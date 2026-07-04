CREATE TABLE users (
    id                TEXT PRIMARY KEY,
    email             TEXT NOT NULL UNIQUE,
    display_name      TEXT NOT NULL DEFAULT '',
    avatar_url        TEXT,
    avatar_object_key TEXT,                       -- S3 object key for an uploaded avatar
    avatar_updated_at TIMESTAMPTZ,
    phone             TEXT,                        -- optional profile phone number
    locale            TEXT NOT NULL DEFAULT 'en',
    -- Soft-delete (e.g. Apple Guideline 5.1.1(v) account self-deletion). On
    -- delete: deleted_at is set, PII is nulled, and email is rewritten to a
    -- 'deleted-<id>@deleted.invalid' sentinel so the UNIQUE constraint holds
    -- and the original address can be re-registered. The auth middleware
    -- rejects any request whose JWT references a user with deleted_at set.
    deleted_at        TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Partial index on the common path (auth lookups always want non-deleted).
CREATE INDEX users_active ON users(id) WHERE deleted_at IS NULL;
