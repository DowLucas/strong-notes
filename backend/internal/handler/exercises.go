package handler

import (
	"encoding/json"
	"errors"
	"net/http"

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
	if len(req.Muscles) == 0 {
		writeError(w, http.StatusBadRequest, "at least one muscle is required")
		return
	}
	for _, m := range req.Muscles {
		if !validMuscles[m] {
			writeError(w, http.StatusBadRequest, "invalid muscle: "+m)
			return
		}
	}

	existing, err := h.queries.GetExerciseByName(r.Context(), req.Name)
	if err == nil {
		writeJSON(w, http.StatusOK, existing)
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

	for _, m := range req.Muscles {
		if err := h.queries.CreateMuscleMapEntry(r.Context(), db.CreateMuscleMapEntryParams{
			ID: ulid.New(), ExerciseID: created.ID, Muscle: m, Role: "PRIMARY", Weight: 1,
		}); err != nil {
			writeError(w, http.StatusInternalServerError, "muscle map create failed")
			return
		}
	}

	writeJSON(w, http.StatusCreated, created)
}
