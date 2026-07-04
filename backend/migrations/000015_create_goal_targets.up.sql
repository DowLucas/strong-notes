CREATE TABLE goal_targets (
    id                TEXT PRIMARY KEY,
    goal_id           TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    muscle            TEXT NOT NULL CHECK (muscle IN ('GLUTES','QUADS','HAMSTRINGS','CHEST','BACK','SHOULDERS','ARMS','CORE','CALVES')),
    min_sets_per_week INTEGER NOT NULL,
    max_sets_per_week INTEGER NOT NULL
);
CREATE INDEX goal_targets_goal_id ON goal_targets(goal_id);
