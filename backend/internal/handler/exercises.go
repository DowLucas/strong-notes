package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/DowLucas/strong-notes-backend/internal/db"
	"github.com/DowLucas/strong-notes-backend/internal/science"
	"github.com/DowLucas/strong-notes-backend/internal/ulid"
)

type ExercisesHandler struct {
	queries *db.Queries
}

func NewExercisesHandler(queries *db.Queries) *ExercisesHandler {
	return &ExercisesHandler{queries: queries}
}

var validMuscles = func() map[string]bool {
	m := make(map[string]bool, len(science.MuscleGroups))
	for _, muscle := range science.MuscleGroups {
		m[muscle] = true
	}
	return m
}()

type createExerciseRequest struct {
	Name    string   `json:"name"`
	Muscles []string `json:"muscles"`
}

// exerciseResponse mirrors db.Exercise but with camelCase JSON tags: the
// sqlc-generated model uses db-column-style snake_case tags, which don't
// match the mobile client's expected camelCase response shape.
type exerciseResponse struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Category  string `json:"category"`
	CreatedAt string `json:"createdAt"`
}

func toExerciseResponse(e db.Exercise) exerciseResponse {
	return exerciseResponse{
		ID:        e.ID,
		Name:      e.Name,
		Category:  e.Category,
		CreatedAt: e.CreatedAt.Time.Format(time.RFC3339),
	}
}

// Create handles POST /api/exercises. It looks up an existing exercise by
// name and returns it unchanged (200) if found, otherwise creates a new
// exercise plus its muscle map entries (201). Name-based dedupe means the
// same exercise name always resolves to the same row, regardless of how many
// times an LLM resolution flow re-confirms it.
func (h *ExercisesHandler) Create(w http.ResponseWriter, r *http.Request) {
	var req createExerciseRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}
	// An empty muscle list is allowed: the LLM guess is normalized against the
	// muscle taxonomy and may legitimately end up with nothing recognised —
	// that must not block the user from confirming the exercise itself.

	// Dedupe muscles: a request like ["GLUTES","GLUTES"] should collapse to a
	// single MuscleMapEntry per unique muscle, not one row per occurrence.
	seen := make(map[string]bool, len(req.Muscles))
	muscles := make([]string, 0, len(req.Muscles))
	for _, m := range req.Muscles {
		if !seen[m] {
			seen[m] = true
			muscles = append(muscles, m)
		}
	}

	for _, m := range muscles {
		if !validMuscles[m] {
			writeError(w, http.StatusBadRequest, "invalid muscle: "+m)
			return
		}
	}

	existing, err := h.queries.GetExerciseByName(r.Context(), req.Name)
	if err == nil {
		writeJSON(w, http.StatusOK, toExerciseResponse(existing))
		return
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusInternalServerError, "lookup failed")
		return
	}

	created, err := h.queries.CreateExercise(r.Context(), db.CreateExerciseParams{
		ID: ulid.New(), Name: req.Name, Category: "COMPOUND",
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "create failed")
		return
	}

	// The LLM only provides a flat, unordered-in-meaning muscle list with no
	// explicit primary/secondary signal. As a simple, defensible heuristic we
	// treat the first muscle in the deduped list as the PRIMARY mover (full
	// weight) and every subsequent muscle as a SECONDARY contributor (half
	// weight) for volume-tracking purposes.
	for i, m := range muscles {
		role, weight := "SECONDARY", float32(0.5)
		if i == 0 {
			role, weight = "PRIMARY", 1.0
		}
		if err := h.queries.CreateMuscleMapEntry(r.Context(), db.CreateMuscleMapEntryParams{
			ID: ulid.New(), ExerciseID: created.ID, Muscle: m, Role: role, Weight: weight,
		}); err != nil {
			writeError(w, http.StatusInternalServerError, "muscle map create failed")
			return
		}
	}

	writeJSON(w, http.StatusCreated, toExerciseResponse(created))
}
