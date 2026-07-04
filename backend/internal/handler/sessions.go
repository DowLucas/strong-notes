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
	writeJSON(w, http.StatusOK, sessions)
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
