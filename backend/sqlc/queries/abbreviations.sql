-- name: ListAbbreviationsForUser :many
SELECT * FROM abbreviations WHERE user_id = $1 ORDER BY token;

-- name: GetAbbreviationByUserAndToken :one
SELECT * FROM abbreviations WHERE user_id = $1 AND token = $2;

-- name: CreateAbbreviation :one
INSERT INTO abbreviations (id, user_id, token, exercise_id, modifier_type, modifier_value, source)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING *;

-- name: ConfirmAbbreviation :one
UPDATE abbreviations SET source = 'USER_ADDED' WHERE id = $1
RETURNING *;

-- name: FindAbbreviationsForTokens :many
SELECT * FROM abbreviations WHERE user_id = $1 AND token = ANY(sqlc.arg(tokens)::text[]);
