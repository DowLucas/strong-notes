# Log Screen: iOS-Notes-Style Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current chat-log-style Log screen (a `FlatList` of parsed rows plus a bottom text input) with a single continuous, freeform text editor that feels like the iOS Notes app — you write naturally, and the app quietly recognizes logged sets within your prose and highlights them inline.

**Architecture:** The Log screen becomes one auto-growing multi-line text surface whose text *is* `session.notes` (a field already wired through SQLite/sync/backend, but never surfaced in UI). A pure `extractCandidates()` function finds "loggable" clauses by anchoring on the existing numeric patterns (`60kg`, `8x3`) and splitting on sentence separators. A `scanNote()` orchestrator runs each candidate clause through the *unchanged* dictionary-first → LLM-fallback pipeline (`parseQuickEntryLine`) and diffs the results against the previous scan so edits/deletes to the text update/remove the underlying entries (text is the source of truth). Two independent debounce timers drive persistence (fast, so text is never lost) and parsing (slower). Recognized clauses render as inline highlights via a transparent-`TextInput`-over-styled-`Text` overlay; tapping one opens a popover.

**Tech Stack:** Expo SDK ~54, TypeScript, expo-router, React Native `TextInput` (multiline overlay pattern), `expo-sqlite`, jest-expo + `@testing-library/react-native`. No new dependencies.

## Global Constraints

- Mobile app lives in `mobile/` at the repo root. All paths below are relative to `mobile/`.
- A write always goes to SQLite first, then is queued for sync — the note text must never be lost even if parsing or the network fails (carried over from the existing offline-first guarantee; do not regress this).
- Local dictionary resolution is attempted before any network call in the parsing flow (`parseQuickEntryLine` already does this via `tryResolveLocally`; do not regress it).
- Reuse the existing `parseQuickEntryLine(api, line)` pipeline unchanged — the only change to parsing is the *unit* fed to it (a candidate clause instead of a whole submitted line).
- Match the app's existing design tokens from `lib/theme.ts`: `colors.paper`/`bone`/`graphite`/`lead`/`moss`/`citrine`, `spacing.s1..s7`, `fonts.regular`, `fontSize.body`. Never hardcode hex values that duplicate a token.
- Inline highlight = merged pill + underline: `backgroundColor: colors.bone` plus `textDecorationLine: 'underline'` in an accent color. Resolved → `colors.moss`; needs-confirm → `colors.citrine`; unresolved → no highlight (plain text).
- Do not modify the History, Stats, or You tabs, the auth stack, or `syncEngine` (spans are local-only and never sync).

## File Structure

```
mobile/
  src/
    parsing/
      extractCandidates.ts       # NEW: pure clause-finder (numeric-anchor + sentence split)
      scanNote.ts                # NEW: extractCandidates + parseQuickEntryLine + diff-vs-previous
      quickEntry.ts              # UNCHANGED (reused by scanNote)
    db/
      client.ts                  # MODIFY: add span_start/span_end columns (+ idempotent ALTER)
      sessionsRepo.ts            # MODIFY: LocalSetEntry gains spanStart/spanEnd; upsert/load them
    components/
      NotesEditor.tsx            # NEW: overlay editor (transparent TextInput over styled Text)
      EntryPopover.tsx           # NEW: tap-a-span detail card + confirm
      ParsedLineRow.tsx          # UNCHANGED file; retired from the Log screen (still used nowhere else)
  app/(tabs)/
    index.tsx                    # REWRITE: the Notes-style Log screen
  __tests__/
    parsing/extractCandidates.test.ts   # NEW
    parsing/scanNote.test.ts            # NEW
    db/sessionsRepo.spans.test.ts       # NEW
    components/NotesEditor.test.tsx     # NEW
    components/EntryPopover.test.tsx    # NEW
    app/log.test.tsx                    # REWRITE (adapted regression)
    app/log-offline.test.tsx            # REWRITE (adapted regression)
    app/log-rehydrate.test.tsx          # REWRITE (adapted regression)
```

---

### Task 1: `extractCandidates` — find loggable clauses in prose

**Files:**
- Create: `src/parsing/extractCandidates.ts`
- Test: `__tests__/parsing/extractCandidates.test.ts`

**Interfaces:**
- Consumes: nothing (pure string logic).
- Produces:
  ```ts
  export type Candidate = { text: string; start: number; end: number };
  export function extractCandidates(text: string): Candidate[];
  ```
  `start`/`end` are character offsets into the *original* `text` bounding the trimmed clause. A clause qualifies if any whitespace-split token is a numeric anchor: a reps×sets token (`8x3`) or a weight-with-unit token (`40kg`, `40lb`, `40.5kg`). Task 2 and Task 3 depend on these exact field names.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/parsing/extractCandidates.test.ts
import { extractCandidates } from '@/src/parsing/extractCandidates';

describe('extractCandidates', () => {
  it('extracts a single clause containing a set, with correct offsets', () => {
    const text = 'Felt strong today, did Bench Press 60kg 8x3, work on grip';
    const found = extractCandidates(text);
    expect(found).toHaveLength(1);
    expect(found[0].text).toBe('did Bench Press 60kg 8x3');
    expect(text.slice(found[0].start, found[0].end)).toBe('did Bench Press 60kg 8x3');
  });

  it('extracts multiple clauses across separators and newlines', () => {
    const text = 'RDL 40kg 8x3\nDB Curl 12kg 10x3';
    const found = extractCandidates(text);
    expect(found.map((c) => c.text)).toEqual(['RDL 40kg 8x3', 'DB Curl 12kg 10x3']);
  });

  it('returns nothing for prose with no numeric anchor', () => {
    expect(extractCandidates('Felt tired, skipped the gym today.')).toEqual([]);
  });

  it('ignores bare numbers with no unit or reps pattern', () => {
    // "3 things" has a bare number but no weight-unit or NxN anchor.
    expect(extractCandidates('Need to fix 3 things about my form')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npm test -- extractCandidates.test.ts`
Expected: FAIL — module does not exist yet.

- [ ] **Step 3: Implement `extractCandidates`**

```ts
// src/parsing/extractCandidates.ts

export type Candidate = { text: string; start: number; end: number };

// A token is a numeric anchor if it is a reps×sets pattern (8x3) or a weight
// with an explicit unit (40kg / 40lb / 40.5kg). Bare numbers are deliberately
// excluded so prose like "fix 3 things" doesn't create false candidates.
const ANCHOR_TOKEN = /^(?:\d+x\d+|\d+(?:\.\d+)?(?:kg|lb))$/i;

// Clauses are runs of text between sentence separators: period, comma, newline.
const CLAUSE = /[^.,\n]+/g;

export function extractCandidates(text: string): Candidate[] {
  const candidates: Candidate[] = [];
  let match: RegExpExecArray | null;
  while ((match = CLAUSE.exec(text)) !== null) {
    const rawClause = match[0];
    const leadingWs = rawClause.length - rawClause.trimStart().length;
    const trimmed = rawClause.trim();
    if (trimmed.length === 0) continue;

    const hasAnchor = trimmed.split(/\s+/).some((token) => ANCHOR_TOKEN.test(token));
    if (!hasAnchor) continue;

    const start = match.index + leadingWs;
    candidates.push({ text: trimmed, start, end: start + trimmed.length });
  }
  return candidates;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npm test -- extractCandidates.test.ts`
Expected: PASS (4/4)

- [ ] **Step 5: Commit**

```bash
git add mobile/src/parsing/extractCandidates.ts mobile/__tests__/parsing/extractCandidates.test.ts
git commit -m "feat(mobile): add extractCandidates prose clause finder"
```

---

### Task 2: Add span tracking to the local entries schema

**Files:**
- Modify: `src/db/client.ts`
- Modify: `src/db/sessionsRepo.ts`
- Test: `__tests__/db/sessionsRepo.spans.test.ts`

**Interfaces:**
- Consumes: `getDb` (`src/db/client.ts`), the existing `LocalSetEntry`/`LocalSession` types and `upsertLocalSession`/`getLocalSession` (`src/db/sessionsRepo.ts`).
- Produces: `LocalSetEntry` gains two optional fields:
  ```ts
  spanStart?: number | null;
  spanEnd?: number | null;
  ```
  Optional so existing entry literals elsewhere (History tests, etc.) keep compiling. Persisted to new `set_entries.span_start`/`span_end` columns. Task 3 and Task 6 read/write these.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/db/sessionsRepo.spans.test.ts
import { resetDbForTests } from '@/src/db/client';
import { upsertLocalSession, getLocalSession } from '@/src/db/sessionsRepo';

beforeEach(() => {
  resetDbForTests();
});

describe('sessionsRepo span tracking', () => {
  it('round-trips spanStart/spanEnd on an entry', async () => {
    await upsertLocalSession({
      date: '2026-07-05',
      notes: 'did RDL 40kg 8x3',
      synced: 0,
      entries: [
        {
          id: 'e1', exerciseId: 'ex-1', equipment: null, weightKg: 40, reps: 8, sets: 3,
          rawText: 'did RDL 40kg 8x3', parsedBy: 'DICTIONARY', order: 0, synced: 0,
          spanStart: 0, spanEnd: 16,
        },
      ],
    });

    const session = await getLocalSession('2026-07-05');
    expect(session?.entries[0].spanStart).toBe(0);
    expect(session?.entries[0].spanEnd).toBe(16);
  });

  it('defaults missing spans to null', async () => {
    await upsertLocalSession({
      date: '2026-07-06', notes: null, synced: 0,
      entries: [
        { id: 'e2', exerciseId: null, equipment: null, weightKg: null, reps: null, sets: null,
          rawText: 'note', parsedBy: 'DICTIONARY', order: 0, synced: 0 },
      ],
    });
    const session = await getLocalSession('2026-07-06');
    expect(session?.entries[0].spanStart ?? null).toBeNull();
    expect(session?.entries[0].spanEnd ?? null).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npm test -- sessionsRepo.spans.test.ts`
Expected: FAIL — `spanStart` is `undefined` (columns and mapping don't exist yet).

- [ ] **Step 3: Add the columns (with an idempotent migration for pre-existing DBs)**

In `src/db/client.ts`, add `span_start`/`span_end` to the `set_entries` CREATE TABLE and add an idempotent column-add for databases created before this change. Replace the `migrate` function body's `set_entries` table definition and add the helper:

```ts
// src/db/client.ts — inside migrate(), change the set_entries CREATE TABLE to:
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
      entry_order INTEGER NOT NULL,
      span_start INTEGER,
      span_end INTEGER
    );
```

Then, still inside `migrate`, after the `execAsync(...)` block that creates the tables, add:

```ts
  // Backfill columns for databases created before span tracking existed.
  // CREATE TABLE IF NOT EXISTS won't alter an existing table, so add
  // explicitly and ignore the "duplicate column" case.
  await addColumnIfMissing(db, 'set_entries', 'span_start', 'INTEGER');
  await addColumnIfMissing(db, 'set_entries', 'span_end', 'INTEGER');
```

And add this helper above `getDb`:

```ts
async function addColumnIfMissing(
  db: SQLite.SQLiteDatabase,
  table: string,
  column: string,
  type: string,
): Promise<void> {
  const cols = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
  if (!cols.some((c) => c.name === column)) {
    await db.runAsync(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}
```

- [ ] **Step 4: Thread the fields through `sessionsRepo`**

In `src/db/sessionsRepo.ts`:

Add the fields to the type:

```ts
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
  spanStart?: number | null;
  spanEnd?: number | null;
};
```

Change the INSERT in `upsertLocalSession` to include the two columns:

```ts
      await db.runAsync(
        `INSERT INTO set_entries (id, session_date, exercise_id, equipment, weight_kg, reps, sets, raw_text, parsed_by, entry_order, span_start, span_end)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          entry.spanStart ?? null,
          entry.spanEnd ?? null,
        ]
      );
```

Change `loadEntries`' row type and mapping to include the columns:

```ts
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
    span_start: number | null;
    span_end: number | null;
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
    synced: 0 as const,
    spanStart: r.span_start,
    spanEnd: r.span_end,
  }));
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd mobile && npm test -- sessionsRepo.spans.test.ts`
Expected: PASS (2/2)

- [ ] **Step 6: Run the existing repo/sync tests to confirm no regression**

Run: `cd mobile && npm test -- sessionsRepo.test.ts syncEngine.test.ts`
Expected: PASS (the new columns are additive; `syncEngine` never reads them).

- [ ] **Step 7: Commit**

```bash
git add mobile/src/db/client.ts mobile/src/db/sessionsRepo.ts mobile/__tests__/db/sessionsRepo.spans.test.ts
git commit -m "feat(mobile): add span tracking columns to local set entries"
```

---

### Task 3: `scanNote` — turn note text into resolved entries with spans

**Files:**
- Create: `src/parsing/scanNote.ts`
- Test: `__tests__/parsing/scanNote.test.ts`

**Interfaces:**
- Consumes: `extractCandidates` (Task 1), `parseQuickEntryLine`/`ParsedLine` (`src/parsing/quickEntry.ts`, unchanged), `LocalSetEntry` (Task 2), `ApiClient`/`MuscleGroup` (`@/lib/api`).
- Produces:
  ```ts
  export type ScannedEntry = LocalSetEntry & {
    status: 'resolved' | 'needs-confirm';
    exerciseName?: string;
    muscles?: MuscleGroup[];
    unresolvedToken?: string;
  };
  export function scanNote(api: ApiClient, text: string, previous: ScannedEntry[]): Promise<ScannedEntry[]>;
  ```
  Only `resolved` and `needs-confirm` candidates become entries (unresolved/pending produce no highlight). A candidate whose `rawText` matches a `previous` entry reuses that entry's resolution + `id` (only span offsets/order update), so already-resolved clauses don't re-hit the network and confirm-state survives re-scans. Task 6 consumes this.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/parsing/scanNote.test.ts
import { scanNote, type ScannedEntry } from '@/src/parsing/scanNote';
import { resetDbForTests } from '@/src/db/client';
import { cacheAbbreviations } from '@/src/db/abbreviationsRepo';
import type { ApiClient } from '@/lib/api';

function fakeApi(overrides: Partial<ApiClient> = {}): ApiClient {
  return { resolveLine: jest.fn(), ...overrides } as unknown as ApiClient;
}

beforeEach(() => {
  resetDbForTests();
});

describe('scanNote', () => {
  it('produces a resolved entry with span offsets for a recognized clause', async () => {
    const api = fakeApi({
      resolveLine: jest.fn().mockResolvedValue({
        resolvedTokens: [{ token: 'RDL', type: 'exercise', exerciseId: 'ex-1' }],
        unresolvedTokens: [],
      }),
    });
    const text = 'Warmup, then RDL 40kg 8x3';
    const entries = await scanNote(api, text, []);

    expect(entries).toHaveLength(1);
    expect(entries[0].status).toBe('resolved');
    expect(entries[0].exerciseId).toBe('ex-1');
    expect(text.slice(entries[0].spanStart!, entries[0].spanEnd!)).toBe('then RDL 40kg 8x3');
  });

  it('drops clauses that resolve to unresolved (no highlight)', async () => {
    const api = fakeApi({
      resolveLine: jest.fn().mockResolvedValue({ resolvedTokens: [], unresolvedTokens: ['ZZZ'] }),
    });
    const entries = await scanNote(api, 'ZZZ 40kg 8x3', []);
    expect(entries).toEqual([]);
  });

  it('reuses a prior resolution for an unchanged clause without calling the network again', async () => {
    await cacheAbbreviations([{ id: '1', token: 'RDL', exerciseId: 'ex-1', source: 'BUILT_IN', createdAt: '' }]);
    const resolveLine = jest.fn();
    const api = fakeApi({ resolveLine });

    const first = await scanNote(api, 'RDL 40kg 8x3', []); // resolves locally, no network
    const second = await scanNote(api, 'RDL 40kg 8x3', first);

    expect(resolveLine).not.toHaveBeenCalled();
    expect(second[0].id).toBe(first[0].id); // stable id across re-scan
  });

  it('surfaces needs-confirm metadata for an LLM guess', async () => {
    const api = fakeApi({
      resolveLine: jest.fn().mockResolvedValue({
        resolvedTokens: [],
        unresolvedTokens: ['CRABWALK'],
        llmGuess: { exerciseName: 'Crab Walk', muscles: ['GLUTES', 'CORE'], reps: 8, sets: 2 },
      }),
    });
    const entries = await scanNote(api, 'CRABWALK 8x2', []);
    expect(entries[0].status).toBe('needs-confirm');
    expect(entries[0].exerciseName).toBe('Crab Walk');
    expect(entries[0].unresolvedToken).toBe('CRABWALK');
    expect(entries[0].muscles).toEqual(['GLUTES', 'CORE']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npm test -- scanNote.test.ts`
Expected: FAIL — module does not exist yet.

- [ ] **Step 3: Implement `scanNote`**

```ts
// src/parsing/scanNote.ts
import type { ApiClient, MuscleGroup } from '@/lib/api';
import type { LocalSetEntry } from '../db/sessionsRepo';
import { extractCandidates } from './extractCandidates';
import { parseQuickEntryLine } from './quickEntry';

export type ScannedEntry = LocalSetEntry & {
  status: 'resolved' | 'needs-confirm';
  exerciseName?: string;
  muscles?: MuscleGroup[];
  unresolvedToken?: string;
};

let idCounter = 0;
function makeEntryId(): string {
  idCounter += 1;
  return `entry-${Date.now()}-${idCounter}`;
}

export async function scanNote(
  api: ApiClient,
  text: string,
  previous: ScannedEntry[],
): Promise<ScannedEntry[]> {
  const candidates = extractCandidates(text);
  const prevByText = new Map(previous.map((e) => [e.rawText, e]));
  const result: ScannedEntry[] = [];

  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];

    // Unchanged clause text → reuse the prior resolution (and its stable id +
    // any confirm state); only the span offsets and order can have shifted.
    const reuse = prevByText.get(candidate.text);
    if (reuse) {
      result.push({ ...reuse, spanStart: candidate.start, spanEnd: candidate.end, order: i });
      continue;
    }

    const parsed = await parseQuickEntryLine(api, candidate.text);
    if (parsed.status !== 'resolved' && parsed.status !== 'needs-confirm') continue;

    result.push({
      id: makeEntryId(),
      exerciseId: parsed.exerciseId ?? null,
      equipment: parsed.equipment ?? null,
      weightKg: parsed.weightKg ?? null,
      reps: parsed.reps ?? null,
      sets: parsed.sets ?? null,
      rawText: parsed.rawText,
      parsedBy: parsed.parsedBy,
      order: i,
      synced: 0,
      spanStart: candidate.start,
      spanEnd: candidate.end,
      status: parsed.status,
      exerciseName: parsed.exerciseName,
      muscles: parsed.muscles,
      unresolvedToken: parsed.unresolvedToken,
    });
  }

  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npm test -- scanNote.test.ts`
Expected: PASS (4/4)

- [ ] **Step 5: Commit**

```bash
git add mobile/src/parsing/scanNote.ts mobile/__tests__/parsing/scanNote.test.ts
git commit -m "feat(mobile): add scanNote to resolve prose clauses into spanned entries"
```

---

### Task 4: `NotesEditor` — the inline-highlight overlay editor

**Files:**
- Create: `src/components/NotesEditor.tsx`
- Test: `__tests__/components/NotesEditor.test.tsx`

**Interfaces:**
- Consumes: theme tokens from `@/lib/theme`.
- Produces:
  ```ts
  export type HighlightSpan = { start: number; end: number; status: 'resolved' | 'needs-confirm'; entryId: string };
  export function NotesEditor(props: {
    value: string;
    onChangeText: (t: string) => void;
    spans: HighlightSpan[];
    onSpanPress: (entryId: string) => void;
    placeholder?: string;
  }): JSX.Element;
  ```
  Presentational only — no timers, no api, no persistence. Task 6 owns all of that and feeds this component. Uses the standard overlay pattern: a transparent-text `TextInput` (the real editing surface, exposing the caret) stacked over a styled `Text` that renders the same string with highlighted spans. Both layers share identical font metrics so they stay aligned.

**Note on the overlay risk:** if this alignment proves too fragile on-device during implementation (multi-line reflow, cursor drift, IME/autocorrect), fall back to a plain `TextInput` with no `spans` overlay — Task 6's persistence, scanning, and popover still work, just without inline visual markers — and revisit highlighting as a fast-follow. The interface above does not change in that fallback (pass `spans={[]}`).

- [ ] **Step 1: Write the failing test**

```tsx
// __tests__/components/NotesEditor.test.tsx
import { render, screen, fireEvent } from '@testing-library/react-native';
import { NotesEditor, type HighlightSpan } from '@/src/components/NotesEditor';

describe('NotesEditor', () => {
  const value = 'Warmup, then RDL 40kg 8x3';
  const spans: HighlightSpan[] = [
    { start: 8, end: 25, status: 'resolved', entryId: 'e1' }, // "then RDL 40kg 8x3"
  ];

  it('renders the highlighted span as its own tappable node', async () => {
    const onSpanPress = jest.fn();
    await render(
      <NotesEditor value={value} onChangeText={jest.fn()} spans={spans} onSpanPress={onSpanPress} placeholder="Start typing…" />,
    );

    const span = screen.getByText('then RDL 40kg 8x3');
    await fireEvent.press(span);
    expect(onSpanPress).toHaveBeenCalledWith('e1');
  });

  it('exposes the editable text and reports changes', async () => {
    const onChangeText = jest.fn();
    await render(
      <NotesEditor value={value} onChangeText={onChangeText} spans={[]} onSpanPress={jest.fn()} placeholder="Start typing…" />,
    );

    const input = screen.getByPlaceholderText('Start typing…');
    await fireEvent.changeText(input, 'new text');
    expect(onChangeText).toHaveBeenCalledWith('new text');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npm test -- NotesEditor.test.tsx`
Expected: FAIL — module does not exist yet.

- [ ] **Step 3: Implement `NotesEditor`**

```tsx
// src/components/NotesEditor.tsx
import type { ReactNode } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { colors, spacing, fonts, fontSize } from '@/lib/theme';

export type HighlightSpan = {
  start: number;
  end: number;
  status: 'resolved' | 'needs-confirm';
  entryId: string;
};

function renderSegments(
  text: string,
  spans: HighlightSpan[],
  onSpanPress: (entryId: string) => void,
): ReactNode[] {
  const ordered = [...spans].sort((a, b) => a.start - b.start);
  const nodes: ReactNode[] = [];
  let cursor = 0;

  ordered.forEach((span, i) => {
    // Skip malformed/overlapping spans defensively so a bad offset never
    // corrupts the rendered text.
    if (span.start < cursor || span.end > text.length || span.start >= span.end) return;
    if (span.start > cursor) {
      nodes.push(<Text key={`plain-${i}`}>{text.slice(cursor, span.start)}</Text>);
    }
    nodes.push(
      <Text
        key={span.entryId}
        style={span.status === 'resolved' ? styles.resolved : styles.needsConfirm}
        onPress={() => onSpanPress(span.entryId)}
      >
        {text.slice(span.start, span.end)}
      </Text>,
    );
    cursor = span.end;
  });

  if (cursor < text.length) nodes.push(<Text key="tail">{text.slice(cursor)}</Text>);
  return nodes;
}

export function NotesEditor({
  value,
  onChangeText,
  spans,
  onSpanPress,
  placeholder,
}: {
  value: string;
  onChangeText: (t: string) => void;
  spans: HighlightSpan[];
  onSpanPress: (entryId: string) => void;
  placeholder?: string;
}) {
  // Layer order matters. The TextInput is rendered first (underneath) and is
  // the real editing surface, with transparent text so the styled overlay
  // shows through and its caret (selectionColor) peeks through the gaps. The
  // styled overlay is rendered second (on top) inside a `box-none` View:
  // plain-text segments have no touch handler, so taps fall THROUGH to the
  // TextInput (positioning the cursor); span segments have onPress, so they
  // capture the tap and open the popover.
  return (
    <View style={styles.container}>
      <TextInput
        style={[styles.text, styles.input]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.lead}
        selectionColor={colors.graphite}
        multiline
        textAlignVertical="top"
        scrollEnabled={false}
      />
      <View style={styles.overlay} pointerEvents="box-none">
        <Text style={styles.text}>{renderSegments(value, spans, onSpanPress)}</Text>
      </View>
    </View>
  );
}

// Both layers MUST share fontFamily, fontSize, lineHeight, and padding so the
// styled overlay stays pixel-aligned with the transparent editing layer.
const styles = StyleSheet.create({
  container: { flex: 1 },
  text: {
    fontFamily: fonts.regular,
    fontSize: fontSize.body,
    lineHeight: 26,
    padding: spacing.s4,
    color: colors.graphite,
  },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  // Transparent text so the styled overlay shows through; the caret is still
  // visible via selectionColor.
  input: { flex: 1, color: 'transparent' },
  resolved: {
    backgroundColor: colors.bone,
    textDecorationLine: 'underline',
    textDecorationColor: colors.moss,
  },
  needsConfirm: {
    backgroundColor: colors.bone,
    textDecorationLine: 'underline',
    textDecorationColor: colors.citrine,
  },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npm test -- NotesEditor.test.tsx`
Expected: PASS (2/2)

- [ ] **Step 5: Commit**

```bash
git add mobile/src/components/NotesEditor.tsx mobile/__tests__/components/NotesEditor.test.tsx
git commit -m "feat(mobile): add NotesEditor overlay component with inline set highlights"
```

---

### Task 5: `EntryPopover` — tap-a-span detail + confirm

**Files:**
- Create: `src/components/EntryPopover.tsx`
- Test: `__tests__/components/EntryPopover.test.tsx`

**Interfaces:**
- Consumes: `ScannedEntry` (Task 3), theme tokens.
- Produces:
  ```ts
  export function EntryPopover(props: {
    entry: ScannedEntry;
    onConfirm: (entry: ScannedEntry) => void;
    onClose: () => void;
  }): JSX.Element;
  ```
  Presentational card. Shows the exercise name (or raw clause) and parsed weight/reps/sets. A `needs-confirm` entry shows a "Confirm exercise" action wired by Task 6 to `createExercise` + `createAbbreviation`; a `resolved` entry does not. Always shows a Close action.

- [ ] **Step 1: Write the failing test**

```tsx
// __tests__/components/EntryPopover.test.tsx
import { render, screen, fireEvent } from '@testing-library/react-native';
import { EntryPopover } from '@/src/components/EntryPopover';
import type { ScannedEntry } from '@/src/parsing/scanNote';

function entry(overrides: Partial<ScannedEntry>): ScannedEntry {
  return {
    id: 'e1', exerciseId: null, equipment: null, weightKg: 60, reps: 8, sets: 3,
    rawText: 'Bench Press 60kg 8x3', parsedBy: 'LLM', order: 0, synced: 0,
    spanStart: 0, spanEnd: 20, status: 'needs-confirm', exerciseName: 'Bench Press',
    unresolvedToken: 'BP', ...overrides,
  };
}

describe('EntryPopover', () => {
  it('shows a Confirm action for a needs-confirm entry and fires it', async () => {
    const onConfirm = jest.fn();
    const e = entry({});
    await render(<EntryPopover entry={e} onConfirm={onConfirm} onClose={jest.fn()} />);

    expect(screen.getByText('Bench Press')).toBeTruthy();
    expect(screen.getByText(/60kg/)).toBeTruthy();
    await fireEvent.press(screen.getByText('Confirm exercise'));
    expect(onConfirm).toHaveBeenCalledWith(e);
  });

  it('hides Confirm for a resolved entry and fires Close', async () => {
    const onClose = jest.fn();
    await render(
      <EntryPopover entry={entry({ status: 'resolved', exerciseId: 'ex-1' })} onConfirm={jest.fn()} onClose={onClose} />,
    );
    expect(screen.queryByText('Confirm exercise')).toBeNull();
    await fireEvent.press(screen.getByText('Close'));
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npm test -- EntryPopover.test.tsx`
Expected: FAIL — module does not exist yet.

- [ ] **Step 3: Implement `EntryPopover`**

```tsx
// src/components/EntryPopover.tsx
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { colors, spacing, typography } from '@/lib/theme';
import type { ScannedEntry } from '../parsing/scanNote';

export function EntryPopover({
  entry,
  onConfirm,
  onClose,
}: {
  entry: ScannedEntry;
  onConfirm: (entry: ScannedEntry) => void;
  onClose: () => void;
}) {
  const title = entry.exerciseName ?? entry.rawText;
  const detail = [
    entry.weightKg != null ? `${entry.weightKg}kg` : null,
    entry.reps != null && entry.sets != null ? `${entry.reps}×${entry.sets}` : null,
  ]
    .filter(Boolean)
    .join('   ');

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{title}</Text>
      {detail ? <Text style={styles.detail}>{detail}</Text> : null}
      {entry.status === 'needs-confirm' ? (
        <Pressable onPress={() => onConfirm(entry)} style={styles.confirmBtn}>
          <Text style={styles.confirmLabel}>Confirm exercise</Text>
        </Pressable>
      ) : null}
      <Pressable onPress={onClose} style={styles.closeBtn}>
        <Text style={styles.closeLabel}>Close</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.graphite,
    borderRadius: 10,
    padding: spacing.s4,
    gap: spacing.s2,
  },
  title: { ...typography.title, color: colors.graphite },
  detail: { ...typography.monoBodyS, color: colors.lead },
  confirmBtn: {
    backgroundColor: colors.graphite,
    borderRadius: 6,
    paddingVertical: spacing.s2,
    alignItems: 'center',
  },
  confirmLabel: { ...typography.bodyEmphasis, color: colors.fgOnAccent },
  closeBtn: { alignItems: 'center', paddingVertical: spacing.s1 },
  closeLabel: { ...typography.monoCaption, color: colors.lead },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npm test -- EntryPopover.test.tsx`
Expected: PASS (2/2)

- [ ] **Step 5: Commit**

```bash
git add mobile/src/components/EntryPopover.tsx mobile/__tests__/components/EntryPopover.test.tsx
git commit -m "feat(mobile): add EntryPopover detail card for tapped set highlights"
```

---

### Task 6: Rewrite the Log screen as the Notes-style editor

**Files:**
- Modify (rewrite): `app/(tabs)/index.tsx`
- Test (rewrite): `__tests__/app/log.test.tsx`
- Test (rewrite): `__tests__/app/log-offline.test.tsx`
- Test (rewrite): `__tests__/app/log-rehydrate.test.tsx`

**Interfaces:**
- Consumes: `useAuth` (`@/lib/auth`), `scanNote`/`ScannedEntry` (Task 3), `getLocalSession`/`upsertLocalSession`/`LocalSetEntry` (Task 2), `NotesEditor`/`HighlightSpan` (Task 4), `EntryPopover` (Task 5), `createExercise`/`createAbbreviation` on `ApiClient`.
- Produces: the real Notes-style Log screen. No later task depends on its internals. Must preserve every existing guarantee: offline-first (note text saved to SQLite before any network), rehydration of today's note on mount, no lost text under rapid typing, and a working confirm loop for LLM-guessed exercises — now surfaced via `EntryPopover` instead of the retired `ParsedLineRow`.

**Behavior:**
- Two debounce timers: a fast one (`PERSIST_DELAY_MS = 300`) that writes the raw note text (plus whatever entries currently exist) to SQLite, and a slower one (`SCAN_DELAY_MS = 700`) that re-runs `scanNote` and persists the refreshed entries. The fast timer guarantees text is never lost even if a scan is slow or fails.
- Persistence is serialized through a promise queue (same technique as the current screen) so overlapping ticks can't interleave writes.
- On mount, load `session.notes`, show it, and run one scan to rebuild highlights/entries from the persisted text.

- [ ] **Step 1: Rewrite the Log screen**

```tsx
// app/(tabs)/index.tsx
import { useEffect, useRef, useState } from 'react';
import { View, Text, Modal, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/lib/auth';
import { scanNote, type ScannedEntry } from '@/src/parsing/scanNote';
import { getLocalSession, upsertLocalSession, type LocalSetEntry } from '@/src/db/sessionsRepo';
import { NotesEditor, type HighlightSpan } from '@/src/components/NotesEditor';
import { EntryPopover } from '@/src/components/EntryPopover';
import { colors, spacing } from '@/lib/theme';

const ERROR_MESSAGE = "Couldn't load data. Pull down or reopen the app to retry.";
const PERSIST_DELAY_MS = 300;
const SCAN_DELAY_MS = 700;

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function toLocalSetEntry(e: ScannedEntry): LocalSetEntry {
  return {
    id: e.id,
    exerciseId: e.exerciseId,
    equipment: e.equipment,
    weightKg: e.weightKg,
    reps: e.reps,
    sets: e.sets,
    rawText: e.rawText,
    parsedBy: e.parsedBy,
    order: e.order,
    synced: 0,
    spanStart: e.spanStart,
    spanEnd: e.spanEnd,
  };
}

export default function LogScreen() {
  const { api } = useAuth();
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const [entries, setEntries] = useState<ScannedEntry[]>([]);
  const [popoverId, setPopoverId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const entriesRef = useRef<ScannedEntry[]>([]);
  const persistQueueRef = useRef<Promise<void>>(Promise.resolve());
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scanTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function applyEntries(next: ScannedEntry[]) {
    entriesRef.current = next;
    setEntries(next);
  }

  function persist(noteText: string, list: ScannedEntry[]): Promise<void> {
    const task = persistQueueRef.current.then(() =>
      upsertLocalSession({
        date: todayDate(),
        notes: noteText,
        synced: 0,
        entries: list.map(toLocalSetEntry),
      }),
    );
    persistQueueRef.current = task.catch(() => undefined);
    return task;
  }

  async function runScan(noteText: string): Promise<void> {
    try {
      const scanned = await scanNote(api, noteText, entriesRef.current);
      applyEntries(scanned);
      await persist(noteText, scanned);
      setError(null);
    } catch {
      // Text is already persisted by the fast timer; a failed scan just leaves
      // the current highlights in place and will retry on the next edit.
      setError(ERROR_MESSAGE);
    }
  }

  // Load + initial scan on mount.
  useEffect(() => {
    (async () => {
      try {
        const existing = await getLocalSession(todayDate());
        const noteText = existing?.notes ?? '';
        setText(noteText);
        if (noteText) await runScan(noteText);
      } catch {
        setError(ERROR_MESSAGE);
      }
    })();
    return () => {
      if (persistTimer.current) clearTimeout(persistTimer.current);
      if (scanTimer.current) clearTimeout(scanTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleChangeText(next: string) {
    setText(next);

    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      // Fast path: never lose the raw note text, even if scanning lags/fails.
      persist(next, entriesRef.current).then(
        () => setError(null),
        () => setError(ERROR_MESSAGE),
      );
    }, PERSIST_DELAY_MS);

    if (scanTimer.current) clearTimeout(scanTimer.current);
    scanTimer.current = setTimeout(() => {
      void runScan(next);
    }, SCAN_DELAY_MS);
  }

  async function handleConfirm(entry: ScannedEntry) {
    setPopoverId(null);
    try {
      const exercise = await api.createExercise({
        name: entry.exerciseName!,
        muscles: entry.muscles ?? [],
      });
      await api.createAbbreviation({ token: entry.unresolvedToken!, exerciseId: exercise.id });
      const updated = entriesRef.current.map((e) =>
        e.id === entry.id
          ? { ...e, status: 'resolved' as const, exerciseId: exercise.id }
          : e,
      );
      applyEntries(updated);
      await persist(text, updated);
      setError(null);
    } catch {
      setError(ERROR_MESSAGE);
    }
  }

  const spans: HighlightSpan[] = entries
    .filter((e) => e.spanStart != null && e.spanEnd != null)
    .map((e) => ({
      start: e.spanStart as number,
      end: e.spanEnd as number,
      status: e.status,
      entryId: e.id,
    }));

  const popoverEntry = entries.find((e) => e.id === popoverId) ?? null;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <NotesEditor
        value={text}
        onChangeText={handleChangeText}
        spans={spans}
        onSpanPress={setPopoverId}
        placeholder="Start typing your workout…"
      />
      <Modal visible={popoverEntry != null} transparent animationType="fade" onRequestClose={() => setPopoverId(null)}>
        <Pressable style={styles.backdrop} onPress={() => setPopoverId(null)}>
          <View style={styles.popoverWrap}>
            {popoverEntry ? (
              <EntryPopover entry={popoverEntry} onConfirm={handleConfirm} onClose={() => setPopoverId(null)} />
            ) : null}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.paper },
  error: { color: colors.brick, paddingHorizontal: spacing.s4, paddingTop: spacing.s2 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.2)', justifyContent: 'center', padding: spacing.s5 },
  popoverWrap: { alignSelf: 'stretch' },
});
```

- [ ] **Step 2: Rewrite the core log test**

```tsx
// __tests__/app/log.test.tsx
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
  mockResolveLine.mockReset().mockResolvedValue({
    resolvedTokens: [{ token: 'RDL', type: 'exercise', exerciseId: 'ex-1' }],
    unresolvedTokens: [],
  });
  (useAuth as jest.Mock).mockReturnValue({ api: { resolveLine: mockResolveLine } });
});

describe('LogScreen (notes-style)', () => {
  it('highlights a recognized set after the debounced scan and persists it', async () => {
    await render(<LogScreen />);
    const input = screen.getByPlaceholderText('Start typing your workout…');

    await fireEvent.changeText(input, 'Warmup, then RDL 40kg 8x3');

    await waitFor(
      () => {
        expect(screen.getByText('then RDL 40kg 8x3')).toBeTruthy();
      },
      { timeout: 3000 },
    );

    const session = await getLocalSession(todayDate());
    expect(session?.notes).toBe('Warmup, then RDL 40kg 8x3');
    expect(session?.entries).toHaveLength(1);
    expect(session?.entries[0].exerciseId).toBe('ex-1');
  });
});
```

- [ ] **Step 3: Run the core log test (expect fail, then pass)**

Run: `cd mobile && npm test -- app/log.test.tsx`
Expected: on a clean checkout of just the test it would fail; with the Step 1 rewrite in place it PASSES. If it fails, confirm the screen file was saved and re-run.

- [ ] **Step 4: Rewrite the offline-first regression test**

```tsx
// __tests__/app/log-offline.test.tsx
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
  it('saves the raw note text even when the background parse rejects', async () => {
    const resolveLine = jest.fn().mockRejectedValue(new Error('offline'));
    (useAuth as jest.Mock).mockReturnValue({ api: { resolveLine } });

    await render(<LogScreen />);
    const input = screen.getByPlaceholderText('Start typing your workout…');
    await fireEvent.changeText(input, 'did RDL 40kg 8x3');

    await waitFor(
      async () => {
        const session = await getLocalSession(todayDate());
        expect(session?.notes).toBe('did RDL 40kg 8x3');
      },
      { timeout: 3000 },
    );
    // The editable text is still present on screen (not dropped by the failed scan).
    expect(screen.getByDisplayValue('did RDL 40kg 8x3')).toBeTruthy();
  });
});
```

- [ ] **Step 5: Rewrite the rehydration regression test**

```tsx
// __tests__/app/log-rehydrate.test.tsx
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
  (useAuth as jest.Mock).mockReturnValue({
    api: {
      resolveLine: jest.fn().mockResolvedValue({
        resolvedTokens: [{ token: 'RDL', type: 'exercise', exerciseId: 'ex-1' }],
        unresolvedTokens: [],
      }),
    },
  });
});

describe('LogScreen rehydration', () => {
  it('shows the already-saved note text for today on mount', async () => {
    await upsertLocalSession({
      date: todayDate(),
      notes: 'did RDL 40kg 8x3',
      synced: 1,
      entries: [],
    });

    await render(<LogScreen />);

    await waitFor(
      () => {
        expect(screen.getByDisplayValue('did RDL 40kg 8x3')).toBeTruthy();
      },
      { timeout: 3000 },
    );
  });
});
```

- [ ] **Step 6: Run all three Log screen tests**

Run: `cd mobile && npm test -- app/log.test.tsx app/log-offline.test.tsx app/log-rehydrate.test.tsx`
Expected: PASS (all three files).

- [ ] **Step 7: Run the full suite + typecheck (composition check)**

Run: `cd mobile && npm test && npx tsc --noEmit`
Expected: every test file passes and there are no type errors. In particular, confirm no remaining file imports `ParsedLineRow` from the Log screen (it's retired here; History/others don't use it).

- [ ] **Step 8: Commit**

```bash
git add "mobile/app/(tabs)/index.tsx" mobile/__tests__/app/log.test.tsx mobile/__tests__/app/log-offline.test.tsx mobile/__tests__/app/log-rehydrate.test.tsx
git commit -m "feat(mobile): rewrite Log screen as iOS-Notes-style prose editor with inline set highlights"
```

- [ ] **Step 9: Manual smoke test against the live backend**

With the docker-compose backend running (`cd backend && docker compose up -d`) and Metro up (`cd mobile && npm run start:tailscale`), open the app and on the Log tab:
1. Type a paragraph mixing prose and a set (e.g. "Felt strong, did RDL 40kg 8x3, tight hamstrings"). Confirm the "did RDL 40kg 8x3" span gets a highlight after you pause typing, and the surrounding prose does not.
2. Tap the highlight → the popover shows the parsed detail; for an LLM-guessed exercise, tap Confirm and verify the highlight turns from citrine (needs-confirm) to moss (resolved).
3. Edit the weight in the highlighted phrase, pause, and confirm the highlight re-resolves; delete the whole phrase and confirm the highlight (and its logged entry) disappears.
4. Kill the app and reopen → the note text is still there.
Report the result in your final summary; do not skip this because the automated tests passed.

---

## Self-Review Notes

- **Spec coverage:** every spec section maps to a task — numeric-anchor parsing (Task 1), span-tracking data model (Task 2), debounced extract+resolve+diff orchestration with "text is source of truth" reuse-by-clause-text (Task 3), the overlay `NotesEditor` with the three highlight states and the documented plain-`TextInput` fallback (Task 4), the tap `EntryPopover` with confirm wiring (Task 5), and the full screen rewrite preserving offline-first/rehydration/confirm-loop with two-timer persistence (Task 6). History/Stats/You, the auth stack, and `syncEngine` are untouched, matching the spec's out-of-scope list.
- **Placeholder scan:** no TBDs; every code step is complete and runnable. The one deliberately-flagged risk (overlay alignment on-device) is disclosed in Task 4 with a concrete, interface-preserving fallback, not glossed over.
- **Type consistency:** `Candidate` (Task 1) → consumed by `scanNote` (Task 3); `LocalSetEntry.spanStart/spanEnd` (Task 2) → written by `scanNote` and the screen; `ScannedEntry` (Task 3) → consumed by `NotesEditor`'s `HighlightSpan` mapping, `EntryPopover`, and the screen; `HighlightSpan` (Task 4) built from `ScannedEntry` in Task 6. `scanNote(api, text, previous)` is called with the same argument order everywhere. Only `resolved`/`needs-confirm` statuses ever reach the UI, so `HighlightSpan.status` and `EntryPopover` never need to handle `pending`/`unresolved`.
- **Offline-first invariant:** the fast (300ms) persist timer writes note text independent of the slower (700ms) scan, and `runScan`/`handleChangeText` both keep text on screen and in SQLite even when `resolveLine` rejects — verified by the rewritten `log-offline` test.
