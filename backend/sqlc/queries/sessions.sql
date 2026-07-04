-- name: UpsertWorkoutSession :one
INSERT INTO workout_sessions (id, user_id, date, notes)
VALUES ($1, $2, $3, $4)
ON CONFLICT (user_id, date) DO UPDATE SET notes = EXCLUDED.notes
RETURNING *;

-- name: DeleteSetEntriesForSession :exec
DELETE FROM set_entries WHERE session_id = $1;

-- name: CreateSetEntry :exec
INSERT INTO set_entries (id, session_id, exercise_id, equipment, weight_kg, reps, sets, raw_text, parsed_by, entry_order)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10);

-- name: GetSetEntriesForSession :many
SELECT * FROM set_entries WHERE session_id = $1 ORDER BY entry_order;

-- name: ListWorkoutSessionsInRange :many
SELECT * FROM workout_sessions WHERE user_id = $1 AND date >= $2 AND date <= $3 ORDER BY date ASC;

-- name: ListSetEntriesForSessionsInRange :many
SELECT set_entries.* FROM set_entries
JOIN workout_sessions ON workout_sessions.id = set_entries.session_id
WHERE workout_sessions.user_id = $1 AND workout_sessions.date >= $2 AND workout_sessions.date <= $3
ORDER BY workout_sessions.date ASC, set_entries.entry_order ASC;
