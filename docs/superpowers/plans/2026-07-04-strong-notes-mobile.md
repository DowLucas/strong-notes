# Strong Notes Mobile App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Expo/React Native mobile app (iOS first) that logs gym sessions via fast free-text entry, syncs to the Strong Notes backend, and visualizes weekly muscle volume against a goal.

**Architecture:** Expo + TypeScript + expo-router for file-based tab navigation. `expo-sqlite` provides local-first storage so logging is instant offline; a sync module pushes local sessions to the backend and pulls down the abbreviation dictionary. `expo-secure-store` holds the bearer token. All backend calls go through one typed API client module so screens never touch `fetch` directly.

**Tech Stack:** Expo SDK (managed workflow, bootstrapped via `create-expo-app`), TypeScript, expo-router, expo-sqlite, expo-secure-store, react-native-svg (muscle heatmap), Jest + jest-expo + @testing-library/react-native (testing).

## Global Constraints

- Mobile app lives in `mobile/` at the repo root, alongside `backend/`.
- All backend calls go through `src/api/client.ts` — no screen calls `fetch` directly.
- The bearer token and API base URL are read from `expo-secure-store` / app config, never hardcoded.
- Local SQLite is the source of truth for what the UI renders instantly; the backend is the source of truth for sync/backup. A write always goes to SQLite first, then is queued for sync — screens never block on network to show a just-logged line.
- Screens are thin: all business logic (parsing flow, sync, muscle color mapping) lives in `src/` modules that are unit-tested independently of any screen.
- Match the backend's data shapes exactly: `MuscleGroup` values (`GLUTES`, `QUADS`, `HAMSTRINGS`, `CHEST`, `BACK`, `SHOULDERS`, `ARMS`, `CORE`, `CALVES`), `GoalType` values (`HYPERTROPHY`, `STRENGTH`, `ENDURANCE`, `CUSTOM`), `ParsedBy` values (`DICTIONARY`, `LLM`).

---

## File Structure

```
mobile/
  app.json
  tsconfig.json
  package.json
  jest.config.js
  app/
    _layout.tsx                # root Stack, wraps (tabs)
    (tabs)/
      _layout.tsx              # Tabs navigator: Log, Stats, History, Profile
      index.tsx                # Log tab (default route)
      stats.tsx                # Stats tab
      history.tsx              # History tab
      profile.tsx              # Profile tab
  src/
    config.ts                  # API_BASE_URL constant + env resolution
    api/
      client.ts                # typed fetch wrapper, one function per backend endpoint
      types.ts                 # shared request/response types matching backend shapes
    auth/
      token.ts                 # SecureStore get/set API token
    db/
      client.ts                # expo-sqlite database singleton + migration runner
      sessionsRepo.ts           # local session/entry CRUD
      abbreviationsRepo.ts       # local abbreviation cache CRUD
    sync/
      syncEngine.ts             # push unsynced sessions, pull abbreviations
    parsing/
      quickEntry.ts             # orchestrates resolveLine call + confirm-chip data shape
    science/
      muscleColor.ts            # sets-vs-target ratio -> heat color mapping
    components/
      ParsedLineRow.tsx          # one parsed/pending line in the Log tab
      MuscleHeatmap.tsx          # front/back body diagram colored by progress
  __tests__/
    api/client.test.ts
    db/sessionsRepo.test.ts
    db/abbreviationsRepo.test.ts
    sync/syncEngine.test.ts
    parsing/quickEntry.test.ts
    science/muscleColor.test.ts
    components/MuscleHeatmap.test.tsx
    app/log.test.tsx
    app/stats.test.tsx
```

---

### Task 1: Expo app scaffold with tab navigation

**Files:**
- Create: `mobile/` (via `create-expo-app`)
- Create: `mobile/app/_layout.tsx`
- Create: `mobile/app/(tabs)/_layout.tsx`
- Create: `mobile/app/(tabs)/index.tsx`
- Create: `mobile/app/(tabs)/stats.tsx`
- Create: `mobile/app/(tabs)/history.tsx`
- Create: `mobile/app/(tabs)/profile.tsx`
- Create: `mobile/jest.config.js`
- Test: `mobile/__tests__/app/log.test.tsx`

**Interfaces:**
- Consumes: none (foundational).
- Produces: four routable screens (`/`, `/stats`, `/history`, `/profile`) that later tasks fill in with real content. Each screen file default-exports a plain React component, importable directly in tests without a router context.

- [ ] **Step 1: Scaffold the Expo project**

Run from the repo root:
```bash
npx create-expo-app@latest mobile --template blank-typescript --yes
cd mobile
npx expo install expo-router expo-secure-store expo-sqlite react-native-svg react-native-safe-area-context react-native-screens
npm install --save-dev jest-expo @testing-library/react-native @types/jest
```

- [ ] **Step 2: Configure expo-router as the entry point**

Edit `mobile/package.json`, set the `main` field:
```json
{
  "main": "expo-router/entry"
}
```

Edit `mobile/app.json`, add the router plugin under `expo.plugins` (keep whatever `create-expo-app` already generated for `name`/`slug`/etc., just add this):
```json
{
  "expo": {
    "scheme": "strongnotes",
    "plugins": ["expo-router"]
  }
}
```

- [ ] **Step 3: Create the root layout**

```tsx
// mobile/app/_layout.tsx
import { Stack } from 'expo-router';

export default function RootLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
```

- [ ] **Step 4: Create the tab layout and four screen stubs**

```tsx
// mobile/app/(tabs)/_layout.tsx
import { Tabs } from 'expo-router';

export default function TabsLayout() {
  return (
    <Tabs>
      <Tabs.Screen name="index" options={{ title: 'Log' }} />
      <Tabs.Screen name="stats" options={{ title: 'Stats' }} />
      <Tabs.Screen name="history" options={{ title: 'History' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
    </Tabs>
  );
}
```

```tsx
// mobile/app/(tabs)/index.tsx
import { View, Text } from 'react-native';

export default function LogScreen() {
  return (
    <View>
      <Text>Log</Text>
    </View>
  );
}
```

```tsx
// mobile/app/(tabs)/stats.tsx
import { View, Text } from 'react-native';

export default function StatsScreen() {
  return (
    <View>
      <Text>Stats</Text>
    </View>
  );
}
```

```tsx
// mobile/app/(tabs)/history.tsx
import { View, Text } from 'react-native';

export default function HistoryScreen() {
  return (
    <View>
      <Text>History</Text>
    </View>
  );
}
```

```tsx
// mobile/app/(tabs)/profile.tsx
import { View, Text } from 'react-native';

export default function ProfileScreen() {
  return (
    <View>
      <Text>Profile</Text>
    </View>
  );
}
```

- [ ] **Step 5: Configure Jest**

```js
// mobile/jest.config.js
module.exports = {
  preset: 'jest-expo',
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg)',
  ],
};
```

Add to `mobile/package.json` scripts:
```json
{
  "scripts": {
    "test": "jest"
  }
}
```

- [ ] **Step 6: Write the failing test**

```tsx
// mobile/__tests__/app/log.test.tsx
import { render, screen } from '@testing-library/react-native';
import LogScreen from '../../app/(tabs)/index';

describe('LogScreen', () => {
  it('renders the Log screen stub', () => {
    render(<LogScreen />);
    expect(screen.getByText('Log')).toBeTruthy();
  });
});
```

- [ ] **Step 7: Run test to verify it fails, then passes**

Run: `cd mobile && npm test`
Expected: FAIL first (before Step 6's file existed / before scaffolding was complete), then PASS once Steps 1-6 are done.

- [ ] **Step 8: Commit**

```bash
git add mobile
git commit -m "feat(mobile): scaffold expo app with tab navigation"
```

---

### Task 2: API client and secure token storage

**Files:**
- Create: `mobile/src/config.ts`
- Create: `mobile/src/auth/token.ts`
- Create: `mobile/src/api/types.ts`
- Create: `mobile/src/api/client.ts`
- Test: `mobile/__tests__/api/client.test.ts`

**Interfaces:**
- Consumes: `expo-secure-store`, `mobile/src/config.ts`'s `API_BASE_URL`.
- Produces:
  ```ts
  // src/auth/token.ts
  export async function getApiToken(): Promise<string | null>;
  export async function setApiToken(token: string): Promise<void>;

  // src/api/types.ts
  export type MuscleGroup = 'GLUTES'|'QUADS'|'HAMSTRINGS'|'CHEST'|'BACK'|'SHOULDERS'|'ARMS'|'CORE'|'CALVES';
  export type GoalType = 'HYPERTROPHY'|'STRENGTH'|'ENDURANCE'|'CUSTOM';
  export type ParsedBy = 'DICTIONARY'|'LLM';
  export type ResolveLineResponse = {
    resolvedTokens: { token: string; type: 'exercise'|'modifier'; exerciseId?: string; modifierType?: string; modifierValue?: string }[];
    unresolvedTokens: string[];
    llmGuess?: { exerciseName: string; equipment?: string; weightKg?: number; reps?: number; sets?: number };
  };
  export type GoalGuess = { type: GoalType; muscles: MuscleGroup[] };
  export type Abbreviation = { id: string; token: string; exerciseId?: string; modifierType?: string; modifierValue?: string; source: string };
  export type SetEntryInput = { exerciseId?: string; equipment?: string; weightKg?: number; reps?: number; sets?: number; rawText: string; parsedBy: ParsedBy; order: number };
  export type SessionResponse = { id: string; date: string; notes: string | null; entries: (SetEntryInput & { id: string })[] };
  export type GoalProgress = { muscle: MuscleGroup; targetMin: number; targetMax: number; actualSets: number };

  // src/api/client.ts
  export async function resolveLine(line: string): Promise<ResolveLineResponse>;
  export async function resolveGoal(text: string): Promise<GoalGuess>;
  export async function listAbbreviations(): Promise<Abbreviation[]>;
  export async function createAbbreviation(input: { token: string; exerciseId?: string; modifierType?: string; modifierValue?: string }): Promise<Abbreviation>;
  export async function confirmAbbreviation(id: string): Promise<Abbreviation>;
  export async function putSession(date: string, body: { notes?: string | null; entries: SetEntryInput[] }): Promise<SessionResponse>;
  export async function getSessions(from: string, to: string): Promise<SessionResponse[]>;
  export async function createGoal(input: { type: GoalType; description?: string; overrides?: { muscle: MuscleGroup; min: number; max: number }[] }): Promise<unknown>;
  export async function getGoalProgress(weekStart: string): Promise<GoalProgress[]>;
  ```
  Every later task (db repos, sync engine, screens) imports these functions and types — do not rename any of them.

- [ ] **Step 1: Create config**

```ts
// mobile/src/config.ts
export const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'https://strong-notes-api.lurkhuset.com';
```

- [ ] **Step 2: Create token storage**

```ts
// mobile/src/auth/token.ts
import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'strongnotes_api_token';

export async function getApiToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function setApiToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}
```

- [ ] **Step 3: Create shared types**

```ts
// mobile/src/api/types.ts
export type MuscleGroup = 'GLUTES' | 'QUADS' | 'HAMSTRINGS' | 'CHEST' | 'BACK' | 'SHOULDERS' | 'ARMS' | 'CORE' | 'CALVES';
export type GoalType = 'HYPERTROPHY' | 'STRENGTH' | 'ENDURANCE' | 'CUSTOM';
export type ParsedBy = 'DICTIONARY' | 'LLM';

export type ResolveLineResponse = {
  resolvedTokens: { token: string; type: 'exercise' | 'modifier'; exerciseId?: string; modifierType?: string; modifierValue?: string }[];
  unresolvedTokens: string[];
  llmGuess?: { exerciseName: string; equipment?: string; weightKg?: number; reps?: number; sets?: number };
};

export type GoalGuess = { type: GoalType; muscles: MuscleGroup[] };

export type Abbreviation = {
  id: string;
  token: string;
  exerciseId?: string;
  modifierType?: string;
  modifierValue?: string;
  source: string;
};

export type SetEntryInput = {
  exerciseId?: string;
  equipment?: string;
  weightKg?: number;
  reps?: number;
  sets?: number;
  rawText: string;
  parsedBy: ParsedBy;
  order: number;
};

export type SessionResponse = {
  id: string;
  date: string;
  notes: string | null;
  entries: (SetEntryInput & { id: string })[];
};

export type GoalProgress = {
  muscle: MuscleGroup;
  targetMin: number;
  targetMax: number;
  actualSets: number;
};
```

- [ ] **Step 4: Write the failing test**

```ts
// mobile/__tests__/api/client.test.ts
import { resolveLine, putSession, getGoalProgress } from '../../src/api/client';
import { getApiToken } from '../../src/auth/token';

jest.mock('../../src/auth/token', () => ({
  getApiToken: jest.fn(),
}));

const mockGetApiToken = getApiToken as jest.Mock;

describe('api client', () => {
  beforeEach(() => {
    mockGetApiToken.mockResolvedValue('test-token');
    global.fetch = jest.fn();
  });

  it('sends a bearer token and the request body on resolveLine', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ resolvedTokens: [], unresolvedTokens: [] }),
    });

    const result = await resolveLine('RDL BB 40kg 8x3');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/resolve/line'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
        body: JSON.stringify({ line: 'RDL BB 40kg 8x3' }),
      })
    );
    expect(result).toEqual({ resolvedTokens: [], unresolvedTokens: [] });
  });

  it('throws with the response status on a non-ok response', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });

    await expect(putSession('2026-07-04', { entries: [] })).rejects.toThrow('500');
  });

  it('builds the query string for getGoalProgress', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => [] });

    await getGoalProgress('2026-07-06');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/goals/active/progress?weekStart=2026-07-06'),
      expect.any(Object)
    );
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `cd mobile && npm test -- api/client.test.ts`
Expected: FAIL — `src/api/client.ts` does not exist.

- [ ] **Step 6: Implement the client**

```ts
// mobile/src/api/client.ts
import { API_BASE_URL } from '../config';
import { getApiToken } from '../auth/token';
import type {
  ResolveLineResponse,
  GoalGuess,
  Abbreviation,
  SetEntryInput,
  SessionResponse,
  GoalProgress,
  GoalType,
  MuscleGroup,
} from './types';

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = await getApiToken();
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers ?? {}),
    },
  });
  if (!res.ok) {
    throw new Error(`Strong Notes API request to ${path} failed with status ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function resolveLine(line: string): Promise<ResolveLineResponse> {
  return request('/resolve/line', { method: 'POST', body: JSON.stringify({ line }) });
}

export function resolveGoal(text: string): Promise<GoalGuess> {
  return request('/resolve/goal', { method: 'POST', body: JSON.stringify({ text }) });
}

export function listAbbreviations(): Promise<Abbreviation[]> {
  return request('/abbreviations');
}

export function createAbbreviation(input: {
  token: string;
  exerciseId?: string;
  modifierType?: string;
  modifierValue?: string;
}): Promise<Abbreviation> {
  return request('/abbreviations', { method: 'POST', body: JSON.stringify(input) });
}

export function confirmAbbreviation(id: string): Promise<Abbreviation> {
  return request(`/abbreviations/${id}/confirm`, { method: 'PATCH' });
}

export function putSession(
  date: string,
  body: { notes?: string | null; entries: SetEntryInput[] }
): Promise<SessionResponse> {
  return request(`/sessions/${date}`, { method: 'PUT', body: JSON.stringify(body) });
}

export function getSessions(from: string, to: string): Promise<SessionResponse[]> {
  return request(`/sessions?from=${from}&to=${to}`);
}

export function createGoal(input: {
  type: GoalType;
  description?: string;
  overrides?: { muscle: MuscleGroup; min: number; max: number }[];
}): Promise<unknown> {
  return request('/goals', { method: 'POST', body: JSON.stringify(input) });
}

export function getGoalProgress(weekStart: string): Promise<GoalProgress[]> {
  return request(`/goals/active/progress?weekStart=${weekStart}`);
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `cd mobile && npm test -- api/client.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add mobile/src/config.ts mobile/src/auth mobile/src/api mobile/__tests__/api
git commit -m "feat(mobile): add typed API client and secure token storage"
```

---

### Task 3: Local SQLite schema and repositories

**Files:**
- Create: `mobile/src/db/client.ts`
- Create: `mobile/src/db/sessionsRepo.ts`
- Create: `mobile/src/db/abbreviationsRepo.ts`
- Test: `mobile/__tests__/db/sessionsRepo.test.ts`
- Test: `mobile/__tests__/db/abbreviationsRepo.test.ts`

**Interfaces:**
- Consumes: `expo-sqlite`.
- Produces:
  ```ts
  // src/db/client.ts
  export async function getDb(): Promise<SQLite.SQLiteDatabase>; // runs migrations on first call

  // src/db/sessionsRepo.ts
  export type LocalSetEntry = { id: string; exerciseId: string | null; equipment: string | null; weightKg: number | null; reps: number | null; sets: number | null; rawText: string; parsedBy: 'DICTIONARY' | 'LLM'; order: number; synced: 0 | 1 };
  export type LocalSession = { date: string; notes: string | null; entries: LocalSetEntry[]; synced: 0 | 1 };
  export async function upsertLocalSession(session: LocalSession): Promise<void>;
  export async function getLocalSession(date: string): Promise<LocalSession | null>;
  export async function listLocalSessions(fromDate: string, toDate: string): Promise<LocalSession[]>;
  export async function listUnsyncedSessions(): Promise<LocalSession[]>;
  export async function markSessionSynced(date: string): Promise<void>;

  // src/db/abbreviationsRepo.ts
  export async function cacheAbbreviations(abbreviations: Abbreviation[]): Promise<void>; // replace-all cache
  export async function getCachedAbbreviations(): Promise<Abbreviation[]>;
  ```
  Task 4 (Log screen) uses `upsertLocalSession`/`getLocalSession`. Task 5 (sync engine) uses `listUnsyncedSessions`/`markSessionSynced`/`cacheAbbreviations`. Task 8 (Profile screen) uses `getCachedAbbreviations`.

- [ ] **Step 1: Create the DB client with migrations**

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
}
```

- [ ] **Step 2: Write the failing sessions repo test**

```ts
// mobile/__tests__/db/sessionsRepo.test.ts
import { resetDbForTests } from '../../src/db/client';
import {
  upsertLocalSession,
  getLocalSession,
  listUnsyncedSessions,
  markSessionSynced,
} from '../../src/db/sessionsRepo';

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

- [ ] **Step 3: Run test to verify it fails**

Run: `cd mobile && npm test -- db/sessionsRepo.test.ts`
Expected: FAIL — `src/db/sessionsRepo.ts` does not exist.

- [ ] **Step 4: Implement the sessions repo**

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

- [ ] **Step 5: Run test to verify it passes**

Run: `cd mobile && npm test -- db/sessionsRepo.test.ts`
Expected: PASS

- [ ] **Step 6: Write the failing abbreviations repo test**

```ts
// mobile/__tests__/db/abbreviationsRepo.test.ts
import { resetDbForTests } from '../../src/db/client';
import { cacheAbbreviations, getCachedAbbreviations } from '../../src/db/abbreviationsRepo';

beforeEach(() => {
  resetDbForTests();
});

describe('abbreviationsRepo', () => {
  it('replaces the entire cache on each call', async () => {
    await cacheAbbreviations([
      { id: '1', token: 'RDL', exerciseId: 'ex-1', source: 'BUILT_IN' },
    ]);
    await cacheAbbreviations([
      { id: '2', token: 'HT', exerciseId: 'ex-2', source: 'BUILT_IN' },
    ]);

    const cached = await getCachedAbbreviations();
    expect(cached).toHaveLength(1);
    expect(cached[0].token).toBe('HT');
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `cd mobile && npm test -- db/abbreviationsRepo.test.ts`
Expected: FAIL — `src/db/abbreviationsRepo.ts` does not exist.

- [ ] **Step 8: Implement the abbreviations repo**

```ts
// mobile/src/db/abbreviationsRepo.ts
import { getDb } from './client';
import type { Abbreviation } from '../api/types';

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
  }));
}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `cd mobile && npm test -- db/abbreviationsRepo.test.ts`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add mobile/src/db mobile/__tests__/db
git commit -m "feat(mobile): add local sqlite schema and repositories"
```

---

### Task 4: Quick-entry parsing orchestration

**Files:**
- Create: `mobile/src/parsing/quickEntry.ts`
- Test: `mobile/__tests__/parsing/quickEntry.test.ts`

**Interfaces:**
- Consumes: `resolveLine` from `src/api/client.ts` (Task 2).
- Produces:
  ```ts
  export type ParsedLine = {
    rawText: string;
    status: 'resolved' | 'needs-confirm' | 'unresolved';
    exerciseName?: string;
    equipment?: string;
    weightKg?: number;
    reps?: number;
    sets?: number;
    parsedBy: 'DICTIONARY' | 'LLM';
  };
  export async function parseQuickEntryLine(line: string): Promise<ParsedLine>;
  ```
  Task 5's Log screen calls `parseQuickEntryLine` for every submitted line and renders the result via `ParsedLineRow`.

- [ ] **Step 1: Write the failing test**

```ts
// mobile/__tests__/parsing/quickEntry.test.ts
import { parseQuickEntryLine } from '../../src/parsing/quickEntry';
import { resolveLine } from '../../src/api/client';

jest.mock('../../src/api/client', () => ({
  resolveLine: jest.fn(),
}));

const mockResolveLine = resolveLine as jest.Mock;

describe('parseQuickEntryLine', () => {
  it('marks a fully dictionary-resolved line as resolved', async () => {
    mockResolveLine.mockResolvedValue({
      resolvedTokens: [{ token: 'BB', type: 'modifier', modifierType: 'equipment', modifierValue: 'barbell' }],
      unresolvedTokens: [],
    });

    const result = await parseQuickEntryLine('BB RDL 40kg 8x3');

    expect(result.status).toBe('resolved');
    expect(result.parsedBy).toBe('DICTIONARY');
  });

  it('marks an LLM-guessed line as needs-confirm', async () => {
    mockResolveLine.mockResolvedValue({
      resolvedTokens: [],
      unresolvedTokens: ['CRABWALK'],
      llmGuess: { exerciseName: 'Cable Crab Walk', equipment: undefined, weightKg: undefined, reps: 8, sets: 2 },
    });

    const result = await parseQuickEntryLine('CRABWALK 8x2');

    expect(result.status).toBe('needs-confirm');
    expect(result.exerciseName).toBe('Cable Crab Walk');
    expect(result.parsedBy).toBe('LLM');
  });

  it('marks a line with unresolved tokens and no LLM guess as unresolved', async () => {
    mockResolveLine.mockResolvedValue({ resolvedTokens: [], unresolvedTokens: ['???'] });

    const result = await parseQuickEntryLine('???');

    expect(result.status).toBe('unresolved');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npm test -- parsing/quickEntry.test.ts`
Expected: FAIL — `src/parsing/quickEntry.ts` does not exist.

- [ ] **Step 3: Implement the orchestration**

```ts
// mobile/src/parsing/quickEntry.ts
import { resolveLine } from '../api/client';

export type ParsedLine = {
  rawText: string;
  status: 'resolved' | 'needs-confirm' | 'unresolved';
  exerciseName?: string;
  equipment?: string;
  weightKg?: number;
  reps?: number;
  sets?: number;
  parsedBy: 'DICTIONARY' | 'LLM';
};

export async function parseQuickEntryLine(line: string): Promise<ParsedLine> {
  const response = await resolveLine(line);

  if (response.llmGuess) {
    return {
      rawText: line,
      status: 'needs-confirm',
      exerciseName: response.llmGuess.exerciseName,
      equipment: response.llmGuess.equipment,
      weightKg: response.llmGuess.weightKg,
      reps: response.llmGuess.reps,
      sets: response.llmGuess.sets,
      parsedBy: 'LLM',
    };
  }

  if (response.unresolvedTokens.length > 0) {
    return { rawText: line, status: 'unresolved', parsedBy: 'DICTIONARY' };
  }

  return { rawText: line, status: 'resolved', parsedBy: 'DICTIONARY' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npm test -- parsing/quickEntry.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add mobile/src/parsing mobile/__tests__/parsing
git commit -m "feat(mobile): add quick-entry parsing orchestration"
```

---

### Task 5: Log screen (quick entry UI)

**Files:**
- Create: `mobile/src/components/ParsedLineRow.tsx`
- Modify: `mobile/app/(tabs)/index.tsx`
- Test: `mobile/__tests__/app/log.test.tsx` (extends Task 1's stub test)

**Interfaces:**
- Consumes: `parseQuickEntryLine` (Task 4), `upsertLocalSession`/`getLocalSession` (Task 3).
- Produces: the real Log screen UI — a single `TextInput` at the bottom, a `FlatList` of `ParsedLineRow` above it for today's date. No other task depends on this screen's internals.

- [ ] **Step 1: Write the failing test**

```tsx
// mobile/__tests__/app/log.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import LogScreen from '../../app/(tabs)/index';
import { resolveLine } from '../../src/api/client';
import { resetDbForTests } from '../../src/db/client';

jest.mock('../../src/api/client', () => ({
  resolveLine: jest.fn(),
}));

const mockResolveLine = resolveLine as jest.Mock;

beforeEach(() => {
  resetDbForTests();
  mockResolveLine.mockResolvedValue({ resolvedTokens: [], unresolvedTokens: [] });
});

describe('LogScreen', () => {
  it('adds a parsed line to the list after submitting text', async () => {
    render(<LogScreen />);

    const input = screen.getByPlaceholderText('Log a set...');
    fireEvent.changeText(input, 'BB RDL 40kg 8x3');
    fireEvent(input, 'submitEditing');

    await waitFor(() => {
      expect(screen.getByText('BB RDL 40kg 8x3')).toBeTruthy();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npm test -- app/log.test.tsx`
Expected: FAIL — no `TextInput` with that placeholder exists yet (Task 1's stub screen).

- [ ] **Step 3: Implement the parsed-line row component**

```tsx
// mobile/src/components/ParsedLineRow.tsx
import { View, Text, StyleSheet } from 'react-native';
import type { ParsedLine } from '../parsing/quickEntry';

export function ParsedLineRow({ line }: { line: ParsedLine }) {
  return (
    <View style={styles.row}>
      <Text>{line.rawText}</Text>
      {line.status === 'needs-confirm' && <Text style={styles.pending}>Confirm: {line.exerciseName}</Text>}
      {line.status === 'unresolved' && <Text style={styles.pending}>Unrecognized</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { paddingVertical: 8 },
  pending: { color: '#a35', fontSize: 12 },
});
```

- [ ] **Step 4: Implement the Log screen**

```tsx
// mobile/app/(tabs)/index.tsx
import { useState } from 'react';
import { View, TextInput, FlatList, StyleSheet } from 'react-native';
import { parseQuickEntryLine, type ParsedLine } from '../../src/parsing/quickEntry';
import { upsertLocalSession, getLocalSession } from '../../src/db/sessionsRepo';
import { ParsedLineRow } from '../../src/components/ParsedLineRow';

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function LogScreen() {
  const [text, setText] = useState('');
  const [lines, setLines] = useState<ParsedLine[]>([]);

  async function handleSubmit() {
    const line = text.trim();
    if (!line) return;
    setText('');

    const parsed = await parseQuickEntryLine(line);
    const nextLines = [...lines, parsed];
    setLines(nextLines);

    const date = todayDate();
    const existing = await getLocalSession(date);
    await upsertLocalSession({
      date,
      notes: existing?.notes ?? null,
      synced: 0,
      entries: nextLines.map((l, i) => ({
        id: existing?.entries[i]?.id ?? `${date}-${i}-${Date.now()}`,
        exerciseId: null,
        equipment: l.equipment ?? null,
        weightKg: l.weightKg ?? null,
        reps: l.reps ?? null,
        sets: l.sets ?? null,
        rawText: l.rawText,
        parsedBy: l.parsedBy,
        order: i,
        synced: 0,
      })),
    });
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={lines}
        keyExtractor={(_, i) => String(i)}
        renderItem={({ item }) => <ParsedLineRow line={item} />}
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
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd mobile && npm test -- app/log.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add mobile/src/components/ParsedLineRow.tsx mobile/app/\(tabs\)/index.tsx mobile/__tests__/app/log.test.tsx
git commit -m "feat(mobile): implement log screen quick-entry UI"
```

---

### Task 6: Sync engine

**Files:**
- Create: `mobile/src/sync/syncEngine.ts`
- Test: `mobile/__tests__/sync/syncEngine.test.ts`

**Interfaces:**
- Consumes: `listUnsyncedSessions`, `markSessionSynced` (Task 3's `sessionsRepo`), `cacheAbbreviations` (Task 3's `abbreviationsRepo`), `putSession`, `listAbbreviations` (Task 2's `client`).
- Produces:
  ```ts
  export async function syncNow(): Promise<{ pushed: number; pulled: number }>;
  ```
  Task 7 (Stats screen, to refresh before showing progress) and Task 8 (Profile screen sync status) both call `syncNow`.

- [ ] **Step 1: Write the failing test**

```ts
// mobile/__tests__/sync/syncEngine.test.ts
import { syncNow } from '../../src/sync/syncEngine';
import * as client from '../../src/api/client';
import * as sessionsRepo from '../../src/db/sessionsRepo';
import * as abbreviationsRepo from '../../src/db/abbreviationsRepo';

jest.mock('../../src/api/client');
jest.mock('../../src/db/sessionsRepo');
jest.mock('../../src/db/abbreviationsRepo');

describe('syncNow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('pushes each unsynced local session to the backend and marks it synced', async () => {
    (sessionsRepo.listUnsyncedSessions as jest.Mock).mockResolvedValue([
      { date: '2026-07-04', notes: 'leg day', synced: 0, entries: [] },
    ]);
    (client.putSession as jest.Mock).mockResolvedValue({});
    (client.listAbbreviations as jest.Mock).mockResolvedValue([]);

    const result = await syncNow();

    expect(client.putSession).toHaveBeenCalledWith('2026-07-04', { notes: 'leg day', entries: [] });
    expect(sessionsRepo.markSessionSynced).toHaveBeenCalledWith('2026-07-04');
    expect(result.pushed).toBe(1);
  });

  it('pulls the abbreviation dictionary and caches it', async () => {
    (sessionsRepo.listUnsyncedSessions as jest.Mock).mockResolvedValue([]);
    (client.listAbbreviations as jest.Mock).mockResolvedValue([{ id: '1', token: 'RDL', source: 'BUILT_IN' }]);

    const result = await syncNow();

    expect(abbreviationsRepo.cacheAbbreviations).toHaveBeenCalledWith([{ id: '1', token: 'RDL', source: 'BUILT_IN' }]);
    expect(result.pulled).toBe(1);
  });

  it('does not mark a session synced if the push fails', async () => {
    (sessionsRepo.listUnsyncedSessions as jest.Mock).mockResolvedValue([
      { date: '2026-07-05', notes: null, synced: 0, entries: [] },
    ]);
    (client.putSession as jest.Mock).mockRejectedValue(new Error('network down'));
    (client.listAbbreviations as jest.Mock).mockResolvedValue([]);

    const result = await syncNow();

    expect(sessionsRepo.markSessionSynced).not.toHaveBeenCalled();
    expect(result.pushed).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npm test -- sync/syncEngine.test.ts`
Expected: FAIL — `src/sync/syncEngine.ts` does not exist.

- [ ] **Step 3: Implement the sync engine**

```ts
// mobile/src/sync/syncEngine.ts
import { putSession, listAbbreviations } from '../api/client';
import { listUnsyncedSessions, markSessionSynced } from '../db/sessionsRepo';
import { cacheAbbreviations } from '../db/abbreviationsRepo';

export async function syncNow(): Promise<{ pushed: number; pulled: number }> {
  const unsynced = await listUnsyncedSessions();
  let pushed = 0;

  for (const session of unsynced) {
    try {
      await putSession(session.date, {
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

  const abbreviations = await listAbbreviations();
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
git commit -m "feat(mobile): add sync engine for sessions and abbreviations"
```

---

### Task 7: Muscle heatmap and Stats screen

**Files:**
- Create: `mobile/src/science/muscleColor.ts`
- Create: `mobile/src/components/MuscleHeatmap.tsx`
- Modify: `mobile/app/(tabs)/stats.tsx`
- Test: `mobile/__tests__/science/muscleColor.test.ts`
- Test: `mobile/__tests__/components/MuscleHeatmap.test.tsx`

**Interfaces:**
- Consumes: `getGoalProgress` (Task 2's `client`), `syncNow` (Task 6), `GoalProgress`/`MuscleGroup` types (Task 2).
- Produces:
  ```ts
  export function progressColor(actualSets: number, targetMin: number, targetMax: number): string;
  ```
  `MuscleHeatmap` is the only consumer of `progressColor`; no later task depends on either.

- [ ] **Step 1: Write the failing color-mapping test**

```ts
// mobile/__tests__/science/muscleColor.test.ts
import { progressColor } from '../../src/science/muscleColor';

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
Expected: FAIL — `src/science/muscleColor.ts` does not exist.

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

- [ ] **Step 5: Write the failing heatmap component test**

```tsx
// mobile/__tests__/components/MuscleHeatmap.test.tsx
import { render, screen } from '@testing-library/react-native';
import { MuscleHeatmap } from '../../src/components/MuscleHeatmap';

describe('MuscleHeatmap', () => {
  it('renders a labeled row per muscle with its set count', () => {
    render(
      <MuscleHeatmap
        progress={[
          { muscle: 'GLUTES', targetMin: 12, targetMax: 20, actualSets: 8 },
          { muscle: 'CHEST', targetMin: 10, targetMax: 18, actualSets: 2 },
        ]}
      />
    );

    expect(screen.getByText('GLUTES')).toBeTruthy();
    expect(screen.getByText('8 / 20')).toBeTruthy();
    expect(screen.getByText('CHEST')).toBeTruthy();
    expect(screen.getByText('2 / 18')).toBeTruthy();
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd mobile && npm test -- components/MuscleHeatmap.test.tsx`
Expected: FAIL — `src/components/MuscleHeatmap.tsx` does not exist.

- [ ] **Step 7: Implement the heatmap component**

```tsx
// mobile/src/components/MuscleHeatmap.tsx
import { View, Text, StyleSheet } from 'react-native';
import { progressColor } from '../science/muscleColor';
import type { GoalProgress } from '../api/types';

export function MuscleHeatmap({ progress }: { progress: GoalProgress[] }) {
  return (
    <View>
      {progress.map((p) => (
        <View key={p.muscle} style={[styles.row, { backgroundColor: progressColor(p.actualSets, p.targetMin, p.targetMax) }]}>
          <Text style={styles.label}>{p.muscle}</Text>
          <Text style={styles.count}>{p.actualSets} / {p.targetMax}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', padding: 12, borderRadius: 8, marginBottom: 6 },
  label: { fontWeight: '600' },
  count: {},
});
```

- [ ] **Step 8: Run test to verify it passes**

Run: `cd mobile && npm test -- components/MuscleHeatmap.test.tsx`
Expected: PASS

- [ ] **Step 9: Implement the Stats screen**

```tsx
// mobile/app/(tabs)/stats.tsx
import { useEffect, useState } from 'react';
import { View, ScrollView } from 'react-native';
import { getGoalProgress } from '../../src/api/client';
import { syncNow } from '../../src/sync/syncEngine';
import { MuscleHeatmap } from '../../src/components/MuscleHeatmap';
import type { GoalProgress } from '../../src/api/types';

function currentWeekStart(): string {
  const now = new Date();
  const day = now.getUTCDay();
  const diff = (day + 6) % 7; // days since Monday
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() - diff);
  return monday.toISOString().slice(0, 10);
}

export default function StatsScreen() {
  const [progress, setProgress] = useState<GoalProgress[]>([]);

  useEffect(() => {
    (async () => {
      await syncNow();
      const data = await getGoalProgress(currentWeekStart());
      setProgress(data);
    })();
  }, []);

  return (
    <ScrollView>
      <View style={{ padding: 16 }}>
        <MuscleHeatmap progress={progress} />
      </View>
    </ScrollView>
  );
}
```

- [ ] **Step 10: Commit**

```bash
git add mobile/src/science mobile/src/components/MuscleHeatmap.tsx mobile/app/\(tabs\)/stats.tsx mobile/__tests__/science mobile/__tests__/components
git commit -m "feat(mobile): add muscle heatmap and stats screen"
```

---

### Task 8: History and Profile screens

**Files:**
- Modify: `mobile/app/(tabs)/history.tsx`
- Modify: `mobile/app/(tabs)/profile.tsx`
- Test: `mobile/__tests__/app/stats.test.tsx` (history/profile covered inline below; see Step 5 for the actual test file names)

**Interfaces:**
- Consumes: `listLocalSessions` (Task 3), `getCachedAbbreviations` (Task 3), `confirmAbbreviation` (Task 2), `syncNow` (Task 6).
- Produces: final two screens. No later task depends on them.

- [ ] **Step 1: Write the failing History screen test**

```tsx
// mobile/__tests__/app/history.test.tsx
import { render, screen, waitFor } from '@testing-library/react-native';
import HistoryScreen from '../../app/(tabs)/history';
import { resetDbForTests } from '../../src/db/client';
import { upsertLocalSession } from '../../src/db/sessionsRepo';

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
    render(<HistoryScreen />);

    await waitFor(() => {
      expect(screen.getByText('2026-07-01')).toBeTruthy();
      expect(screen.getByText('BB RDL 40kg 8x3')).toBeTruthy();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npm test -- app/history.test.tsx`
Expected: FAIL — History screen is still Task 1's stub.

- [ ] **Step 3: Implement the History screen**

```tsx
// mobile/app/(tabs)/history.tsx
import { useEffect, useState } from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { listLocalSessions } from '../../src/db/sessionsRepo';
import type { LocalSession } from '../../src/db/sessionsRepo';

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

- [ ] **Step 5: Write the failing Profile screen test**

```tsx
// mobile/__tests__/app/profile.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import ProfileScreen from '../../app/(tabs)/profile';
import { resetDbForTests } from '../../src/db/client';
import { cacheAbbreviations } from '../../src/db/abbreviationsRepo';
import { confirmAbbreviation } from '../../src/api/client';

jest.mock('../../src/api/client', () => ({
  confirmAbbreviation: jest.fn().mockResolvedValue({}),
  listAbbreviations: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../src/sync/syncEngine', () => ({
  syncNow: jest.fn().mockResolvedValue({ pushed: 0, pulled: 0 }),
}));

beforeEach(async () => {
  resetDbForTests();
  await cacheAbbreviations([
    { id: '1', token: 'RDL', exerciseId: 'ex-1', source: 'BUILT_IN' },
    { id: '2', token: 'CRABWALK', source: 'LLM_SUGGESTED_PENDING_CONFIRM' },
  ]);
});

describe('ProfileScreen', () => {
  it('lists cached abbreviations and confirms a pending one', async () => {
    render(<ProfileScreen />);

    await waitFor(() => {
      expect(screen.getByText('RDL')).toBeTruthy();
      expect(screen.getByText('CRABWALK')).toBeTruthy();
    });

    fireEvent.press(screen.getByText('Confirm'));

    await waitFor(() => {
      expect(confirmAbbreviation).toHaveBeenCalledWith('2');
    });
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd mobile && npm test -- app/profile.test.tsx`
Expected: FAIL — Profile screen is still Task 1's stub.

- [ ] **Step 7: Implement the Profile screen**

```tsx
// mobile/app/(tabs)/profile.tsx
import { useEffect, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet } from 'react-native';
import { getCachedAbbreviations } from '../../src/db/abbreviationsRepo';
import { confirmAbbreviation } from '../../src/api/client';
import { syncNow } from '../../src/sync/syncEngine';
import type { Abbreviation } from '../../src/api/types';

export default function ProfileScreen() {
  const [abbreviations, setAbbreviations] = useState<Abbreviation[]>([]);

  async function refresh() {
    await syncNow();
    const cached = await getCachedAbbreviations();
    setAbbreviations(cached);
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleConfirm(id: string) {
    await confirmAbbreviation(id);
    await refresh();
  }

  return (
    <FlatList
      data={abbreviations}
      keyExtractor={(a) => a.id}
      renderItem={({ item }) => (
        <View style={styles.row}>
          <Text>{item.token}</Text>
          {item.source === 'LLM_SUGGESTED_PENDING_CONFIRM' && (
            <Pressable onPress={() => handleConfirm(item.id)}>
              <Text style={styles.confirm}>Confirm</Text>
            </Pressable>
          )}
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: '#eee' },
  confirm: { color: '#2563eb', fontWeight: '600' },
});
```

- [ ] **Step 8: Run test to verify it passes**

Run: `cd mobile && npm test -- app/profile.test.tsx`
Expected: PASS

- [ ] **Step 9: Run the full mobile test suite**

Run: `cd mobile && npm test`
Expected: PASS (all tasks' tests green)

- [ ] **Step 10: Commit**

```bash
git add mobile/app/\(tabs\)/history.tsx mobile/app/\(tabs\)/profile.tsx mobile/__tests__/app/history.test.tsx mobile/__tests__/app/profile.test.tsx
git commit -m "feat(mobile): implement history and profile screens"
```

---

## Self-Review Notes

- **Spec coverage:** free-text quick logging (Task 5), editable shorthand dictionary + LLM fallback confirm flow (Task 4, 8), goal-driven muscle heatmap (Task 7), history view (Task 8), local-first storage with background sync (Task 3, 6), secure token storage (Task 2) — all covered. The v2 fast-follow items (mood rating, workout suggestions) are correctly out of scope per the spec and not present in this plan.
- **Placeholder scan:** none found; every step has runnable code.
- **Type consistency:** `ParsedLine` (Task 4) is consumed identically by `ParsedLineRow` and the Log screen (Task 5). `LocalSession`/`LocalSetEntry` (Task 3) match what the sync engine (Task 6) and Log/History screens (Task 5, 8) construct and read. `GoalProgress`/`Abbreviation`/`MuscleGroup` (Task 2) flow unchanged through the sync engine, Stats screen, and Profile screen.
