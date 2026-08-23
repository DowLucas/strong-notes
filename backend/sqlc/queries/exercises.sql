-- name: GetExerciseByName :one
SELECT * FROM exercises WHERE name = $1;

-- name: CreateExercise :one
INSERT INTO exercises (id, name, category)
VALUES ($1, $2, $3)
RETURNING *;

-- name: CreateMuscleMapEntry :exec
INSERT INTO muscle_map_entries (id, exercise_id, muscle, role, weight)
VALUES ($1, $2, $3, $4, $5);

-- name: GetMuscleMapForExercise :many
SELECT * FROM muscle_map_entries WHERE exercise_id = $1;

-- name: FindExistingExerciseIDs :many
SELECT id FROM exercises WHERE id = ANY(sqlc.arg(ids)::text[]);

-- name: GetExerciseNamesByIDs :many
SELECT id, name FROM exercises WHERE id = ANY(sqlc.arg(ids)::text[]);
