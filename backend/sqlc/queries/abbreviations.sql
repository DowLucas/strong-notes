-- name: ListAbbreviationsForUser :many
SELECT * FROM abbreviations WHERE user_id = $1 ORDER BY token;

-- name: GetAbbreviationByUserAndToken :one
SELECT * FROM abbreviations WHERE user_id = $1 AND UPPER(token) = UPPER(sqlc.arg(token)::text);

-- name: CreateAbbreviation :one
INSERT INTO abbreviations (id, user_id, token, exercise_id, modifier_type, modifier_value, source)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING *;

-- name: ConfirmAbbreviationForUser :one
UPDATE abbreviations SET source = 'USER_ADDED' WHERE id = $1 AND user_id = $2
RETURNING *;

-- name: FindAbbreviationsForTokens :many
-- tokens are passed canonical (upper-case); compare case-insensitively so
-- rows stored before canonicalisation still match.
SELECT * FROM abbreviations WHERE user_id = $1 AND UPPER(token) = ANY(sqlc.arg(tokens)::text[]);
