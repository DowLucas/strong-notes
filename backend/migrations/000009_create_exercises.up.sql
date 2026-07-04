CREATE TABLE exercises (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE,
    category   TEXT NOT NULL CHECK (category IN ('COMPOUND', 'ISOLATION')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
