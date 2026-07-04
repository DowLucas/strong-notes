package handler

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/DowLucas/strong-notes-backend/internal/db"
	"github.com/DowLucas/strong-notes-backend/internal/middleware"
	"github.com/DowLucas/strong-notes-backend/internal/ulid"
)

type SessionsHandler struct {
	pool    *pgxpool.Pool
	queries *db.Queries
}

func NewSessionsHandler(pool *pgxpool.Pool, queries *db.Queries) *SessionsHandler {
	return &SessionsHandler{pool: pool, queries: queries}
}

func (h *SessionsHandler) Get(w http.ResponseWriter, r *http.Request) {
	claims := middleware.ClaimsFromContext(r.Context())
	from, err1 := time.Parse("2006-01-02", r.URL.Query().Get("from"))
	to, err2 := time.Parse("2006-01-02", r.URL.Query().Get("to"))
	if err1 != nil || err2 != nil {
		writeError(w, http.StatusBadRequest, "from and to must be YYYY-MM-DD")
		return
	}

	sessions, err := h.queries.ListWorkoutSessionsInRange(r.Context(), db.ListWorkoutSessionsInRangeParams{
		UserID: claims.UserID,
		Date:   pgtype.Date{Time: from, Valid: true},
		Date_2: pgtype.Date{Time: to, Valid: true},
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "list failed")
		return
	}

	// Fetch every session's entries in a single batched query instead of one
	// query per session (N+1), then group the flat list by session in Go.
	entries, err := h.queries.ListSetEntriesForSessionsInRange(r.Context(), db.ListSetEntriesForSessionsInRangeParams{
		UserID: claims.UserID,
		Date:   pgtype.Date{Time: from, Valid: true},
		Date_2: pgtype.Date{Time: to, Valid: true},
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "fetch entries failed")
		return
	}
	entriesBySession := make(map[string][]setEntryResponse, len(sessions))
	for _, e := range entries {
		entriesBySession[e.SessionID] = append(entriesBySession[e.SessionID], toSetEntryResponse(e))
	}

	responses := make([]map[string]any, len(sessions))
	for i, session := range sessions {
		entryResponses := entriesBySession[session.ID]
		if entryResponses == nil {
			entryResponses = []setEntryResponse{}
		}
		responses[i] = map[string]any{
			"id":      session.ID,
			"date":    session.Date,
			"notes":   session.Notes,
			"entries": entryResponses,
		}
	}
	writeJSON(w, http.StatusOK, responses)
}

type putSessionEntry struct {
	ExerciseID *string  `json:"exerciseId"`
	Equipment  *string  `json:"equipment"`
	WeightKg   *float32 `json:"weightKg"`
	Reps       *int32   `json:"reps"`
	Sets       *int32   `json:"sets"`
	RawText    string   `json:"rawText"`
	ParsedBy   string   `json:"parsedBy"`
	Order      int32    `json:"order"`
}

type putSessionRequest struct {
	Notes   *string           `json:"notes"`
	Entries []putSessionEntry `json:"entries"`
}

// setEntryResponse mirrors db.SetEntry but with camelCase JSON tags: the
// sqlc-generated model uses db-column-style snake_case tags, which don't
// match the mobile client's expected camelCase response shape.
type setEntryResponse struct {
	ID         string   `json:"id"`
	SessionID  string   `json:"sessionId"`
	ExerciseID *string  `json:"exerciseId"`
	Equipment  *string  `json:"equipment"`
	WeightKg   *float32 `json:"weightKg"`
	Reps       *int32   `json:"reps"`
	Sets       *int32   `json:"sets"`
	RawText    string   `json:"rawText"`
	ParsedBy   string   `json:"parsedBy"`
	Order      int32    `json:"order"`
}

func toSetEntryResponse(e db.SetEntry) setEntryResponse {
	return setEntryResponse{
		ID:         e.ID,
		SessionID:  e.SessionID,
		ExerciseID: e.ExerciseID,
		Equipment:  e.Equipment,
		WeightKg:   e.WeightKg,
		Reps:       e.Reps,
		Sets:       e.Sets,
		RawText:    e.RawText,
		ParsedBy:   e.ParsedBy,
		Order:      e.EntryOrder,
	}
}

func (h *SessionsHandler) Put(w http.ResponseWriter, r *http.Request) {
	claims := middleware.ClaimsFromContext(r.Context())
	date, err := time.Parse("2006-01-02", chi.URLParam(r, "date"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "date must be YYYY-MM-DD")
		return
	}

	var req putSessionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}

	// Validate every referenced exerciseId exists up front so a bogus id
	// fails fast with a 400 instead of tripping the set_entries.exercise_id
	// foreign key mid-transaction and surfacing as a generic 500.
	seenExerciseIDs := make(map[string]bool, len(req.Entries))
	requestedExerciseIDs := make([]string, 0, len(req.Entries))
	for _, e := range req.Entries {
		if e.ExerciseID == nil || seenExerciseIDs[*e.ExerciseID] {
			continue
		}
		seenExerciseIDs[*e.ExerciseID] = true
		requestedExerciseIDs = append(requestedExerciseIDs, *e.ExerciseID)
	}
	if len(requestedExerciseIDs) > 0 {
		existingIDs, err := h.queries.FindExistingExerciseIDs(r.Context(), requestedExerciseIDs)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "exercise lookup failed")
			return
		}
		existing := make(map[string]bool, len(existingIDs))
		for _, id := range existingIDs {
			existing[id] = true
		}
		for _, id := range requestedExerciseIDs {
			if !existing[id] {
				writeError(w, http.StatusBadRequest, "unknown exerciseId: "+id)
				return
			}
		}
	}

	tx, err := h.pool.Begin(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "tx begin failed")
		return
	}
	defer tx.Rollback(r.Context())
	qtx := h.queries.WithTx(tx)

	session, err := qtx.UpsertWorkoutSession(r.Context(), db.UpsertWorkoutSessionParams{
		ID:     ulid.New(),
		UserID: claims.UserID,
		Date:   pgtype.Date{Time: date, Valid: true},
		Notes:  req.Notes,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "upsert failed")
		return
	}
	if err := qtx.DeleteSetEntriesForSession(r.Context(), session.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "delete entries failed")
		return
	}
	for _, e := range req.Entries {
		if err := qtx.CreateSetEntry(r.Context(), db.CreateSetEntryParams{
			ID:         ulid.New(),
			SessionID:  session.ID,
			ExerciseID: e.ExerciseID,
			Equipment:  e.Equipment,
			WeightKg:   e.WeightKg,
			Reps:       e.Reps,
			Sets:       e.Sets,
			RawText:    e.RawText,
			ParsedBy:   e.ParsedBy,
			EntryOrder: e.Order,
		}); err != nil {
			writeError(w, http.StatusInternalServerError, "create entry failed")
			return
		}
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, "tx commit failed")
		return
	}

	entries, err := h.queries.GetSetEntriesForSession(r.Context(), session.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "fetch entries failed")
		return
	}
	entryResponses := make([]setEntryResponse, len(entries))
	for i, e := range entries {
		entryResponses[i] = toSetEntryResponse(e)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"id":      session.ID,
		"date":    session.Date,
		"notes":   session.Notes,
		"entries": entryResponses,
	})
}
