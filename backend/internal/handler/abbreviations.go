package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"github.com/DowLucas/strong-notes-backend/internal/db"
	"github.com/DowLucas/strong-notes-backend/internal/middleware"
	"github.com/DowLucas/strong-notes-backend/internal/parsing"
	"github.com/DowLucas/strong-notes-backend/internal/ulid"
)

type AbbreviationsHandler struct {
	queries *db.Queries
}

func NewAbbreviationsHandler(queries *db.Queries) *AbbreviationsHandler {
	return &AbbreviationsHandler{queries: queries}
}

// abbreviationResponse mirrors db.Abbreviation but with camelCase JSON tags:
// the sqlc-generated model uses db-column-style snake_case tags, which don't
// match the mobile client's expected camelCase response shape.
type abbreviationResponse struct {
	ID            string  `json:"id"`
	Token         string  `json:"token"`
	ExerciseID    *string `json:"exerciseId"`
	ExerciseName  *string `json:"exerciseName"`
	ModifierType  *string `json:"modifierType"`
	ModifierValue *string `json:"modifierValue"`
	Source        string  `json:"source"`
	CreatedAt     string  `json:"createdAt"`
}

// toAbbreviationResponse maps one row; names supplies the exercise name for
// a.ExerciseID (nil when unknown or when the abbreviation is a modifier).
func toAbbreviationResponse(a db.Abbreviation, names map[string]string) abbreviationResponse {
	var exerciseName *string
	if a.ExerciseID != nil {
		if name, ok := names[*a.ExerciseID]; ok {
			exerciseName = &name
		}
	}
	return abbreviationResponse{
		ID:            a.ID,
		Token:         a.Token,
		ExerciseID:    a.ExerciseID,
		ExerciseName:  exerciseName,
		ModifierType:  a.ModifierType,
		ModifierValue: a.ModifierValue,
		Source:        a.Source,
		CreatedAt:     a.CreatedAt.Time.Format(time.RFC3339),
	}
}

// writeAbbreviation responds with a single abbreviation, resolving its
// exercise name (if it points at an exercise).
func (h *AbbreviationsHandler) writeAbbreviation(w http.ResponseWriter, r *http.Request, status int, a db.Abbreviation) {
	var ids []string
	if a.ExerciseID != nil {
		ids = []string{*a.ExerciseID}
	}
	names, err := parsing.ExerciseNamesByID(r.Context(), h.queries, ids)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "lookup failed")
		return
	}
	writeJSON(w, status, toAbbreviationResponse(a, names))
}

func (h *AbbreviationsHandler) List(w http.ResponseWriter, r *http.Request) {
	claims := middleware.ClaimsFromContext(r.Context())
	list, err := h.queries.ListAbbreviationsForUser(r.Context(), claims.UserID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "list failed")
		return
	}
	var exerciseIDs []string
	for _, a := range list {
		if a.ExerciseID != nil {
			exerciseIDs = append(exerciseIDs, *a.ExerciseID)
		}
	}
	names, err := parsing.ExerciseNamesByID(r.Context(), h.queries, exerciseIDs)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "list failed")
		return
	}
	responses := make([]abbreviationResponse, len(list))
	for i, a := range list {
		responses[i] = toAbbreviationResponse(a, names)
	}
	writeJSON(w, http.StatusOK, responses)
}

type createAbbreviationRequest struct {
	Token         string  `json:"token"`
	ExerciseID    *string `json:"exerciseId"`
	ModifierType  *string `json:"modifierType"`
	ModifierValue *string `json:"modifierValue"`
}

func (h *AbbreviationsHandler) Create(w http.ResponseWriter, r *http.Request) {
	var req createAbbreviationRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || strings.TrimSpace(req.Token) == "" {
		writeError(w, http.StatusBadRequest, "token is required")
		return
	}
	// Tokens are canonically upper-case: matching is case-insensitive and
	// "Bench"/"bench" must be one dictionary entry, not two.
	req.Token = parsing.CanonicalToken(req.Token)
	claims := middleware.ClaimsFromContext(r.Context())

	existing, err := h.queries.GetAbbreviationByUserAndToken(r.Context(), db.GetAbbreviationByUserAndTokenParams{UserID: claims.UserID, Token: req.Token})
	if err == nil {
		h.writeAbbreviation(w, r, http.StatusCreated, existing)
		return
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusInternalServerError, "lookup failed")
		return
	}

	created, err := h.queries.CreateAbbreviation(r.Context(), db.CreateAbbreviationParams{
		ID: ulid.New(), UserID: claims.UserID, Token: req.Token,
		ExerciseID: req.ExerciseID, ModifierType: req.ModifierType, ModifierValue: req.ModifierValue,
		Source: "USER_ADDED",
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "create failed")
		return
	}
	h.writeAbbreviation(w, r, http.StatusCreated, created)
}

func (h *AbbreviationsHandler) Confirm(w http.ResponseWriter, r *http.Request) {
	claims := middleware.ClaimsFromContext(r.Context())
	id := chi.URLParam(r, "id")
	updated, err := h.queries.ConfirmAbbreviationForUser(r.Context(), db.ConfirmAbbreviationForUserParams{ID: id, UserID: claims.UserID})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "abbreviation not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "confirm failed")
		return
	}
	h.writeAbbreviation(w, r, http.StatusOK, updated)
}
