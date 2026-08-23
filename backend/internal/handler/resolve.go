package handler

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/DowLucas/strong-notes-backend/internal/db"
	"github.com/DowLucas/strong-notes-backend/internal/llm"
	"github.com/DowLucas/strong-notes-backend/internal/middleware"
	"github.com/DowLucas/strong-notes-backend/internal/parsing"
)

type ResolveHandler struct {
	queries  *db.Queries
	provider llm.Provider
}

func NewResolveHandler(queries *db.Queries, provider llm.Provider) *ResolveHandler {
	return &ResolveHandler{queries: queries, provider: provider}
}

type resolveLineRequest struct {
	Line string `json:"line"`
}

func (h *ResolveHandler) ResolveLine(w http.ResponseWriter, r *http.Request) {
	var req resolveLineRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Line == "" {
		writeError(w, http.StatusBadRequest, "line is required")
		return
	}
	claims := middleware.ClaimsFromContext(r.Context())

	dictResult, err := parsing.ResolveLineWithDictionary(r.Context(), h.queries, claims.UserID, req.Line)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "resolve failed")
		return
	}

	if len(dictResult.UnresolvedTokens) == 0 {
		writeJSON(w, http.StatusOK, map[string]any{
			"resolvedTokens":   dictResult.ResolvedTokens,
			"unresolvedTokens": dictResult.UnresolvedTokens,
		})
		return
	}

	guess, err := h.provider.ResolveLine(r.Context(), req.Line, dictResult.UnresolvedTokens)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "llm resolve failed")
		return
	}
	// Small local models sometimes answer with no exercise name at all; one
	// retry is cheap and usually enough before falling back to a name built
	// from the raw tokens (see NormalizeLineGuess).
	if strings.TrimSpace(guess.ExerciseName) == "" {
		if retry, rerr := h.provider.ResolveLine(r.Context(), req.Line, dictResult.UnresolvedTokens); rerr == nil {
			guess = retry
		}
	}
	guess = llm.NormalizeLineGuess(dictResult.UnresolvedTokens, guess)
	writeJSON(w, http.StatusOK, map[string]any{
		"resolvedTokens":   dictResult.ResolvedTokens,
		"unresolvedTokens": dictResult.UnresolvedTokens,
		"llmGuess":         guess,
	})
}

type resolveGoalRequest struct {
	Text string `json:"text"`
}

func (h *ResolveHandler) ResolveGoal(w http.ResponseWriter, r *http.Request) {
	var req resolveGoalRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Text == "" {
		writeError(w, http.StatusBadRequest, "text is required")
		return
	}
	guess, err := h.provider.ResolveGoal(r.Context(), req.Text)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "llm resolve failed")
		return
	}
	writeJSON(w, http.StatusOK, guess)
}
