CREATE TABLE abbreviations (
    id             TEXT PRIMARY KEY,
    user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token          TEXT NOT NULL,
    exercise_id    TEXT REFERENCES exercises(id) ON DELETE SET NULL,
    modifier_type  TEXT,
    modifier_value TEXT,
    source         TEXT NOT NULL CHECK (source IN ('BUILT_IN', 'USER_ADDED', 'LLM_SUGGESTED_PENDING_CONFIRM')) DEFAULT 'USER_ADDED',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, token)
);
