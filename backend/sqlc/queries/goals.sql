-- name: DeactivateGoalsForUser :exec
UPDATE goals SET is_active = FALSE WHERE user_id = $1 AND is_active = TRUE;

-- name: CreateGoal :one
INSERT INTO goals (id, user_id, type, description, is_active)
VALUES ($1, $2, $3, $4, TRUE)
RETURNING *;

-- name: CreateGoalTarget :exec
INSERT INTO goal_targets (id, goal_id, muscle, min_sets_per_week, max_sets_per_week)
VALUES ($1, $2, $3, $4, $5);

-- name: GetActiveGoalForUser :one
SELECT * FROM goals WHERE user_id = $1 AND is_active = TRUE;

-- name: GetGoalTargetsForGoal :many
SELECT * FROM goal_targets WHERE goal_id = $1;

-- name: GetSessionsWithEntriesInWeek :many
SELECT
  set_entries.exercise_id,
  set_entries.sets,
  muscle_map_entries.muscle
FROM workout_sessions
JOIN set_entries ON set_entries.session_id = workout_sessions.id
JOIN muscle_map_entries ON muscle_map_entries.exercise_id = set_entries.exercise_id
WHERE workout_sessions.user_id = $1
  AND workout_sessions.date >= $2
  AND workout_sessions.date < $3
  AND set_entries.sets IS NOT NULL;
