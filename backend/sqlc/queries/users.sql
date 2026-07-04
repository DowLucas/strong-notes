-- name: GetUserByID :one
SELECT * FROM users WHERE id = $1;

-- name: GetActiveUserByID :one
-- Used by the auth middleware to reject any JWT whose subject has been
-- soft-deleted via DELETE /api/me. Returns no row → the token is invalid.
SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL;

-- name: SoftDeleteUser :exec
-- Account self-deletion. Marks the user deleted, nulls PII, and rewrites the
-- unique email to a sentinel so the original address is free to be
-- re-registered.
UPDATE users
SET deleted_at        = NOW(),
    email             = 'deleted-' || id || '@deleted.invalid',
    display_name      = '',
    phone             = NULL,
    avatar_url        = NULL,
    avatar_object_key = NULL,
    avatar_updated_at = NULL,
    updated_at        = NOW()
WHERE id = $1
  AND deleted_at IS NULL;

-- name: DeleteMagicLinkTokensByEmail :exec
DELETE FROM magic_link_tokens WHERE email = $1;

-- name: GetUserByEmail :one
SELECT * FROM users WHERE email = $1;

-- name: UpsertUser :one
INSERT INTO users (id, email, display_name, avatar_url, locale)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (email) DO UPDATE
    SET display_name = EXCLUDED.display_name,
        avatar_url   = COALESCE(EXCLUDED.avatar_url, users.avatar_url),
        updated_at   = NOW()
RETURNING *;

-- name: UpdateUser :one
UPDATE users
SET display_name = COALESCE(sqlc.narg(display_name), display_name),
    avatar_url   = COALESCE(sqlc.narg(avatar_url), avatar_url),
    phone        = COALESCE(sqlc.narg(phone), phone),
    locale       = COALESCE(sqlc.narg(locale), locale),
    updated_at   = NOW()
WHERE id = $1
RETURNING *;

-- name: SetUserAvatar :one
UPDATE users
SET avatar_object_key = $2,
    avatar_updated_at = NOW(),
    updated_at        = NOW()
WHERE id = $1
RETURNING *;

-- name: ClearUserAvatar :one
UPDATE users
SET avatar_object_key = NULL,
    avatar_updated_at = NOW(),
    updated_at        = NOW()
WHERE id = $1
RETURNING *;
