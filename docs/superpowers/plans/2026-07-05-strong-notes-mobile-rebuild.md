# Strong Notes Mobile Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current custom-auth Expo mobile app with one forked from `github.com/DowLucas/app-scaffold`'s Expo starter (magic-link/JWT auth, design system, i18n), porting Strong Notes' four screens and their already-tested local-first logic (SQLite repos, sync engine, quick-entry parsing, muscle-color science) on top of it.

**Architecture:** The scaffold's `app/` directory (renamed to `mobile/`) is kept largely as-is for its auth stack (`lib/auth.tsx`, `lib/storage.ts`, `lib/api.ts`, `lib/protocol.ts`, `lib/discovery.ts`, the `(auth)/sign-in` screen). `lib/api.ts`'s `ApiClient` interface and `createClient` gain the ten Strong Notes domain methods, matching the already-shipped Go backend's real routes/response shapes exactly. Strong Notes' business logic (`src/db`, `src/sync`, `src/parsing`, `src/science`, `src/components`) ports over with one structural change: every module that previously imported a free-function API client now receives the scaffold's `ApiClient` object as a parameter (dependency injection), since screens obtain it via `useAuth().api` rather than a module-level singleton. The scaffold's `(tabs)/index` becomes the Log screen; `stats`/`history` are new tabs; `(tabs)/you` (the existing settings hub) gains an abbreviation-dictionary section.

**Tech Stack:** Expo SDK ~54 (scaffold's pinned version), TypeScript, expo-router, i18next, `expo-sqlite` (local-first storage), `expo-secure-store` (via the scaffold's session storage), jest-expo + `@testing-library/react-native` (added — the scaffold's own `ts-jest` setup only covers pure-logic tests, not component rendering, which every ported screen test needs).

## Global Constraints

- Mobile app lives in `mobile/` at the repo root (replacing the current custom-auth `mobile/`), alongside `backend/`.
- Do not modify the scaffold's auth stack's behavior (`lib/auth.tsx`, `lib/storage.ts`, `(auth)/sign-in.tsx`) beyond what's needed to keep it working — this plan builds on top of it, not around it.
- Every backend call goes through the single `ApiClient` object obtained via `useAuth().api` — no screen or module calls `fetch` directly, and no module holds its own module-level client singleton (this is why sync/parsing modules take `api: ApiClient` as a parameter instead of importing a client module).
- Match the Go backend's real, camelCase JSON contract exactly (verified against the shipped backend, not assumed): `MuscleGroup` values (`GLUTES`, `QUADS`, `HAMSTRINGS`, `CHEST`, `BACK`, `SHOULDERS`, `ARMS`, `CORE`, `CALVES`), `GoalType` values (`HYPERTROPHY`, `STRENGTH`, `ENDURANCE`, `CUSTOM`), `ParsedBy` values (`DICTIONARY`, `LLM`).
- A write always goes to SQLite first, then is queued for sync — screens never block on network to show a just-logged line (carried over from the prior mobile app's offline-first fix; do not regress this).
- Local dictionary resolution is attempted before any network call in the quick-entry parsing flow (carried over from the prior app's fix; do not regress this either).

---

## File Structure

```
mobile/                                    # forked from app-scaffold's app/ directory
  app.config.ts                            # MODIFY: name/slug/bundleIdentifier/scheme for Strong Notes
  jest.config.js                           # NEW: jest-expo preset (replaces package.json's ts-jest block)
  app/
    _layout.tsx                            # from scaffold, unmodified
    (auth)/_layout.tsx, sign-in.tsx         # from scaffold, unmodified
    (tabs)/_layout.tsx                      # MODIFY: 4 tabs (Log/Stats/History/You) instead of 2
    (tabs)/index.tsx                        # REPLACE: becomes the Log screen
    (tabs)/stats.tsx                        # NEW: Stats screen (heatmap + goal editor)
    (tabs)/history.tsx                      # NEW: History screen
    (tabs)/you.tsx                          # MODIFY: add abbreviation-dictionary section
    settings/about.tsx                      # from scaffold, unmodified
  lib/
    api.ts                                  # MODIFY: extend ApiClient with 10 domain methods
    auth.tsx, storage.ts, protocol.ts,
    discovery.ts, i18n.ts, theme.ts, ...     # from scaffold, unmodified
  src/
    db/
      client.ts                             # PORT (from old mobile/): expo-sqlite + migrations
      sessionsRepo.ts                        # PORT: local session/entry CRUD
      abbreviationsRepo.ts                    # PORT: local abbreviation cache CRUD
    sync/
      syncEngine.ts                          # PORT + REFACTOR: takes `api: ApiClient` param
    parsing/
      quickEntry.ts                          # PORT + REFACTOR: takes `api: ApiClient` param
    science/
      muscleColor.ts                         # PORT: unchanged, no API dependency
    components/
      ParsedLineRow.tsx                       # PORT: unchanged
      MuscleHeatmap.tsx                        # PORT: unchanged (SVG body diagram)
  test-shims/
    expo-sqlite.js                           # PORT: better-sqlite3 test shim
  __tests__/
    (mirrors old mobile/__tests__ structure, ported with api-injection updates)
```

---

### Task 1: Fork the scaffold app and verify it boots

**Files:**
- Create: `mobile/` (entire scaffold `app/` clone, renamed/rebranded)
- Modify: `mobile/app.config.ts`
- Create: `mobile/jest.config.js`
- Modify: `mobile/package.json` (add jest-expo, `@testing-library/react-native`, `better-sqlite3`, `expo-sqlite`; remove the `"jest"` block that configures `ts-jest`)

**Interfaces:**
- Consumes: nothing (foundational).
- Produces: a booting Expo app with the scaffold's sign-in flow working end-to-end against the shipped Go backend, and a jest-expo test environment capable of rendering React Native components (which every later task's screen tests need).

- [ ] **Step 1: Remove the old mobile app and clone the scaffold's app/ directory in its place**

```bash
cd /home/lucas/dev/projects/strong-notes
git rm -r mobile
git clone --depth 1 https://github.com/DowLucas/app-scaffold.git /tmp/scaffold-source
cp -r /tmp/scaffold-source/app ./mobile
rm -rf /tmp/scaffold-source
cd mobile
rm -rf node_modules
npm install
```

- [ ] **Step 2: Rebrand app.config.ts for Strong Notes**

Edit `mobile/app.config.ts`: change `name: 'Scaffold'` → `name: 'Strong Notes'`, `slug: 'scaffold'` → `slug: 'strong-notes'`, `scheme: 'scaffold'` → `scheme: 'strongnotes'`, `bundleIdentifier: 'com.dowlucas.scaffold'` → `bundleIdentifier: 'com.dowlucas.strongnotes'`, `package: 'com.dowlucas.scaffold'` → `package: 'com.dowlucas.strongnotes'`. Leave everything else (fonts, splash screen, plugins, `extra.apiBaseUrl` env-var pattern) unchanged.

- [ ] **Step 3: Replace the test setup with jest-expo**

```bash
cd mobile
npm install --save-dev jest-expo @testing-library/react-native better-sqlite3
npm install expo-sqlite
```

Remove the `"jest": { "preset": "ts-jest", ... }` block from `mobile/package.json` (the scaffold's own `lib/__tests__/api.test.ts` is pure-logic and doesn't need component rendering, but every ported screen test in this plan does).

```js
// mobile/jest.config.js
module.exports = {
  preset: 'jest-expo',
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg)',
  ],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    '^expo-sqlite$': '<rootDir>/test-shims/expo-sqlite.js',
  },
};
```

Add to `mobile/package.json`'s `scripts`: `"test": "jest"` (replacing the old ts-jest-invoking one, if the key already exists just overwrite its value).

- [ ] **Step 4: Verify the scaffold boots in web preview against the shipped Go backend**

Ensure the Go backend and its Postgres are running (from the completed backend migration): `docker start strong-notes-pg` (or equivalent), then run the backend (`cd ../backend && go run ./cmd/api`, with `.env.local` configured — `DEV_MODE=true` so sign-in returns the magic-link token inline).

```bash
cd mobile
EXPO_PUBLIC_API_URL=http://localhost:8080 npx expo start --web
```
Expected: the app loads to the sign-in screen (`(auth)/sign-in`), entering an email and tapping through returns an inline dev token, and completing sign-in redirects to the tabs (still the scaffold's stock `index`/`you` tabs at this point — that's expected, later tasks replace them).

- [ ] **Step 5: Run the scaffold's own existing tests to confirm the jest-expo swap didn't break them**

```bash
cd mobile
npm test
```
Expected: `lib/__tests__/api.test.ts` still passes under jest-expo (it's pure-logic, no rendering, so the preset swap shouldn't affect it — if it fails, check whether `jest-expo`'s environment needs `testEnvironment: 'node'` overridden per-file via a `@jest-environment` docblock; fix forward rather than reverting to ts-jest, since later tasks need jest-expo).

- [ ] **Step 6: Commit**

```bash
git add mobile
git commit -m "feat(mobile): fork app-scaffold as the Expo app, add jest-expo for component tests"
```

---

### Task 2: Extend the API client with Strong Notes domain methods

**Files:**
- Modify: `mobile/lib/api.ts`
- Test: `mobile/lib/__tests__/api.strongnotes.test.ts`

**Interfaces:**
- Consumes: `createClient`'s existing `request<T>`/`parse<T>` helpers and `ApiError` (already in `lib/api.ts`, unmodified).
- Produces: `ApiClient` interface gains these methods (exact names/signatures later tasks depend on):
  ```ts
  export type MuscleGroup = 'GLUTES'|'QUADS'|'HAMSTRINGS'|'CHEST'|'BACK'|'SHOULDERS'|'ARMS'|'CORE'|'CALVES';
  export type GoalType = 'HYPERTROPHY'|'STRENGTH'|'ENDURANCE'|'CUSTOM';
  export type ParsedBy = 'DICTIONARY'|'LLM';

  export interface ResolvedToken {
    token: string;
    type: 'exercise' | 'modifier';
    exerciseId?: string;
    modifierType?: string;
    modifierValue?: string;
  }
  export interface LlmGuess {
    exerciseName: string;
    equipment?: string | null;
    weightKg?: number | null;
    reps?: number | null;
    sets?: number | null;
    muscles?: MuscleGroup[];
  }
  export interface ResolveLineResponse {
    resolvedTokens: ResolvedToken[];
    unresolvedTokens: string[];
    llmGuess?: LlmGuess;
  }
  export interface GoalGuess { type: GoalType; muscles: MuscleGroup[]; }
  export interface Exercise { id: string; name: string; category: string; createdAt: string; }
  export interface Abbreviation {
    id: string; token: string; exerciseId?: string;
    modifierType?: string; modifierValue?: string; source: string; createdAt: string;
  }
  export interface SetEntryInput {
    exerciseId?: string; equipment?: string; weightKg?: number;
    reps?: number; sets?: number; rawText: string; parsedBy: ParsedBy; order: number;
  }
  export interface SetEntryResponse extends SetEntryInput { id: string; }
  export interface SessionResponse { id: string; date: string; notes: string | null; entries: SetEntryResponse[]; }
  export interface GoalTarget { muscle: MuscleGroup; minSetsPerWeek: number; maxSetsPerWeek: number; }
  export interface GoalResponse { id: string; type: GoalType; description?: string | null; targets: GoalTarget[]; }
  export interface GoalProgress { muscle: MuscleGroup; targetMin: number; targetMax: number; actualSets: number; }

  // Added to the ApiClient interface:
  resolveLine(line: string): Promise<ResolveLineResponse>;
  resolveGoal(text: string): Promise<GoalGuess>;
  createExercise(input: { name: string; muscles: MuscleGroup[] }): Promise<Exercise>;
  listAbbreviations(): Promise<Abbreviation[]>;
  createAbbreviation(input: { token: string; exerciseId?: string; modifierType?: string; modifierValue?: string }): Promise<Abbreviation>;
  confirmAbbreviation(id: string): Promise<Abbreviation>;
  putSession(date: string, body: { notes?: string | null; entries: SetEntryInput[] }): Promise<SessionResponse>;
  getSessions(from: string, to: string): Promise<SessionResponse[]>;
  createGoal(input: { type: GoalType; description?: string; overrides?: { muscle: MuscleGroup; min: number; max: number }[] }): Promise<GoalResponse>;
  getGoalProgress(weekStart: string): Promise<GoalProgress[]>;
  ```
  Every later task (db repos, sync engine, screens) imports these types and calls these methods on the `api` object it receives — do not rename any of them.

- [ ] **Step 1: Write the failing test**

```ts
// mobile/lib/__tests__/api.strongnotes.test.ts
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { apiBaseUrl: 'http://localhost:8080' } } },
}));

import { createClient } from '../api';
import { PROTOCOL_HEADER, APP_PROTOCOL_VERSION } from '../protocol';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? 'application/json' : null) },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe('ApiClient Strong Notes methods', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  it('resolveLine posts the line and returns the parsed response', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(jsonResponse({ resolvedTokens: [], unresolvedTokens: [] }));
    const client = createClient('http://localhost:8080', async () => 'test-token');

    const result = await client.resolveLine('BB RDL 40kg 8x3');

    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/resolve/line',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ line: 'BB RDL 40kg 8x3' }),
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
          [PROTOCOL_HEADER]: String(APP_PROTOCOL_VERSION),
        }),
      }),
    );
    expect(result).toEqual({ resolvedTokens: [], unresolvedTokens: [] });
  });

  it('getGoalProgress builds the query string', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(jsonResponse([]));
    const client = createClient('http://localhost:8080', async () => 'test-token');

    await client.getGoalProgress('2026-07-06');

    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/goals/active/progress?weekStart=2026-07-06',
      expect.any(Object),
    );
  });

  it('putSession PUTs to the date-scoped path', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(jsonResponse({ id: 's1', date: '2026-07-06', notes: null, entries: [] }));
    const client = createClient('http://localhost:8080', async () => 'test-token');

    const result = await client.putSession('2026-07-06', { entries: [] });

    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/sessions/2026-07-06',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ entries: [] }) }),
    );
    expect(result.id).toBe('s1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npm test -- api.strongnotes.test.ts`
Expected: FAIL — `client.resolveLine` etc. are not functions yet.

- [ ] **Step 3: Implement the extension**

Add these type exports near the top of `mobile/lib/api.ts` (after the existing `User`/`MagicLinkResponse`/etc. wire types):

```ts
export type MuscleGroup = 'GLUTES' | 'QUADS' | 'HAMSTRINGS' | 'CHEST' | 'BACK' | 'SHOULDERS' | 'ARMS' | 'CORE' | 'CALVES';
export type GoalType = 'HYPERTROPHY' | 'STRENGTH' | 'ENDURANCE' | 'CUSTOM';
export type ParsedBy = 'DICTIONARY' | 'LLM';

export interface ResolvedToken {
  token: string;
  type: 'exercise' | 'modifier';
  exerciseId?: string;
  modifierType?: string;
  modifierValue?: string;
}

export interface LlmGuess {
  exerciseName: string;
  equipment?: string | null;
  weightKg?: number | null;
  reps?: number | null;
  sets?: number | null;
  muscles?: MuscleGroup[];
}

export interface ResolveLineResponse {
  resolvedTokens: ResolvedToken[];
  unresolvedTokens: string[];
  llmGuess?: LlmGuess;
}

export interface GoalGuess {
  type: GoalType;
  muscles: MuscleGroup[];
}

export interface Exercise {
  id: string;
  name: string;
  category: string;
  createdAt: string;
}

export interface Abbreviation {
  id: string;
  token: string;
  exerciseId?: string;
  modifierType?: string;
  modifierValue?: string;
  source: string;
  createdAt: string;
}

export interface SetEntryInput {
  exerciseId?: string;
  equipment?: string;
  weightKg?: number;
  reps?: number;
  sets?: number;
  rawText: string;
  parsedBy: ParsedBy;
  order: number;
}

export interface SetEntryResponse extends SetEntryInput {
  id: string;
}

export interface SessionResponse {
  id: string;
  date: string;
  notes: string | null;
  entries: SetEntryResponse[];
}

export interface GoalTarget {
  muscle: MuscleGroup;
  minSetsPerWeek: number;
  maxSetsPerWeek: number;
}

export interface GoalResponse {
  id: string;
  type: GoalType;
  description?: string | null;
  targets: GoalTarget[];
}

export interface GoalProgress {
  muscle: MuscleGroup;
  targetMin: number;
  targetMax: number;
  actualSets: number;
}
```

Add these method signatures to the `ApiClient` interface (after `getInstanceInfo`):

```ts
  resolveLine(line: string): Promise<ResolveLineResponse>;
  resolveGoal(text: string): Promise<GoalGuess>;
  createExercise(input: { name: string; muscles: MuscleGroup[] }): Promise<Exercise>;
  listAbbreviations(): Promise<Abbreviation[]>;
  createAbbreviation(input: { token: string; exerciseId?: string; modifierType?: string; modifierValue?: string }): Promise<Abbreviation>;
  confirmAbbreviation(id: string): Promise<Abbreviation>;
  putSession(date: string, body: { notes?: string | null; entries: SetEntryInput[] }): Promise<SessionResponse>;
  getSessions(from: string, to: string): Promise<SessionResponse[]>;
  createGoal(input: { type: GoalType; description?: string; overrides?: { muscle: MuscleGroup; min: number; max: number }[] }): Promise<GoalResponse>;
  getGoalProgress(weekStart: string): Promise<GoalProgress[]>;
```

Add these implementations to the object `createClient` returns (after `getInstanceInfo: ...`, before the closing `avatarImageSource` — order doesn't matter, but keep them grouped together):

```ts
    resolveLine: (line) =>
      request<ResolveLineResponse>('/api/resolve/line', { method: 'POST', body: JSON.stringify({ line }) }),

    resolveGoal: (text) =>
      request<GoalGuess>('/api/resolve/goal', { method: 'POST', body: JSON.stringify({ text }) }),

    createExercise: (input) =>
      request<Exercise>('/api/exercises', { method: 'POST', body: JSON.stringify(input) }),

    listAbbreviations: () => request<Abbreviation[]>('/api/abbreviations'),

    createAbbreviation: (input) =>
      request<Abbreviation>('/api/abbreviations', { method: 'POST', body: JSON.stringify(input) }),

    confirmAbbreviation: (id) =>
      request<Abbreviation>(`/api/abbreviations/${id}/confirm`, { method: 'PATCH' }),

    putSession: (date, body) =>
      request<SessionResponse>(`/api/sessions/${date}`, { method: 'PUT', body: JSON.stringify(body) }),

    getSessions: (from, to) => request<SessionResponse[]>(`/api/sessions?from=${from}&to=${to}`),

    createGoal: (input) =>
      request<GoalResponse>('/api/goals', { method: 'POST', body: JSON.stringify(input) }),

    getGoalProgress: (weekStart) => request<GoalProgress[]>(`/api/goals/active/progress?weekStart=${weekStart}`),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npm test -- api.strongnotes.test.ts`
Expected: PASS (3/3)

- [ ] **Step 5: Commit**

```bash
git add mobile/lib/api.ts mobile/lib/__tests__/api.strongnotes.test.ts
git commit -m "feat(mobile): extend ApiClient with Strong Notes domain methods"
```

---

### Task 3: Local SQLite schema and repositories

**Files:**
- Create: `mobile/src/db/client.ts`
- Create: `mobile/src/db/sessionsRepo.ts`
- Create: `mobile/src/db/abbreviationsRepo.ts`
- Create: `mobile/test-shims/expo-sqlite.js`
- Test: `mobile/__tests__/db/sessionsRepo.test.ts`
- Test: `mobile/__tests__/db/abbreviationsRepo.test.ts`

**Interfaces:**
- Consumes: `expo-sqlite`, `Abbreviation` type from `@/lib/api` (Task 2).
- Produces (unchanged from the prior mobile app's shipped, tested API — port verbatim, only import paths change):
  ```ts
  // src/db/client.ts
  export async function getDb(): Promise<SQLite.SQLiteDatabase>;
  export function resetDbForTests(): void;

  // src/db/sessionsRepo.ts
  export type LocalSetEntry = { id: string; exerciseId: string | null; equipment: string | null; weightKg: number | null; reps: number | null; sets: number | null; rawText: string; parsedBy: 'DICTIONARY' | 'LLM'; order: number; synced: 0 | 1 };
  export type LocalSession = { date: string; notes: string | null; entries: LocalSetEntry[]; synced: 0 | 1 };
  export async function upsertLocalSession(session: LocalSession): Promise<void>;
  export async function getLocalSession(date: string): Promise<LocalSession | null>;
  export async function listLocalSessions(fromDate: string, toDate: string): Promise<LocalSession[]>;
  export async function listUnsyncedSessions(): Promise<LocalSession[]>;
  export async function markSessionSynced(date: string): Promise<void>;

  // src/db/abbreviationsRepo.ts
  export async function cacheAbbreviations(abbreviations: Abbreviation[]): Promise<void>;
  export async function getCachedAbbreviations(): Promise<Abbreviation[]>;
  ```
  Task 4 (sync engine) and Task 5 (parsing) and every screen task depend on these exact names.

- [ ] **Step 1: Create the test shim**

```js
// mobile/test-shims/expo-sqlite.js
/**
 * Test-only shim for `expo-sqlite`. expo-sqlite is a native module with no
 * Node-compatible implementation, so this backs the small subset of the
 * async API this app uses (execAsync, runAsync, getAllAsync, getFirstAsync,
 * withTransactionAsync, openDatabaseAsync) with better-sqlite3, an in-process
 * native SQLite binding for Node. It runs real SQL so tests can catch actual
 * bugs in the repo layer's queries.
 *
 * Wired in ONLY for Jest via jest.config.js's moduleNameMapper; production
 * code continues to import the real expo-sqlite.
 */
const Database = require('better-sqlite3');

const registry = new Map();

class SQLiteDatabase {
  constructor(nativeDb) {
    this.nativeDb = nativeDb;
  }

  async execAsync(source) {
    this.nativeDb.exec(source);
  }

  async runAsync(source, params = []) {
    const info = this.nativeDb.prepare(source).run(...params);
    return { lastInsertRowId: info.lastInsertRowid, changes: info.changes };
  }

  async getAllAsync(source, params = []) {
    return this.nativeDb.prepare(source).all(...params);
  }

  async getFirstAsync(source, params = []) {
    const row = this.nativeDb.prepare(source).get(...params);
    return row === undefined ? null : row;
  }

  async withTransactionAsync(fn) {
    this.nativeDb.exec('BEGIN');
    try {
      await fn();
      this.nativeDb.exec('COMMIT');
    } catch (err) {
      this.nativeDb.exec('ROLLBACK');
      throw err;
    }
  }
}

async function openDatabaseAsync(name) {
  if (!registry.has(name)) {
    registry.set(name, new Database(':memory:'));
  }
  return new SQLiteDatabase(registry.get(name));
}

function __resetAllForTests() {
  for (const db of registry.values()) {
    db.close();
  }
  registry.clear();
}

module.exports = { openDatabaseAsync, __resetAllForTests };
```

- [ ] **Step 2: Create the DB client with migrations**

```ts
// mobile/src/db/client.ts
import * as SQLite from 'expo-sqlite';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function migrate(db: SQLite.SQLiteDatabase) {
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS sessions (
      date TEXT PRIMARY KEY,
      notes TEXT,
      synced INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS set_entries (
      id TEXT PRIMARY KEY,
      session_date TEXT NOT NULL REFERENCES sessions(date),
      exercise_id TEXT,
      equipment TEXT,
      weight_kg REAL,
      reps INTEGER,
      sets INTEGER,
      raw_text TEXT NOT NULL,
      parsed_by TEXT NOT NULL,
      entry_order INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS abbreviations_cache (
      id TEXT PRIMARY KEY,
      token TEXT NOT NULL,
      exercise_id TEXT,
      modifier_type TEXT,
      modifier_value TEXT,
      source TEXT NOT NULL
    );
  `);
}

export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync('strongnotes.db');
      await migrate(db);
      return db;
    })();
  }
  return dbPromise;
}

export function resetDbForTests() {
  dbPromise = null;
  const maybeShim = SQLite as unknown as { __resetAllForTests?: () => void };
  maybeShim.__resetAllForTests?.();
}
```

- [ ] **Step 3: Write the failing sessions repo test**

```ts
// mobile/__tests__/db/sessionsRepo.test.ts
import { resetDbForTests } from '@/src/db/client';
import {
  upsertLocalSession,
  getLocalSession,
  listUnsyncedSessions,
  markSessionSynced,
} from '@/src/db/sessionsRepo';

beforeEach(() => {
  resetDbForTests();
});

describe('sessionsRepo', () => {
  it('upserts a session with entries and reads it back', async () => {
    await upsertLocalSession({
      date: '2026-07-04',
      notes: 'leg day',
      synced: 0,
      entries: [
        {
          id: 'entry-1',
          exerciseId: null,
          equipment: 'barbell',
          weightKg: 40,
          reps: 8,
          sets: 3,
          rawText: 'BB RDL 40kg 8x3',
          parsedBy: 'DICTIONARY',
          order: 0,
          synced: 0,
        },
      ],
    });

    const session = await getLocalSession('2026-07-04');
    expect(session?.notes).toBe('leg day');
    expect(session?.entries).toHaveLength(1);
    expect(session?.entries[0].rawText).toBe('BB RDL 40kg 8x3');
  });

  it('replaces entries on repeat upsert of the same date', async () => {
    await upsertLocalSession({
      date: '2026-07-05',
      notes: null,
      synced: 0,
      entries: [{ id: 'a', exerciseId: null, equipment: null, weightKg: null, reps: null, sets: null, rawText: 'first', parsedBy: 'DICTIONARY', order: 0, synced: 0 }],
    });
    await upsertLocalSession({
      date: '2026-07-05',
      notes: null,
      synced: 0,
      entries: [{ id: 'b', exerciseId: null, equipment: null, weightKg: null, reps: null, sets: null, rawText: 'second', parsedBy: 'DICTIONARY', order: 0, synced: 0 }],
    });

    const session = await getLocalSession('2026-07-05');
    expect(session?.entries).toHaveLength(1);
    expect(session?.entries[0].rawText).toBe('second');
  });

  it('lists unsynced sessions and marks them synced', async () => {
    await upsertLocalSession({ date: '2026-07-06', notes: null, synced: 0, entries: [] });

    let unsynced = await listUnsyncedSessions();
    expect(unsynced.some((s) => s.date === '2026-07-06')).toBe(true);

    await markSessionSynced('2026-07-06');

    unsynced = await listUnsyncedSessions();
    expect(unsynced.some((s) => s.date === '2026-07-06')).toBe(false);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd mobile && npm test -- db/sessionsRepo.test.ts`
Expected: FAIL — `src/db/sessionsRepo.ts` doesn't exist yet.

- [ ] **Step 5: Implement the sessions repo**

```ts
// mobile/src/db/sessionsRepo.ts
import { getDb } from './client';

export type LocalSetEntry = {
  id: string;
  exerciseId: string | null;
  equipment: string | null;
  weightKg: number | null;
  reps: number | null;
  sets: number | null;
  rawText: string;
  parsedBy: 'DICTIONARY' | 'LLM';
  order: number;
  synced: 0 | 1;
};

export type LocalSession = {
  date: string;
  notes: string | null;
  entries: LocalSetEntry[];
  synced: 0 | 1;
};

export async function upsertLocalSession(session: LocalSession): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO sessions (date, notes, synced) VALUES (?, ?, ?)
       ON CONFLICT(date) DO UPDATE SET notes = excluded.notes, synced = excluded.synced`,
      [session.date, session.notes, session.synced]
    );
    await db.runAsync(`DELETE FROM set_entries WHERE session_date = ?`, [session.date]);
    for (const entry of session.entries) {
      await db.runAsync(
        `INSERT INTO set_entries (id, session_date, exercise_id, equipment, weight_kg, reps, sets, raw_text, parsed_by, entry_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          entry.id,
          session.date,
          entry.exerciseId,
          entry.equipment,
          entry.weightKg,
          entry.reps,
          entry.sets,
          entry.rawText,
          entry.parsedBy,
          entry.order,
        ]
      );
    }
  });
}

async function loadEntries(db: Awaited<ReturnType<typeof getDb>>, date: string): Promise<LocalSetEntry[]> {
  const rows = await db.getAllAsync<{
    id: string;
    exercise_id: string | null;
    equipment: string | null;
    weight_kg: number | null;
    reps: number | null;
    sets: number | null;
    raw_text: string;
    parsed_by: 'DICTIONARY' | 'LLM';
    entry_order: number;
  }>(`SELECT * FROM set_entries WHERE session_date = ? ORDER BY entry_order ASC`, [date]);

  return rows.map((r) => ({
    id: r.id,
    exerciseId: r.exercise_id,
    equipment: r.equipment,
    weightKg: r.weight_kg,
    reps: r.reps,
    sets: r.sets,
    rawText: r.raw_text,
    parsedBy: r.parsed_by,
    order: r.entry_order,
    synced: 0,
  }));
}

export async function getLocalSession(date: string): Promise<LocalSession | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ date: string; notes: string | null; synced: number }>(
    `SELECT * FROM sessions WHERE date = ?`,
    [date]
  );
  if (!row) return null;
  const entries = await loadEntries(db, date);
  return { date: row.date, notes: row.notes, synced: row.synced as 0 | 1, entries };
}

export async function listLocalSessions(fromDate: string, toDate: string): Promise<LocalSession[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ date: string; notes: string | null; synced: number }>(
    `SELECT * FROM sessions WHERE date >= ? AND date <= ? ORDER BY date DESC`,
    [fromDate, toDate]
  );
  const sessions: LocalSession[] = [];
  for (const row of rows) {
    const entries = await loadEntries(db, row.date);
    sessions.push({ date: row.date, notes: row.notes, synced: row.synced as 0 | 1, entries });
  }
  return sessions;
}

export async function listUnsyncedSessions(): Promise<LocalSession[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ date: string; notes: string | null; synced: number }>(
    `SELECT * FROM sessions WHERE synced = 0`
  );
  const sessions: LocalSession[] = [];
  for (const row of rows) {
    const entries = await loadEntries(db, row.date);
    sessions.push({ date: row.date, notes: row.notes, synced: row.synced as 0 | 1, entries });
  }
  return sessions;
}

export async function markSessionSynced(date: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(`UPDATE sessions SET synced = 1 WHERE date = ?`, [date]);
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd mobile && npm test -- db/sessionsRepo.test.ts`
Expected: PASS

- [ ] **Step 7: Write the failing abbreviations repo test**

```ts
// mobile/__tests__/db/abbreviationsRepo.test.ts
import { resetDbForTests } from '@/src/db/client';
import { cacheAbbreviations, getCachedAbbreviations } from '@/src/db/abbreviationsRepo';

beforeEach(() => {
  resetDbForTests();
});

describe('abbreviationsRepo', () => {
  it('replaces the entire cache on each call', async () => {
    await cacheAbbreviations([
      { id: '1', token: 'RDL', exerciseId: 'ex-1', source: 'BUILT_IN', createdAt: '2026-01-01T00:00:00Z' },
    ]);
    await cacheAbbreviations([
      { id: '2', token: 'HT', exerciseId: 'ex-2', source: 'BUILT_IN', createdAt: '2026-01-01T00:00:00Z' },
    ]);

    const cached = await getCachedAbbreviations();
    expect(cached).toHaveLength(1);
    expect(cached[0].token).toBe('HT');
  });
});
```

- [ ] **Step 8: Run test to verify it fails**

Run: `cd mobile && npm test -- db/abbreviationsRepo.test.ts`
Expected: FAIL — `src/db/abbreviationsRepo.ts` doesn't exist yet.

- [ ] **Step 9: Implement the abbreviations repo**

```ts
// mobile/src/db/abbreviationsRepo.ts
import { getDb } from './client';
import type { Abbreviation } from '@/lib/api';

export async function cacheAbbreviations(abbreviations: Abbreviation[]): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync(`DELETE FROM abbreviations_cache`);
    for (const a of abbreviations) {
      await db.runAsync(
        `INSERT INTO abbreviations_cache (id, token, exercise_id, modifier_type, modifier_value, source)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [a.id, a.token, a.exerciseId ?? null, a.modifierType ?? null, a.modifierValue ?? null, a.source]
      );
    }
  });
}

export async function getCachedAbbreviations(): Promise<Abbreviation[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{
    id: string;
    token: string;
    exercise_id: string | null;
    modifier_type: string | null;
    modifier_value: string | null;
    source: string;
  }>(`SELECT * FROM abbreviations_cache`);

  return rows.map((r) => ({
    id: r.id,
    token: r.token,
    exerciseId: r.exercise_id ?? undefined,
    modifierType: r.modifier_type ?? undefined,
    modifierValue: r.modifier_value ?? undefined,
    source: r.source,
    createdAt: '', // not needed for offline dictionary matching; cache doesn't round-trip this field
  }));
}
```

- [ ] **Step 10: Run test to verify it passes**

Run: `cd mobile && npm test -- db/abbreviationsRepo.test.ts`
Expected: PASS

- [ ] **Step 11: Commit**

```bash
git add mobile/src/db mobile/test-shims mobile/__tests__/db
git commit -m "feat(mobile): add local sqlite schema and repositories"
```

---

### Task 4: Sync engine (API-injected)

**Files:**
- Create: `mobile/src/sync/syncEngine.ts`
- Test: `mobile/__tests__/sync/syncEngine.test.ts`

**Interfaces:**
- Consumes: `ApiClient` type (Task 2), `listUnsyncedSessions`/`markSessionSynced` (Task 3's `sessionsRepo`), `cacheAbbreviations` (Task 3's `abbreviationsRepo`).
- Produces:
  ```ts
  export async function syncNow(api: ApiClient): Promise<{ pushed: number; pulled: number }>;
  ```
  Note the signature change from the prior mobile app's version: `api` is now a parameter (the screen's `useAuth().api`), not imported from a module-level client. Task 7 (Stats screen) and Task 9 (You/Profile additions) both call `syncNow(api)`.

- [ ] **Step 1: Write the failing test**

```ts
// mobile/__tests__/sync/syncEngine.test.ts
import { syncNow } from '@/src/sync/syncEngine';
import * as sessionsRepo from '@/src/db/sessionsRepo';
import * as abbreviationsRepo from '@/src/db/abbreviationsRepo';
import type { ApiClient } from '@/lib/api';

jest.mock('@/src/db/sessionsRepo');
jest.mock('@/src/db/abbreviationsRepo');

function fakeApi(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    putSession: jest.fn(),
    listAbbreviations: jest.fn(),
    ...overrides,
  } as unknown as ApiClient;
}

describe('syncNow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('pushes each unsynced local session to the backend and marks it synced', async () => {
    (sessionsRepo.listUnsyncedSessions as jest.Mock).mockResolvedValue([
      { date: '2026-07-04', notes: 'leg day', synced: 0, entries: [] },
    ]);
    const api = fakeApi({
      putSession: jest.fn().mockResolvedValue({}),
      listAbbreviations: jest.fn().mockResolvedValue([]),
    });

    const result = await syncNow(api);

    expect(api.putSession).toHaveBeenCalledWith('2026-07-04', { notes: 'leg day', entries: [] });
    expect(sessionsRepo.markSessionSynced).toHaveBeenCalledWith('2026-07-04');
    expect(result.pushed).toBe(1);
  });

  it('pulls the abbreviation dictionary and caches it', async () => {
    (sessionsRepo.listUnsyncedSessions as jest.Mock).mockResolvedValue([]);
    const api = fakeApi({
      listAbbreviations: jest.fn().mockResolvedValue([{ id: '1', token: 'RDL', source: 'BUILT_IN', createdAt: '' }]),
    });

    const result = await syncNow(api);

    expect(abbreviationsRepo.cacheAbbreviations).toHaveBeenCalledWith([{ id: '1', token: 'RDL', source: 'BUILT_IN', createdAt: '' }]);
    expect(result.pulled).toBe(1);
  });

  it('does not mark a session synced if the push fails', async () => {
    (sessionsRepo.listUnsyncedSessions as jest.Mock).mockResolvedValue([
      { date: '2026-07-05', notes: null, synced: 0, entries: [] },
    ]);
    const api = fakeApi({
      putSession: jest.fn().mockRejectedValue(new Error('network down')),
      listAbbreviations: jest.fn().mockResolvedValue([]),
    });

    const result = await syncNow(api);

    expect(sessionsRepo.markSessionSynced).not.toHaveBeenCalled();
    expect(result.pushed).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npm test -- sync/syncEngine.test.ts`
Expected: FAIL — `src/sync/syncEngine.ts` doesn't exist yet.

- [ ] **Step 3: Implement the sync engine**

```ts
// mobile/src/sync/syncEngine.ts
import type { ApiClient } from '@/lib/api';
import { listUnsyncedSessions, markSessionSynced } from '../db/sessionsRepo';
import { cacheAbbreviations } from '../db/abbreviationsRepo';

export async function syncNow(api: ApiClient): Promise<{ pushed: number; pulled: number }> {
  const unsynced = await listUnsyncedSessions();
  let pushed = 0;

  for (const session of unsynced) {
    try {
      await api.putSession(session.date, {
        notes: session.notes,
        entries: session.entries.map((e) => ({
          exerciseId: e.exerciseId ?? undefined,
          equipment: e.equipment ?? undefined,
          weightKg: e.weightKg ?? undefined,
          reps: e.reps ?? undefined,
          sets: e.sets ?? undefined,
          rawText: e.rawText,
          parsedBy: e.parsedBy,
          order: e.order,
        })),
      });
      await markSessionSynced(session.date);
      pushed += 1;
    } catch {
      // Leave this session unsynced; the next syncNow() call retries it.
    }
  }

  const abbreviations = await api.listAbbreviations();
  await cacheAbbreviations(abbreviations);

  return { pushed, pulled: abbreviations.length };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npm test -- sync/syncEngine.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add mobile/src/sync mobile/__tests__/sync
git commit -m "feat(mobile): add API-injected sync engine"
```

---

### Task 5: Quick-entry parsing (API-injected, local-dictionary-first)

**Files:**
- Create: `mobile/src/parsing/quickEntry.ts`
- Test: `mobile/__tests__/parsing/quickEntry.test.ts`

**Interfaces:**
- Consumes: `ApiClient` type (Task 2), `getCachedAbbreviations` (Task 3's `abbreviationsRepo`).
- Produces:
  ```ts
  export type ParsedLine = {
    rawText: string;
    status: 'pending' | 'resolved' | 'needs-confirm' | 'unresolved';
    exerciseId?: string;
    exerciseName?: string;
    equipment?: string;
    weightKg?: number;
    reps?: number;
    sets?: number;
    muscles?: MuscleGroup[];
    unresolvedToken?: string;
    parsedBy: 'DICTIONARY' | 'LLM';
  };
  export async function parseQuickEntryLine(api: ApiClient, line: string): Promise<ParsedLine>;
  ```
  Note the signature change: `api` is a parameter. Task 6 (Log screen) imports `parseQuickEntryLine`/`ParsedLine` and calls it with the screen's `useAuth().api`.

  This carries over BOTH fixes from the prior mobile app's shipped version: (a) local-cache-first dictionary resolution before any network call, and (b) `exerciseId`/parsed weight/reps/sets threaded through for dictionary-resolved lines (the critical bug fixed in the prior app — do not regress it here).

- [ ] **Step 1: Write the failing test**

```ts
// mobile/__tests__/parsing/quickEntry.test.ts
import { parseQuickEntryLine } from '@/src/parsing/quickEntry';
import { cacheAbbreviations } from '@/src/db/abbreviationsRepo';
import { resetDbForTests } from '@/src/db/client';
import type { ApiClient } from '@/lib/api';

function fakeApi(overrides: Partial<ApiClient> = {}): ApiClient {
  return { resolveLine: jest.fn(), ...overrides } as unknown as ApiClient;
}

beforeEach(() => {
  resetDbForTests();
});

describe('parseQuickEntryLine', () => {
  it('resolves locally from the cached dictionary without calling the network', async () => {
    await cacheAbbreviations([
      { id: '1', token: 'RDL', exerciseId: 'ex-1', source: 'BUILT_IN', createdAt: '' },
    ]);
    const resolveLine = jest.fn();
    const api = fakeApi({ resolveLine });

    const result = await parseQuickEntryLine(api, 'RDL 40kg 8x3');

    expect(resolveLine).not.toHaveBeenCalled();
    expect(result.status).toBe('resolved');
    expect(result.exerciseId).toBe('ex-1');
    expect(result.weightKg).toBe(40);
    expect(result.reps).toBe(8);
    expect(result.sets).toBe(3);
    expect(result.parsedBy).toBe('DICTIONARY');
  });

  it('falls back to the network when the local cache misses, extracting exerciseId from resolvedTokens', async () => {
    const api = fakeApi({
      resolveLine: jest.fn().mockResolvedValue({
        resolvedTokens: [{ token: 'HT', type: 'exercise', exerciseId: 'ex-2' }],
        unresolvedTokens: [],
      }),
    });

    const result = await parseQuickEntryLine(api, 'HT 50kg 10x3');

    expect(result.status).toBe('resolved');
    expect(result.exerciseId).toBe('ex-2');
    expect(result.parsedBy).toBe('DICTIONARY');
  });

  it('marks an LLM-guessed line as needs-confirm with the unresolved token and muscles carried through', async () => {
    const api = fakeApi({
      resolveLine: jest.fn().mockResolvedValue({
        resolvedTokens: [],
        unresolvedTokens: ['CRABWALK'],
        llmGuess: { exerciseName: 'Crab Walk', equipment: null, weightKg: null, reps: 8, sets: 2, muscles: ['GLUTES', 'CORE'] },
      }),
    });

    const result = await parseQuickEntryLine(api, 'CRABWALK 8x2');

    expect(result.status).toBe('needs-confirm');
    expect(result.exerciseName).toBe('Crab Walk');
    expect(result.unresolvedToken).toBe('CRABWALK');
    expect(result.muscles).toEqual(['GLUTES', 'CORE']);
    expect(result.parsedBy).toBe('LLM');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npm test -- parsing/quickEntry.test.ts`
Expected: FAIL — `src/parsing/quickEntry.ts` doesn't exist yet.

- [ ] **Step 3: Implement the parsing module**

```ts
// mobile/src/parsing/quickEntry.ts
import type { ApiClient, MuscleGroup } from '@/lib/api';
import { getCachedAbbreviations } from '../db/abbreviationsRepo';

export type ParsedLine = {
  rawText: string;
  status: 'pending' | 'resolved' | 'needs-confirm' | 'unresolved';
  exerciseId?: string;
  exerciseName?: string;
  equipment?: string;
  weightKg?: number;
  reps?: number;
  sets?: number;
  muscles?: MuscleGroup[];
  unresolvedToken?: string;
  parsedBy: 'DICTIONARY' | 'LLM';
};

const NUMERIC_TOKEN = /^\d+(\.\d+)?(kg|lb)?$|^\d+x\d+$/i;
const WEIGHT_TOKEN = /^(\d+(?:\.\d+)?)(?:kg|lb)?$/i;
const REPS_SETS_TOKEN = /^(\d+)x(\d+)$/i;

function parseNumericTokens(line: string): { weightKg?: number; reps?: number; sets?: number } {
  const out: { weightKg?: number; reps?: number; sets?: number } = {};
  for (const token of line.trim().split(/\s+/)) {
    const repsSets = token.match(REPS_SETS_TOKEN);
    if (repsSets) {
      out.reps = Number(repsSets[1]);
      out.sets = Number(repsSets[2]);
      continue;
    }
    const weight = token.match(WEIGHT_TOKEN);
    if (weight) out.weightKg = Number(weight[1]);
  }
  return out;
}

async function tryResolveLocally(line: string): Promise<ParsedLine | null> {
  const cached = await getCachedAbbreviations();
  const byToken = new Map(cached.map((a) => [a.token.toUpperCase(), a]));

  const wordTokens = line.trim().split(/\s+/).filter((t) => !NUMERIC_TOKEN.test(t));
  if (wordTokens.length === 0) return null;

  let exerciseId: string | undefined;
  let equipment: string | undefined;
  for (const token of wordTokens) {
    const match = byToken.get(token.toUpperCase());
    if (!match) return null; // any miss falls through to the network path
    if (match.exerciseId) exerciseId = match.exerciseId;
    if (match.modifierType === 'equipment' && match.modifierValue) equipment = match.modifierValue;
  }
  if (!exerciseId) return null;

  const numeric = parseNumericTokens(line);
  return {
    rawText: line,
    status: 'resolved',
    exerciseId,
    equipment,
    ...numeric,
    parsedBy: 'DICTIONARY',
  };
}

export async function parseQuickEntryLine(api: ApiClient, line: string): Promise<ParsedLine> {
  const local = await tryResolveLocally(line);
  if (local) return local;

  const response = await api.resolveLine(line);
  const numeric = parseNumericTokens(line);

  if (response.llmGuess) {
    return {
      rawText: line,
      status: 'needs-confirm',
      exerciseName: response.llmGuess.exerciseName,
      equipment: response.llmGuess.equipment ?? undefined,
      weightKg: response.llmGuess.weightKg ?? numeric.weightKg,
      reps: response.llmGuess.reps ?? numeric.reps,
      sets: response.llmGuess.sets ?? numeric.sets,
      muscles: response.llmGuess.muscles,
      unresolvedToken: response.unresolvedTokens[0],
      parsedBy: 'LLM',
    };
  }

  if (response.unresolvedTokens.length > 0) {
    return { rawText: line, status: 'unresolved', parsedBy: 'DICTIONARY' };
  }

  const exerciseToken = response.resolvedTokens.find((t) => t.type === 'exercise');
  const modifierToken = response.resolvedTokens.find((t) => t.type === 'modifier' && t.modifierType === 'equipment');
  return {
    rawText: line,
    status: 'resolved',
    exerciseId: exerciseToken?.exerciseId,
    equipment: modifierToken?.modifierValue,
    ...numeric,
    parsedBy: 'DICTIONARY',
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npm test -- parsing/quickEntry.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add mobile/src/parsing mobile/__tests__/parsing
git commit -m "feat(mobile): add API-injected quick-entry parsing with local-dictionary-first resolution"
```

---

### Task 6: Muscle color science and SVG heatmap component

**Files:**
- Create: `mobile/src/science/muscleColor.ts`
- Create: `mobile/src/components/ParsedLineRow.tsx`
- Create: `mobile/src/components/MuscleHeatmap.tsx`
- Test: `mobile/__tests__/science/muscleColor.test.ts`
- Test: `mobile/__tests__/components/ParsedLineRow.test.tsx`
- Test: `mobile/__tests__/components/MuscleHeatmap.test.tsx`

**Interfaces:**
- Consumes: `GoalProgress`/`MuscleGroup` types (Task 2). No API dependency — pure/presentational, ports verbatim from the prior mobile app.
- Produces:
  ```ts
  export function progressColor(actualSets: number, targetMin: number, targetMax: number): string;
  ```
  ```tsx
  export function ParsedLineRow({ line, onConfirm }: { line: ParsedLine; onConfirm?: (line: ParsedLine) => void }): JSX.Element;
  export function MuscleHeatmap({ progress }: { progress: GoalProgress[] }): JSX.Element;
  ```
  Task 7 (Log screen) uses `ParsedLineRow`; Task 8 (Stats screen) uses `MuscleHeatmap`.

- [ ] **Step 1: Write the failing color-mapping test**

```ts
// mobile/__tests__/science/muscleColor.test.ts
import { progressColor } from '@/src/science/muscleColor';

describe('progressColor', () => {
  it('returns a low-intensity color when far under target', () => {
    expect(progressColor(1, 12, 20)).toBe('#fde2e2');
  });

  it('returns a mid-intensity color within target range', () => {
    expect(progressColor(15, 12, 20)).toBe('#f59e42');
  });

  it('returns a high-intensity color at or above target max', () => {
    expect(progressColor(20, 12, 20)).toBe('#dc2626');
  });

  it('treats zero actual sets as the lowest intensity', () => {
    expect(progressColor(0, 12, 20)).toBe('#fde2e2');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npm test -- science/muscleColor.test.ts`
Expected: FAIL — `src/science/muscleColor.ts` doesn't exist yet.

- [ ] **Step 3: Implement the color mapping**

```ts
// mobile/src/science/muscleColor.ts
export function progressColor(actualSets: number, targetMin: number, targetMax: number): string {
  const ratio = targetMax > 0 ? actualSets / targetMax : 0;
  if (ratio >= 1) return '#dc2626';
  if (actualSets >= targetMin) return '#f59e42';
  return '#fde2e2';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npm test -- science/muscleColor.test.ts`
Expected: PASS

- [ ] **Step 5: Write the failing ParsedLineRow test**

```tsx
// mobile/__tests__/components/ParsedLineRow.test.tsx
import { render, screen, fireEvent } from '@testing-library/react-native';
import { ParsedLineRow } from '@/src/components/ParsedLineRow';
import type { ParsedLine } from '@/src/parsing/quickEntry';

describe('ParsedLineRow', () => {
  it('renders raw text and calls onConfirm when tapped for a needs-confirm line', async () => {
    const line: ParsedLine = { rawText: 'PLANK 5x1', status: 'needs-confirm', exerciseName: 'Plank', parsedBy: 'LLM' };
    const onConfirm = jest.fn();
    await render(<ParsedLineRow line={line} onConfirm={onConfirm} />);

    expect(screen.getByText('PLANK 5x1')).toBeTruthy();
    await fireEvent.press(screen.getByText('Confirm: Plank'));
    expect(onConfirm).toHaveBeenCalledWith(line);
  });

  it('shows "Not yet parsed" for a pending line', async () => {
    const line: ParsedLine = { rawText: 'PLANK 5x1', status: 'pending', parsedBy: 'DICTIONARY' };
    await render(<ParsedLineRow line={line} />);
    expect(screen.getByText('Not yet parsed')).toBeTruthy();
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd mobile && npm test -- components/ParsedLineRow.test.tsx`
Expected: FAIL — component doesn't exist yet.

- [ ] **Step 7: Implement ParsedLineRow**

```tsx
// mobile/src/components/ParsedLineRow.tsx
import { View, Text, Pressable, StyleSheet } from 'react-native';
import type { ParsedLine } from '../parsing/quickEntry';

export function ParsedLineRow({
  line,
  onConfirm,
}: {
  line: ParsedLine;
  onConfirm?: (line: ParsedLine) => void;
}) {
  return (
    <View style={styles.row}>
      <Text>{line.rawText}</Text>
      {line.status === 'pending' && <Text style={styles.pending}>Not yet parsed</Text>}
      {line.status === 'needs-confirm' && (
        <Pressable onPress={() => onConfirm?.(line)}>
          <Text style={styles.pending}>Confirm: {line.exerciseName}</Text>
        </Pressable>
      )}
      {line.status === 'unresolved' && <Text style={styles.pending}>Unrecognized</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { paddingVertical: 8 },
  pending: { color: '#a35', fontSize: 12 },
});
```

- [ ] **Step 8: Run test to verify it passes**

Run: `cd mobile && npm test -- components/ParsedLineRow.test.tsx`
Expected: PASS

- [ ] **Step 9: Write the failing MuscleHeatmap test**

```tsx
// mobile/__tests__/components/MuscleHeatmap.test.tsx
import { render, screen, fireEvent } from '@testing-library/react-native';
import { MuscleHeatmap } from '@/src/components/MuscleHeatmap';
import type { GoalProgress } from '@/lib/api';

describe('MuscleHeatmap', () => {
  const progress: GoalProgress[] = [
    { muscle: 'GLUTES', targetMin: 12, targetMax: 20, actualSets: 8 },
    { muscle: 'CHEST', targetMin: 10, targetMax: 18, actualSets: 2 },
  ];

  it('renders the front view by default with region accessibility labels', async () => {
    await render(<MuscleHeatmap progress={progress} />);
    expect(screen.getByLabelText('Chest: 2 of 18 sets')).toBeTruthy();
  });

  it('switches to the back view showing back-only regions', async () => {
    await render(<MuscleHeatmap progress={progress} />);
    await fireEvent.press(screen.getByText('Back'));
    expect(screen.getByLabelText('Glutes: 8 of 20 sets')).toBeTruthy();
    expect(screen.queryByLabelText('Chest: 2 of 18 sets')).toBeNull();
  });
});
```

- [ ] **Step 10: Run test to verify it fails**

Run: `cd mobile && npm test -- components/MuscleHeatmap.test.tsx`
Expected: FAIL — component doesn't exist yet.

- [ ] **Step 11: Implement MuscleHeatmap**

```tsx
// mobile/src/components/MuscleHeatmap.tsx
import { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import Svg, { Rect, Ellipse, Circle } from 'react-native-svg';
import { progressColor } from '../science/muscleColor';
import type { GoalProgress, MuscleGroup } from '@/lib/api';

const NEUTRAL = '#e5e7eb';
const SKIN = '#e5c9a8';

function colorFor(muscle: MuscleGroup, progress: GoalProgress[]): string {
  const p = progress.find((x) => x.muscle === muscle);
  if (!p) return NEUTRAL;
  return progressColor(p.actualSets, p.targetMin, p.targetMax);
}

function labelFor(muscle: MuscleGroup, progress: GoalProgress[]): string {
  const p = progress.find((x) => x.muscle === muscle);
  const name = muscle.charAt(0) + muscle.slice(1).toLowerCase();
  return p ? `${name}: ${p.actualSets} of ${p.targetMax} sets` : `${name}: no data`;
}

function FrontBody({ progress }: { progress: GoalProgress[] }) {
  return (
    <Svg width={160} height={340} viewBox="0 0 160 340" accessibilityLabel="Front body diagram">
      <Circle cx={80} cy={30} r={22} fill={SKIN} />
      <Ellipse cx={80} cy={168} rx={34} ry={16} fill={colorFor('QUADS', progress)} accessibilityLabel={labelFor('QUADS', progress)} />
      <Ellipse cx={50} cy={65} rx={16} ry={10} fill={colorFor('SHOULDERS', progress)} accessibilityLabel={labelFor('SHOULDERS', progress)} />
      <Ellipse cx={110} cy={65} rx={16} ry={10} fill={colorFor('SHOULDERS', progress)} accessibilityLabel={labelFor('SHOULDERS', progress)} />
      <Rect x={55} y={60} width={50} height={55} rx={12} fill={colorFor('CHEST', progress)} accessibilityLabel={labelFor('CHEST', progress)} />
      <Rect x={30} y={70} width={16} height={80} rx={8} fill={colorFor('ARMS', progress)} accessibilityLabel={labelFor('ARMS', progress)} />
      <Rect x={114} y={70} width={16} height={80} rx={8} fill={colorFor('ARMS', progress)} accessibilityLabel={labelFor('ARMS', progress)} />
      <Rect x={58} y={118} width={44} height={50} rx={10} fill={colorFor('CORE', progress)} accessibilityLabel={labelFor('CORE', progress)} />
      <Rect x={55} y={170} width={20} height={70} rx={10} fill={colorFor('QUADS', progress)} accessibilityLabel={labelFor('QUADS', progress)} />
      <Rect x={85} y={170} width={20} height={70} rx={10} fill={colorFor('QUADS', progress)} accessibilityLabel={labelFor('QUADS', progress)} />
      <Rect x={57} y={244} width={16} height={60} rx={8} fill={colorFor('CALVES', progress)} accessibilityLabel={labelFor('CALVES', progress)} />
      <Rect x={87} y={244} width={16} height={60} rx={8} fill={colorFor('CALVES', progress)} accessibilityLabel={labelFor('CALVES', progress)} />
    </Svg>
  );
}

function BackBody({ progress }: { progress: GoalProgress[] }) {
  return (
    <Svg width={160} height={340} viewBox="0 0 160 340" accessibilityLabel="Back body diagram">
      <Circle cx={80} cy={30} r={22} fill={SKIN} />
      <Ellipse cx={80} cy={168} rx={34} ry={16} fill={colorFor('GLUTES', progress)} accessibilityLabel={labelFor('GLUTES', progress)} />
      <Ellipse cx={50} cy={65} rx={16} ry={10} fill={colorFor('SHOULDERS', progress)} accessibilityLabel={labelFor('SHOULDERS', progress)} />
      <Ellipse cx={110} cy={65} rx={16} ry={10} fill={colorFor('SHOULDERS', progress)} accessibilityLabel={labelFor('SHOULDERS', progress)} />
      <Rect x={55} y={60} width={50} height={70} rx={12} fill={colorFor('BACK', progress)} accessibilityLabel={labelFor('BACK', progress)} />
      <Rect x={30} y={70} width={16} height={80} rx={8} fill={colorFor('ARMS', progress)} accessibilityLabel={labelFor('ARMS', progress)} />
      <Rect x={114} y={70} width={16} height={80} rx={8} fill={colorFor('ARMS', progress)} accessibilityLabel={labelFor('ARMS', progress)} />
      <Rect x={55} y={178} width={20} height={55} rx={10} fill={colorFor('HAMSTRINGS', progress)} accessibilityLabel={labelFor('HAMSTRINGS', progress)} />
      <Rect x={85} y={178} width={20} height={55} rx={10} fill={colorFor('HAMSTRINGS', progress)} accessibilityLabel={labelFor('HAMSTRINGS', progress)} />
      <Rect x={57} y={236} width={16} height={60} rx={8} fill={colorFor('CALVES', progress)} accessibilityLabel={labelFor('CALVES', progress)} />
      <Rect x={87} y={236} width={16} height={60} rx={8} fill={colorFor('CALVES', progress)} accessibilityLabel={labelFor('CALVES', progress)} />
    </Svg>
  );
}

export function MuscleHeatmap({ progress }: { progress: GoalProgress[] }) {
  const [view, setView] = useState<'front' | 'back'>('front');
  return (
    <View style={styles.container}>
      <View style={styles.toggleRow}>
        <Pressable testID="toggle-front" onPress={() => setView('front')}>
          <Text style={view === 'front' ? styles.toggleActive : styles.toggle}>Front</Text>
        </Pressable>
        <Pressable testID="toggle-back" onPress={() => setView('back')}>
          <Text style={view === 'back' ? styles.toggleActive : styles.toggle}>Back</Text>
        </Pressable>
      </View>
      {view === 'front' ? <FrontBody progress={progress} /> : <BackBody progress={progress} />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center' },
  toggleRow: { flexDirection: 'row', gap: 16, marginBottom: 8 },
  toggle: { color: '#999' },
  toggleActive: { color: '#111', fontWeight: '700' },
});
```

- [ ] **Step 12: Run test to verify it passes**

Run: `cd mobile && npm test -- components/MuscleHeatmap.test.tsx`
Expected: PASS

- [ ] **Step 13: Commit**

```bash
git add mobile/src/science mobile/src/components mobile/__tests__/science mobile/__tests__/components
git commit -m "feat(mobile): add muscle color science and SVG heatmap/parsed-line components"
```

---

### Task 7: Log screen (replaces the scaffold's index tab)

**Files:**
- Modify: `mobile/app/(tabs)/index.tsx`
- Test: `mobile/__tests__/app/log.test.tsx`
- Test: `mobile/__tests__/app/log-offline.test.tsx`
- Test: `mobile/__tests__/app/log-rehydrate.test.tsx`

**Interfaces:**
- Consumes: `useAuth` (scaffold's `@/lib/auth`), `parseQuickEntryLine`/`ParsedLine` (Task 5), `upsertLocalSession`/`getLocalSession` (Task 3), `ParsedLineRow` (Task 6), `createExercise`/`createAbbreviation` methods on `ApiClient` (Task 2, for the confirm-loop).
- Produces: the real Log screen. No later task depends on its internals, but it must preserve every behavior the prior mobile app's Log screen shipped with: offline-first (SQLite write before any network call), rehydration of today's session on mount, no dropped entries under concurrent submissions, and a working tap-to-confirm loop for LLM-resolved exercises.

- [ ] **Step 1: Write the core submission/rehydration test**

```tsx
// mobile/__tests__/app/log.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import LogScreen from '../../app/(tabs)/index';
import { useAuth } from '@/lib/auth';
import { resetDbForTests } from '@/src/db/client';
import { getLocalSession } from '@/src/db/sessionsRepo';

jest.mock('@/lib/auth');

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

const mockResolveLine = jest.fn();

beforeEach(() => {
  resetDbForTests();
  mockResolveLine.mockReset().mockResolvedValue({ resolvedTokens: [], unresolvedTokens: [] });
  (useAuth as jest.Mock).mockReturnValue({ api: { resolveLine: mockResolveLine } });
});

describe('LogScreen', () => {
  it('adds a parsed line to the list after submitting text', async () => {
    await render(<LogScreen />);

    const input = screen.getByPlaceholderText('Log a set...');
    await fireEvent.changeText(input, 'BB RDL 40kg 8x3');
    await fireEvent(input, 'submitEditing');

    await waitFor(() => {
      expect(screen.getByText('BB RDL 40kg 8x3')).toBeTruthy();
    });
  });

  it('keeps both entries when a second line is submitted before the first network round-trip resolves', async () => {
    let resolveFirst!: (value: { resolvedTokens: never[]; unresolvedTokens: never[] }) => void;
    let resolveSecond!: (value: { resolvedTokens: never[]; unresolvedTokens: never[] }) => void;
    const firstResponse = new Promise((res) => { resolveFirst = res as typeof resolveFirst; });
    const secondResponse = new Promise((res) => { resolveSecond = res as typeof resolveSecond; });
    mockResolveLine.mockImplementationOnce(() => firstResponse).mockImplementationOnce(() => secondResponse);

    await render(<LogScreen />);
    const input = screen.getByPlaceholderText('Log a set...');

    await fireEvent.changeText(input, 'BB RDL 40kg 8x3');
    fireEvent(input, 'submitEditing');
    await fireEvent.changeText(input, 'DB Curl 12kg 10x3');
    fireEvent(input, 'submitEditing');

    resolveSecond({ resolvedTokens: [], unresolvedTokens: [] });
    resolveFirst({ resolvedTokens: [], unresolvedTokens: [] });

    await waitFor(() => {
      expect(screen.getByText('BB RDL 40kg 8x3')).toBeTruthy();
      expect(screen.getByText('DB Curl 12kg 10x3')).toBeTruthy();
    });

    const session = await getLocalSession(todayDate());
    expect(session?.entries).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npm test -- app/log.test.tsx`
Expected: FAIL — `(tabs)/index.tsx` is still the scaffold's stock home screen.

- [ ] **Step 3: Implement the Log screen**

```tsx
// mobile/app/(tabs)/index.tsx
import { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, FlatList, StyleSheet } from 'react-native';
import { useAuth } from '@/lib/auth';
import { parseQuickEntryLine, type ParsedLine } from '@/src/parsing/quickEntry';
import { upsertLocalSession, getLocalSession } from '@/src/db/sessionsRepo';
import { ParsedLineRow } from '@/src/components/ParsedLineRow';

type UiLine = ParsedLine & { id: string };

const ERROR_MESSAGE = "Couldn't load data. Pull down or reopen the app to retry.";

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

let idCounter = 0;
function makeEntryId(): string {
  idCounter += 1;
  return `entry-${Date.now()}-${idCounter}`;
}

export default function LogScreen() {
  const { api } = useAuth();
  const [text, setText] = useState('');
  const [lines, setLines] = useState<UiLine[]>([]);
  const [error, setError] = useState<string | null>(null);

  const linesRef = useRef<UiLine[]>([]);
  const persistQueueRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    (async () => {
      try {
        const existing = await getLocalSession(todayDate());
        if (!existing) return;
        const restored: UiLine[] = existing.entries.map((e) => ({
          id: e.id,
          rawText: e.rawText,
          status: e.exerciseId ? 'resolved' : 'pending',
          parsedBy: e.parsedBy,
          exerciseId: e.exerciseId ?? undefined,
          equipment: e.equipment ?? undefined,
          weightKg: e.weightKg ?? undefined,
          reps: e.reps ?? undefined,
          sets: e.sets ?? undefined,
        }));
        linesRef.current = restored;
        setLines(restored);
      } catch {
        setError(ERROR_MESSAGE);
      }
    })();
  }, []);

  async function persistLines(allLines: UiLine[]): Promise<void> {
    const date = todayDate();
    const existing = await getLocalSession(date);
    await upsertLocalSession({
      date,
      notes: existing?.notes ?? null,
      synced: 0,
      entries: allLines.map((l, i) => ({
        id: l.id,
        exerciseId: l.exerciseId ?? null,
        equipment: l.equipment ?? null,
        weightKg: l.weightKg ?? null,
        reps: l.reps ?? null,
        sets: l.sets ?? null,
        rawText: l.rawText,
        parsedBy: l.parsedBy ?? 'DICTIONARY',
        order: i,
        synced: 0,
      })),
    });
  }

  function persist(allLines: UiLine[]): Promise<void> {
    const task = persistQueueRef.current.then(() => persistLines(allLines));
    persistQueueRef.current = task.catch(() => undefined);
    return task;
  }

  function updateEntry(id: string, updates: Partial<ParsedLine>): Promise<void> {
    const updated = linesRef.current.map((l) => (l.id === id ? { ...l, ...updates } : l));
    linesRef.current = updated;
    setLines(updated);
    return persist(updated);
  }

  async function handleSubmit() {
    const line = text.trim();
    if (!line) return;
    setText('');

    const id = makeEntryId();
    const pendingEntry: UiLine = { id, rawText: line, status: 'pending', parsedBy: 'DICTIONARY' };

    const nextLines = [...linesRef.current, pendingEntry];
    linesRef.current = nextLines;
    setLines(nextLines);
    try {
      await persist(nextLines);
      setError(null);
    } catch {
      setError(ERROR_MESSAGE);
      return;
    }

    parseQuickEntryLine(api, line)
      .then((parsed) => {
        setError(null);
        return updateEntry(id, parsed);
      })
      .catch(() => {
        setError(ERROR_MESSAGE);
      });
  }

  async function handleConfirmLine(line: ParsedLine & { id: string }) {
    try {
      const exercise = await api.createExercise({ name: line.exerciseName!, muscles: line.muscles ?? [] });
      await api.createAbbreviation({ token: line.unresolvedToken!, exerciseId: exercise.id });
      await updateEntry(line.id, { status: 'resolved', exerciseId: exercise.id, parsedBy: 'LLM' });
      setError(null);
    } catch {
      setError(ERROR_MESSAGE);
    }
  }

  return (
    <View style={styles.container}>
      {error && <Text style={styles.error}>{error}</Text>}
      <FlatList
        data={lines}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <ParsedLineRow line={item} onConfirm={handleConfirmLine} />}
      />
      <TextInput
        style={styles.input}
        placeholder="Log a set..."
        value={text}
        onChangeText={setText}
        onSubmitEditing={handleSubmit}
        returnKeyType="done"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12, marginTop: 8 },
  error: { color: '#a33', marginBottom: 8 },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npm test -- app/log.test.tsx`
Expected: PASS

- [ ] **Step 5: Write the offline-first and rehydration regression tests in their own files**

These live in separate files from `log.test.tsx` due to a known `VirtualizedList`/`act()` cross-test-file interaction in this test stack — putting every `LogScreen` render in one file causes flaky failures unrelated to the code under test.

```tsx
// mobile/__tests__/app/log-offline.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import LogScreen from '../../app/(tabs)/index';
import { useAuth } from '@/lib/auth';
import { resetDbForTests } from '@/src/db/client';
import { getLocalSession } from '@/src/db/sessionsRepo';

jest.mock('@/lib/auth');

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

beforeEach(() => {
  resetDbForTests();
});

describe('LogScreen offline-first behavior', () => {
  it('keeps the raw entry saved and visible when the background parse rejects (offline/network failure)', async () => {
    const resolveLine = jest.fn().mockRejectedValue(new Error('offline'));
    (useAuth as jest.Mock).mockReturnValue({ api: { resolveLine } });

    await render(<LogScreen />);
    const input = screen.getByPlaceholderText('Log a set...');
    await fireEvent.changeText(input, 'BB RDL 40kg 8x3');
    await fireEvent(input, 'submitEditing');

    await waitFor(async () => {
      expect(screen.getByText('BB RDL 40kg 8x3')).toBeTruthy();
      const session = await getLocalSession(todayDate());
      expect(session?.entries).toHaveLength(1);
    });
  });
});
```

```tsx
// mobile/__tests__/app/log-rehydrate.test.tsx
import { render, screen, waitFor } from '@testing-library/react-native';
import LogScreen from '../../app/(tabs)/index';
import { useAuth } from '@/lib/auth';
import { resetDbForTests } from '@/src/db/client';
import { upsertLocalSession } from '@/src/db/sessionsRepo';

jest.mock('@/lib/auth');

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

beforeEach(() => {
  resetDbForTests();
  (useAuth as jest.Mock).mockReturnValue({ api: { resolveLine: jest.fn() } });
});

describe('LogScreen rehydration', () => {
  it('shows already-logged entries for today on mount, not a blank list', async () => {
    await upsertLocalSession({
      date: todayDate(),
      notes: null,
      synced: 1,
      entries: [
        { id: 'existing-1', exerciseId: 'ex-1', equipment: 'barbell', weightKg: 40, reps: 8, sets: 3, rawText: 'BB RDL 40kg 8x3', parsedBy: 'DICTIONARY', order: 0, synced: 1 },
      ],
    });

    await render(<LogScreen />);

    await waitFor(() => {
      expect(screen.getByText('BB RDL 40kg 8x3')).toBeTruthy();
    });
  });
});
```

- [ ] **Step 6: Run both new test files**

Run: `cd mobile && npm test -- app/log-offline.test.tsx app/log-rehydrate.test.tsx`
Expected: PASS (both)

- [ ] **Step 7: Commit**

```bash
git add "mobile/app/(tabs)/index.tsx" mobile/__tests__/app/log.test.tsx mobile/__tests__/app/log-offline.test.tsx mobile/__tests__/app/log-rehydrate.test.tsx
git commit -m "feat(mobile): implement log screen with offline-first entry, rehydration, and confirm loop"
```

---

### Task 8: Stats screen (heatmap + goal editor)

**Files:**
- Create: `mobile/app/(tabs)/stats.tsx`
- Test: `mobile/__tests__/app/stats.test.tsx`

**Interfaces:**
- Consumes: `useAuth`, `syncNow` (Task 4), `MuscleHeatmap` (Task 6), `createGoal`/`resolveGoal`/`getGoalProgress` methods on `ApiClient` (Task 2).
- Produces: the Stats tab. No later task depends on its internals.

- [ ] **Step 1: Write the failing test**

```tsx
// mobile/__tests__/app/stats.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import StatsScreen from '../../app/(tabs)/stats';
import { useAuth } from '@/lib/auth';

jest.mock('@/lib/auth');
jest.mock('@/src/sync/syncEngine', () => ({ syncNow: jest.fn().mockResolvedValue({ pushed: 0, pulled: 0 }) }));

function fakeApi(overrides: Record<string, jest.Mock> = {}) {
  return {
    getGoalProgress: jest.fn().mockRejectedValue(Object.assign(new Error('not found'), { status: 404 })),
    createGoal: jest.fn().mockResolvedValue({ id: 'g1', type: 'HYPERTROPHY', targets: [] }),
    resolveGoal: jest.fn(),
    ...overrides,
  };
}

describe('StatsScreen', () => {
  it('shows a no-goal-yet empty state on a 404, not a generic error', async () => {
    (useAuth as jest.Mock).mockReturnValue({ api: fakeApi() });
    await render(<StatsScreen />);

    await waitFor(() => {
      expect(screen.getByText(/no goal set yet/i)).toBeTruthy();
    });
  });

  it('creates a preset goal and refreshes progress', async () => {
    const api = fakeApi();
    (useAuth as jest.Mock).mockReturnValue({ api });
    await render(<StatsScreen />);
    await waitFor(() => screen.getByText('Hypertrophy'));

    await fireEvent.press(screen.getByText('Hypertrophy'));

    await waitFor(() => {
      expect(api.createGoal).toHaveBeenCalledWith({ type: 'HYPERTROPHY' });
      expect(api.getGoalProgress).toHaveBeenCalledTimes(2); // initial mount + post-create refresh
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npm test -- app/stats.test.tsx`
Expected: FAIL — `(tabs)/stats.tsx` doesn't exist yet.

- [ ] **Step 3: Implement the Stats screen**

```tsx
// mobile/app/(tabs)/stats.tsx
import { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useAuth } from '@/lib/auth';
import { ApiError } from '@/lib/api';
import { syncNow } from '@/src/sync/syncEngine';
import { MuscleHeatmap } from '@/src/components/MuscleHeatmap';
import type { GoalProgress, GoalType } from '@/lib/api';

const ERROR_MESSAGE = "Couldn't load data. Pull down or reopen the app to retry.";
const PRESETS: { label: string; type: GoalType }[] = [
  { label: 'Hypertrophy', type: 'HYPERTROPHY' },
  { label: 'Strength', type: 'STRENGTH' },
  { label: 'Endurance', type: 'ENDURANCE' },
];

function currentWeekStart(): string {
  const now = new Date();
  const day = now.getUTCDay();
  const diff = (day + 6) % 7;
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() - diff);
  return monday.toISOString().slice(0, 10);
}

export default function StatsScreen() {
  const { api } = useAuth();
  const [progress, setProgress] = useState<GoalProgress[]>([]);
  const [noActiveGoal, setNoActiveGoal] = useState(false);
  const [goalText, setGoalText] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function refreshProgress() {
    try {
      const data = await api.getGoalProgress(currentWeekStart());
      setProgress(data);
      setNoActiveGoal(false);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setNoActiveGoal(true);
        setError(null);
      } else {
        setError(ERROR_MESSAGE);
      }
    }
  }

  useEffect(() => {
    (async () => {
      await syncNow(api);
      await refreshProgress();
    })();
  }, []);

  async function handlePresetPress(type: GoalType) {
    try {
      await api.createGoal({ type });
      await refreshProgress();
    } catch {
      setError(ERROR_MESSAGE);
    }
  }

  async function handleSetGoal() {
    const description = goalText.trim();
    if (!description) return;
    try {
      const guess = await api.resolveGoal(description);
      const overrides = (guess.muscles ?? []).map((muscle) => ({ muscle, min: 0, max: 0 })); // filled server-side from defaults + bump; see createGoal
      await api.createGoal({ type: guess.type, description, overrides: overrides.length ? overrides : undefined });
      setGoalText('');
      await refreshProgress();
    } catch {
      setError(ERROR_MESSAGE);
    }
  }

  return (
    <ScrollView>
      <View style={{ padding: 16 }}>
        {error && <Text style={styles.error}>{error}</Text>}
        {noActiveGoal && <Text>No goal set yet — pick one below to start tracking.</Text>}
        <View style={styles.presetRow}>
          {PRESETS.map((p) => (
            <Pressable key={p.type} onPress={() => handlePresetPress(p.type)} style={styles.chip}>
              <Text>{p.label}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.goalRow}>
          <TextInput
            style={styles.goalInput}
            placeholder="Or describe your goal..."
            value={goalText}
            onChangeText={setGoalText}
          />
          <Pressable onPress={handleSetGoal}>
            <Text>Set Goal</Text>
          </Pressable>
        </View>
        <MuscleHeatmap progress={progress} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  presetRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  chip: { borderWidth: 1, borderColor: '#ccc', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
  goalRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
  goalInput: { flex: 1, borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 10 },
  error: { color: '#a33', marginBottom: 8 },
});
```

Note: the free-text goal's per-muscle override values (`min`/`max` in the `overrides` array) are left as `0` placeholders in this step — computing the actual "science-table default + emphasis bump" requires the mobile client to know the backend's volume table, which it doesn't. If the backend's `POST /api/goals` already applies a sensible default when `min`/`max` are absent/zero for a listed muscle, adjust the overrides payload to omit `min`/`max` and send just `{ muscle }`-shaped entries instead — check `POST /api/goals`'s actual accepted request shape (`backend/internal/handler/goals.go`) before finalizing this step, and match it exactly rather than guessing.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npm test -- app/stats.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add "mobile/app/(tabs)/stats.tsx" mobile/__tests__/app/stats.test.tsx
git commit -m "feat(mobile): add stats screen with muscle heatmap and goal editor"
```

---

### Task 9: History screen

**Files:**
- Create: `mobile/app/(tabs)/history.tsx`
- Test: `mobile/__tests__/app/history.test.tsx`

**Interfaces:**
- Consumes: `listLocalSessions` (Task 3).
- Produces: the History tab. No later task depends on its internals.

- [ ] **Step 1: Write the failing test**

```tsx
// mobile/__tests__/app/history.test.tsx
import { render, screen, waitFor } from '@testing-library/react-native';
import HistoryScreen from '../../app/(tabs)/history';
import { resetDbForTests } from '@/src/db/client';
import { upsertLocalSession } from '@/src/db/sessionsRepo';

beforeEach(async () => {
  resetDbForTests();
  await upsertLocalSession({
    date: '2026-07-01',
    notes: 'leg day',
    synced: 1,
    entries: [{ id: 'e1', exerciseId: null, equipment: null, weightKg: 40, reps: 8, sets: 3, rawText: 'BB RDL 40kg 8x3', parsedBy: 'DICTIONARY', order: 0, synced: 1 }],
  });
});

describe('HistoryScreen', () => {
  it('lists past sessions with their raw entry text', async () => {
    await render(<HistoryScreen />);

    await waitFor(() => {
      expect(screen.getByText('2026-07-01')).toBeTruthy();
      expect(screen.getByText('BB RDL 40kg 8x3')).toBeTruthy();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npm test -- app/history.test.tsx`
Expected: FAIL — `(tabs)/history.tsx` doesn't exist yet.

- [ ] **Step 3: Implement the History screen**

```tsx
// mobile/app/(tabs)/history.tsx
import { useEffect, useState } from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { listLocalSessions, type LocalSession } from '@/src/db/sessionsRepo';

function ninetyDaysAgo(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 90);
  return d.toISOString().slice(0, 10);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function HistoryScreen() {
  const [sessions, setSessions] = useState<LocalSession[]>([]);

  useEffect(() => {
    (async () => {
      const data = await listLocalSessions(ninetyDaysAgo(), today());
      setSessions(data);
    })();
  }, []);

  return (
    <FlatList
      data={sessions}
      keyExtractor={(s) => s.date}
      renderItem={({ item }) => (
        <View style={styles.session}>
          <Text style={styles.date}>{item.date}</Text>
          {item.entries.map((e) => (
            <Text key={e.id}>{e.rawText}</Text>
          ))}
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  session: { padding: 16, borderBottomWidth: 1, borderBottomColor: '#eee' },
  date: { fontWeight: '700', marginBottom: 4 },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npm test -- app/history.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add "mobile/app/(tabs)/history.tsx" mobile/__tests__/app/history.test.tsx
git commit -m "feat(mobile): add history screen"
```

---

### Task 10: Extend the You/settings screen with abbreviation dictionary management

**Files:**
- Modify: `mobile/app/(tabs)/you.tsx`
- Test: `mobile/__tests__/app/you.strongnotes.test.tsx`

**Interfaces:**
- Consumes: `useAuth`, `syncNow` (Task 4), `getCachedAbbreviations` (Task 3), `confirmAbbreviation` method on `ApiClient` (Task 2).
- Produces: the existing You/settings tab, with an added abbreviation-list section. No later task depends on this.

- [ ] **Step 1: Read the current `you.tsx` before editing**

This file already handles avatar, language, sign-out (scaffold's existing settings hub) — read it first and add the new section without disturbing the existing layout/behavior; the exact insertion point depends on that file's real structure, which you should check directly rather than assume.

- [ ] **Step 2: Write the failing test**

```tsx
// mobile/__tests__/app/you.strongnotes.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import YouScreen from '../../app/(tabs)/you';
import { useAuth } from '@/lib/auth';
import { resetDbForTests } from '@/src/db/client';
import { cacheAbbreviations } from '@/src/db/abbreviationsRepo';

jest.mock('@/lib/auth');
jest.mock('@/src/sync/syncEngine', () => ({ syncNow: jest.fn().mockResolvedValue({ pushed: 0, pulled: 0 }) }));

beforeEach(async () => {
  resetDbForTests();
  await cacheAbbreviations([
    { id: '1', token: 'RDL', exerciseId: 'ex-1', source: 'BUILT_IN', createdAt: '' },
    { id: '2', token: 'CRABWALK', source: 'LLM_SUGGESTED_PENDING_CONFIRM', createdAt: '' },
  ]);
});

describe('YouScreen abbreviation dictionary', () => {
  it('lists cached abbreviations and confirms a pending one', async () => {
    const confirmAbbreviation = jest.fn().mockResolvedValue({});
    (useAuth as jest.Mock).mockReturnValue({
      session: { user: { id: 'u1', email: 'test@example.com', name: 'Test' } },
      api: { confirmAbbreviation, logout: jest.fn() },
      signOut: jest.fn(),
    });

    await render(<YouScreen />);

    await waitFor(() => {
      expect(screen.getByText('RDL')).toBeTruthy();
      expect(screen.getByText('CRABWALK')).toBeTruthy();
    });

    await fireEvent.press(screen.getByText('Confirm'));

    await waitFor(() => {
      expect(confirmAbbreviation).toHaveBeenCalledWith('2');
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd mobile && npm test -- app/you.strongnotes.test.tsx`
Expected: FAIL — no abbreviation list rendered yet.

- [ ] **Step 4: Add the abbreviation-dictionary section to you.tsx**

Add (near the existing settings sections, without removing avatar/language/sign-out):

```tsx
// Add these imports at the top of mobile/app/(tabs)/you.tsx, alongside the existing ones:
import { useEffect, useState } from 'react';
import { FlatList, Pressable } from 'react-native';
import { getCachedAbbreviations } from '@/src/db/abbreviationsRepo';
import { syncNow } from '@/src/sync/syncEngine';
import type { Abbreviation } from '@/lib/api';
```

```tsx
// Add this inside the YouScreen/`you` default-export component function, alongside its
// existing state/effects (adapt to match the file's actual existing structure — this is
// additive, not a full-file replacement):
const [abbreviations, setAbbreviations] = useState<Abbreviation[]>([]);

async function refreshAbbreviations() {
  await syncNow(api); // `api` is already destructured from useAuth() elsewhere in this file
  const cached = await getCachedAbbreviations();
  setAbbreviations(cached);
}

useEffect(() => {
  refreshAbbreviations();
}, []);

async function handleConfirmAbbreviation(id: string) {
  await api.confirmAbbreviation(id);
  await refreshAbbreviations();
}
```

```tsx
// Add this JSX section wherever it fits alongside the existing settings rows
// in the component's returned tree:
<FlatList
  data={abbreviations}
  keyExtractor={(a) => a.id}
  renderItem={({ item }) => (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: '#eee' }}>
      <Text>{item.token}</Text>
      {item.source === 'LLM_SUGGESTED_PENDING_CONFIRM' && (
        <Pressable onPress={() => handleConfirmAbbreviation(item.id)}>
          <Text style={{ color: '#2563eb', fontWeight: '600' }}>Confirm</Text>
        </Pressable>
      )}
    </View>
  )}
/>
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd mobile && npm test -- app/you.strongnotes.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add "mobile/app/(tabs)/you.tsx" mobile/__tests__/app/you.strongnotes.test.tsx
git commit -m "feat(mobile): add abbreviation dictionary management to the you/settings screen"
```

---

### Task 11: Final tab wiring and full verification

**Files:**
- Modify: `mobile/app/(tabs)/_layout.tsx`

**Interfaces:**
- Consumes: nothing new (all four tab screens already exist from Tasks 7-10).
- Produces: the final 4-tab navigation (Log, Stats, History, You), and this task is the final check that all 10 prior tasks compose correctly together.

- [ ] **Step 1: Update the tabs layout**

```tsx
// mobile/app/(tabs)/_layout.tsx
import { Redirect, Tabs } from 'expo-router';
import { View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '@/lib/auth';
import { colors, fontMono } from '@/lib/theme';

export default function TabsLayout() {
  const { session, loading } = useAuth();

  if (loading) return <View style={{ flex: 1, backgroundColor: colors.paper }} />;
  if (!session) return <Redirect href="/(auth)/sign-in" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.graphite,
        tabBarInactiveTintColor: colors.lead,
        tabBarStyle: { backgroundColor: colors.paper, borderTopColor: colors.graphite },
        tabBarLabelStyle: { fontFamily: fontMono, fontSize: 11, letterSpacing: 0.3 },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Log', tabBarIcon: ({ color, size }) => <Feather name="edit-3" size={size} color={color} /> }} />
      <Tabs.Screen name="stats" options={{ title: 'Stats', tabBarIcon: ({ color, size }) => <Feather name="bar-chart-2" size={size} color={color} /> }} />
      <Tabs.Screen name="history" options={{ title: 'History', tabBarIcon: ({ color, size }) => <Feather name="clock" size={size} color={color} /> }} />
      <Tabs.Screen name="you" options={{ title: 'You', tabBarIcon: ({ color, size }) => <Feather name="user" size={size} color={color} /> }} />
    </Tabs>
  );
}
```

Note: this drops the scaffold's `useTranslation()`-driven tab titles (`t('app.name')`/`t('you.title')`) in favor of literal strings, since Strong Notes' four tabs don't have existing i18n keys — if `mobile/lib/locales/en.json` already has usable keys, prefer wiring those in instead of hardcoding; check the actual file before finalizing this step.

- [ ] **Step 2: Run the full test suite**

```bash
cd mobile
npm test
```
Expected: every test file from Tasks 1-10 passes together (this is the composition check for the whole mobile rebuild).

- [ ] **Step 3: Manual smoke test against the live Go backend**

```bash
cd ../backend && docker start strong-notes-pg && go run ./cmd/api &
cd ../mobile && EXPO_PUBLIC_API_URL=http://localhost:8080 npx expo start --web
```
Sign in (dev mode inline token) → log a line with known dictionary shorthand → switch to Stats, create a Hypertrophy goal, confirm the heatmap reflects the logged set → switch to History, confirm the session appears → switch to You, confirm the abbreviation list shows the dictionary. This exercises the full chain end-to-end against the real backend, not mocks — do this manually and note the result in your final report, don't skip it because the automated tests passed.

- [ ] **Step 4: Commit**

```bash
git add "mobile/app/(tabs)/_layout.tsx"
git commit -m "feat(mobile): wire final 4-tab navigation (Log/Stats/History/You)"
```

---

## Self-Review Notes

- **Spec coverage:** every mobile requirement from the migration design spec is covered — scaffold's design system/i18n/magic-link auth adopted as-is (Task 1), local-first SQLite + sync (Tasks 3-4), quick-entry parsing with local-dictionary-first resolution and the confirm-loop (Tasks 5, 7), muscle heatmap + goal editor (Task 8), history (Task 9), abbreviation dictionary folded into the existing You screen per the spec's stated intent (Task 10) rather than a separate Profile tab.
- **Placeholder scan:** one deliberately-flagged spot in Task 8 (goal-override `min`/`max` values) where the exact backend request shape needs to be checked against the real `goals.go` handler rather than assumed — this is disclosed with explicit instructions on what to check and why, not silently glossed over, consistent with how the backend plan handled similar sqlc-generated-type uncertainty.
- **Type consistency:** `ApiClient`'s new methods (Task 2) are referenced identically by name and shape in every consuming task (`ParsedLine`'s `exerciseId`/`muscles`/`unresolvedToken` fields in Task 5 match what Task 7's confirm-loop and Task 6's `ParsedLineRow` expect; `GoalProgress`/`MuscleGroup` flow unchanged from Task 2 through Task 6's heatmap into Task 8's screen). The `api`-as-parameter convention (replacing the prior app's module-level client singleton) is applied consistently in Tasks 4, 5, 7, 8, 9, 10 — no task reverts to a free-function import.
