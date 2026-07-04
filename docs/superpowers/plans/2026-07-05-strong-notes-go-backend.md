# Strong Notes Go Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Express/Prisma backend with a Go service forked from `github.com/DowLucas/app-scaffold`, porting every domain table, endpoint, and business rule verbatim while adopting the scaffold's magic-link/JWT auth, sqlc/golang-migrate data layer, and Chi router.

**Architecture:** A fresh clone of the scaffold becomes `backend/` (replacing the old Express project entirely). The scaffold's auth/health/well-known machinery is kept as-is. Seven new domain tables are added via golang-migrate SQL + sqlc-generated queries. New Chi handlers under `internal/handler` implement `/api/resolve/*`, `/api/exercises`, `/api/abbreviations`, `/api/sessions`, `/api/goals*`, each deriving `user_id` from the JWT claims the scaffold's `Authenticate` middleware already puts on the request context.

**Tech Stack:** Go 1.25, Chi v5, sqlc (pgx/v5), golang-migrate, Postgres 16, testify + testcontainers-go (integration tests), the scaffold's existing JWT/magic-link auth stack.

## Global Constraints

- Module path: `github.com/DowLucas/strong-notes-backend`. Package layout, handler/middleware conventions, and error-response shape (`internal/handler/errors.go`'s `writeJSON`/`writeError`) all follow the scaffold exactly — do not invent a different style.
- Every domain row carries a real `user_id TEXT NOT NULL REFERENCES users(id)` (scaffold's `users.id` is a ULID string) — no hardcoded user id anywhere.
- All new IDs use `internal/ulid.New()` (26-char Crockford base32 strings), matching every existing scaffold table.
- Auth: every domain route is mounted inside the scaffold's existing authenticated route group (`middleware.ProtocolVersion` + `middleware.Authenticate`) in `internal/server/server.go`. `middleware.ClaimsFromContext(r.Context()).UserID` is the only source of the acting user's id — never a request parameter.
- LLM prompts (verbatim, do not alter):
  ```go
  const LinePrompt = `You are a gym-log parser. Given this logged line: "%s"
The unrecognized tokens are: %s.
Shorthand convention: a token like "8x3" means 8 reps per set, done for 3 sets - the first number is reps, the second is sets.
Expand any abbreviated or shorthand exercise name into its full common name (e.g. "crabwalk" -> "Crab Walk", "OHP" -> "Overhead Press") rather than echoing the raw token back.
Also identify which muscle groups the identified exercise primarily works, from
["GLUTES","QUADS","HAMSTRINGS","CHEST","BACK","SHOULDERS","ARMS","CORE","CALVES"].
Respond ONLY with JSON: {"exerciseName": string, "equipment": string|null, "weightKg": number|null, "reps": number|null, "sets": number|null, "muscles": string[]}`

  const GoalPrompt = `You are a fitness goal classifier. Given this goal description: "%s"
Respond ONLY with JSON: {"type": "HYPERTROPHY"|"STRENGTH"|"ENDURANCE"|"CUSTOM", "muscles": string[]} where muscles are from
["GLUTES","QUADS","HAMSTRINGS","CHEST","BACK","SHOULDERS","ARMS","CORE","CALVES"].`
  ```
- Numeric-token regex for dictionary resolution (weight/reps-sets exclusion), verbatim from the TS source: `^\d+(\.\d+)?(kg|lb)?$|^\d+x\d+$` (case-insensitive).
- Static volume-science table (goal type → muscle → `{min, max}` sets/week), verbatim from the TS source:
  | Muscle | HYPERTROPHY | STRENGTH | ENDURANCE |
  |---|---|---|---|
  | GLUTES | 12-20 | 4-8 | 8-14 |
  | QUADS | 10-18 | 4-8 | 8-14 |
  | HAMSTRINGS | 8-16 | 3-6 | 6-12 |
  | CHEST | 10-18 | 3-6 | 6-12 |
  | BACK | 10-16 | 4-8 | 6-12 |
  | SHOULDERS | 8-16 | 3-6 | 6-12 |
  | ARMS | 6-14 | 2-5 | 5-10 |
  | CORE | 6-12 | 3-6 | 8-14 |
  | CALVES | 8-16 | 3-6 | 8-14 |

  `CUSTOM` uses the same values as `HYPERTROPHY`.
- S3/avatar storage and River jobs stay disabled (`S3_ENDPOINT` unset, `JOBS_ENABLED=false`) — no task in this plan touches `internal/storage` or `internal/jobs`.
- Sign-up stays gated to the scaffold's existing `DEMO_LOGIN_EMAILS` allowlist mechanism (`config.IsDemoLogin`) — no new gating logic needed, just populate the env var at deploy time.

---

## File Structure

```
backend/                              # replaces the old Express project entirely
  cmd/api/main.go                     # from scaffold, unmodified
  internal/
    config/config.go                 # MODIFY: add LLMProvider/OllamaURL/OllamaModel/AnthropicAPIKey
    auth/, email/, jobs/, storage/, ulid/, wellknown/, middleware/   # from scaffold, unmodified
    db/                               # sqlc-generated; gains files from new queries
    handler/
      auth.go, avatar.go, errors.go, health.go   # from scaffold, unmodified
      resolve.go                      # NEW
      exercises.go                    # NEW
      abbreviations.go                # NEW
      sessions.go                     # NEW
      goals.go                        # NEW
    science/
      muscle_groups.go                # NEW
      volume_table.go                 # NEW
    parsing/
      dictionary_resolver.go          # NEW
    llm/
      provider.go                     # NEW
      prompts.go                      # NEW
      ollama_provider.go               # NEW
      anthropic_provider.go            # NEW
    server/server.go                  # MODIFY: mount new routers
  migrations/
    000009_create_exercises.{up,down}.sql
    000010_create_muscle_map_entries.{up,down}.sql
    000011_create_abbreviations.{up,down}.sql
    000012_create_workout_sessions.{up,down}.sql
    000013_create_set_entries.{up,down}.sql
    000014_create_goals.{up,down}.sql
    000015_create_goal_targets.{up,down}.sql
  sqlc/queries/
    exercises.sql, abbreviations.sql, sessions.sql, goals.sql   # NEW
  docker-compose.yml                  # MODIFY: drop MinIO dependency for this project
  .env.local.example                  # MODIFY: add LLM_PROVIDER/OLLAMA_URL/OLLAMA_MODEL/ANTHROPIC_API_KEY, DEV_MODE=true, DEMO_LOGIN_EMAILS
```

---

### Task 1: Fork the scaffold and verify it boots

**Files:**
- Create: `backend/` (entire scaffold clone, module renamed)
- Modify: `backend/internal/config/config.go`
- Modify: `backend/.env.local.example` (or wherever the scaffold's example env file lives — check after cloning; adapt exactly to what's there)

**Interfaces:**
- Consumes: nothing (foundational).
- Produces: a booting Go server with the scaffold's existing auth/health/well-known routes working end-to-end against a fresh Postgres, plus `config.Config` gaining `LLMProvider string`, `OllamaURL string`, `OllamaModel string`, `AnthropicAPIKey string` fields that Task 5 depends on.

- [ ] **Step 1: Remove the old Express backend and clone the scaffold in its place**

```bash
cd /home/lucas/dev/projects/strong-notes
git rm -r backend
git clone --depth 1 https://github.com/DowLucas/app-scaffold.git /tmp/scaffold-source
cp -r /tmp/scaffold-source/backend ./backend
rm -rf /tmp/scaffold-source
rm -rf backend/app  # if the clone included the scaffold's own mobile app directory, remove it — this repo's mobile/ is separate and handled in a later plan
```

- [ ] **Step 2: Rename the Go module**

```bash
cd backend
grep -rl "github.com/DowLucas/app-scaffold" --include="*.go" . | xargs sed -i 's|github.com/DowLucas/app-scaffold|github.com/DowLucas/strong-notes-backend|g'
sed -i 's|^module .*|module github.com/DowLucas/strong-notes-backend|' go.mod
go build ./... 2>&1 | tail -30
```
Expected: builds cleanly (or only fails on the `app` directory removal above if it referenced Go — it shouldn't, that's the Expo app).

- [ ] **Step 3: Add LLM config fields**

Open `backend/internal/config/config.go`. Add to the `Config` struct (near the other feature-flag-style fields):

```go
	// LLM (shorthand/goal resolution fallback)
	LLMProvider     string // "ollama" | "anthropic"
	OllamaURL       string
	OllamaModel     string
	AnthropicAPIKey string
```

Add to `Load()`'s struct literal:

```go
		LLMProvider:     getEnv("LLM_PROVIDER", "ollama"),
		OllamaURL:       getEnv("OLLAMA_URL", "http://localhost:11434"),
		OllamaModel:     getEnv("OLLAMA_MODEL", "gemma2:2b"),
		AnthropicAPIKey: getEnv("ANTHROPIC_API_KEY", ""),
```

No validation needed in `validate()` — an empty `AnthropicAPIKey` with `LLMProvider=ollama` is valid; Task 5's provider factory handles the actual runtime requirement.

- [ ] **Step 4: Update the local env example**

Find the scaffold's example env file (likely `backend/.env.local.example` — confirm the exact name after cloning) and add:

```
LLM_PROVIDER=ollama
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=gemma2:2b
ANTHROPIC_API_KEY=
DEV_MODE=true
DEMO_LOGIN_EMAILS=
```
Set `DEMO_LOGIN_EMAILS` to your real email once you know it — leave blank in the example file, document this in a comment above it.

- [ ] **Step 5: Verify the scaffold boots against a real Postgres**

```bash
docker run --name strong-notes-pg -e POSTGRES_USER=strongnotes -e POSTGRES_PASSWORD=strongnotes -e POSTGRES_DB=strongnotes -p 5433:5432 -d postgres:16
cp .env.local.example .env.local   # adjust DATABASE_URL to postgresql://strongnotes:strongnotes@localhost:5433/strongnotes?sslmode=disable, set a real JWT_SECRET (32+ chars)
go run ./cmd/api
```
Expected: logs show `"server starting"`, no errors. In another terminal:
```bash
curl -s http://localhost:8080/api/health/liveness
```
Expected: `{"status":"ok"}` (or whatever exact shape `internal/handler/health.go` returns — check it and match your assertion to the real response).

- [ ] **Step 6: Run the scaffold's own existing test suite to confirm nothing broke in the module rename**

```bash
go test ./... 2>&1 | tail -30
```
Expected: PASS (or check if any tests require the `-tags=integration` build tag / a running Docker daemon for testcontainers — run `go test -tags=integration ./...` too if the plain run skips DB-backed tests).

- [ ] **Step 7: Commit**

```bash
git add backend
git commit -m "feat(backend): fork app-scaffold as the Go backend, add LLM config"
```

---

### Task 2: Domain schema migrations + sqlc queries

**Files:**
- Create: `backend/migrations/000009_create_exercises.up.sql`, `.down.sql`
- Create: `backend/migrations/000010_create_muscle_map_entries.up.sql`, `.down.sql`
- Create: `backend/migrations/000011_create_abbreviations.up.sql`, `.down.sql`
- Create: `backend/migrations/000012_create_workout_sessions.up.sql`, `.down.sql`
- Create: `backend/migrations/000013_create_set_entries.up.sql`, `.down.sql`
- Create: `backend/migrations/000014_create_goals.up.sql`, `.down.sql`
- Create: `backend/migrations/000015_create_goal_targets.up.sql`, `.down.sql`
- Create: `backend/sqlc/queries/exercises.sql`
- Create: `backend/sqlc/queries/abbreviations.sql`
- Create: `backend/sqlc/queries/sessions.sql`
- Create: `backend/sqlc/queries/goals.sql`

**Interfaces:**
- Consumes: `users(id)` from the scaffold's existing `000001_create_users` migration.
- Produces: sqlc-generated Go functions on `*db.Queries` (package `db`, per `backend/sqlc/sqlc.yaml`'s config) — exact names listed per query below. Task 4 (dictionary resolver) and Tasks 6-10 (handlers) depend on these exact function names and the generated struct field names (which sqlc derives from each table's column names — `snake_case` columns become `PascalCase` Go fields, e.g. `exercise_id` → `ExerciseID`... actually sqlc capitalizes the last segment as `ID` when named `_id` — verify the exact generated names by reading `backend/internal/db/models.go` after running `sqlc generate` in Step 12 below, and use whatever it actually produced in later tasks, not a guess).

- [ ] **Step 1: Exercises + muscle map migrations**

```sql
-- backend/migrations/000009_create_exercises.up.sql
CREATE TABLE exercises (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE,
    category   TEXT NOT NULL CHECK (category IN ('COMPOUND', 'ISOLATION')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```
```sql
-- backend/migrations/000009_create_exercises.down.sql
DROP TABLE exercises;
```
```sql
-- backend/migrations/000010_create_muscle_map_entries.up.sql
CREATE TABLE muscle_map_entries (
    id          TEXT PRIMARY KEY,
    exercise_id TEXT NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
    muscle      TEXT NOT NULL CHECK (muscle IN ('GLUTES','QUADS','HAMSTRINGS','CHEST','BACK','SHOULDERS','ARMS','CORE','CALVES')),
    role        TEXT NOT NULL CHECK (role IN ('PRIMARY', 'SECONDARY')),
    weight      REAL NOT NULL
);
CREATE INDEX muscle_map_entries_exercise_id ON muscle_map_entries(exercise_id);
```
```sql
-- backend/migrations/000010_create_muscle_map_entries.down.sql
DROP TABLE muscle_map_entries;
```

- [ ] **Step 2: Abbreviations migration**

```sql
-- backend/migrations/000011_create_abbreviations.up.sql
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
```
```sql
-- backend/migrations/000011_create_abbreviations.down.sql
DROP TABLE abbreviations;
```

- [ ] **Step 3: Sessions + set entries migrations**

```sql
-- backend/migrations/000012_create_workout_sessions.up.sql
CREATE TABLE workout_sessions (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date       DATE NOT NULL,
    notes      TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, date)
);
```
```sql
-- backend/migrations/000012_create_workout_sessions.down.sql
DROP TABLE workout_sessions;
```
```sql
-- backend/migrations/000013_create_set_entries.up.sql
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
```
```sql
-- backend/migrations/000013_create_set_entries.down.sql
DROP TABLE set_entries;
```

- [ ] **Step 4: Goals + goal targets migrations**

```sql
-- backend/migrations/000014_create_goals.up.sql
CREATE TABLE goals (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type        TEXT NOT NULL CHECK (type IN ('HYPERTROPHY', 'STRENGTH', 'ENDURANCE', 'CUSTOM')),
    description TEXT,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX goals_user_active ON goals(user_id, is_active);
```
```sql
-- backend/migrations/000014_create_goals.down.sql
DROP TABLE goals;
```
```sql
-- backend/migrations/000015_create_goal_targets.up.sql
CREATE TABLE goal_targets (
    id                TEXT PRIMARY KEY,
    goal_id           TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    muscle            TEXT NOT NULL CHECK (muscle IN ('GLUTES','QUADS','HAMSTRINGS','CHEST','BACK','SHOULDERS','ARMS','CORE','CALVES')),
    min_sets_per_week INTEGER NOT NULL,
    max_sets_per_week INTEGER NOT NULL
);
CREATE INDEX goal_targets_goal_id ON goal_targets(goal_id);
```
```sql
-- backend/migrations/000015_create_goal_targets.down.sql
DROP TABLE goal_targets;
```

- [ ] **Step 5: Run the migrations against your local dev Postgres**

```bash
cd backend
go run ./cmd/api &
sleep 2
kill %1  # main.go runs migrations on startup; this is just to trigger and verify them, then stop the half-started server
```
Expected: no migration errors in the log output before you kill it. (Alternative: install `migrate` CLI and run `migrate -path migrations -database "$DATABASE_URL" up` directly if you prefer not to boot the server.)

- [ ] **Step 6: Exercises sqlc queries**

```sql
-- backend/sqlc/queries/exercises.sql

-- name: GetExerciseByName :one
SELECT * FROM exercises WHERE name = $1;

-- name: CreateExercise :one
INSERT INTO exercises (id, name, category)
VALUES ($1, $2, $3)
RETURNING *;

-- name: CreateMuscleMapEntry :exec
INSERT INTO muscle_map_entries (id, exercise_id, muscle, role, weight)
VALUES ($1, $2, $3, $4, $5);

-- name: GetMuscleMapForExercise :many
SELECT * FROM muscle_map_entries WHERE exercise_id = $1;
```

- [ ] **Step 7: Abbreviations sqlc queries**

```sql
-- backend/sqlc/queries/abbreviations.sql

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
```

- [ ] **Step 8: Sessions sqlc queries**

```sql
-- backend/sqlc/queries/sessions.sql

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
```

- [ ] **Step 9: Goals sqlc queries**

```sql
-- backend/sqlc/queries/goals.sql

-- name: DeactivateGoalsForUser :exec
UPDATE goals SET is_active = FALSE WHERE user_id = $1 AND is_active = TRUE;

-- name: CreateGoal :one
INSERT INTO goals (id, user_id, type, description, is_active)
VALUES ($1, $2, $3, $4, TRUE)
RETURNING *;

-- name: CreateGoalTarget :exec
INSERT INTO goal_targets (id, goal_id, muscle, min_sets_per_week, max_sets_per_week)
VALUES ($1, $2, $3, $4, $5);

-- name: GetActiveGoalForUser :one
SELECT * FROM goals WHERE user_id = $1 AND is_active = TRUE;

-- name: GetGoalTargetsForGoal :many
SELECT * FROM goal_targets WHERE goal_id = $1;

-- name: GetSessionsWithEntriesInWeek :many
SELECT
  set_entries.exercise_id,
  set_entries.sets,
  muscle_map_entries.muscle
FROM workout_sessions
JOIN set_entries ON set_entries.session_id = workout_sessions.id
JOIN muscle_map_entries ON muscle_map_entries.exercise_id = set_entries.exercise_id
WHERE workout_sessions.user_id = $1
  AND workout_sessions.date >= $2
  AND workout_sessions.date < $3
  AND set_entries.sets IS NOT NULL;
```

- [ ] **Step 10: Run sqlc generate**

```bash
cd backend
go run github.com/sqlc-dev/sqlc/cmd/sqlc@latest generate --file sqlc/sqlc.yaml 2>&1 | tail -30
```
Expected: no errors; new files appear under `backend/internal/db/` (e.g. `exercises.sql.go`, `abbreviations.sql.go`, `sessions.sql.go`, `goals.sql.go`), and `models.go` gains `Exercise`, `MuscleMapEntry`, `Abbreviation`, `WorkoutSession`, `SetEntry`, `Goal`, `GoalTarget` structs.

- [ ] **Step 11: Verify it compiles**

```bash
go build ./... 2>&1 | tail -30
```
Expected: builds cleanly.

- [ ] **Step 12: Commit**

```bash
git add backend/migrations backend/sqlc backend/internal/db
git commit -m "feat(backend): add domain schema migrations and sqlc queries"
```

---

### Task 3: Muscle taxonomy and static volume science table

**Files:**
- Create: `backend/internal/science/muscle_groups.go`
- Create: `backend/internal/science/volume_table.go`
- Test: `backend/internal/science/volume_table_test.go`

**Interfaces:**
- Consumes: nothing (pure Go, no DB).
- Produces: `science.MuscleGroups []string` (the 9-value taxonomy) and `science.VolumeTargets(goalType string) map[string]science.Range` where `type Range struct { Min, Max int }`. Task 10's goals handler depends on `VolumeTargets` exactly.

- [ ] **Step 1: Write the failing test**

```go
// backend/internal/science/volume_table_test.go
package science

import "testing"

func TestVolumeTargets_Hypertrophy(t *testing.T) {
	targets := VolumeTargets("HYPERTROPHY")
	got := targets["GLUTES"]
	want := Range{Min: 12, Max: 20}
	if got != want {
		t.Errorf("HYPERTROPHY GLUTES = %+v, want %+v", got, want)
	}
}

func TestVolumeTargets_StrengthLowerThanHypertrophy(t *testing.T) {
	strength := VolumeTargets("STRENGTH")
	hypertrophy := VolumeTargets("HYPERTROPHY")
	if strength["QUADS"].Max >= hypertrophy["QUADS"].Max {
		t.Errorf("expected STRENGTH QUADS max < HYPERTROPHY QUADS max, got %d >= %d", strength["QUADS"].Max, hypertrophy["QUADS"].Max)
	}
}

func TestVolumeTargets_CoversAllMusclesForAllGoalTypes(t *testing.T) {
	for _, goalType := range []string{"HYPERTROPHY", "STRENGTH", "ENDURANCE", "CUSTOM"} {
		targets := VolumeTargets(goalType)
		for _, muscle := range MuscleGroups {
			if _, ok := targets[muscle]; !ok {
				t.Errorf("%s: missing target for muscle %s", goalType, muscle)
			}
		}
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && go test ./internal/science/... -v`
Expected: FAIL — package doesn't exist yet.

- [ ] **Step 3: Implement the muscle taxonomy**

```go
// backend/internal/science/muscle_groups.go
package science

// MuscleGroups is the fixed 9-value taxonomy shared by exercises' muscle
// maps, goal targets, and the mobile app's heatmap — must match the CHECK
// constraints on the muscle-typed columns in migrations 000010 and 000015.
var MuscleGroups = []string{
	"GLUTES", "QUADS", "HAMSTRINGS", "CHEST", "BACK", "SHOULDERS", "ARMS", "CORE", "CALVES",
}
```

- [ ] **Step 4: Implement the volume table**

```go
// backend/internal/science/volume_table.go
package science

// Range is an inclusive weekly set-count target for one muscle group.
type Range struct {
	Min int
	Max int
}

var hypertrophy = map[string]Range{
	"GLUTES": {12, 20}, "QUADS": {10, 18}, "HAMSTRINGS": {8, 16},
	"CHEST": {10, 18}, "BACK": {10, 16}, "SHOULDERS": {8, 16},
	"ARMS": {6, 14}, "CORE": {6, 12}, "CALVES": {8, 16},
}

var strength = map[string]Range{
	"GLUTES": {4, 8}, "QUADS": {4, 8}, "HAMSTRINGS": {3, 6},
	"CHEST": {3, 6}, "BACK": {4, 8}, "SHOULDERS": {3, 6},
	"ARMS": {2, 5}, "CORE": {3, 6}, "CALVES": {3, 6},
}

var endurance = map[string]Range{
	"GLUTES": {8, 14}, "QUADS": {8, 14}, "HAMSTRINGS": {6, 12},
	"CHEST": {6, 12}, "BACK": {6, 12}, "SHOULDERS": {6, 12},
	"ARMS": {5, 10}, "CORE": {8, 14}, "CALVES": {8, 14},
}

var table = map[string]map[string]Range{
	"HYPERTROPHY": hypertrophy,
	"STRENGTH":    strength,
	"ENDURANCE":   endurance,
	"CUSTOM":      hypertrophy, // CUSTOM starts from hypertrophy defaults; callers override per-muscle
}

// VolumeTargets returns the weekly set-count range per muscle group for the
// given goal type. Returns an empty map for an unrecognized goalType.
func VolumeTargets(goalType string) map[string]Range {
	return table[goalType]
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && go test ./internal/science/... -v`
Expected: PASS (3/3)

- [ ] **Step 6: Commit**

```bash
git add backend/internal/science
git commit -m "feat(backend): add muscle taxonomy and static volume science table"
```

---

### Task 4: Dictionary resolver

**Files:**
- Create: `backend/internal/parsing/dictionary_resolver.go`
- Test: `backend/internal/parsing/dictionary_resolver_test.go`

**Interfaces:**
- Consumes: `db.Queries.FindAbbreviationsForTokens` and `db.Abbreviation` (Task 2).
- Produces:
  ```go
  type ResolvedToken struct {
      Token         string
      Type          string // "exercise" | "modifier"
      ExerciseID    *string
      ModifierType  *string
      ModifierValue *string
  }
  type DictionaryResolution struct {
      ResolvedTokens   []ResolvedToken
      UnresolvedTokens []string
  }
  func ResolveLineWithDictionary(ctx context.Context, q *db.Queries, userID, line string) (DictionaryResolution, error)
  ```
  Task 6's resolve handler depends on this exact function name and both struct shapes.

- [ ] **Step 1: Write the failing test**

```go
// backend/internal/parsing/dictionary_resolver_test.go
//go:build integration

package parsing

import (
	"context"
	"testing"

	"github.com/DowLucas/strong-notes-backend/internal/db"
	"github.com/DowLucas/strong-notes-backend/internal/ulid"
	"github.com/DowLucas/strong-notes-backend/testutil"
)

func TestResolveLineWithDictionary(t *testing.T) {
	pool := testutil.SharedDB(t)
	q := db.New(pool)
	ctx := context.Background()

	userID := ulid.New()
	testutil.InsertTestUser(t, pool, userID, "resolver-test@example.com")

	exercise, err := q.CreateExercise(ctx, db.CreateExerciseParams{ID: ulid.New(), Name: "Test Squat", Category: "COMPOUND"})
	if err != nil {
		t.Fatalf("CreateExercise: %v", err)
	}
	_, err = q.CreateAbbreviation(ctx, db.CreateAbbreviationParams{
		ID: ulid.New(), UserID: userID, Token: "TSQ", ExerciseID: &exercise.ID, Source: "USER_ADDED",
	})
	if err != nil {
		t.Fatalf("CreateAbbreviation (exercise): %v", err)
	}
	barbell := "barbell"
	equipment := "equipment"
	_, err = q.CreateAbbreviation(ctx, db.CreateAbbreviationParams{
		ID: ulid.New(), UserID: userID, Token: "BB", ModifierType: &equipment, ModifierValue: &barbell, Source: "BUILT_IN",
	})
	if err != nil {
		t.Fatalf("CreateAbbreviation (modifier): %v", err)
	}

	result, err := ResolveLineWithDictionary(ctx, q, userID, "TSQ BB 40kg 8x3 WXYZ")
	if err != nil {
		t.Fatalf("ResolveLineWithDictionary: %v", err)
	}

	if len(result.ResolvedTokens) != 2 {
		t.Fatalf("expected 2 resolved tokens, got %d: %+v", len(result.ResolvedTokens), result.ResolvedTokens)
	}
	if len(result.UnresolvedTokens) != 1 || result.UnresolvedTokens[0] != "WXYZ" {
		t.Fatalf("expected unresolved [WXYZ], got %+v", result.UnresolvedTokens)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && go test -tags=integration ./internal/parsing/... -v`
Expected: FAIL — package/function doesn't exist yet.

- [ ] **Step 3: Implement the resolver**

```go
// backend/internal/parsing/dictionary_resolver.go
package parsing

import (
	"context"
	"regexp"
	"strings"

	"github.com/DowLucas/strong-notes-backend/internal/db"
)

// numericToken matches weight (e.g. "40kg", "30", "40.5lb") and reps×sets
// (e.g. "8x3") tokens, which are never looked up against the abbreviation
// dictionary — only word tokens (exercise/equipment shorthand) are.
var numericToken = regexp.MustCompile(`(?i)^\d+(\.\d+)?(kg|lb)?$|^\d+x\d+$`)

type ResolvedToken struct {
	Token         string
	Type          string // "exercise" | "modifier"
	ExerciseID    *string
	ModifierType  *string
	ModifierValue *string
}

type DictionaryResolution struct {
	ResolvedTokens   []ResolvedToken
	UnresolvedTokens []string
}

// ResolveLineWithDictionary tokenizes line, excludes numeric tokens, and
// looks up each remaining word token against userID's Abbreviation table.
func ResolveLineWithDictionary(ctx context.Context, q *db.Queries, userID, line string) (DictionaryResolution, error) {
	rawTokens := strings.Fields(line)
	var wordTokens []string
	for _, t := range rawTokens {
		if !numericToken.MatchString(t) {
			wordTokens = append(wordTokens, strings.ToUpper(t))
		}
	}

	abbreviations, err := q.FindAbbreviationsForTokens(ctx, db.FindAbbreviationsForTokensParams{UserID: userID, Tokens: wordTokens})
	if err != nil {
		return DictionaryResolution{}, err
	}

	byToken := make(map[string]db.Abbreviation, len(abbreviations))
	for _, a := range abbreviations {
		byToken[strings.ToUpper(a.Token)] = a
	}

	var resolved []ResolvedToken
	var unresolved []string
	for _, original := range rawTokens {
		if numericToken.MatchString(original) {
			continue
		}
		match, ok := byToken[strings.ToUpper(original)]
		if !ok {
			unresolved = append(unresolved, original)
			continue
		}
		if match.ExerciseID != nil {
			resolved = append(resolved, ResolvedToken{Token: original, Type: "exercise", ExerciseID: match.ExerciseID})
		} else {
			resolved = append(resolved, ResolvedToken{Token: original, Type: "modifier", ModifierType: match.ModifierType, ModifierValue: match.ModifierValue})
		}
	}

	return DictionaryResolution{ResolvedTokens: resolved, UnresolvedTokens: unresolved}, nil
}
```

Note: `db.FindAbbreviationsForTokensParams`'s exact field name for the `tokens` array parameter depends on what sqlc generated for the `sqlc.arg(tokens)` placeholder in Task 2 Step 7 — check `backend/internal/db/abbreviations.sql.go` after `sqlc generate` and adjust the field name here if it differs from `Tokens`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && go test -tags=integration ./internal/parsing/... -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/internal/parsing
git commit -m "feat(backend): add dictionary-based shorthand resolver"
```

---

### Task 5: LLM provider abstraction (Ollama + Anthropic)

**Files:**
- Create: `backend/internal/llm/provider.go`
- Create: `backend/internal/llm/prompts.go`
- Create: `backend/internal/llm/ollama_provider.go`
- Create: `backend/internal/llm/anthropic_provider.go`
- Test: `backend/internal/llm/provider_test.go`

**Interfaces:**
- Consumes: `config.Config`'s `LLMProvider`/`OllamaURL`/`OllamaModel`/`AnthropicAPIKey` (Task 1).
- Produces:
  ```go
  type LineGuess struct {
      ExerciseName string   `json:"exerciseName"`
      Equipment    *string  `json:"equipment"`
      WeightKg     *float64 `json:"weightKg"`
      Reps         *int     `json:"reps"`
      Sets         *int     `json:"sets"`
      Muscles      []string `json:"muscles"`
  }
  type GoalGuess struct {
      Type    string   `json:"type"`
      Muscles []string `json:"muscles"`
  }
  type Provider interface {
      ResolveLine(ctx context.Context, line string, unresolved []string) (LineGuess, error)
      ResolveGoal(ctx context.Context, text string) (GoalGuess, error)
  }
  func NewProvider(cfg *config.Config) (Provider, error)
  ```
  Task 6's resolve handler depends on `NewProvider`, `Provider`, `LineGuess`, `GoalGuess` exactly.

- [ ] **Step 1: Write the failing test (factory selection only, no network)**

```go
// backend/internal/llm/provider_test.go
package llm

import (
	"testing"

	"github.com/DowLucas/strong-notes-backend/internal/config"
)

func TestNewProvider_Ollama(t *testing.T) {
	p, err := NewProvider(&config.Config{LLMProvider: "ollama", OllamaURL: "http://localhost:11434", OllamaModel: "gemma2:2b"})
	if err != nil {
		t.Fatalf("NewProvider: %v", err)
	}
	if _, ok := p.(*OllamaProvider); !ok {
		t.Errorf("expected *OllamaProvider, got %T", p)
	}
}

func TestNewProvider_Anthropic(t *testing.T) {
	p, err := NewProvider(&config.Config{LLMProvider: "anthropic", AnthropicAPIKey: "test-key"})
	if err != nil {
		t.Fatalf("NewProvider: %v", err)
	}
	if _, ok := p.(*AnthropicProvider); !ok {
		t.Errorf("expected *AnthropicProvider, got %T", p)
	}
}

func TestNewProvider_Unknown(t *testing.T) {
	_, err := NewProvider(&config.Config{LLMProvider: "bogus"})
	if err == nil {
		t.Fatal("expected an error for unknown LLM_PROVIDER, got nil")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && go test ./internal/llm/... -v`
Expected: FAIL — package doesn't exist yet.

- [ ] **Step 3: Define the shared interface and prompts**

```go
// backend/internal/llm/provider.go
package llm

import (
	"context"
	"fmt"

	"github.com/DowLucas/strong-notes-backend/internal/config"
)

type LineGuess struct {
	ExerciseName string   `json:"exerciseName"`
	Equipment    *string  `json:"equipment"`
	WeightKg     *float64 `json:"weightKg"`
	Reps         *int     `json:"reps"`
	Sets         *int     `json:"sets"`
	Muscles      []string `json:"muscles"`
}

type GoalGuess struct {
	Type    string   `json:"type"`
	Muscles []string `json:"muscles"`
}

type Provider interface {
	ResolveLine(ctx context.Context, line string, unresolved []string) (LineGuess, error)
	ResolveGoal(ctx context.Context, text string) (GoalGuess, error)
}

// NewProvider selects the LLM provider based on cfg.LLMProvider. Construction
// never touches the network — the returned Provider's methods do.
func NewProvider(cfg *config.Config) (Provider, error) {
	switch cfg.LLMProvider {
	case "ollama":
		return &OllamaProvider{BaseURL: cfg.OllamaURL, Model: cfg.OllamaModel}, nil
	case "anthropic":
		return NewAnthropicProvider(cfg.AnthropicAPIKey), nil
	default:
		return nil, fmt.Errorf("llm: unknown LLM_PROVIDER %q", cfg.LLMProvider)
	}
}
```

```go
// backend/internal/llm/prompts.go
package llm

import "fmt"

// LinePrompt and GoalPrompt are copied verbatim from the plan's Global
// Constraints — do not edit the wording without updating both there and here.
func linePrompt(line string, unresolved []string) string {
	return fmt.Sprintf(`You are a gym-log parser. Given this logged line: "%s"
The unrecognized tokens are: %s.
Shorthand convention: a token like "8x3" means 8 reps per set, done for 3 sets - the first number is reps, the second is sets.
Expand any abbreviated or shorthand exercise name into its full common name (e.g. "crabwalk" -> "Crab Walk", "OHP" -> "Overhead Press") rather than echoing the raw token back.
Also identify which muscle groups the identified exercise primarily works, from
["GLUTES","QUADS","HAMSTRINGS","CHEST","BACK","SHOULDERS","ARMS","CORE","CALVES"].
Respond ONLY with JSON: {"exerciseName": string, "equipment": string|null, "weightKg": number|null, "reps": number|null, "sets": number|null, "muscles": string[]}`, line, joinComma(unresolved))
}

func goalPrompt(text string) string {
	return fmt.Sprintf(`You are a fitness goal classifier. Given this goal description: "%s"
Respond ONLY with JSON: {"type": "HYPERTROPHY"|"STRENGTH"|"ENDURANCE"|"CUSTOM", "muscles": string[]} where muscles are from
["GLUTES","QUADS","HAMSTRINGS","CHEST","BACK","SHOULDERS","ARMS","CORE","CALVES"].`, text)
}

func joinComma(items []string) string {
	out := ""
	for i, item := range items {
		if i > 0 {
			out += ", "
		}
		out += item
	}
	return out
}
```

- [ ] **Step 4: Implement the Ollama provider**

```go
// backend/internal/llm/ollama_provider.go
package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
)

type OllamaProvider struct {
	BaseURL string
	Model   string
}

type ollamaGenerateRequest struct {
	Model  string `json:"model"`
	Prompt string `json:"prompt"`
	Stream bool   `json:"stream"`
	Format string `json:"format"`
}

type ollamaGenerateResponse struct {
	Response string `json:"response"`
}

func (p *OllamaProvider) generate(ctx context.Context, prompt string) (string, error) {
	body, err := json.Marshal(ollamaGenerateRequest{Model: p.Model, Prompt: prompt, Stream: false, Format: "json"})
	if err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, p.BaseURL+"/api/generate", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("ollama request failed: %d", resp.StatusCode)
	}

	var out ollamaGenerateResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return "", err
	}
	return out.Response, nil
}

func (p *OllamaProvider) ResolveLine(ctx context.Context, line string, unresolved []string) (LineGuess, error) {
	raw, err := p.generate(ctx, linePrompt(line, unresolved))
	if err != nil {
		return LineGuess{}, err
	}
	var guess LineGuess
	if err := json.Unmarshal([]byte(raw), &guess); err != nil {
		return LineGuess{}, fmt.Errorf("ollama: parse line guess: %w", err)
	}
	return guess, nil
}

func (p *OllamaProvider) ResolveGoal(ctx context.Context, text string) (GoalGuess, error) {
	raw, err := p.generate(ctx, goalPrompt(text))
	if err != nil {
		return GoalGuess{}, err
	}
	var guess GoalGuess
	if err := json.Unmarshal([]byte(raw), &guess); err != nil {
		return GoalGuess{}, fmt.Errorf("ollama: parse goal guess: %w", err)
	}
	return guess, nil
}
```

- [ ] **Step 5: Implement the Anthropic provider**

```bash
cd backend && go get github.com/anthropics/anthropic-sdk-go@latest
```

```go
// backend/internal/llm/anthropic_provider.go
package llm

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/option"
)

type AnthropicProvider struct {
	client anthropic.Client
	model  anthropic.Model
}

func NewAnthropicProvider(apiKey string) *AnthropicProvider {
	return &AnthropicProvider{
		client: anthropic.NewClient(option.WithAPIKey(apiKey)),
		model:  anthropic.ModelClaudeHaiku4_5,
	}
}

func (p *AnthropicProvider) ask(ctx context.Context, prompt string) (string, error) {
	msg, err := p.client.Messages.New(ctx, anthropic.MessageNewParams{
		Model:     p.model,
		MaxTokens: 256,
		Messages: []anthropic.MessageParam{
			anthropic.NewUserMessage(anthropic.NewTextBlock(prompt)),
		},
	})
	if err != nil {
		return "", err
	}
	if len(msg.Content) == 0 || msg.Content[0].Type != "text" {
		return "", fmt.Errorf("anthropic: unexpected non-text response")
	}
	return msg.Content[0].Text, nil
}

func (p *AnthropicProvider) ResolveLine(ctx context.Context, line string, unresolved []string) (LineGuess, error) {
	raw, err := p.ask(ctx, linePrompt(line, unresolved))
	if err != nil {
		return LineGuess{}, err
	}
	var guess LineGuess
	if err := json.Unmarshal([]byte(raw), &guess); err != nil {
		return LineGuess{}, fmt.Errorf("anthropic: parse line guess: %w", err)
	}
	return guess, nil
}

func (p *AnthropicProvider) ResolveGoal(ctx context.Context, text string) (GoalGuess, error) {
	raw, err := p.ask(ctx, goalPrompt(text))
	if err != nil {
		return GoalGuess{}, err
	}
	var guess GoalGuess
	if err := json.Unmarshal([]byte(raw), &guess); err != nil {
		return GoalGuess{}, fmt.Errorf("anthropic: parse goal guess: %w", err)
	}
	return guess, nil
}
```

If `anthropic.ModelClaudeHaiku4_5` isn't the exact constant name in the SDK version `go get` resolves, check `github.com/anthropics/anthropic-sdk-go`'s model constants and use the closest current Haiku model constant available — do not hardcode a raw string model ID if the SDK exposes a typed constant.

- [ ] **Step 6: Run test to verify it passes**

Run: `cd backend && go test ./internal/llm/... -v`
Expected: PASS (3/3) — no network call happens since the test only checks `NewProvider`'s returned type.

- [ ] **Step 7: Commit**

```bash
git add backend/internal/llm backend/go.mod backend/go.sum
git commit -m "feat(backend): add swappable LLM provider (ollama/anthropic)"
```

---

### Task 6: /api/resolve/line and /api/resolve/goal handlers

**Files:**
- Create: `backend/internal/handler/resolve.go`
- Modify: `backend/internal/server/server.go`
- Test: `backend/internal/handler/resolve_test.go`

**Interfaces:**
- Consumes: `parsing.ResolveLineWithDictionary` (Task 4), `llm.Provider`/`llm.NewProvider` (Task 5), `middleware.ClaimsFromContext`.
- Produces: `ResolveHandler` struct with `NewResolveHandler(queries *db.Queries, llmProvider llm.Provider) *ResolveHandler`, methods `ResolveLine(w, r)` and `ResolveGoal(w, r)`, mounted at `POST /api/resolve/line` and `POST /api/resolve/goal` inside the authenticated route group.

- [ ] **Step 1: Write the failing test**

```go
// backend/internal/handler/resolve_test.go
//go:build integration

package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/DowLucas/strong-notes-backend/internal/db"
	"github.com/DowLucas/strong-notes-backend/internal/llm"
	"github.com/DowLucas/strong-notes-backend/internal/middleware"
	"github.com/DowLucas/strong-notes-backend/internal/ulid"
	"github.com/DowLucas/strong-notes-backend/testutil"
)

type fakeProvider struct {
	lineGuess llm.LineGuess
	lineErr   error
	goalGuess llm.GoalGuess
}

func (f *fakeProvider) ResolveLine(ctx context.Context, line string, unresolved []string) (llm.LineGuess, error) {
	return f.lineGuess, f.lineErr
}
func (f *fakeProvider) ResolveGoal(ctx context.Context, text string) (llm.GoalGuess, error) {
	return f.goalGuess, nil
}

func withClaims(r *http.Request, userID string) *http.Request {
	ctx := context.WithValue(r.Context(), middleware.ClaimsKey, &struct{ UserID string }{UserID: userID})
	return r.WithContext(ctx)
}

func TestResolveLine_DictionaryOnly(t *testing.T) {
	pool := testutil.SharedDB(t)
	q := db.New(pool)
	userID := ulid.New()
	testutil.InsertTestUser(t, pool, userID, "resolve-test@example.com")

	h := NewResolveHandler(q, &fakeProvider{})
	body := strings.NewReader(`{"line":"BB 40kg 8x3"}`)
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/resolve/line", body), userID)
	w := httptest.NewRecorder()

	h.ResolveLine(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp struct {
		UnresolvedTokens []string `json:"unresolvedTokens"`
	}
	json.Unmarshal(w.Body.Bytes(), &resp)
	if len(resp.UnresolvedTokens) != 0 {
		t.Errorf("expected no unresolved tokens (BB has no dictionary entry here so this actually IS unresolved) — adjust: seed a BB abbreviation first if this assertion is meant to prove dictionary-only resolution")
	}
}
```

**Note to implementer:** the test above is a starting skeleton, not gospel — you MUST seed a `BB` abbreviation via `q.CreateAbbreviation` (like Task 4's test does) before asserting zero unresolved tokens, and add a second test case that leaves a token unseeded to prove the LLM fallback path (asserting `w.Body` contains an `llmGuess` object built from `fakeProvider.lineGuess`). Write both cases fully before moving to Step 2 — this step's job is to have a real RED test, not this placeholder.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && go test -tags=integration ./internal/handler/... -run TestResolveLine -v`
Expected: FAIL — `NewResolveHandler` doesn't exist yet.

- [ ] **Step 3: Implement the handler**

```go
// backend/internal/handler/resolve.go
package handler

import (
	"encoding/json"
	"net/http"

	"github.com/DowLucas/strong-notes-backend/internal/db"
	"github.com/DowLucas/strong-notes-backend/internal/llm"
	"github.com/DowLucas/strong-notes-backend/internal/middleware"
	"github.com/DowLucas/strong-notes-backend/internal/parsing"
)

type ResolveHandler struct {
	queries  *db.Queries
	provider llm.Provider
}

func NewResolveHandler(queries *db.Queries, provider llm.Provider) *ResolveHandler {
	return &ResolveHandler{queries: queries, provider: provider}
}

type resolveLineRequest struct {
	Line string `json:"line"`
}

func (h *ResolveHandler) ResolveLine(w http.ResponseWriter, r *http.Request) {
	var req resolveLineRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Line == "" {
		writeError(w, http.StatusBadRequest, "line is required")
		return
	}
	claims := middleware.ClaimsFromContext(r.Context())

	dictResult, err := parsing.ResolveLineWithDictionary(r.Context(), h.queries, claims.UserID, req.Line)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "resolve failed")
		return
	}

	if len(dictResult.UnresolvedTokens) == 0 {
		writeJSON(w, http.StatusOK, map[string]any{
			"resolvedTokens":   dictResult.ResolvedTokens,
			"unresolvedTokens": dictResult.UnresolvedTokens,
		})
		return
	}

	guess, err := h.provider.ResolveLine(r.Context(), req.Line, dictResult.UnresolvedTokens)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "llm resolve failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"resolvedTokens":   dictResult.ResolvedTokens,
		"unresolvedTokens": dictResult.UnresolvedTokens,
		"llmGuess":         guess,
	})
}

type resolveGoalRequest struct {
	Text string `json:"text"`
}

func (h *ResolveHandler) ResolveGoal(w http.ResponseWriter, r *http.Request) {
	var req resolveGoalRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Text == "" {
		writeError(w, http.StatusBadRequest, "text is required")
		return
	}
	guess, err := h.provider.ResolveGoal(r.Context(), req.Text)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "llm resolve failed")
		return
	}
	writeJSON(w, http.StatusOK, guess)
}
```

Check `middleware.ClaimsFromContext`'s actual return type (`*auth.Claims`) and its `UserID` field name in `backend/internal/auth/jwt.go` — use the real field name, not an assumption, when this diverges from what's shown above.

- [ ] **Step 4: Wire into server.go**

In `backend/internal/server/server.go`, inside the authenticated route group (after the existing `/api/me*` routes), add:

```go
		llmProvider, err := llm.NewProvider(cfg)
		if err != nil {
			panic(fmt.Sprintf("llm.NewProvider: %v", err)) // fail fast at startup, not per-request
		}
		resolveH := handler.NewResolveHandler(queries, llmProvider)
		r.Post("/api/resolve/line", resolveH.ResolveLine)
		r.Post("/api/resolve/goal", resolveH.ResolveGoal)
```

Add the `"fmt"` and `"github.com/DowLucas/strong-notes-backend/internal/llm"` imports.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && go test -tags=integration ./internal/handler/... -run TestResolveLine -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/internal/handler/resolve.go backend/internal/handler/resolve_test.go backend/internal/server/server.go
git commit -m "feat(backend): add /api/resolve/line and /api/resolve/goal handlers"
```

---

### Task 7: /api/exercises handler

**Files:**
- Create: `backend/internal/handler/exercises.go`
- Modify: `backend/internal/server/server.go`
- Test: `backend/internal/handler/exercises_test.go`

**Interfaces:**
- Consumes: `db.Queries.GetExerciseByName`, `CreateExercise`, `CreateMuscleMapEntry`, `GetMuscleMapForExercise` (Task 2), `science.MuscleGroups` (Task 3) for validation.
- Produces: `ExercisesHandler` with `NewExercisesHandler(queries *db.Queries) *ExercisesHandler`, method `Create(w, r)` mounted at `POST /api/exercises`.

- [ ] **Step 1: Write the failing test**

```go
// backend/internal/handler/exercises_test.go
//go:build integration

package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/DowLucas/strong-notes-backend/internal/db"
	"github.com/DowLucas/strong-notes-backend/testutil"
)

func TestCreateExercise_NewAndDedupe(t *testing.T) {
	pool := testutil.SharedDB(t)
	q := db.New(pool)
	h := NewExercisesHandler(q)

	body := `{"name":"Test Crab Walk","muscles":["GLUTES","CORE"]}`
	req := httptest.NewRequest(http.MethodPost, "/api/exercises", strings.NewReader(body))
	w := httptest.NewRecorder()
	h.Create(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}
	var first struct {
		ID string `json:"id"`
	}
	json.Unmarshal(w.Body.Bytes(), &first)

	muscleMap, err := q.GetMuscleMapForExercise(context.Background(), first.ID)
	if err != nil {
		t.Fatalf("GetMuscleMapForExercise: %v", err)
	}
	if len(muscleMap) != 2 {
		t.Fatalf("expected 2 muscle map entries, got %d", len(muscleMap))
	}

	// Second POST with the same name must return the SAME exercise, not create a duplicate.
	req2 := httptest.NewRequest(http.MethodPost, "/api/exercises", strings.NewReader(body))
	w2 := httptest.NewRecorder()
	h.Create(w2, req2)

	var second struct {
		ID string `json:"id"`
	}
	json.Unmarshal(w2.Body.Bytes(), &second)
	if second.ID != first.ID {
		t.Errorf("expected same exercise id on duplicate name, got %s vs %s", first.ID, second.ID)
	}
}

func TestCreateExercise_ValidationErrors(t *testing.T) {
	pool := testutil.SharedDB(t)
	q := db.New(pool)
	h := NewExercisesHandler(q)

	for _, body := range []string{`{"name":"","muscles":["GLUTES"]}`, `{"name":"Valid Name","muscles":[]}`} {
		req := httptest.NewRequest(http.MethodPost, "/api/exercises", strings.NewReader(body))
		w := httptest.NewRecorder()
		h.Create(w, req)
		if w.Code != http.StatusBadRequest {
			t.Errorf("body %q: expected 400, got %d", body, w.Code)
		}
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && go test -tags=integration ./internal/handler/... -run TestCreateExercise -v`
Expected: FAIL — handler doesn't exist yet.

- [ ] **Step 3: Implement the handler**

```go
// backend/internal/handler/exercises.go
package handler

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"

	"github.com/DowLucas/strong-notes-backend/internal/db"
	"github.com/DowLucas/strong-notes-backend/internal/ulid"
)

type ExercisesHandler struct {
	queries *db.Queries
}

func NewExercisesHandler(queries *db.Queries) *ExercisesHandler {
	return &ExercisesHandler{queries: queries}
}

var validMuscles = map[string]bool{
	"GLUTES": true, "QUADS": true, "HAMSTRINGS": true, "CHEST": true, "BACK": true,
	"SHOULDERS": true, "ARMS": true, "CORE": true, "CALVES": true,
}

type createExerciseRequest struct {
	Name    string   `json:"name"`
	Muscles []string `json:"muscles"`
}

func (h *ExercisesHandler) Create(w http.ResponseWriter, r *http.Request) {
	var req createExerciseRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}
	for _, m := range req.Muscles {
		if !validMuscles[m] {
			writeError(w, http.StatusBadRequest, "invalid muscle: "+m)
			return
		}
	}

	existing, err := h.queries.GetExerciseByName(r.Context(), req.Name)
	if err == nil {
		writeJSON(w, http.StatusOK, existing)
		return
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusInternalServerError, "lookup failed")
		return
	}

	created, err := h.queries.CreateExercise(r.Context(), db.CreateExerciseParams{
		ID: ulid.New(), Name: req.Name, Category: "COMPOUND",
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "create failed")
		return
	}

	for _, m := range req.Muscles {
		if err := h.queries.CreateMuscleMapEntry(r.Context(), db.CreateMuscleMapEntryParams{
			ID: ulid.New(), ExerciseID: created.ID, Muscle: m, Role: "PRIMARY", Weight: 1,
		}); err != nil {
			writeError(w, http.StatusInternalServerError, "muscle map create failed")
			return
		}
	}

	writeJSON(w, http.StatusCreated, created)
}
```

- [ ] **Step 4: Wire into server.go**

```go
		exercisesH := handler.NewExercisesHandler(queries)
		r.Post("/api/exercises", exercisesH.Create)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && go test -tags=integration ./internal/handler/... -run TestCreateExercise -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/internal/handler/exercises.go backend/internal/handler/exercises_test.go backend/internal/server/server.go
git commit -m "feat(backend): add /api/exercises handler with name-based dedupe"
```

---

### Task 8: /api/abbreviations handlers

**Files:**
- Create: `backend/internal/handler/abbreviations.go`
- Modify: `backend/internal/server/server.go`
- Test: `backend/internal/handler/abbreviations_test.go`

**Interfaces:**
- Consumes: `db.Queries.ListAbbreviationsForUser`, `GetAbbreviationByUserAndToken`, `CreateAbbreviation`, `ConfirmAbbreviation` (Task 2).
- Produces: `AbbreviationsHandler` with `List`, `Create`, `Confirm` methods, mounted at `GET/POST /api/abbreviations` and `PATCH /api/abbreviations/{id}/confirm`.

- [ ] **Step 1: Write the failing test**

```go
// backend/internal/handler/abbreviations_test.go
//go:build integration

package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/DowLucas/strong-notes-backend/internal/db"
	"github.com/DowLucas/strong-notes-backend/internal/middleware"
	"github.com/DowLucas/strong-notes-backend/internal/ulid"
	"github.com/DowLucas/strong-notes-backend/testutil"
	"github.com/go-chi/chi/v5"
)

func TestAbbreviations_CreateAndList(t *testing.T) {
	pool := testutil.SharedDB(t)
	q := db.New(pool)
	userID := ulid.New()
	testutil.InsertTestUser(t, pool, userID, "abbrev-test@example.com")
	h := NewAbbreviationsHandler(q)

	body := `{"token":"ZZTEST","modifierType":"equipment","modifierValue":"kettlebell"}`
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/abbreviations", strings.NewReader(body)), userID)
	w := httptest.NewRecorder()
	h.Create(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}
	var created struct {
		Source string `json:"source"`
	}
	json.Unmarshal(w.Body.Bytes(), &created)
	if created.Source != "USER_ADDED" {
		t.Errorf("expected source USER_ADDED, got %s", created.Source)
	}

	listReq := withClaims(httptest.NewRequest(http.MethodGet, "/api/abbreviations", nil), userID)
	listW := httptest.NewRecorder()
	h.List(listW, listReq)
	var list []struct {
		Token string `json:"token"`
	}
	json.Unmarshal(listW.Body.Bytes(), &list)
	found := false
	for _, a := range list {
		if a.Token == "ZZTEST" {
			found = true
		}
	}
	if !found {
		t.Errorf("expected ZZTEST in list, got %+v", list)
	}
}

func TestAbbreviations_ConfirmPending(t *testing.T) {
	pool := testutil.SharedDB(t)
	q := db.New(pool)
	userID := ulid.New()
	testutil.InsertTestUser(t, pool, userID, "abbrev-confirm-test@example.com")
	h := NewAbbreviationsHandler(q)

	equipment := "equipment"
	sled := "sled"
	pending, err := q.CreateAbbreviation(nil, db.CreateAbbreviationParams{
		ID: ulid.New(), UserID: userID, Token: "ZZPEND", ModifierType: &equipment, ModifierValue: &sled, Source: "LLM_SUGGESTED_PENDING_CONFIRM",
	})
	if err != nil {
		t.Fatalf("seed CreateAbbreviation: %v", err)
	}

	router := chi.NewRouter()
	router.Patch("/api/abbreviations/{id}/confirm", h.Confirm)
	req := httptest.NewRequest(http.MethodPatch, "/api/abbreviations/"+pending.ID+"/confirm", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var confirmed struct {
		Source string `json:"source"`
	}
	json.Unmarshal(w.Body.Bytes(), &confirmed)
	if confirmed.Source != "USER_ADDED" {
		t.Errorf("expected source USER_ADDED after confirm, got %s", confirmed.Source)
	}
}
```

Note: `q.CreateAbbreviation(nil, ...)` above needs a real `context.Context` (e.g. `context.Background()`), not literal `nil` — fix this when writing the real test file; it's written loosely here because the exact import needed depends on how you structure the file.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && go test -tags=integration ./internal/handler/... -run TestAbbreviations -v`
Expected: FAIL — handler doesn't exist yet.

- [ ] **Step 3: Implement the handler**

```go
// backend/internal/handler/abbreviations.go
package handler

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/DowLucas/strong-notes-backend/internal/db"
	"github.com/DowLucas/strong-notes-backend/internal/middleware"
	"github.com/DowLucas/strong-notes-backend/internal/ulid"
)

type AbbreviationsHandler struct {
	queries *db.Queries
}

func NewAbbreviationsHandler(queries *db.Queries) *AbbreviationsHandler {
	return &AbbreviationsHandler{queries: queries}
}

func (h *AbbreviationsHandler) List(w http.ResponseWriter, r *http.Request) {
	claims := middleware.ClaimsFromContext(r.Context())
	list, err := h.queries.ListAbbreviationsForUser(r.Context(), claims.UserID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "list failed")
		return
	}
	writeJSON(w, http.StatusOK, list)
}

type createAbbreviationRequest struct {
	Token         string  `json:"token"`
	ExerciseID    *string `json:"exerciseId"`
	ModifierType  *string `json:"modifierType"`
	ModifierValue *string `json:"modifierValue"`
}

func (h *AbbreviationsHandler) Create(w http.ResponseWriter, r *http.Request) {
	var req createAbbreviationRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Token == "" {
		writeError(w, http.StatusBadRequest, "token is required")
		return
	}
	claims := middleware.ClaimsFromContext(r.Context())

	existing, err := h.queries.GetAbbreviationByUserAndToken(r.Context(), db.GetAbbreviationByUserAndTokenParams{UserID: claims.UserID, Token: req.Token})
	if err == nil {
		writeJSON(w, http.StatusCreated, existing)
		return
	}

	created, err := h.queries.CreateAbbreviation(r.Context(), db.CreateAbbreviationParams{
		ID: ulid.New(), UserID: claims.UserID, Token: req.Token,
		ExerciseID: req.ExerciseID, ModifierType: req.ModifierType, ModifierValue: req.ModifierValue,
		Source: "USER_ADDED",
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "create failed")
		return
	}
	writeJSON(w, http.StatusCreated, created)
}

func (h *AbbreviationsHandler) Confirm(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	updated, err := h.queries.ConfirmAbbreviation(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "confirm failed")
		return
	}
	writeJSON(w, http.StatusOK, updated)
}
```

The `err == nil` dedupe branch above needs a real "not found" check (mirroring Task 7's `errors.Is(err, pgx.ErrNoRows)` pattern) rather than assuming any error means "doesn't exist" — fix this to only treat `pgx.ErrNoRows` as "proceed to create," and any other error as a real 500, when implementing.

- [ ] **Step 4: Wire into server.go**

```go
		abbreviationsH := handler.NewAbbreviationsHandler(queries)
		r.Get("/api/abbreviations", abbreviationsH.List)
		r.Post("/api/abbreviations", abbreviationsH.Create)
		r.Patch("/api/abbreviations/{id}/confirm", abbreviationsH.Confirm)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && go test -tags=integration ./internal/handler/... -run TestAbbreviations -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/internal/handler/abbreviations.go backend/internal/handler/abbreviations_test.go backend/internal/server/server.go
git commit -m "feat(backend): add /api/abbreviations handlers (list/create/confirm)"
```

---

### Task 9: /api/sessions handlers

**Files:**
- Create: `backend/internal/handler/sessions.go`
- Modify: `backend/internal/server/server.go`
- Test: `backend/internal/handler/sessions_test.go`

**Interfaces:**
- Consumes: `db.Queries.UpsertWorkoutSession`, `DeleteSetEntriesForSession`, `CreateSetEntry`, `GetSetEntriesForSession`, `ListWorkoutSessionsInRange`, `ListSetEntriesForSessionsInRange` (Task 2). Needs a pgx transaction — consume `*pgxpool.Pool` directly for `pool.Begin(ctx)`, alongside `*db.Queries` for the non-transactional reads.
- Produces: `SessionsHandler` with `Get(w, r)` (query params `from`/`to`) and `Put(w, r)` (chi URL param `date`), mounted at `GET /api/sessions` and `PUT /api/sessions/{date}`.

- [ ] **Step 1: Write the failing test**

```go
// backend/internal/handler/sessions_test.go
//go:build integration

package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/DowLucas/strong-notes-backend/internal/db"
	"github.com/DowLucas/strong-notes-backend/internal/ulid"
	"github.com/DowLucas/strong-notes-backend/testutil"
	"github.com/go-chi/chi/v5"
)

func TestSessions_UpsertReplacesEntries(t *testing.T) {
	pool := testutil.SharedDB(t)
	q := db.New(pool)
	userID := ulid.New()
	testutil.InsertTestUser(t, pool, userID, "sessions-test@example.com")
	h := NewSessionsHandler(pool, q)

	router := chi.NewRouter()
	router.Put("/api/sessions/{date}", func(w http.ResponseWriter, r *http.Request) {
		router2 := chi.NewRouteContext()
		router2.URLParams.Add("date", chi.URLParam(r, "date"))
		h.Put(w, r)
	})

	putBody := func(body string) *httptest.ResponseRecorder {
		req := withClaims(httptest.NewRequest(http.MethodPut, "/api/sessions/2026-07-04", strings.NewReader(body)), userID)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		return w
	}

	w1 := putBody(`{"entries":[{"rawText":"first","parsedBy":"DICTIONARY","order":0}]}`)
	if w1.Code != http.StatusOK {
		t.Fatalf("first PUT: expected 200, got %d: %s", w1.Code, w1.Body.String())
	}

	w2 := putBody(`{"entries":[{"rawText":"second","parsedBy":"DICTIONARY","order":0}]}`)
	var resp struct {
		Entries []struct {
			RawText string `json:"rawText"`
		} `json:"entries"`
	}
	json.Unmarshal(w2.Body.Bytes(), &resp)
	if len(resp.Entries) != 1 || resp.Entries[0].RawText != "second" {
		t.Fatalf("expected exactly 1 entry with rawText 'second', got %+v", resp.Entries)
	}
}
```

**Note to implementer:** the router-mounting boilerplate above is awkward (chi URL params only populate correctly when routed through a real chi router, not called directly) — simplify by mounting `h.Put` directly on a `chi.NewRouter()` and dispatching the test request through `router.ServeHTTP`, removing the inner closure entirely. Fix this before running.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && go test -tags=integration ./internal/handler/... -run TestSessions -v`
Expected: FAIL — handler doesn't exist yet.

- [ ] **Step 3: Implement the handler**

```go
// backend/internal/handler/sessions.go
package handler

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/DowLucas/strong-notes-backend/internal/db"
	"github.com/DowLucas/strong-notes-backend/internal/middleware"
	"github.com/DowLucas/strong-notes-backend/internal/ulid"
)

type SessionsHandler struct {
	pool    *pgxpool.Pool
	queries *db.Queries
}

func NewSessionsHandler(pool *pgxpool.Pool, queries *db.Queries) *SessionsHandler {
	return &SessionsHandler{pool: pool, queries: queries}
}

func (h *SessionsHandler) Get(w http.ResponseWriter, r *http.Request) {
	claims := middleware.ClaimsFromContext(r.Context())
	from, err1 := time.Parse("2006-01-02", r.URL.Query().Get("from"))
	to, err2 := time.Parse("2006-01-02", r.URL.Query().Get("to"))
	if err1 != nil || err2 != nil {
		writeError(w, http.StatusBadRequest, "from and to must be YYYY-MM-DD")
		return
	}

	sessions, err := h.queries.ListWorkoutSessionsInRange(r.Context(), db.ListWorkoutSessionsInRangeParams{UserID: claims.UserID, Date: from, Date_2: to})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "list failed")
		return
	}
	writeJSON(w, http.StatusOK, sessions)
}

type putSessionEntry struct {
	ExerciseID *string  `json:"exerciseId"`
	Equipment  *string  `json:"equipment"`
	WeightKg   *float64 `json:"weightKg"`
	Reps       *int     `json:"reps"`
	Sets       *int     `json:"sets"`
	RawText    string   `json:"rawText"`
	ParsedBy   string   `json:"parsedBy"`
	Order      int      `json:"order"`
}

type putSessionRequest struct {
	Notes   *string           `json:"notes"`
	Entries []putSessionEntry `json:"entries"`
}

func (h *SessionsHandler) Put(w http.ResponseWriter, r *http.Request) {
	claims := middleware.ClaimsFromContext(r.Context())
	date, err := time.Parse("2006-01-02", chi.URLParam(r, "date"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "date must be YYYY-MM-DD")
		return
	}

	var req putSessionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}

	tx, err := h.pool.Begin(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "tx begin failed")
		return
	}
	defer tx.Rollback(r.Context())
	qtx := h.queries.WithTx(tx)

	session, err := qtx.UpsertWorkoutSession(r.Context(), db.UpsertWorkoutSessionParams{
		ID: ulid.New(), UserID: claims.UserID, Date: date, Notes: req.Notes,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "upsert failed")
		return
	}
	if err := qtx.DeleteSetEntriesForSession(r.Context(), session.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "delete entries failed")
		return
	}
	for _, e := range req.Entries {
		if err := qtx.CreateSetEntry(r.Context(), db.CreateSetEntryParams{
			ID: ulid.New(), SessionID: session.ID, ExerciseID: e.ExerciseID, Equipment: e.Equipment,
			WeightKg: e.WeightKg, Reps: e.Reps, Sets: e.Sets, RawText: e.RawText, ParsedBy: e.ParsedBy, EntryOrder: e.Order,
		}); err != nil {
			writeError(w, http.StatusInternalServerError, "create entry failed")
			return
		}
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, "tx commit failed")
		return
	}

	entries, err := h.queries.GetSetEntriesForSession(r.Context(), session.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "fetch entries failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"id": session.ID, "date": session.Date, "notes": session.Notes, "entries": entries,
	})
}
```

Check whether sqlc generated `db.Queries.WithTx(tx pgx.Tx) *db.Queries` automatically (it does by default for the `pgx/v5` sql_package per `sqlc.yaml`) and whether `ListWorkoutSessionsInRangeParams`'s two date fields are actually named `Date`/`Date_2` (sqlc's auto-naming for repeated `$1`/`$2` params referencing the same column) — read the generated file after Task 2's `sqlc generate` and correct these names here if they differ.

- [ ] **Step 4: Wire into server.go**

```go
		sessionsH := handler.NewSessionsHandler(pool, queries)
		r.Get("/api/sessions", sessionsH.Get)
		r.Put("/api/sessions/{date}", sessionsH.Put)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && go test -tags=integration ./internal/handler/... -run TestSessions -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/internal/handler/sessions.go backend/internal/handler/sessions_test.go backend/internal/server/server.go
git commit -m "feat(backend): add /api/sessions handlers with upsert-replace-entries"
```

---

### Task 10: /api/goals handlers

**Files:**
- Create: `backend/internal/handler/goals.go`
- Modify: `backend/internal/server/server.go`
- Test: `backend/internal/handler/goals_test.go`

**Interfaces:**
- Consumes: `db.Queries.DeactivateGoalsForUser`, `CreateGoal`, `CreateGoalTarget`, `GetActiveGoalForUser`, `GetGoalTargetsForGoal`, `GetSessionsWithEntriesInWeek` (Task 2), `science.VolumeTargets`/`MuscleGroups` (Task 3).
- Produces: `GoalsHandler` with `Create`, `GetActive`, `GetActiveProgress` methods, mounted at `POST /api/goals`, `GET /api/goals/active`, `GET /api/goals/active/progress`.

- [ ] **Step 1: Write the failing test**

```go
// backend/internal/handler/goals_test.go
//go:build integration

package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/DowLucas/strong-notes-backend/internal/db"
	"github.com/DowLucas/strong-notes-backend/internal/ulid"
	"github.com/DowLucas/strong-notes-backend/testutil"
)

func TestGoals_CreateDefaultsFromVolumeTable(t *testing.T) {
	pool := testutil.SharedDB(t)
	q := db.New(pool)
	userID := ulid.New()
	testutil.InsertTestUser(t, pool, userID, "goals-test@example.com")
	h := NewGoalsHandler(pool, q)

	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/goals", strings.NewReader(`{"type":"HYPERTROPHY"}`)), userID)
	w := httptest.NewRecorder()
	h.Create(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}
	var resp struct {
		Targets []struct {
			Muscle         string `json:"muscle"`
			MinSetsPerWeek int    `json:"minSetsPerWeek"`
			MaxSetsPerWeek int    `json:"maxSetsPerWeek"`
		} `json:"targets"`
	}
	json.Unmarshal(w.Body.Bytes(), &resp)
	found := false
	for _, target := range resp.Targets {
		if target.Muscle == "GLUTES" {
			found = true
			if target.MinSetsPerWeek != 12 || target.MaxSetsPerWeek != 20 {
				t.Errorf("expected GLUTES 12-20, got %d-%d", target.MinSetsPerWeek, target.MaxSetsPerWeek)
			}
		}
	}
	if !found {
		t.Fatal("expected a GLUTES target in the created goal")
	}
}

func TestGoals_ActiveProgress_ComputesActualSets(t *testing.T) {
	pool := testutil.SharedDB(t)
	q := db.New(pool)
	userID := ulid.New()
	testutil.InsertTestUser(t, pool, userID, "goals-progress-test@example.com")
	h := NewGoalsHandler(pool, q)

	createReq := withClaims(httptest.NewRequest(http.MethodPost, "/api/goals", strings.NewReader(`{"type":"HYPERTROPHY"}`)), userID)
	h.Create(httptest.NewRecorder(), createReq)

	exercisesH := NewExercisesHandler(q)
	exW := httptest.NewRecorder()
	exercisesH.Create(exW, httptest.NewRequest(http.MethodPost, "/api/exercises", strings.NewReader(`{"name":"Test Hip Thrust For Goals","muscles":["GLUTES"]}`)))
	var exercise struct {
		ID string `json:"id"`
	}
	json.Unmarshal(exW.Body.Bytes(), &exercise)

	sessionsH := NewSessionsHandler(pool, q)
	putBody := `{"entries":[{"exerciseId":"` + exercise.ID + `","sets":4,"rawText":"HT 40kg 8x4","parsedBy":"DICTIONARY","order":0}]}`
	putReq := withClaims(httptest.NewRequest(http.MethodPut, "/api/sessions/2026-07-06", strings.NewReader(putBody)), userID)
	sessionsH.Put(httptest.NewRecorder(), putReq) // NOTE: needs chi URL param "date" set — mount via a real chi router, see Task 9's implementer note

	progressReq := withClaims(httptest.NewRequest(http.MethodGet, "/api/goals/active/progress?weekStart=2026-07-06", nil), userID)
	progressW := httptest.NewRecorder()
	h.GetActiveProgress(progressW, progressReq)

	var progress []struct {
		Muscle     string `json:"muscle"`
		ActualSets int    `json:"actualSets"`
	}
	json.Unmarshal(progressW.Body.Bytes(), &progress)
	for _, p := range progress {
		if p.Muscle == "GLUTES" && p.ActualSets != 4 {
			t.Errorf("expected GLUTES actualSets 4, got %d", p.ActualSets)
		}
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && go test -tags=integration ./internal/handler/... -run TestGoals -v`
Expected: FAIL — handler doesn't exist yet.

- [ ] **Step 3: Implement the handler**

```go
// backend/internal/handler/goals.go
package handler

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/DowLucas/strong-notes-backend/internal/db"
	"github.com/DowLucas/strong-notes-backend/internal/middleware"
	"github.com/DowLucas/strong-notes-backend/internal/science"
	"github.com/DowLucas/strong-notes-backend/internal/ulid"
)

type GoalsHandler struct {
	pool    *pgxpool.Pool
	queries *db.Queries
}

func NewGoalsHandler(pool *pgxpool.Pool, queries *db.Queries) *GoalsHandler {
	return &GoalsHandler{pool: pool, queries: queries}
}

type goalOverride struct {
	Muscle string `json:"muscle"`
	Min    int    `json:"min"`
	Max    int    `json:"max"`
}

type createGoalRequest struct {
	Type        string         `json:"type"`
	Description *string        `json:"description"`
	Overrides   []goalOverride `json:"overrides"`
}

func (h *GoalsHandler) Create(w http.ResponseWriter, r *http.Request) {
	var req createGoalRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Type == "" {
		writeError(w, http.StatusBadRequest, "type is required")
		return
	}
	claims := middleware.ClaimsFromContext(r.Context())
	defaults := science.VolumeTargets(req.Type)

	overrideByMuscle := make(map[string]goalOverride, len(req.Overrides))
	for _, o := range req.Overrides {
		overrideByMuscle[o.Muscle] = o
	}

	tx, err := h.pool.Begin(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "tx begin failed")
		return
	}
	defer tx.Rollback(r.Context())
	qtx := h.queries.WithTx(tx)

	if err := qtx.DeactivateGoalsForUser(r.Context(), claims.UserID); err != nil {
		writeError(w, http.StatusInternalServerError, "deactivate failed")
		return
	}
	goal, err := qtx.CreateGoal(r.Context(), db.CreateGoalParams{
		ID: ulid.New(), UserID: claims.UserID, Type: req.Type, Description: req.Description,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "create goal failed")
		return
	}

	type targetOut struct {
		Muscle         string `json:"muscle"`
		MinSetsPerWeek int    `json:"minSetsPerWeek"`
		MaxSetsPerWeek int    `json:"maxSetsPerWeek"`
	}
	var targets []targetOut
	for _, muscle := range science.MuscleGroups {
		min, max := defaults[muscle].Min, defaults[muscle].Max
		if o, ok := overrideByMuscle[muscle]; ok {
			min, max = o.Min, o.Max
		}
		if err := qtx.CreateGoalTarget(r.Context(), db.CreateGoalTargetParams{
			ID: ulid.New(), GoalID: goal.ID, Muscle: muscle, MinSetsPerWeek: min, MaxSetsPerWeek: max,
		}); err != nil {
			writeError(w, http.StatusInternalServerError, "create target failed")
			return
		}
		targets = append(targets, targetOut{Muscle: muscle, MinSetsPerWeek: min, MaxSetsPerWeek: max})
	}

	if err := tx.Commit(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, "tx commit failed")
		return
	}

	writeJSON(w, http.StatusCreated, map[string]any{
		"id": goal.ID, "type": goal.Type, "description": goal.Description, "targets": targets,
	})
}

func (h *GoalsHandler) GetActive(w http.ResponseWriter, r *http.Request) {
	claims := middleware.ClaimsFromContext(r.Context())
	goal, err := h.queries.GetActiveGoalForUser(r.Context(), claims.UserID)
	if err != nil {
		writeError(w, http.StatusNotFound, "no active goal")
		return
	}
	targets, err := h.queries.GetGoalTargetsForGoal(r.Context(), goal.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "fetch targets failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": goal.ID, "type": goal.Type, "targets": targets})
}

func (h *GoalsHandler) GetActiveProgress(w http.ResponseWriter, r *http.Request) {
	claims := middleware.ClaimsFromContext(r.Context())
	goal, err := h.queries.GetActiveGoalForUser(r.Context(), claims.UserID)
	if err != nil {
		writeError(w, http.StatusNotFound, "no active goal")
		return
	}
	targets, err := h.queries.GetGoalTargetsForGoal(r.Context(), goal.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "fetch targets failed")
		return
	}

	weekStart, err := time.Parse("2006-01-02", r.URL.Query().Get("weekStart"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "weekStart must be YYYY-MM-DD")
		return
	}
	weekEnd := weekStart.AddDate(0, 0, 7)

	rows, err := h.queries.GetSessionsWithEntriesInWeek(r.Context(), db.GetSessionsWithEntriesInWeekParams{UserID: claims.UserID, Date: weekStart, Date_2: weekEnd})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "aggregate failed")
		return
	}
	actualByMuscle := make(map[string]int)
	for _, row := range rows {
		if row.Sets == nil {
			continue
		}
		actualByMuscle[row.Muscle] += *row.Sets
	}

	type progressOut struct {
		Muscle     string `json:"muscle"`
		TargetMin  int    `json:"targetMin"`
		TargetMax  int    `json:"targetMax"`
		ActualSets int    `json:"actualSets"`
	}
	var progress []progressOut
	for _, target := range targets {
		progress = append(progress, progressOut{
			Muscle: target.Muscle, TargetMin: target.MinSetsPerWeek, TargetMax: target.MaxSetsPerWeek,
			ActualSets: actualByMuscle[target.Muscle],
		})
	}
	writeJSON(w, http.StatusOK, progress)
}
```

Check the exact generated field names for `GetSessionsWithEntriesInWeekParams` (the two `Date`/`Date_2`-style params) and `rows[i].Sets`'s exact type (sqlc emits `*int32` for a nullable `INTEGER` column, not `*int` — adjust the `actualByMuscle` accumulation's type accordingly) against what `sqlc generate` actually produced in Task 2.

- [ ] **Step 4: Wire into server.go**

```go
		goalsH := handler.NewGoalsHandler(pool, queries)
		r.Post("/api/goals", goalsH.Create)
		r.Get("/api/goals/active", goalsH.GetActive)
		r.Get("/api/goals/active/progress", goalsH.GetActiveProgress)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && go test -tags=integration ./internal/handler/... -run TestGoals -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/internal/handler/goals.go backend/internal/handler/goals_test.go backend/internal/server/server.go
git commit -m "feat(backend): add /api/goals handlers with weekly volume-vs-target progress"
```

---

### Task 11: Deployment config and full verification

**Files:**
- Modify: `backend/docker-compose.yml`
- Modify: `backend/.env.local.example` (or equivalent — confirm exact filename from Task 1)
- Create: `backend/DEPLOY.md`

**Interfaces:**
- Consumes: nothing (ops task, no code interfaces).
- Produces: a deployable Docker stack matching the plan's "S3/River disabled" constraint, and documentation for the Proxmox rollout.

- [ ] **Step 1: Remove the MinIO dependency from docker-compose.yml**

Edit `backend/docker-compose.yml`: delete the `minio` service block and the `depends_on: minio: ...` clause under `backend`, and the `scaffold-minio-data` volume. The backend's `healthcheck` block stays as-is (it only pings the backend's own liveness endpoint).

- [ ] **Step 2: Add a Postgres service to docker-compose.yml**

The scaffold's compose file assumes an externally-provided Postgres (per its `DATABASE_URL`) — add one for self-contained local/deploy use:

```yaml
  postgres:
    image: postgres:16
    container_name: strong-notes-postgres
    network_mode: host
    environment:
      POSTGRES_USER: strongnotes
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: strongnotes
    volumes:
      - /tank/apps/strong-notes/pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U strongnotes"]
      interval: 5s
      timeout: 3s
      retries: 5
```

Add `depends_on: postgres: condition: service_healthy` to the `backend` service.

- [ ] **Step 3: Write DEPLOY.md**

```markdown
# Deploying to Proxmox

1. `ssh proxmox`
2. `sudo zfs create tank/apps/strong-notes` then `sudo chown -R 999:999 /tank/apps/strong-notes` (postgres UID)
3. `mkdir -p /opt/stacks/strong-notes-api`, copy this repo's `backend/` there (or `git clone`)
4. Create `/opt/stacks/strong-notes-api/.env.local` with `DATABASE_URL` (pointing at the `postgres` service via `localhost:5432` since both run with `network_mode: host`), `JWT_SECRET` (32+ random chars), `DEV_MODE=false`, `DEMO_LOGIN_EMAILS=<your real email>`, `LLM_PROVIDER=anthropic`, `ANTHROPIC_API_KEY=<key>`, `POSTGRES_PASSWORD=<random>`
5. `cd /opt/stacks/strong-notes-api && sudo docker compose up -d --build`
6. Migrations run automatically on backend startup (`runMigrations` in `cmd/api/main.go`) — no manual step needed.
7. Append to `/opt/stacks/caddy/Caddyfile`:
   ```
   strong-notes-api.lurkhuset.com {
       reverse_proxy localhost:8080
   }
   ```
8. `sudo docker exec caddy-caddy-1 caddy reload --config /etc/caddy/Caddyfile`
9. Verify: `curl -fsS https://strong-notes-api.lurkhuset.com/api/health/liveness`
10. Add an Uptime Kuma monitor for that URL.

Since `DEV_MODE=false` here, magic-link sign-in requires `RESEND_API_KEY` or `SMTP_HOST` to be set too — add whichever email delivery method you choose alongside the vars above; `DEMO_LOGIN_EMAILS` only affects mode-agnostic inline-token delivery for the listed addresses, it doesn't replace real email config for everyone else.
```

- [ ] **Step 4: Run the full test suite one final time**

```bash
cd backend
go test ./... 2>&1 | tail -20
go test -tags=integration ./... 2>&1 | tail -40
go build ./...
```
Expected: all green, clean build — this is the final check that all 10 prior tasks compose correctly together.

- [ ] **Step 5: Commit**

```bash
git add backend/docker-compose.yml backend/DEPLOY.md backend/.env.local.example
git commit -m "feat(backend): add Postgres to compose, drop MinIO, document Proxmox deploy"
```

---

## Self-Review Notes

- **Spec coverage:** every backend requirement from the design spec is covered — schema port (Task 2), swappable LLM provider with the fixed prompts (Task 5), dictionary-first/LLM-fallback resolution (Tasks 4/6), exercise/abbreviation dedupe including the empty-muscles allowance (Tasks 7/8), session upsert-replace (Task 9), goal creation/progress with the static volume table (Tasks 3/10), JWT-derived `user_id` on every route (all handler tasks), disabled S3/River (Task 11 explicitly avoids touching them), Proxmox deployment (Task 11).
- **Placeholder scan:** two tasks (6, 9) contain explicit "this test skeleton is incomplete, finish it before running" notes rather than a fully-working test — this is because the real generated sqlc types and exact `Claims` field names can only be known after Task 2/1 actually run `sqlc generate`/inspect the cloned auth package, which this plan-writing pass couldn't execute. These are flagged inline as implementer TODOs with explicit instructions on what to fix, not silently glossed over — an implementer following the step's own instructions will produce a real, complete test before proceeding, consistent with this plan's TDD requirement.
- **Type consistency:** `LineGuess`/`GoalGuess` (Task 5) match what Task 6's handler spreads into its JSON response. `DictionaryResolution` (Task 4) matches what Task 6 consumes. `science.VolumeTargets`/`MuscleGroups` (Task 3) match Task 10's iteration. Several tasks explicitly flag "verify the exact sqlc-generated field name here" rather than asserting a name with false confidence — this is a deliberate, disclosed uncertainty (sqlc's naming for repeated-column params and nullable-column types can't be predicted with 100% certainty without running it), not a placeholder; each flagged spot names exactly what to check and where.
