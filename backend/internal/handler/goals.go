package handler

import (
	"encoding/json"
	"math"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/DowLucas/strong-notes-backend/internal/db"
	"github.com/DowLucas/strong-notes-backend/internal/middleware"
	"github.com/DowLucas/strong-notes-backend/internal/science"
	"github.com/DowLucas/strong-notes-backend/internal/ulid"
)

type GoalsHandler struct {
	pool    *pgxpool.Pool
	queries *db.Queries
}

func NewGoalsHandler(pool *pgxpool.Pool, queries *db.Queries) *GoalsHandler {
	return &GoalsHandler{pool: pool, queries: queries}
}

type goalOverride struct {
	Muscle string `json:"muscle"`
	Min    int    `json:"min"`
	Max    int    `json:"max"`
}

type createGoalRequest struct {
	Type        string         `json:"type"`
	Description *string        `json:"description"`
	Overrides   []goalOverride `json:"overrides"`
}

// validGoalTypes mirrors the goals.type CHECK constraint in the DB schema.
// Validating here lets an unrecognized type surface as a 400 instead of
// falling through to science.VolumeTargets (which returns an empty map for
// unknown types) and failing as an opaque 500 on the DB constraint.
var validGoalTypes = map[string]bool{
	"HYPERTROPHY": true,
	"STRENGTH":    true,
	"ENDURANCE":   true,
	"CUSTOM":      true,
}

// goalTargetResponse mirrors db.GoalTarget but with camelCase JSON tags: the
// sqlc-generated model uses db-column-style snake_case tags, which don't
// match the mobile client's expected camelCase response shape.
type goalTargetResponse struct {
	Muscle         string `json:"muscle"`
	MinSetsPerWeek int32  `json:"minSetsPerWeek"`
	MaxSetsPerWeek int32  `json:"maxSetsPerWeek"`
}

func toGoalTargetResponse(t db.GoalTarget) goalTargetResponse {
	return goalTargetResponse{
		Muscle:         t.Muscle,
		MinSetsPerWeek: t.MinSetsPerWeek,
		MaxSetsPerWeek: t.MaxSetsPerWeek,
	}
}

// goalResponse mirrors db.Goal plus its targets, with camelCase JSON tags.
type goalResponse struct {
	ID          string               `json:"id"`
	Type        string               `json:"type"`
	Description *string              `json:"description"`
	Targets     []goalTargetResponse `json:"targets"`
}

// Create handles POST /api/goals. It deactivates any currently-active goal
// for the user and creates a new one with per-muscle weekly set targets,
// seeded from science.VolumeTargets(type) and overridden per-muscle by the
// request's overrides. Deactivate + create + create-targets all happen in one
// transaction so a partial failure never leaves the user without an active
// goal (or with two active goals).
func (h *GoalsHandler) Create(w http.ResponseWriter, r *http.Request) {
	var req createGoalRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Type == "" {
		writeError(w, http.StatusBadRequest, "type is required")
		return
	}
	if !validGoalTypes[req.Type] {
		writeError(w, http.StatusBadRequest, "type must be one of HYPERTROPHY, STRENGTH, ENDURANCE, CUSTOM")
		return
	}
	claims := middleware.ClaimsFromContext(r.Context())
	defaults := science.VolumeTargets(req.Type)

	overrideByMuscle := make(map[string]goalOverride, len(req.Overrides))
	for _, o := range req.Overrides {
		overrideByMuscle[o.Muscle] = o
	}

	tx, err := h.pool.Begin(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "tx begin failed")
		return
	}
	defer tx.Rollback(r.Context())
	qtx := h.queries.WithTx(tx)

	if err := qtx.DeactivateGoalsForUser(r.Context(), claims.UserID); err != nil {
		writeError(w, http.StatusInternalServerError, "deactivate failed")
		return
	}
	goal, err := qtx.CreateGoal(r.Context(), db.CreateGoalParams{
		ID: ulid.New(), UserID: claims.UserID, Type: req.Type, Description: req.Description,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "create goal failed")
		return
	}

	targets := make([]goalTargetResponse, 0, len(science.MuscleGroups))
	for _, muscle := range science.MuscleGroups {
		min, max := int32(defaults[muscle].Min), int32(defaults[muscle].Max)
		if o, ok := overrideByMuscle[muscle]; ok {
			min, max = int32(o.Min), int32(o.Max)
		}
		if err := qtx.CreateGoalTarget(r.Context(), db.CreateGoalTargetParams{
			ID: ulid.New(), GoalID: goal.ID, Muscle: muscle, MinSetsPerWeek: min, MaxSetsPerWeek: max,
		}); err != nil {
			writeError(w, http.StatusInternalServerError, "create target failed")
			return
		}
		targets = append(targets, goalTargetResponse{Muscle: muscle, MinSetsPerWeek: min, MaxSetsPerWeek: max})
	}

	if err := tx.Commit(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, "tx commit failed")
		return
	}

	writeJSON(w, http.StatusCreated, goalResponse{
		ID: goal.ID, Type: goal.Type, Description: goal.Description, Targets: targets,
	})
}

// GetActive handles GET /api/goals/active.
func (h *GoalsHandler) GetActive(w http.ResponseWriter, r *http.Request) {
	claims := middleware.ClaimsFromContext(r.Context())
	goal, err := h.queries.GetActiveGoalForUser(r.Context(), claims.UserID)
	if err != nil {
		writeError(w, http.StatusNotFound, "no active goal")
		return
	}
	targets, err := h.queries.GetGoalTargetsForGoal(r.Context(), goal.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "fetch targets failed")
		return
	}
	targetResponses := make([]goalTargetResponse, len(targets))
	for i, t := range targets {
		targetResponses[i] = toGoalTargetResponse(t)
	}
	writeJSON(w, http.StatusOK, goalResponse{
		ID: goal.ID, Type: goal.Type, Description: goal.Description, Targets: targetResponses,
	})
}

// goalProgressEntry reports one muscle's weekly target range against the
// actual logged sets for the requested week.
type goalProgressEntry struct {
	Muscle     string `json:"muscle"`
	TargetMin  int32  `json:"targetMin"`
	TargetMax  int32  `json:"targetMax"`
	ActualSets int32  `json:"actualSets"`
}

// GetActiveProgress handles GET /api/goals/active/progress?weekStart=YYYY-MM-DD.
// It sums logged sets per muscle across the 7-day window starting at
// weekStart (inclusive) and pairs each active-goal target with its actual.
func (h *GoalsHandler) GetActiveProgress(w http.ResponseWriter, r *http.Request) {
	claims := middleware.ClaimsFromContext(r.Context())
	goal, err := h.queries.GetActiveGoalForUser(r.Context(), claims.UserID)
	if err != nil {
		writeError(w, http.StatusNotFound, "no active goal")
		return
	}
	targets, err := h.queries.GetGoalTargetsForGoal(r.Context(), goal.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "fetch targets failed")
		return
	}

	weekStart, err := time.Parse("2006-01-02", r.URL.Query().Get("weekStart"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "weekStart must be YYYY-MM-DD")
		return
	}
	weekEnd := weekStart.AddDate(0, 0, 7)

	rows, err := h.queries.GetSessionsWithEntriesInWeek(r.Context(), db.GetSessionsWithEntriesInWeekParams{
		UserID: claims.UserID,
		Date:   pgtype.Date{Time: weekStart, Valid: true},
		Date_2: pgtype.Date{Time: weekEnd, Valid: true},
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "aggregate failed")
		return
	}
	// Sets are weighted by each muscle's contribution to the exercise (e.g. a
	// SECONDARY mover at weight 0.5 counts half as much as the PRIMARY mover)
	// so a muscle only lightly worked by an exercise doesn't get full credit
	// toward its weekly volume target.
	actualByMuscle := make(map[string]float64)
	for _, row := range rows {
		if row.Sets == nil {
			continue
		}
		actualByMuscle[row.Muscle] += float64(*row.Sets) * float64(row.Weight)
	}

	progress := make([]goalProgressEntry, 0, len(targets))
	for _, target := range targets {
		progress = append(progress, goalProgressEntry{
			Muscle:     target.Muscle,
			TargetMin:  target.MinSetsPerWeek,
			TargetMax:  target.MaxSetsPerWeek,
			ActualSets: int32(math.Round(actualByMuscle[target.Muscle])),
		})
	}
	writeJSON(w, http.StatusOK, progress)
}
