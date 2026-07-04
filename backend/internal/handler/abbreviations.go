package handler

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"github.com/DowLucas/strong-notes-backend/internal/db"
	"github.com/DowLucas/strong-notes-backend/internal/middleware"
	"github.com/DowLucas/strong-notes-backend/internal/ulid"
)

type AbbreviationsHandler struct {
	queries *db.Queries
}

func NewAbbreviationsHandler(queries *db.Queries) *AbbreviationsHandler {
	return &AbbreviationsHandler{queries: queries}
}

func (h *AbbreviationsHandler) List(w http.ResponseWriter, r *http.Request) {
	claims := middleware.ClaimsFromContext(r.Context())
	list, err := h.queries.ListAbbreviationsForUser(r.Context(), claims.UserID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "list failed")
		return
	}
	writeJSON(w, http.StatusOK, list)
}

type createAbbreviationRequest struct {
	Token         string  `json:"token"`
	ExerciseID    *string `json:"exerciseId"`
	ModifierType  *string `json:"modifierType"`
	ModifierValue *string `json:"modifierValue"`
}

func (h *AbbreviationsHandler) Create(w http.ResponseWriter, r *http.Request) {
	var req createAbbreviationRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Token == "" {
		writeError(w, http.StatusBadRequest, "token is required")
		return
	}
	claims := middleware.ClaimsFromContext(r.Context())

	existing, err := h.queries.GetAbbreviationByUserAndToken(r.Context(), db.GetAbbreviationByUserAndTokenParams{UserID: claims.UserID, Token: req.Token})
	if err == nil {
		writeJSON(w, http.StatusCreated, existing)
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
	writeJSON(w, http.StatusCreated, created)
}

func (h *AbbreviationsHandler) Confirm(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	updated, err := h.queries.ConfirmAbbreviation(r.Context(), id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "abbreviation not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "confirm failed")
		return
	}
	writeJSON(w, http.StatusOK, updated)
}
