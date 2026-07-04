CREATE TABLE muscle_map_entries (
    id          TEXT PRIMARY KEY,
    exercise_id TEXT NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
    muscle      TEXT NOT NULL CHECK (muscle IN ('GLUTES','QUADS','HAMSTRINGS','CHEST','BACK','SHOULDERS','ARMS','CORE','CALVES')),
    role        TEXT NOT NULL CHECK (role IN ('PRIMARY', 'SECONDARY')),
    weight      REAL NOT NULL
);
CREATE INDEX muscle_map_entries_exercise_id ON muscle_map_entries(exercise_id);
