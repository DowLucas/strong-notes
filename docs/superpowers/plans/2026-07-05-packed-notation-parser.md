# Packed-Notation Workout Parser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Teach the Log-screen parser to understand real, dense workout shorthand — packed `40kgx8x2` (weight×reps×sets) tokens, several set-groups per line, `bar` loads, and indented `⁃` continuation lines that inherit the exercise from the line above — while keeping the existing clean shorthand (`RDL 40kg 8x3`) and prose ("did Bench Press 60kg 8x3") working.

**Architecture:** A new pure tokenizer `parseSetGroups(line)` splits a single line into an exercise-name prefix and a list of `SetGroup`s (each a weight/reps/sets triple with its own character offsets). `scanNote` is reworked from clause-based to **line-based**: for each line it resolves the name prefix ONCE through the existing dictionary→LLM pipeline (`parseQuickEntryLine`) and emits **one entry per set-group**, all sharing that resolved exercise; a line with no name prefix (a `⁃` continuation) inherits the previous line's resolved exercise. Each entry's highlight span is its own packed token, so a multi-set line highlights each group. The existing offline-first persistence, `EntryPopover` confirm-loop, and `NotesEditor` overlay are unchanged.

**Tech Stack:** Expo SDK ~54, TypeScript, jest-expo + `@testing-library/react-native`. No new dependencies.

## Global Constraints

- All paths are relative to `mobile/`.
- **Decision 1 — one entry per weight-group.** `BB RDL 40kgx8 50kgx8x4 40kgx8x3` produces three entries under the same exercise: `(40kg, 8 reps, 1 set)`, `(50kg, 8 reps, 4 sets)`, `(40kg, 8 reps, 3 sets)`. `x<reps>` with no `x<sets>` means sets = 1.
- **Decision 2 — continuation lines inherit.** A line whose set-groups are not preceded by any exercise-name words (it starts with a `⁃`/`-`/`•` bullet and/or leading whitespace, e.g. `⁃  50kgx8 60kgx6 70kgx4`) inherits the exercise resolved from the most recent preceding line that had a name. If there is no such preceding exercise, its groups are left unhighlighted.
- **Decision 3 — learn on confirm, not automatically.** Unknown/personal shorthand resolves via the existing dictionary→LLM path: an LLM guess is `needs-confirm` (amber) and is only saved to the dictionary when the user taps Confirm (existing flow, unchanged). Never auto-add.
- `bar` (the empty barbell) parses to `weightKg: null` (unknown load), reps/sets as written. Do not invent a kg value for it.
- Preserve existing behavior and tests: clean space-separated shorthand (`RDL 40kg 8x3` → weight 40, reps 8, sets 3) and single-set prose lines must still resolve exactly as before.
- Offline-first is unchanged: note text is always persisted before any network call; a set-group whose name can't be resolved (offline / LLM down) is simply left unhighlighted, never an error banner (this was fixed in `scanNote` already — do not regress it).
- Out of scope for this version (leave unhighlighted / best-effort, do NOT attempt): supersets/circuits (`CC RDL16b-SSq16-BSS8-🦀 x8x2`), per-side `(b)` and `(+4)` annotations, rep ranges (`x6-8`), `|`-separated multi-exercise lines, cardio lines (`Elliptical 5min`, `20/20/20`), and section headers/dates (these already produce nothing and must continue to).

## Ambiguity rule (critical)

A bare `A x B` token (no unit, e.g. `43x4` or `8x3`) is ambiguous: it is **weight×reps** in packed notation but **reps×sets** in clean notation. Disambiguate per line:

- A line is **PACKED** if it contains at least one token with a unit glued to an `x` chain — matching `/(?:\d+(?:\.\d+)?(?:kg|lb)|bar)x\d/i` (e.g. `40kgx8`, `barx12`).
- In a PACKED line, every group token is read as `weight [x reps [x sets]]`, so a bare `43x4` = `(weight 43, reps 4, sets 1)`.
- In a non-PACKED (clean/prose) line, the old reading holds: a standalone `40kg` is the weight and a bare `8x3` is `reps×sets`, producing a single group for the line.

## File Structure

```
mobile/
  src/parsing/
    parseSetGroups.ts        # NEW: pure line tokenizer (name prefix + SetGroup[])
    scanNote.ts              # REWORK: line-based, multi-group, continuation-inheriting
    quickEntry.ts            # UNCHANGED (name resolution reused via parseQuickEntryLine)
    extractCandidates.ts     # UNCHANGED file; no longer used by scanNote (kept, tests stay green)
  __tests__/parsing/
    parseSetGroups.test.ts   # NEW
    scanNote.test.ts         # EXTEND with packed / multi-group / continuation cases
  app/(tabs)/index.tsx       # UNCHANGED (already maps entries→spans; multi-span-per-line already works)
```

---

### Task 1: `parseSetGroups` — the packed/clean line tokenizer

**Files:**
- Create: `src/parsing/parseSetGroups.ts`
- Test: `__tests__/parsing/parseSetGroups.test.ts`

**Interfaces:**
- Consumes: nothing (pure string logic).
- Produces:
  ```ts
  export type SetGroup = {
    weightKg: number | null; // null for `bar` or a unit-less weight that is actually reps-only
    reps: number | null;
    sets: number;            // defaults to 1 when the token has no x<sets> part
    token: string;           // the exact matched substring
    start: number;           // char offset of `token` within the line
    end: number;
  };
  export type ParsedWorkoutLine = {
    namePart: string;        // exercise-name text before the first group ('' for a continuation line)
    groups: SetGroup[];      // in left-to-right order; [] when the line has no set tokens
  };
  export function parseSetGroups(line: string): ParsedWorkoutLine;
  ```
  `namePart` is the trimmed run of text from the start of the line to the first group token, with any leading bullet (`⁃`, `-`, `•`) and surrounding whitespace stripped. When that run is empty, the line is a continuation. Task 2 depends on these exact names/types.

- [ ] **Step 1: Write the failing tests**

```ts
// __tests__/parsing/parseSetGroups.test.ts
import { parseSetGroups } from '@/src/parsing/parseSetGroups';

describe('parseSetGroups — packed notation', () => {
  it('parses a single packed weight×reps×sets token', () => {
    const r = parseSetGroups('BB RDL 40kgx8x2');
    expect(r.namePart).toBe('BB RDL');
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0]).toMatchObject({ weightKg: 40, reps: 8, sets: 2, token: '40kgx8x2' });
  });

  it('defaults sets to 1 when there is no x<sets> part', () => {
    const r = parseSetGroups('BB RDL 40kgx8');
    expect(r.groups[0]).toMatchObject({ weightKg: 40, reps: 8, sets: 1 });
  });

  it('emits one group per packed token, sharing the name', () => {
    const r = parseSetGroups('BB RDL 40kgx8 50kgx8x4 40kgx8x3');
    expect(r.namePart).toBe('BB RDL');
    expect(r.groups.map((g) => [g.weightKg, g.reps, g.sets])).toEqual([
      [40, 8, 1],
      [50, 8, 4],
      [40, 8, 3],
    ]);
  });

  it('treats `bar` as an unknown (null) load', () => {
    const r = parseSetGroups('BB P Sq barx12x2');
    expect(r.namePart).toBe('BB P Sq');
    expect(r.groups[0]).toMatchObject({ weightKg: null, reps: 12, sets: 2 });
  });

  it('handles decimal weights', () => {
    const r = parseSetGroups('C row 23.5kgx6x2');
    expect(r.groups[0]).toMatchObject({ weightKg: 23.5, reps: 6, sets: 2 });
  });

  it('reads a bare A×B token as weight×reps inside a packed line', () => {
    // "43x4" follows a unit-bearing packed token, so the line is PACKED.
    const r = parseSetGroups('40kgx6x2 43x4');
    expect(r.groups.map((g) => [g.weightKg, g.reps, g.sets])).toEqual([
      [40, 6, 2],
      [43, 4, 1],
    ]);
  });

  it('records correct character offsets for each group token', () => {
    const line = 'BB RDL 40kgx8 50kgx8x4';
    const r = parseSetGroups(line);
    expect(line.slice(r.groups[0].start, r.groups[0].end)).toBe('40kgx8');
    expect(line.slice(r.groups[1].start, r.groups[1].end)).toBe('50kgx8x4');
  });
});

describe('parseSetGroups — continuation lines', () => {
  it('reports an empty namePart for a bulleted continuation line', () => {
    const r = parseSetGroups('    ⁃    50kgx8 60kgx6 70kgx4');
    expect(r.namePart).toBe('');
    expect(r.groups.map((g) => [g.weightKg, g.reps, g.sets])).toEqual([
      [50, 8, 1],
      [60, 6, 1],
      [70, 4, 1],
    ]);
  });
});

describe('parseSetGroups — clean/prose notation (unchanged behavior)', () => {
  it('reads a standalone weight + bare reps×sets as one group', () => {
    const r = parseSetGroups('RDL 40kg 8x3');
    expect(r.namePart).toBe('RDL');
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0]).toMatchObject({ weightKg: 40, reps: 8, sets: 3 });
  });

  it('extracts the name run before the numbers in a prose line', () => {
    const r = parseSetGroups('did Bench Press 60kg 8x3');
    expect(r.namePart).toBe('did Bench Press');
    expect(r.groups[0]).toMatchObject({ weightKg: 60, reps: 8, sets: 3 });
  });

  it('returns no groups for a line with no set tokens', () => {
    expect(parseSetGroups('Felt tired, skipped legs today').groups).toEqual([]);
    expect(parseSetGroups('2022 03 03').groups).toEqual([]);
    expect(parseSetGroups('VECKA 9').groups).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd mobile && npm test -- parseSetGroups.test.ts`
Expected: FAIL — module does not exist yet.

- [ ] **Step 3: Implement `parseSetGroups`**

```ts
// src/parsing/parseSetGroups.ts

export type SetGroup = {
  weightKg: number | null;
  reps: number | null;
  sets: number;
  token: string;
  start: number;
  end: number;
};

export type ParsedWorkoutLine = {
  namePart: string;
  groups: SetGroup[];
};

// A line is "packed" when a weight-with-unit (or `bar`) is glued directly to an
// `x` chain, e.g. `40kgx8` or `barx12`. That signals the packed grammar where a
// bare `A x B` token means weight×reps rather than reps×sets.
const PACKED_LINE = /(?:\d+(?:\.\d+)?(?:kg|lb)|bar)x\d/i;

// A packed group token: <weight>[unit] x <reps> [x <sets>], where <weight> is a
// number or `bar`.
const PACKED_GROUP = /^(bar|\d+(?:\.\d+)?)(?:kg|lb)?x(\d+)(?:x(\d+))?$/i;

// Clean-notation tokens (used only for non-packed lines).
const WEIGHT_ONLY = /^(\d+(?:\.\d+)?)(?:kg|lb)?$/i;
const REPS_SETS = /^(\d+)x(\d+)$/i;

// Leading list bullets to strip from a name/continuation prefix.
const LEADING_BULLET = /^[\s\-•⁃]+/;

type Token = { text: string; start: number; end: number };

function tokenize(line: string): Token[] {
  const tokens: Token[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    tokens.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  }
  return tokens;
}

function nameBefore(line: string, firstGroupStart: number): string {
  return line.slice(0, firstGroupStart).replace(LEADING_BULLET, '').trim();
}

function parsePackedToken(t: Token): SetGroup | null {
  const m = t.text.match(PACKED_GROUP);
  if (!m) return null;
  const weightKg = /^bar$/i.test(m[1]) ? null : Number(m[1]);
  return {
    weightKg,
    reps: Number(m[2]),
    sets: m[3] ? Number(m[3]) : 1,
    token: t.text,
    start: t.start,
    end: t.end,
  };
}

function parsePacked(line: string, tokens: Token[]): ParsedWorkoutLine {
  const groups: SetGroup[] = [];
  for (const t of tokens) {
    const g = parsePackedToken(t);
    if (g) groups.push(g);
  }
  if (groups.length === 0) return { namePart: '', groups: [] };
  return { namePart: nameBefore(line, groups[0].start), groups };
}

function parseClean(line: string, tokens: Token[]): ParsedWorkoutLine {
  let weight: number | null = null;
  let repsSets: Token | null = null;
  let weightToken: Token | null = null;

  for (const t of tokens) {
    const rs = t.text.match(REPS_SETS);
    if (rs) {
      repsSets = t;
      continue;
    }
    const w = t.text.match(WEIGHT_ONLY);
    if (w) {
      weight = Number(w[1]);
      weightToken = t;
    }
  }

  if (!repsSets && !weightToken) return { namePart: '', groups: [] };

  const first = [repsSets, weightToken]
    .filter((t): t is Token => t != null)
    .sort((a, b) => a.start - b.start)[0];
  const last = [repsSets, weightToken]
    .filter((t): t is Token => t != null)
    .sort((a, b) => a.end - b.end)
    .slice(-1)[0];

  const rsMatch = repsSets?.text.match(REPS_SETS);
  const group: SetGroup = {
    weightKg: weight,
    reps: rsMatch ? Number(rsMatch[1]) : null,
    sets: rsMatch ? Number(rsMatch[2]) : 1,
    token: line.slice(first.start, last.end),
    start: first.start,
    end: last.end,
  };
  return { namePart: nameBefore(line, first.start), groups: [group] };
}

export function parseSetGroups(line: string): ParsedWorkoutLine {
  const tokens = tokenize(line);
  if (tokens.length === 0) return { namePart: '', groups: [] };
  return PACKED_LINE.test(line) ? parsePacked(line, tokens) : parseClean(line, tokens);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd mobile && npm test -- parseSetGroups.test.ts`
Expected: PASS (all cases)

- [ ] **Step 5: Commit**

```bash
git add mobile/src/parsing/parseSetGroups.ts mobile/__tests__/parsing/parseSetGroups.test.ts
git commit -m "feat(mobile): add parseSetGroups tokenizer for packed workout notation"
```

---

### Task 2: Rework `scanNote` to line-based multi-group parsing with continuation inheritance

**Files:**
- Modify: `src/parsing/scanNote.ts`
- Test: `__tests__/parsing/scanNote.test.ts` (extend; keep existing cases green)

**Interfaces:**
- Consumes: `parseSetGroups`/`SetGroup` (Task 1), `parseQuickEntryLine`/`ParsedLine` (`quickEntry.ts`, unchanged — used to resolve just the name prefix), `LocalSetEntry` (`sessionsRepo.ts`), `ApiClient`/`MuscleGroup` (`@/lib/api`).
- Produces: same `ScannedEntry` type and `scanNote(api, text, previous)` signature as today (unchanged public surface). Internally it now iterates lines, resolves each name prefix once, emits one `ScannedEntry` per set-group with the group token's absolute offsets as `spanStart`/`spanEnd`, and threads the last resolved exercise into `⁃` continuation lines. Reuse-by-`rawText` (stable ids / no re-resolve for unchanged tokens) is preserved. Task 3 (the screen) consumes this unchanged.

- [ ] **Step 1: Extend the tests (keep the existing four cases as-is, add these)**

Add these cases inside the existing `describe('scanNote', ...)` block in `__tests__/parsing/scanNote.test.ts`:

```ts
  it('emits one entry per packed set-group, sharing the resolved exercise', async () => {
    const api = fakeApi({
      resolveLine: jest.fn().mockResolvedValue({
        resolvedTokens: [{ token: 'RDL', type: 'exercise', exerciseId: 'ex-1' }],
        unresolvedTokens: [],
      }),
    });
    const entries = await scanNote(api, 'BB RDL 40kgx8 50kgx8x4 40kgx8x3', []);

    expect(entries).toHaveLength(3);
    expect(entries.every((e) => e.exerciseId === 'ex-1')).toBe(true);
    expect(entries.map((e) => [e.weightKg, e.reps, e.sets])).toEqual([
      [40, 8, 1],
      [50, 8, 4],
      [40, 8, 3],
    ]);
    // Name resolved once, not once per group.
    expect((api.resolveLine as jest.Mock).mock.calls).toHaveLength(1);
  });

  it('spans each group token individually within the line', async () => {
    const api = fakeApi({
      resolveLine: jest.fn().mockResolvedValue({
        resolvedTokens: [{ token: 'RDL', type: 'exercise', exerciseId: 'ex-1' }],
        unresolvedTokens: [],
      }),
    });
    const text = 'BB RDL 40kgx8 50kgx8x4';
    const entries = await scanNote(api, text, []);
    expect(text.slice(entries[0].spanStart!, entries[0].spanEnd!)).toBe('40kgx8');
    expect(text.slice(entries[1].spanStart!, entries[1].spanEnd!)).toBe('50kgx8x4');
  });

  it('inherits the exercise from the previous line into a ⁃ continuation line', async () => {
    const api = fakeApi({
      resolveLine: jest.fn().mockResolvedValue({
        resolvedTokens: [{ token: 'Squat', type: 'exercise', exerciseId: 'ex-sq' }],
        unresolvedTokens: [],
      }),
    });
    const text = 'BB Squat barx12x2\n    ⁃    50kgx8 60kgx6';
    const entries = await scanNote(api, text, []);

    // 2 groups on line 1 (barx12x2 -> 1 group) + 2 on the continuation = 3.
    expect(entries).toHaveLength(3);
    expect(entries.every((e) => e.exerciseId === 'ex-sq')).toBe(true);
    // The name is resolved once and reused for the continuation line.
    expect((api.resolveLine as jest.Mock).mock.calls).toHaveLength(1);
  });

  it('leaves a continuation line unhighlighted when no preceding exercise exists', async () => {
    const api = fakeApi({ resolveLine: jest.fn() });
    const entries = await scanNote(api, '    ⁃    50kgx8 60kgx6', []);
    expect(entries).toEqual([]);
    expect((api.resolveLine as jest.Mock).mock.calls).toHaveLength(0);
  });
```

- [ ] **Step 2: Run tests to verify the new cases fail**

Run: `cd mobile && npm test -- scanNote.test.ts`
Expected: the four original cases still pass; the new cases FAIL (current scanNote is clause/single-group based).

- [ ] **Step 3: Reimplement `scanNote`**

Replace the entire contents of `src/parsing/scanNote.ts` with:

```ts
// src/parsing/scanNote.ts
import type { ApiClient, MuscleGroup } from '@/lib/api';
import type { LocalSetEntry } from '../db/sessionsRepo';
import { parseSetGroups, type SetGroup } from './parseSetGroups';
import { parseQuickEntryLine, type ParsedLine } from './quickEntry';

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

// The subset of a resolved name we carry onto each of its set-groups.
type NameResolution = Pick<
  ParsedLine,
  'status' | 'exerciseId' | 'equipment' | 'parsedBy' | 'exerciseName' | 'muscles' | 'unresolvedToken'
>;

function buildEntry(
  group: SetGroup,
  lineStart: number,
  name: NameResolution,
  order: number,
  reuseId?: string,
): ScannedEntry {
  return {
    id: reuseId ?? makeEntryId(),
    exerciseId: name.exerciseId ?? null,
    equipment: name.equipment ?? null,
    weightKg: group.weightKg,
    reps: group.reps,
    sets: group.sets,
    rawText: group.token,
    parsedBy: name.parsedBy,
    order,
    synced: 0,
    spanStart: lineStart + group.start,
    spanEnd: lineStart + group.end,
    status: name.status === 'needs-confirm' ? 'needs-confirm' : 'resolved',
    exerciseName: name.exerciseName,
    muscles: name.muscles,
    unresolvedToken: name.unresolvedToken,
  };
}

export async function scanNote(
  api: ApiClient,
  text: string,
  previous: ScannedEntry[],
): Promise<ScannedEntry[]> {
  const prevByText = new Map(previous.map((e) => [e.rawText, e]));
  const result: ScannedEntry[] = [];

  // Resolve each distinct name prefix once per scan.
  const nameCache = new Map<string, NameResolution | null>();
  // The last successfully-resolved exercise, for ⁃ continuation lines.
  let lastName: NameResolution | null = null;

  let lineStart = 0;
  const lines = text.split('\n');
  for (let li = 0; li < lines.length; li += 1) {
    const line = lines[li];
    const { namePart, groups } = parseSetGroups(line);

    if (groups.length > 0) {
      let name: NameResolution | null;
      if (namePart === '') {
        // Continuation line — inherit the previous line's exercise.
        name = lastName;
      } else if (nameCache.has(namePart)) {
        name = nameCache.get(namePart) ?? null;
      } else {
        try {
          const parsed = await parseQuickEntryLine(api, namePart);
          name =
            parsed.status === 'resolved' || parsed.status === 'needs-confirm' ? parsed : null;
        } catch {
          name = null; // offline / LLM down — leave this line's groups unhighlighted
        }
        nameCache.set(namePart, name);
        if (name) lastName = name;
      }

      if (name) {
        for (const group of groups) {
          const reuse = prevByText.get(group.token);
          result.push(buildEntry(group, lineStart, name, result.length, reuse?.id));
        }
      }
    }

    lineStart += line.length + 1; // +1 for the '\n' consumed by split
  }

  return result;
}
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `cd mobile && npm test -- scanNote.test.ts`
Expected: PASS — the four original cases plus the four new packed/continuation cases (8 total).

- [ ] **Step 5: Commit**

```bash
git add mobile/src/parsing/scanNote.ts mobile/__tests__/parsing/scanNote.test.ts
git commit -m "feat(mobile): line-based scanNote with packed multi-group + continuation inheritance"
```

---

### Task 3: Regression sweep + screen verification

**Files:**
- Possibly modify: `__tests__/app/log.test.tsx` (only if a wording/offset assertion needs updating — see below)
- No source changes expected in `app/(tabs)/index.tsx` (it already maps `entries → HighlightSpan[]` and renders many spans per line).

**Interfaces:**
- Consumes: everything from Tasks 1-2.
- Produces: a green full suite and a manually-verified screen.

- [ ] **Step 1: Run the full suite**

Run: `cd mobile && npm test`
Expected: all suites pass. The Log-screen test `log.test.tsx` types `'Warmup, then RDL 40kg 8x3'` and asserts the highlighted span text is `'then RDL 40kg 8x3'`. Under the new line-based parser this line is non-packed (no glued unit), so `parseSetGroups` returns `namePart: 'Warmup, then RDL'` and one group whose token spans `'40kg 8x3'` — the highlighted span is now `'40kg 8x3'`, NOT `'then RDL 40kg 8x3'`.

- [ ] **Step 2: If `log.test.tsx` fails on that span assertion, update it**

Change the assertion in `mobile/__tests__/app/log.test.tsx` from:

```ts
      expect(screen.getByText('then RDL 40kg 8x3')).toBeTruthy();
```

to:

```ts
      expect(screen.getByText('40kg 8x3')).toBeTruthy();
```

Leave the rest of that test (the persisted-entry assertions) unchanged — it still logs one entry with `exerciseId 'ex-1'`. Re-run `npm test -- app/log.test.tsx` and confirm PASS. (Do not change `log-offline.test.tsx` or `log-rehydrate.test.tsx`; they don't assert span text.)

- [ ] **Step 3: Typecheck**

Run: `cd mobile && npx tsc --noEmit`
Expected: clean (exit 0). If `extractCandidates` is now unused by source but still imported anywhere, remove the dead import; its own test file stays and keeps passing.

- [ ] **Step 4: Full suite once more**

Run: `cd mobile && npm test`
Expected: every suite passes.

- [ ] **Step 5: Commit (only if Step 2 changed a file)**

```bash
git add mobile/__tests__/app/log.test.tsx
git commit -m "test(mobile): update Log span assertion for line-based group parsing"
```

- [ ] **Step 6: Manual smoke test against the live backend**

With the docker-compose backend up (`cd backend && docker compose up -d`), Ollama serving `gemma2:2b`, and Metro running (`cd mobile && npm run start:tailscale`), on the Log tab paste a real block:

```
BB Squat barx12x2 40kgx8
    ⁃    50kgx8 60kgx6 70kgx4
BB RDL 40kgx8 50kgx8x4 40kgx8x3
```

Confirm:
1. Each packed token (`40kgx8`, `50kgx8`, etc.) highlights individually after the ~700ms scan; the exercise names and prose stay plain.
2. The `⁃` continuation line's groups highlight under the same exercise as the line above (tap one → popover shows the inherited exercise).
3. An unknown personal shorthand (`Bänk`, `As D`, `TS Axel`) turns amber (LLM guess) → tap Confirm → it saves and re-resolves green; its abbreviation now resolves instantly on the next line.
4. Kill and reopen the app → the note text is intact.

Report the result in your final summary; do not skip this because the automated tests passed.

---

## Self-Review Notes

- **Spec coverage:** packed `NkgxNxN` tokenization, `bar`→null, decimals, and the bare-`AxB` ambiguity rule live in Task 1; one-entry-per-group (Decision 1), continuation inheritance (Decision 2), and once-per-name resolution feeding the existing LLM-confirm flow (Decision 3) live in Task 2; the clean/prose path and offline-first are preserved and regression-checked in Tasks 1-3. Supersets/`(b)`/ranges/cardio are explicitly out of scope and left unhighlighted.
- **Placeholder scan:** no TBDs; every step has complete, runnable code.
- **Type consistency:** `SetGroup`/`ParsedWorkoutLine` (Task 1) are consumed by `scanNote` (Task 2); `ScannedEntry` and the `scanNote(api, text, previous)` signature are unchanged, so the screen and `EntryPopover`/`NotesEditor` need no changes. `NameResolution` is a `Pick` of the existing `ParsedLine`, so it can't drift from the resolver's shape.
- **Ambiguity guard:** the per-line PACKED detection is the single source of truth for reading bare `AxB` tokens, so clean `RDL 40kg 8x3` (non-packed → reps×sets) and packed `40kgx6x2 43x4` (weight×reps) never collide.
