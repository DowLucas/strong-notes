CREATE TABLE set_entries (
    id          TEXT PRIMARY KEY,
    session_id  TEXT NOT NULL REFERENCES workout_sessions(id) ON DELETE RESTRICT,
    exercise_id TEXT REFERENCES exercises(id) ON DELETE SET NULL,
    equipment   TEXT,
    weight_kg   REAL,
    reps        INTEGER,
    sets        INTEGER,
    raw_text    TEXT NOT NULL,
    parsed_by   TEXT NOT NULL CHECK (parsed_by IN ('DICTIONARY', 'LLM')),
    entry_order INTEGER NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX set_entries_session_id ON set_entries(session_id);
