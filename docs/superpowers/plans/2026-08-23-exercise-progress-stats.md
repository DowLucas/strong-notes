# Exercise Progress Stats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Stats tab with a per-exercise progress list (headline, delta, sparkline) and a pushed `/exercise/[id]` detail screen (chart with metric toggle + session history), computed from the local SQLite log.

**Architecture:** A pure metrics module (`lib/exerciseProgress.ts`) turns flat rows into `ExerciseProgress[]`; a thin repo (`src/db/statsRepo.ts`) reads rows from `set_entries ⋈ abbreviations_cache`; two screens and three small svg components render them. Nothing touches the network.

**Tech Stack:** Expo SDK 54 / React Native, expo-router, expo-sqlite (jest shim = better-sqlite3), react-native-svg 15, react-i18next, Jest + @testing-library/react-native.

**Spec:** `docs/superpowers/specs/2026-08-23-exercise-progress-stats-design.md`

## Global Constraints

- All user-facing strings go through `useTranslation()` `t('…')`; after adding keys run `npm run i18n:extract` (writes `mobile/lib/locales/en.json`) and commit the JSON.
- Colours/spacing/typography only from `mobile/lib/theme.ts` (`colors`, `spacing`, `radii`, `typography`). Delta colours: up `colors.moss`, down `colors.brick`, flat `colors.lead`.
- Headline metric is top-set weight; bodyweight exercises use best reps (`unit: 'reps'`).
- Default range `3m`; picker `1m · 3m · 6m · 1y · All`.
- Local SQLite only; entries with `exercise_id IS NULL` are excluded.
- Heatmap + goals are removed from Stats; `MuscleHeatmap` component and its test are deleted (its only user is `stats.tsx`).
- Run commands from `mobile/` unless stated. Tests: `npx jest <path>`; typecheck: `npx tsc --noEmit -p .`.
- Commit after each task with the trailer lines:
  ```
  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01DcYdmdCKf14Jte1MS7NMmi
  ```
- The working tree already contains unrelated uncommitted changes (parser/equipment/401 work). Stage **only the files named in each task** (`git add <paths>`), never `git add -A`.

---

## File structure

| File | Responsibility |
| --- | --- |
| `mobile/lib/exerciseProgress.ts` (new) | Pure: `rangeStart`, `computeExerciseProgress`, `seriesFor`, `formatHeadline`, `formatDelta`, `relativeDay` |
| `mobile/src/db/statsRepo.ts` (new) | `listStatsRows(fromDate)` — one SQL query, no math |
| `mobile/src/components/Sparkline.tsx` (new) | 80×24 svg polyline of a numeric series with gaps |
| `mobile/src/components/ProgressChart.tsx` (new) | Full-width svg line chart: y ticks, month x labels, points, gaps |
| `mobile/src/components/ExerciseRow.tsx` (new) | One list row: name, headline, delta, sub-line, sparkline |
| `mobile/app/(tabs)/stats.tsx` (rewrite) | Range chips + FlatList of rows + empty state; navigates to detail |
| `mobile/app/exercise/[id].tsx` (new) | Detail: header, chart, metric toggle, range chips, session list |
| `mobile/app/_layout.tsx` (modify) | Register `exercise/[id]` stack screen |
| `mobile/src/components/EntryPopover.tsx` (modify) | "View progress ›" for resolved entries |
| `mobile/src/components/MuscleHeatmap.tsx` + `__tests__/components/MuscleHeatmap.test.tsx` | Delete |
| Tests | `__tests__/exerciseProgress.test.ts`, `__tests__/db/statsRepo.test.ts`, `__tests__/components/{Sparkline,ProgressChart,ExerciseRow}.test.tsx`, `__tests__/app/stats.test.tsx` (rewrite), `__tests__/app/exercise-detail.test.tsx`, `__tests__/components/EntryPopover.test.tsx` (extend) |

---

### Task 1: Pure metrics — `lib/exerciseProgress.ts`

**Files:**
- Create: `mobile/lib/exerciseProgress.ts`
- Test: `mobile/__tests__/exerciseProgress.test.ts`

**Interfaces:**
- Consumes: nothing (pure).
- Produces (used by every later task):
  ```ts
  export type StatsRow = { exerciseId: string; exerciseName: string | null; sessionDate: string; weightKg: number | null; reps: number | null; sets: number | null; entryOrder: number };
  export type SetLine = { weightKg: number | null; reps: number | null; sets: number | null };
  export type SessionPoint = { date: string; topWeightKg: number | null; topReps: number; est1rm: number | null; volume: number; sets: SetLine[] };
  export type Metric = 'topSet' | 'est1rm' | 'volume';
  export type Unit = 'kg' | 'reps';
  export type Range = '1m' | '3m' | '6m' | '1y' | 'all';
  export const RANGES: Range[];
  export type ExerciseProgress = { exerciseId: string; name: string | null; unit: Unit; points: SessionPoint[]; headline: { value: number; unit: Unit }; delta: { value: number; unit: Unit } | null; lastDate: string; sessionCount: number };
  export function rangeStart(range: Range, today: string): string | null;
  export function computeExerciseProgress(rows: StatsRow[]): ExerciseProgress[];
  export function seriesFor(p: ExerciseProgress, metric: Metric): { date: string; value: number | null }[];
  export function isPr(p: ExerciseProgress, index: number): boolean;
  export function formatHeadline(h: { value: number; unit: Unit }): string;   // "100kg" | "22.5kg" | "×12"
  export function formatDelta(d: { value: number; unit: Unit } | null): string; // "▲ +10" | "▼ −5" | "▲ +3 reps" | "─"
  export function relativeDay(date: string, today: string): string;           // 'today' | 'yesterday' | 'Thu' | '2w ago' | '12 Jun'
  ```
  `name` is `null` when unknown — the UI substitutes `t('stats.unnamedExercise')`.

- [ ] **Step 1: Write the failing tests**

```ts
// mobile/__tests__/exerciseProgress.test.ts
import {
  computeExerciseProgress, rangeStart, seriesFor, isPr,
  formatHeadline, formatDelta, relativeDay, type StatsRow,
} from '@/lib/exerciseProgress';

function row(p: Partial<StatsRow> & { sessionDate: string }): StatsRow {
  return { exerciseId: 'ex-dl', exerciseName: 'Barbell Deadlift', weightKg: 100, reps: 5, sets: 3, entryOrder: 0, ...p };
}

describe('rangeStart', () => {
  it('returns null for all', () => expect(rangeStart('all', '2026-08-23')).toBeNull());
  it('subtracts calendar months', () => {
    expect(rangeStart('1m', '2026-08-23')).toBe('2026-07-23');
    expect(rangeStart('3m', '2026-08-23')).toBe('2026-05-23');
    expect(rangeStart('6m', '2026-08-23')).toBe('2026-02-23');
    expect(rangeStart('1y', '2026-08-23')).toBe('2025-08-23');
  });
  it('clamps to the last day of a shorter month', () => {
    expect(rangeStart('3m', '2026-05-31')).toBe('2026-02-28');
    expect(rangeStart('1m', '2024-03-31')).toBe('2024-02-29');
  });
});

describe('computeExerciseProgress', () => {
  it('picks the heaviest set as top set, breaking ties by reps', () => {
    const [p] = computeExerciseProgress([
      row({ sessionDate: '2026-08-01', weightKg: 100, reps: 5, entryOrder: 0 }),
      row({ sessionDate: '2026-08-01', weightKg: 100, reps: 8, entryOrder: 1 }),
      row({ sessionDate: '2026-08-01', weightKg: 90, reps: 10, entryOrder: 2 }),
    ]);
    expect(p.points).toHaveLength(1);
    expect(p.points[0]).toMatchObject({ topWeightKg: 100, topReps: 8 });
    expect(p.points[0].sets).toEqual([
      { weightKg: 100, reps: 5, sets: 3 }, { weightKg: 100, reps: 8, sets: 3 }, { weightKg: 90, reps: 10, sets: 3 },
    ]);
  });

  it('computes est1rm (Epley) and volume', () => {
    const [p] = computeExerciseProgress([
      row({ sessionDate: '2026-08-01', weightKg: 100, reps: 6, sets: 3 }),
      row({ sessionDate: '2026-08-01', weightKg: 80, reps: 8, sets: 2, entryOrder: 1 }),
    ]);
    expect(p.points[0].est1rm).toBeCloseTo(100 * (1 + 6 / 30));
    expect(p.points[0].volume).toBe(100 * 6 * 3 + 80 * 8 * 2);
  });

  it('uses best reps for bodyweight exercises', () => {
    const [p] = computeExerciseProgress([
      row({ exerciseId: 'ex-pu', exerciseName: 'Pull ups', sessionDate: '2026-08-01', weightKg: null, reps: 8 }),
      row({ exerciseId: 'ex-pu', exerciseName: 'Pull ups', sessionDate: '2026-08-01', weightKg: null, reps: 10, entryOrder: 1 }),
      row({ exerciseId: 'ex-pu', exerciseName: 'Pull ups', sessionDate: '2026-08-08', weightKg: null, reps: 12 }),
    ]);
    expect(p.unit).toBe('reps');
    expect(p.points.map((x) => x.topReps)).toEqual([10, 12]);
    expect(p.points[0].est1rm).toBeNull();
    expect(p.headline).toEqual({ value: 12, unit: 'reps' });
    expect(p.delta).toEqual({ value: 2, unit: 'reps' });
  });

  it('keeps kg unit when only some sessions are weightless, plotting them as gaps', () => {
    const [p] = computeExerciseProgress([
      row({ sessionDate: '2026-08-01', weightKg: 60 }),
      row({ sessionDate: '2026-08-08', weightKg: null, reps: 12 }),
      row({ sessionDate: '2026-08-15', weightKg: 65 }),
    ]);
    expect(p.unit).toBe('kg');
    expect(seriesFor(p, 'topSet').map((s) => s.value)).toEqual([60, null, 65]);
  });

  it('delta is kg vs the first point; equal weight with more reps becomes a reps delta; single point has none', () => {
    const [kg] = computeExerciseProgress([
      row({ sessionDate: '2026-06-01', weightKg: 90 }), row({ sessionDate: '2026-08-01', weightKg: 100 }),
    ]);
    expect(kg.headline).toEqual({ value: 100, unit: 'kg' });
    expect(kg.delta).toEqual({ value: 10, unit: 'kg' });

    const [reps] = computeExerciseProgress([
      row({ sessionDate: '2026-06-01', weightKg: 100, reps: 5 }), row({ sessionDate: '2026-08-01', weightKg: 100, reps: 8 }),
    ]);
    expect(reps.delta).toEqual({ value: 3, unit: 'reps' });

    const [single] = computeExerciseProgress([row({ sessionDate: '2026-08-01' })]);
    expect(single.delta).toBeNull();
  });

  it('groups by exercise, sorts exercises by last date desc and points ascending, and counts sessions', () => {
    const list = computeExerciseProgress([
      row({ exerciseId: 'a', exerciseName: 'A', sessionDate: '2026-08-10' }),
      row({ exerciseId: 'b', exerciseName: 'B', sessionDate: '2026-08-20' }),
      row({ exerciseId: 'a', exerciseName: 'A', sessionDate: '2026-08-01' }),
    ]);
    expect(list.map((p) => p.exerciseId)).toEqual(['b', 'a']);
    expect(list[1].points.map((x) => x.date)).toEqual(['2026-08-01', '2026-08-10']);
    expect(list[1]).toMatchObject({ lastDate: '2026-08-10', sessionCount: 2, name: 'A' });
  });

  it('reports a null name when the cache has none', () => {
    const [p] = computeExerciseProgress([row({ sessionDate: '2026-08-01', exerciseName: null })]);
    expect(p.name).toBeNull();
  });
});

describe('seriesFor / isPr', () => {
  const [p] = computeExerciseProgress([
    row({ sessionDate: '2026-06-01', weightKg: 90, reps: 5, sets: 3 }),
    row({ sessionDate: '2026-07-01', weightKg: 95, reps: 5, sets: 3 }),
    row({ sessionDate: '2026-08-01', weightKg: 95, reps: 5, sets: 3 }),
    row({ sessionDate: '2026-08-15', weightKg: 100, reps: 3, sets: 3 }),
  ]);
  it('returns each metric as a dated series', () => {
    expect(seriesFor(p, 'topSet').map((s) => s.value)).toEqual([90, 95, 95, 100]);
    expect(seriesFor(p, 'volume').map((s) => s.value)).toEqual([1350, 1425, 1425, 900]);
    expect(seriesFor(p, 'est1rm')[0].value).toBeCloseTo(105);
  });
  it('marks a point as PR when its top weight beats every earlier point', () => {
    expect([0, 1, 2, 3].map((i) => isPr(p, i))).toEqual([false, true, false, true]);
  });
});

describe('formatting', () => {
  it('formats headlines', () => {
    expect(formatHeadline({ value: 100, unit: 'kg' })).toBe('100kg');
    expect(formatHeadline({ value: 22.5, unit: 'kg' })).toBe('22.5kg');
    expect(formatHeadline({ value: 12, unit: 'reps' })).toBe('×12');
  });
  it('formats deltas', () => {
    expect(formatDelta({ value: 10, unit: 'kg' })).toBe('▲ +10');
    expect(formatDelta({ value: -5, unit: 'kg' })).toBe('▼ −5');
    expect(formatDelta({ value: 3, unit: 'reps' })).toBe('▲ +3 reps');
    expect(formatDelta({ value: 0, unit: 'kg' })).toBe('─');
    expect(formatDelta(null)).toBe('─');
  });
  it('formats relative days', () => {
    const today = '2026-08-23'; // a Sunday
    expect(relativeDay('2026-08-23', today)).toBe('today');
    expect(relativeDay('2026-08-22', today)).toBe('yesterday');
    expect(relativeDay('2026-08-20', today)).toBe('Thu');
    expect(relativeDay('2026-08-09', today)).toBe('2w ago');
    expect(relativeDay('2026-06-12', today)).toBe('12 Jun');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd mobile && npx jest __tests__/exerciseProgress.test.ts`
Expected: FAIL — `Cannot find module '@/lib/exerciseProgress'`.

- [ ] **Step 3: Implement**

```ts
// mobile/lib/exerciseProgress.ts
// Pure per-exercise progress metrics for the Stats tab. No I/O: rows come
// from src/db/statsRepo.ts and everything here is deterministic.

export type StatsRow = {
  exerciseId: string;
  exerciseName: string | null;
  sessionDate: string; // YYYY-MM-DD
  weightKg: number | null;
  reps: number | null;
  sets: number | null;
  entryOrder: number;
};

export type SetLine = { weightKg: number | null; reps: number | null; sets: number | null };

export type SessionPoint = {
  date: string;
  /** Heaviest weight of the session; ties broken by more reps. Null = bodyweight session. */
  topWeightKg: number | null;
  /** Reps of the top set (or best reps when bodyweight). */
  topReps: number;
  /** Epley on the top set; null when bodyweight. */
  est1rm: number | null;
  /** Σ weight×reps×sets; weightless sets contribute 0. */
  volume: number;
  sets: SetLine[];
};

export type Metric = 'topSet' | 'est1rm' | 'volume';
export type Unit = 'kg' | 'reps';
export type Range = '1m' | '3m' | '6m' | '1y' | 'all';
export const RANGES: Range[] = ['1m', '3m', '6m', '1y', 'all'];

export type ExerciseProgress = {
  exerciseId: string;
  name: string | null;
  unit: Unit;
  points: SessionPoint[];
  headline: { value: number; unit: Unit };
  delta: { value: number; unit: Unit } | null;
  lastDate: string;
  sessionCount: number;
};

const RANGE_MONTHS: Record<Exclude<Range, 'all'>, number> = { '1m': 1, '3m': 3, '6m': 6, '1y': 12 };

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function toIso(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** ISO date `months` calendar months before `today`, clamped to the last day of the target month. */
export function rangeStart(range: Range, today: string): string | null {
  if (range === 'all') return null;
  const [y, m, d] = today.split('-').map(Number);
  let targetMonth = m - RANGE_MONTHS[range]; // 1-based, may be ≤ 0
  let targetYear = y;
  while (targetMonth <= 0) {
    targetMonth += 12;
    targetYear -= 1;
  }
  const daysInTarget = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
  return toIso(targetYear, targetMonth, Math.min(d, daysInTarget));
}

function buildPoint(date: string, rows: StatsRow[]): SessionPoint {
  const sets: SetLine[] = rows.map((r) => ({ weightKg: r.weightKg, reps: r.reps, sets: r.sets }));
  const weighted = rows.filter((r) => r.weightKg != null);
  let topWeightKg: number | null = null;
  let topReps = 0;
  if (weighted.length > 0) {
    const top = weighted.reduce((best, r) =>
      r.weightKg! > best.weightKg! || (r.weightKg === best.weightKg && (r.reps ?? 0) > (best.reps ?? 0)) ? r : best,
    );
    topWeightKg = top.weightKg;
    topReps = top.reps ?? 0;
  } else {
    topReps = Math.max(0, ...rows.map((r) => r.reps ?? 0));
  }
  const est1rm = topWeightKg != null ? topWeightKg * (1 + topReps / 30) : null;
  const volume = rows.reduce((sum, r) => sum + (r.weightKg ?? 0) * (r.reps ?? 0) * (r.sets ?? 1), 0);
  return { date, topWeightKg, topReps, est1rm, volume, sets };
}

function buildProgress(exerciseId: string, rows: StatsRow[]): ExerciseProgress {
  const byDate = new Map<string, StatsRow[]>();
  for (const r of rows) {
    const list = byDate.get(r.sessionDate) ?? [];
    list.push(r);
    byDate.set(r.sessionDate, list);
  }
  const points = [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, list]) => buildPoint(date, list.sort((a, b) => a.entryOrder - b.entryOrder)));

  const unit: Unit = points.every((p) => p.topWeightKg == null) ? 'reps' : 'kg';
  const last = points[points.length - 1];
  const first = points[0];
  const headline =
    unit === 'reps' ? { value: last.topReps, unit } : { value: last.topWeightKg ?? 0, unit };

  let delta: ExerciseProgress['delta'] = null;
  if (points.length >= 2) {
    if (unit === 'reps') {
      delta = { value: last.topReps - first.topReps, unit: 'reps' };
    } else if (last.topWeightKg != null && first.topWeightKg != null) {
      const kg = last.topWeightKg - first.topWeightKg;
      delta =
        kg === 0 && last.topReps !== first.topReps
          ? { value: last.topReps - first.topReps, unit: 'reps' }
          : { value: kg, unit: 'kg' };
    }
  }

  return {
    exerciseId,
    name: rows.find((r) => r.exerciseName)?.exerciseName ?? null,
    unit,
    points,
    headline,
    delta,
    lastDate: last.date,
    sessionCount: points.length,
  };
}

/** Group rows by exercise, compute per-session points and headline/delta. Sorted by lastDate desc. */
export function computeExerciseProgress(rows: StatsRow[]): ExerciseProgress[] {
  const byExercise = new Map<string, StatsRow[]>();
  for (const r of rows) {
    const list = byExercise.get(r.exerciseId) ?? [];
    list.push(r);
    byExercise.set(r.exerciseId, list);
  }
  return [...byExercise.entries()]
    .map(([id, list]) => buildProgress(id, list))
    .sort((a, b) => (a.lastDate > b.lastDate ? -1 : a.lastDate < b.lastDate ? 1 : 0));
}

export function seriesFor(p: ExerciseProgress, metric: Metric): { date: string; value: number | null }[] {
  return p.points.map((pt) => ({
    date: pt.date,
    value:
      metric === 'topSet' ? (p.unit === 'reps' ? pt.topReps : pt.topWeightKg)
      : metric === 'est1rm' ? pt.est1rm
      : pt.volume,
  }));
}

/** True when point `index` beats every earlier point on the headline metric (the first point is never a PR). */
export function isPr(p: ExerciseProgress, index: number): boolean {
  if (index === 0) return false;
  const series = seriesFor(p, 'topSet');
  const v = series[index]?.value;
  if (v == null) return false;
  return series.slice(0, index).every((s) => s.value == null || s.value < v);
}

export function formatHeadline(h: { value: number; unit: Unit }): string {
  return h.unit === 'reps' ? `×${h.value}` : `${h.value}kg`;
}

export function formatDelta(d: { value: number; unit: Unit } | null): string {
  if (!d || d.value === 0) return '─';
  const arrow = d.value > 0 ? '▲ +' : '▼ −';
  const suffix = d.unit === 'reps' ? ' reps' : '';
  return `${arrow}${Math.abs(d.value)}${suffix}`;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function utc(date: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** Short relative label: today / yesterday / weekday (≤6 days) / Nw ago (≤8 weeks) / "12 Jun". */
export function relativeDay(date: string, today: string): string {
  const days = Math.round((utc(today).getTime() - utc(date).getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days <= 6) return WEEKDAYS[utc(date).getUTCDay()];
  if (days <= 56) return `${Math.floor(days / 7)}w ago`;
  const d = utc(date);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** Short month label for chart axes, e.g. "Jun". */
export function monthLabel(date: string): string {
  return MONTHS[utc(date).getUTCMonth()];
}
```

- [ ] **Step 4: Run tests**

Run: `cd mobile && npx jest __tests__/exerciseProgress.test.ts && npx tsc --noEmit -p .`
Expected: all PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
cd mobile && git add lib/exerciseProgress.ts __tests__/exerciseProgress.test.ts
git commit -m "feat(mobile): pure per-exercise progress metrics" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DcYdmdCKf14Jte1MS7NMmi"
```

---

### Task 2: Stats repo — `src/db/statsRepo.ts`

**Files:**
- Create: `mobile/src/db/statsRepo.ts`
- Test: `mobile/__tests__/db/statsRepo.test.ts`

**Interfaces:**
- Consumes: `StatsRow` from Task 1; `getDb()` from `src/db/client.ts`; `upsertLocalSession` + `cacheAbbreviations` (tests only).
- Produces: `listStatsRows(fromDate: string | null): Promise<StatsRow[]>`.

- [ ] **Step 1: Write the failing test**

```ts
// mobile/__tests__/db/statsRepo.test.ts
import { resetDbForTests } from '@/src/db/client';
import { upsertLocalSession, type LocalSetEntry } from '@/src/db/sessionsRepo';
import { cacheAbbreviations } from '@/src/db/abbreviationsRepo';
import { listStatsRows } from '@/src/db/statsRepo';

beforeEach(() => {
  resetDbForTests();
});

function entry(p: Partial<LocalSetEntry> & { id: string; order: number }): LocalSetEntry {
  return {
    exerciseId: 'ex-dl', equipment: null, weightKg: 100, reps: 5, sets: 3,
    rawText: 'x', parsedBy: 'DICTIONARY', synced: 0, ...p,
  };
}

describe('listStatsRows', () => {
  beforeEach(async () => {
    await upsertLocalSession({ date: '2026-08-01', notes: null, synced: 0, entries: [
      entry({ id: 'a1', order: 1, weightKg: 90 }),
      entry({ id: 'a0', order: 0, weightKg: 100 }),
      entry({ id: 'a2', order: 2, exerciseId: null }),            // unconfirmed → excluded
      entry({ id: 'a3', order: 3, exerciseId: 'ex-pu', weightKg: null, reps: 10 }),
    ] });
    await upsertLocalSession({ date: '2026-06-01', notes: null, synced: 0, entries: [
      entry({ id: 'b0', order: 0, weightKg: 80 }),
    ] });
    await cacheAbbreviations([
      { id: '1', token: 'DL', exerciseId: 'ex-dl', exerciseName: 'Barbell Deadlift', source: 'USER_ADDED', createdAt: '' },
      { id: '2', token: 'DEADS', exerciseId: 'ex-dl', exerciseName: 'Barbell Deadlift', source: 'USER_ADDED', createdAt: '' },
      { id: '3', token: 'BB', modifierType: 'equipment', modifierValue: 'Barbell', source: 'USER_ADDED', createdAt: '' },
    ]);
  });

  it('returns confirmed entries joined with a name, ordered by exercise, date, entry order', async () => {
    const rows = await listStatsRows(null);
    expect(rows.map((r) => [r.exerciseId, r.sessionDate, r.entryOrder, r.weightKg, r.exerciseName])).toEqual([
      ['ex-dl', '2026-06-01', 0, 80, 'Barbell Deadlift'],
      ['ex-dl', '2026-08-01', 0, 100, 'Barbell Deadlift'],
      ['ex-dl', '2026-08-01', 1, 90, 'Barbell Deadlift'],
      ['ex-pu', '2026-08-01', 3, null, null],
    ]);
  });

  it('does not duplicate rows when two tokens map to the same exercise', async () => {
    const rows = await listStatsRows(null);
    expect(rows.filter((r) => r.exerciseId === 'ex-dl')).toHaveLength(3);
  });

  it('applies the lower date bound inclusively', async () => {
    const rows = await listStatsRows('2026-08-01');
    expect(rows.map((r) => r.sessionDate)).toEqual(['2026-08-01', '2026-08-01', '2026-08-01']);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd mobile && npx jest __tests__/db/statsRepo.test.ts`
Expected: FAIL — cannot find module `@/src/db/statsRepo`.

- [ ] **Step 3: Implement**

```ts
// mobile/src/db/statsRepo.ts
// Read side for the Stats tab: flat rows of confirmed set entries with the
// exercise's cached name. No aggregation here — see lib/exerciseProgress.ts.
// A future "pull sessions" sync only needs to insert into sessions/set_entries
// for this to cover other devices.
import { getDb } from './client';
import type { StatsRow } from '@/lib/exerciseProgress';

export async function listStatsRows(fromDate: string | null): Promise<StatsRow[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{
    exercise_id: string;
    exercise_name: string | null;
    session_date: string;
    weight_kg: number | null;
    reps: number | null;
    sets: number | null;
    entry_order: number;
  }>(
    `SELECT e.exercise_id, n.exercise_name, e.session_date, e.weight_kg, e.reps, e.sets, e.entry_order
     FROM set_entries e
     LEFT JOIN (
       SELECT exercise_id, MIN(exercise_name) AS exercise_name
       FROM abbreviations_cache
       WHERE exercise_id IS NOT NULL AND exercise_name IS NOT NULL
       GROUP BY exercise_id
     ) n ON n.exercise_id = e.exercise_id
     WHERE e.exercise_id IS NOT NULL
       AND (? IS NULL OR e.session_date >= ?)
     ORDER BY e.exercise_id ASC, e.session_date ASC, e.entry_order ASC`,
    [fromDate, fromDate],
  );
  return rows.map((r) => ({
    exerciseId: r.exercise_id,
    exerciseName: r.exercise_name,
    sessionDate: r.session_date,
    weightKg: r.weight_kg,
    reps: r.reps,
    sets: r.sets,
    entryOrder: r.entry_order,
  }));
}
```

- [ ] **Step 4: Run tests**

Run: `cd mobile && npx jest __tests__/db/statsRepo.test.ts && npx tsc --noEmit -p .`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd mobile && git add src/db/statsRepo.ts __tests__/db/statsRepo.test.ts
git commit -m "feat(mobile): stats repo reading confirmed set entries with names" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DcYdmdCKf14Jte1MS7NMmi"
```

---

### Task 3: `Sparkline` and `ProgressChart` svg components

**Files:**
- Create: `mobile/src/components/Sparkline.tsx`, `mobile/src/components/ProgressChart.tsx`
- Test: `mobile/__tests__/components/Sparkline.test.tsx`, `mobile/__tests__/components/ProgressChart.test.tsx`

**Interfaces:**
- Consumes: `monthLabel` from Task 1; `colors` from `lib/theme`.
- Produces:
  ```ts
  export type ChartPoint = { date: string; value: number | null };
  export function Sparkline({ points, width = 80, height = 24 }: { points: ChartPoint[]; width?: number; height?: number }): JSX.Element | null;
  export function ProgressChart({ points, unit, width, height = 180 }: { points: ChartPoint[]; unit: 'kg' | 'reps' | ''; width: number; height?: number }): JSX.Element;
  ```
  Both use `testID`s: `sparkline-segment` (one `Polyline` per contiguous run), `chart-point` (one `Circle` per non-null point), `chart-y-label`, `chart-x-label`.

- [ ] **Step 1: Write the failing tests**

```tsx
// mobile/__tests__/components/Sparkline.test.tsx
import { render, screen } from '@testing-library/react-native';
import { Sparkline } from '@/src/components/Sparkline';

describe('Sparkline', () => {
  it('renders one polyline per contiguous run (gaps split the line)', async () => {
    await render(
      <Sparkline points={[
        { date: '2026-06-01', value: 60 }, { date: '2026-06-08', value: 65 },
        { date: '2026-06-15', value: null },
        { date: '2026-06-22', value: 70 }, { date: '2026-06-29', value: 72 },
      ]} />,
    );
    expect(screen.getAllByTestId('sparkline-segment')).toHaveLength(2);
  });

  it('renders nothing for fewer than two numeric points', async () => {
    await render(<Sparkline points={[{ date: '2026-06-01', value: 60 }]} />);
    expect(screen.queryAllByTestId('sparkline-segment')).toHaveLength(0);
  });
});
```

```tsx
// mobile/__tests__/components/ProgressChart.test.tsx
import { render, screen } from '@testing-library/react-native';
import { ProgressChart } from '@/src/components/ProgressChart';

const points = [
  { date: '2026-06-01', value: 90 }, { date: '2026-07-01', value: 95 },
  { date: '2026-08-01', value: null }, { date: '2026-08-15', value: 100 },
];

describe('ProgressChart', () => {
  it('draws a dot per numeric point, y tick labels and month x labels', async () => {
    await render(<ProgressChart points={points} unit="kg" width={320} />);
    expect(screen.getAllByTestId('chart-point')).toHaveLength(3);
    expect(screen.getAllByTestId('chart-y-label').length).toBeGreaterThanOrEqual(3);
    expect(screen.getAllByTestId('chart-x-label').map((n) => n.props.children)).toEqual(['Jun', 'Jul', 'Aug']);
  });

  it('shows a flat line with sensible ticks when every value is equal', async () => {
    await render(<ProgressChart points={[{ date: '2026-06-01', value: 50 }, { date: '2026-07-01', value: 50 }]} unit="kg" width={320} />);
    expect(screen.getAllByTestId('chart-point')).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd mobile && npx jest __tests__/components/Sparkline.test.tsx __tests__/components/ProgressChart.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the shared scaling helper and both components**

```ts
// mobile/src/components/chartScale.ts
// Shared x/y scaling for Sparkline and ProgressChart.
export type ChartPoint = { date: string; value: number | null };

export type Scaled = { x: number; y: number; value: number; date: string };

/** Splits points into contiguous runs of non-null values, already scaled to pixels. */
export function scaleRuns(
  points: ChartPoint[],
  width: number,
  height: number,
  pad: { top: number; right: number; bottom: number; left: number },
): { runs: Scaled[][]; min: number; max: number } {
  const values = points.map((p) => p.value).filter((v): v is number => v != null);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (!Number.isFinite(min)) return { runs: [], min: 0, max: 0 };
  if (min === max) {
    // Flat series: give the line some breathing room instead of dividing by 0.
    min = min - 1;
    max = max + 1;
  }
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const n = Math.max(points.length - 1, 1);
  const runs: Scaled[][] = [];
  let current: Scaled[] = [];
  points.forEach((p, i) => {
    if (p.value == null) {
      if (current.length) runs.push(current);
      current = [];
      return;
    }
    current.push({
      date: p.date,
      value: p.value,
      x: pad.left + (innerW * i) / n,
      y: pad.top + innerH - (innerH * (p.value - min)) / (max - min),
    });
  });
  if (current.length) runs.push(current);
  return { runs, min, max };
}

/** 3–4 "nice" tick values spanning [min, max]. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  const span = max - min || 1;
  const rawStep = span / (count - 1);
  const mag = 10 ** Math.floor(Math.log10(rawStep));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= rawStep) ?? mag * 10;
  const start = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step / 2; v += step) ticks.push(Number(v.toFixed(2)));
  return ticks;
}
```

```tsx
// mobile/src/components/Sparkline.tsx
import Svg, { Polyline, Circle } from 'react-native-svg';
import { colors } from '@/lib/theme';
import { scaleRuns, type ChartPoint } from './chartScale';

export type { ChartPoint };

const PAD = { top: 2, right: 3, bottom: 2, left: 3 };

/** Tiny trend line for a list row. Gaps (null values) break the line. */
export function Sparkline({ points, width = 80, height = 24 }: { points: ChartPoint[]; width?: number; height?: number }) {
  const numeric = points.filter((p) => p.value != null);
  if (numeric.length < 2) return null;
  const { runs } = scaleRuns(points, width, height, PAD);
  const last = runs[runs.length - 1]?.slice(-1)[0];
  return (
    <Svg width={width} height={height} accessible={false}>
      {runs.map((run, i) => (
        <Polyline
          key={i}
          testID="sparkline-segment"
          points={run.map((p) => `${p.x},${p.y}`).join(' ')}
          fill="none"
          stroke={colors.graphite}
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ))}
      {last ? <Circle cx={last.x} cy={last.y} r={2.2} fill={colors.moss} /> : null}
    </Svg>
  );
}
```

```tsx
// mobile/src/components/ProgressChart.tsx
import Svg, { Polyline, Circle, Line, Text as SvgText } from 'react-native-svg';
import { colors, fontSize } from '@/lib/theme';
import { monthLabel } from '@/lib/exerciseProgress';
import { scaleRuns, niceTicks, type ChartPoint } from './chartScale';

const PAD = { top: 12, right: 12, bottom: 24, left: 40 };

/** Detail-screen line chart: y ticks with unit, month labels on x, dots per session, gaps for nulls. */
export function ProgressChart({
  points, unit, width, height = 180,
}: { points: ChartPoint[]; unit: 'kg' | 'reps' | ''; width: number; height?: number }) {
  const { runs, min, max } = scaleRuns(points, width, height, PAD);
  const ticks = niceTicks(min, max);
  const innerH = height - PAD.top - PAD.bottom;
  const yFor = (v: number) => PAD.top + innerH - (innerH * (v - min)) / (max - min || 1);

  // One x label per month, placed at that month's first point.
  const monthStarts: { x: number; label: string }[] = [];
  const n = Math.max(points.length - 1, 1);
  const innerW = width - PAD.left - PAD.right;
  points.forEach((p, i) => {
    const label = monthLabel(p.date);
    if (monthStarts.length === 0 || monthStarts[monthStarts.length - 1].label !== label) {
      monthStarts.push({ x: PAD.left + (innerW * i) / n, label });
    }
  });

  return (
    <Svg width={width} height={height}>
      {ticks.map((t) => (
        <Line key={`g${t}`} x1={PAD.left} x2={width - PAD.right} y1={yFor(t)} y2={yFor(t)} stroke={colors.ruleSoft} strokeWidth={1} />
      ))}
      {ticks.map((t, i) => (
        <SvgText key={`y${t}`} testID="chart-y-label" x={PAD.left - 6} y={yFor(t) + 4} fontSize={fontSize.caption} fill={colors.lead} textAnchor="end">
          {/* Only the top tick carries the unit, so the axis stays narrow. */}
          {i === ticks.length - 1 && unit ? `${t} ${unit}` : String(t)}
        </SvgText>
      ))}
      {monthStarts.map((m) => (
        <SvgText key={`x${m.x}`} testID="chart-x-label" x={m.x} y={height - 6} fontSize={fontSize.caption} fill={colors.lead} textAnchor="middle">
          {m.label}
        </SvgText>
      ))}
      {runs.map((run, i) => (
        <Polyline key={i} points={run.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke={colors.graphite} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      ))}
      {runs.flat().map((p) => (
        <Circle key={p.date} testID="chart-point" cx={p.x} cy={p.y} r={3.5} fill={colors.paper} stroke={colors.graphite} strokeWidth={2} />
      ))}
    </Svg>
  );
}
```

Note: `fontSize.caption` must exist in `lib/theme.ts` (it does — used by `typography.monoCaption`). If `fontSize` is not exported, use `typography.monoCaption.fontSize`.

- [ ] **Step 4: Run tests**

Run: `cd mobile && npx jest __tests__/components/Sparkline.test.tsx __tests__/components/ProgressChart.test.tsx && npx tsc --noEmit -p .`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd mobile && git add src/components/chartScale.ts src/components/Sparkline.tsx src/components/ProgressChart.tsx __tests__/components/Sparkline.test.tsx __tests__/components/ProgressChart.test.tsx
git commit -m "feat(mobile): svg Sparkline and ProgressChart components" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DcYdmdCKf14Jte1MS7NMmi"
```

---

### Task 4: `ExerciseRow` component

**Files:**
- Create: `mobile/src/components/ExerciseRow.tsx`
- Test: `mobile/__tests__/components/ExerciseRow.test.tsx`
- Modify: `mobile/lib/locales/en.json` (via `npm run i18n:extract`)

**Interfaces:**
- Consumes: `ExerciseProgress`, `formatHeadline`, `formatDelta`, `relativeDay`, `seriesFor` (Task 1); `Sparkline` (Task 3); `Text` from `components/Text`.
- Produces: `export function ExerciseRow({ progress, today, onPress }: { progress: ExerciseProgress; today: string; onPress: () => void }): JSX.Element`.
- i18n keys (add to `en.json` via extract): `stats.unnamedExercise` = "Unnamed exercise", `stats.sessions_one` = "{{count}} session", `stats.sessions_other` = "{{count}} sessions", `stats.last` = "last {{when}}".

- [ ] **Step 1: Write the failing test**

```tsx
// mobile/__tests__/components/ExerciseRow.test.tsx
import '@/lib/i18n';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { ExerciseRow } from '@/src/components/ExerciseRow';
import { computeExerciseProgress } from '@/lib/exerciseProgress';

const [progress] = computeExerciseProgress([
  { exerciseId: 'ex-dl', exerciseName: 'Barbell Deadlift', sessionDate: '2026-06-10', weightKg: 90, reps: 5, sets: 3, entryOrder: 0 },
  { exerciseId: 'ex-dl', exerciseName: 'Barbell Deadlift', sessionDate: '2026-08-20', weightKg: 100, reps: 5, sets: 3, entryOrder: 0 },
]);

describe('ExerciseRow', () => {
  it('shows name, headline, delta and the sessions/last line, and fires onPress', async () => {
    const onPress = jest.fn();
    await render(<ExerciseRow progress={progress} today="2026-08-23" onPress={onPress} />);
    expect(screen.getByText('Barbell Deadlift')).toBeTruthy();
    expect(screen.getByText('100kg')).toBeTruthy();
    expect(screen.getByText('▲ +10')).toBeTruthy();
    expect(screen.getByText('2 sessions · last Thu')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button'));
    expect(onPress).toHaveBeenCalled();
  });

  it('falls back to "Unnamed exercise" when the name is unknown', async () => {
    await render(<ExerciseRow progress={{ ...progress, name: null }} today="2026-08-23" onPress={jest.fn()} />);
    expect(screen.getByText('Unnamed exercise')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd mobile && npx jest __tests__/components/ExerciseRow.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```tsx
// mobile/src/components/ExerciseRow.tsx
import { View, Pressable, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Text } from '@/components/Text';
import { colors, spacing, typography } from '@/lib/theme';
import {
  formatDelta, formatHeadline, relativeDay, seriesFor, type ExerciseProgress,
} from '@/lib/exerciseProgress';
import { Sparkline } from './Sparkline';

function deltaColor(delta: ExerciseProgress['delta']): string {
  if (!delta || delta.value === 0) return colors.lead;
  return delta.value > 0 ? colors.moss : colors.brick;
}

export function ExerciseRow({ progress, today, onPress }: { progress: ExerciseProgress; today: string; onPress: () => void }) {
  const { t } = useTranslation();
  const name = progress.name ?? t('stats.unnamedExercise');
  const headline = formatHeadline(progress.headline);
  const delta = formatDelta(progress.delta);
  const sub = `${t('stats.sessions', { count: progress.sessionCount })} · ${t('stats.last', { when: relativeDay(progress.lastDate, today) })}`;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${headline}, ${delta}, ${sub}`}
    >
      <View style={styles.main}>
        <View style={styles.topLine}>
          <Text variant="bodyEmphasis" style={styles.name} numberOfLines={1}>{name}</Text>
          <Text style={styles.headline}>{headline}</Text>
          <Text style={[styles.delta, { color: deltaColor(progress.delta) }]}>{delta}</Text>
        </View>
        <Text variant="bodyS" style={styles.sub}>{sub}</Text>
      </View>
      <Sparkline points={seriesFor(progress, 'topSet')} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s3,
    paddingVertical: spacing.s3,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.ruleSoft,
  },
  pressed: { opacity: 0.6 },
  main: { flex: 1, gap: spacing.s1 },
  topLine: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.s2 },
  name: { flex: 1, color: colors.graphite },
  headline: { ...typography.amountS, color: colors.graphite },
  delta: { ...typography.monoCaption },
  sub: { color: colors.lead },
});
```

Then add the i18n keys. Run `cd mobile && npm run i18n:extract` and edit `lib/locales/en.json` so the `stats` block contains (keep the existing keys for now — Task 6 removes the goal ones):

```json
"stats": {
  "title": "Progress",
  "unnamedExercise": "Unnamed exercise",
  "sessions_one": "{{count}} session",
  "sessions_other": "{{count}} sessions",
  "last": "last {{when}}",
  ...
}
```

(If the extractor writes `"sessions": ""` instead of the plural pair, replace it with the `_one`/`_other` pair by hand — i18next resolves plurals from `count`.)

- [ ] **Step 4: Run tests**

Run: `cd mobile && npx jest __tests__/components/ExerciseRow.test.tsx && npx tsc --noEmit -p . && npm run i18n:check`
Expected: PASS; i18n:check exits 0.

- [ ] **Step 5: Commit**

```bash
cd mobile && git add src/components/ExerciseRow.tsx __tests__/components/ExerciseRow.test.tsx lib/locales/en.json
git commit -m "feat(mobile): ExerciseRow with headline, delta and sparkline" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DcYdmdCKf14Jte1MS7NMmi"
```

---

### Task 5: Range picker — `RangeChips`

**Files:**
- Create: `mobile/src/components/RangeChips.tsx`
- Test: `mobile/__tests__/components/RangeChips.test.tsx`

**Interfaces:**
- Consumes: `Range`, `RANGES` (Task 1); `Chip` from `components/Chip` (display-only — wrap in `Pressable`).
- Produces: `export function RangeChips({ value, onChange }: { value: Range; onChange: (r: Range) => void }): JSX.Element`. Labels: `1m 3m 6m 1y All` via `t('stats.range.1m')` … `t('stats.range.all')`.

- [ ] **Step 1: Write the failing test**

```tsx
// mobile/__tests__/components/RangeChips.test.tsx
import '@/lib/i18n';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { RangeChips } from '@/src/components/RangeChips';

describe('RangeChips', () => {
  it('renders all ranges, marks the selected one, and reports taps', async () => {
    const onChange = jest.fn();
    await render(<RangeChips value="3m" onChange={onChange} />);
    expect(screen.getAllByRole('button')).toHaveLength(5);
    expect(screen.getByRole('button', { name: '3m' }).props.accessibilityState).toEqual({ selected: true });
    await fireEvent.press(screen.getByRole('button', { name: 'All' }));
    expect(onChange).toHaveBeenCalledWith('all');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd mobile && npx jest __tests__/components/RangeChips.test.tsx` → FAIL (module not found).

- [ ] **Step 3: Implement**

```tsx
// mobile/src/components/RangeChips.tsx
import { View, Pressable, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Chip } from '@/components/Chip';
import { spacing } from '@/lib/theme';
import { RANGES, type Range } from '@/lib/exerciseProgress';

export function RangeChips({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
  const { t } = useTranslation();
  return (
    <View style={styles.row} accessibilityRole="tablist">
      {RANGES.map((r) => {
        const label = t(`stats.range.${r}`);
        return (
          <Pressable
            key={r}
            onPress={() => onChange(r)}
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ selected: r === value }}
          >
            <Chip solid={r === value}>{label}</Chip>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.s2, flexWrap: 'wrap' },
});
```

Add to `en.json` under `stats`:
```json
"range": { "1m": "1m", "3m": "3m", "6m": "6m", "1y": "1y", "all": "All" }
```
(The extractor can't see template keys — add by hand; `i18n:check` still passes because it only removes keys it can prove unused when configured to; if it flags them, add `// t('stats.range.1m') t('stats.range.3m') t('stats.range.6m') t('stats.range.1y') t('stats.range.all')` as a comment in `RangeChips.tsx` so the parser picks them up.)

- [ ] **Step 4: Run tests**

Run: `cd mobile && npx jest __tests__/components/RangeChips.test.tsx && npm run i18n:check && npx tsc --noEmit -p .` → PASS.

- [ ] **Step 5: Commit**

```bash
cd mobile && git add src/components/RangeChips.tsx __tests__/components/RangeChips.test.tsx lib/locales/en.json
git commit -m "feat(mobile): RangeChips picker" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DcYdmdCKf14Jte1MS7NMmi"
```

---

### Task 6: Rewrite the Stats tab

**Files:**
- Modify (rewrite): `mobile/app/(tabs)/stats.tsx`
- Delete: `mobile/src/components/MuscleHeatmap.tsx`, `mobile/__tests__/components/MuscleHeatmap.test.tsx`
- Modify (rewrite): `mobile/__tests__/app/stats.test.tsx`
- Modify: `mobile/lib/locales/en.json` (remove goal keys; add empty-state keys)

**Interfaces:**
- Consumes: `listStatsRows` (Task 2); `computeExerciseProgress`, `rangeStart`, `Range` (Task 1); `ExerciseRow` (Task 4); `RangeChips` (Task 5); `router` from `expo-router`.
- Produces: the screen; navigation target `/exercise/[id]` (Task 7).
- i18n: `stats.title` = "Progress", `stats.emptyTitle` = "No progress yet", `stats.emptyBody` = "Log a workout and confirm the exercise to see it here." Remove `noGoalTitle`, `noGoalBody`, `preset*`, `goalPlaceholder`, `setGoal`.

- [ ] **Step 1: Rewrite the screen test**

```tsx
// mobile/__tests__/app/stats.test.tsx
import '@/lib/i18n';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import StatsScreen from '../../app/(tabs)/stats';
import { resetDbForTests } from '@/src/db/client';
import { upsertLocalSession } from '@/src/db/sessionsRepo';
import { cacheAbbreviations } from '@/src/db/abbreviationsRepo';

const push = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (...a: unknown[]) => push(...a), back: jest.fn() } }));

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
function daysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

beforeEach(() => {
  resetDbForTests();
  push.mockClear();
});

describe('StatsScreen', () => {
  it('shows the empty state when nothing is logged', async () => {
    await render(<StatsScreen />);
    await waitFor(() => expect(screen.getByText('No progress yet')).toBeTruthy());
  });

  it('lists exercises with headline and delta, and navigates on tap', async () => {
    await cacheAbbreviations([{ id: '1', token: 'DL', exerciseId: 'ex-dl', exerciseName: 'Barbell Deadlift', source: 'USER_ADDED', createdAt: '' }]);
    await upsertLocalSession({ date: daysAgo(20), notes: null, synced: 0, entries: [
      { id: 'a', exerciseId: 'ex-dl', equipment: null, weightKg: 90, reps: 5, sets: 3, rawText: 'x', parsedBy: 'DICTIONARY', order: 0, synced: 0 },
    ] });
    await upsertLocalSession({ date: todayIso(), notes: null, synced: 0, entries: [
      { id: 'b', exerciseId: 'ex-dl', equipment: null, weightKg: 100, reps: 5, sets: 3, rawText: 'x', parsedBy: 'DICTIONARY', order: 0, synced: 0 },
    ] });

    await render(<StatsScreen />);
    await waitFor(() => expect(screen.getByText('Barbell Deadlift')).toBeTruthy());
    expect(screen.getByText('100kg')).toBeTruthy();
    expect(screen.getByText('▲ +10')).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: /Barbell Deadlift/ }));
    expect(push).toHaveBeenCalledWith({ pathname: '/exercise/[id]', params: { id: 'ex-dl' } });
  });

  it('changing the range reloads the list', async () => {
    await cacheAbbreviations([{ id: '1', token: 'DL', exerciseId: 'ex-dl', exerciseName: 'Barbell Deadlift', source: 'USER_ADDED', createdAt: '' }]);
    await upsertLocalSession({ date: daysAgo(200), notes: null, synced: 0, entries: [
      { id: 'a', exerciseId: 'ex-dl', equipment: null, weightKg: 90, reps: 5, sets: 3, rawText: 'x', parsedBy: 'DICTIONARY', order: 0, synced: 0 },
    ] });
    await render(<StatsScreen />);
    await waitFor(() => expect(screen.getByText('No progress yet')).toBeTruthy()); // outside 3m
    await fireEvent.press(screen.getByRole('button', { name: 'All' }));
    await waitFor(() => expect(screen.getByText('Barbell Deadlift')).toBeTruthy());
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd mobile && npx jest __tests__/app/stats.test.tsx` → FAIL (old screen renders goals UI / uses `useAuth`).

- [ ] **Step 3: Rewrite `app/(tabs)/stats.tsx`**

```tsx
// mobile/app/(tabs)/stats.tsx
import { useCallback, useEffect, useState } from 'react';
import { View, FlatList, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { router } from 'expo-router';
import { Text } from '@/components/Text';
import { TopBar } from '@/components/TopBar';
import { ContentContainer } from '@/components/ContentContainer';
import { EmptyState } from '@/components/EmptyState';
import { ExerciseRow } from '@/src/components/ExerciseRow';
import { RangeChips } from '@/src/components/RangeChips';
import { listStatsRows } from '@/src/db/statsRepo';
import { computeExerciseProgress, rangeStart, type ExerciseProgress, type Range } from '@/lib/exerciseProgress';
import { colors, spacing } from '@/lib/theme';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function StatsScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [range, setRange] = useState<Range>('3m');
  const [items, setItems] = useState<ExerciseProgress[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const today = todayIso();

  const load = useCallback(async () => {
    try {
      const rows = await listStatsRows(rangeStart(range, today));
      setItems(computeExerciseProgress(rows));
      setError(null);
    } catch {
      setError(t('errors.generic'));
    }
  }, [range, today, t]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <TopBar title={t('stats.title')} />
      <ContentContainer style={styles.content}>
        <RangeChips value={range} onChange={setRange} />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {items && items.length === 0 ? (
          <EmptyState title={t('stats.emptyTitle')} body={t('stats.emptyBody')} icon="trending-up" />
        ) : (
          <FlatList
            data={items ?? []}
            keyExtractor={(p) => p.exerciseId}
            contentContainerStyle={{ paddingBottom: insets.bottom + spacing.s7 }}
            renderItem={({ item }) => (
              <ExerciseRow
                progress={item}
                today={today}
                onPress={() => router.push({ pathname: '/exercise/[id]', params: { id: item.exerciseId } })}
              />
            )}
          />
        )}
      </ContentContainer>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  content: { flex: 1, gap: spacing.s4, paddingTop: spacing.s3 },
  error: { color: colors.brick },
});
```

Check `ContentContainer` accepts `style` (it does — old stats passed `styles.content`). If `FlatList` inside `ContentContainer` doesn't fill, give `ContentContainer` `flex: 1` via the style prop as above.

- [ ] **Step 4: Delete the heatmap and its test; update locales**

```bash
cd mobile && git rm -q src/components/MuscleHeatmap.tsx __tests__/components/MuscleHeatmap.test.tsx
grep -rn "MuscleHeatmap" app src lib components   # must print nothing
npm run i18n:extract
```
Edit `lib/locales/en.json`'s `stats` block to exactly:
```json
"stats": {
  "title": "Progress",
  "emptyTitle": "No progress yet",
  "emptyBody": "Log a workout and confirm the exercise to see it here.",
  "unnamedExercise": "Unnamed exercise",
  "sessions_one": "{{count}} session",
  "sessions_other": "{{count}} sessions",
  "last": "last {{when}}",
  "range": { "1m": "1m", "3m": "3m", "6m": "6m", "1y": "1y", "all": "All" }
}
```
Also check `grep -rn "stats\.\(noGoal\|preset\|goalPlaceholder\|setGoal\)" app src lib components` prints nothing.

- [ ] **Step 5: Run tests**

Run: `cd mobile && npx jest __tests__/app/stats.test.tsx && npm run i18n:check && npx tsc --noEmit -p . && npx jest`
Expected: all PASS (the `you.strongnotes` / tabs tests must still pass — they don't reference the heatmap).

- [ ] **Step 6: Commit**

```bash
cd mobile && git add "app/(tabs)/stats.tsx" __tests__/app/stats.test.tsx lib/locales/en.json
git commit -m "feat(mobile): Stats tab lists per-exercise progress; drop heatmap and goals UI" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DcYdmdCKf14Jte1MS7NMmi"
```
(The `git rm` in Step 4 already staged the deletions.)

---

### Task 7: Exercise detail screen `/exercise/[id]`

**Files:**
- Create: `mobile/app/exercise/[id].tsx`
- Modify: `mobile/app/_layout.tsx:42-46` (register the screen)
- Test: `mobile/__tests__/app/exercise-detail.test.tsx`
- Modify: `mobile/lib/locales/en.json`

**Interfaces:**
- Consumes: `listStatsRows` (Task 2); `computeExerciseProgress`, `rangeStart`, `seriesFor`, `isPr`, `formatHeadline`, `formatDelta`, `Metric`, `Range` (Task 1); `ProgressChart` (Task 3); `RangeChips` (Task 5); `useLocalSearchParams`, `router` from `expo-router`; `IconButton`, `TopBar`, `Chip`.
- i18n: `exercise.metricTopSet` = "Top set", `exercise.metricEst1rm` = "Est. 1RM", `exercise.metricVolume` = "Volume", `exercise.notFoundTitle` = "No data for this exercise", `exercise.notFoundBody` = "Nothing logged in this range.", `exercise.sessionsHeading` = "Sessions", `exercise.pr` = "PR".

- [ ] **Step 1: Write the failing test**

```tsx
// mobile/__tests__/app/exercise-detail.test.tsx
import '@/lib/i18n';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import ExerciseDetail from '../../app/exercise/[id]';
import { resetDbForTests } from '@/src/db/client';
import { upsertLocalSession } from '@/src/db/sessionsRepo';
import { cacheAbbreviations } from '@/src/db/abbreviationsRepo';

let params: Record<string, string> = { id: 'ex-dl' };
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => params,
}));

function daysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}
const entry = (id: string, weightKg: number, reps: number, order = 0) => ({
  id, exerciseId: 'ex-dl', equipment: null, weightKg, reps, sets: 3, rawText: 'x', parsedBy: 'DICTIONARY' as const, order, synced: 0 as const,
});

beforeEach(async () => {
  resetDbForTests();
  params = { id: 'ex-dl' };
  await cacheAbbreviations([{ id: '1', token: 'DL', exerciseId: 'ex-dl', exerciseName: 'Barbell Deadlift', source: 'USER_ADDED', createdAt: '' }]);
  await upsertLocalSession({ date: daysAgo(30), notes: null, synced: 0, entries: [entry('a', 90, 5)] });
  await upsertLocalSession({ date: daysAgo(2), notes: null, synced: 0, entries: [entry('b', 100, 5), entry('c', 80, 8, 1)] });
});

describe('ExerciseDetail', () => {
  it('renders name, headline, chart points and the session list with a PR marker', async () => {
    await render(<ExerciseDetail />);
    await waitFor(() => expect(screen.getByText('Barbell Deadlift')).toBeTruthy());
    expect(screen.getByText('100kg')).toBeTruthy();
    expect(screen.getByText('▲ +10')).toBeTruthy();
    expect(screen.getAllByTestId('chart-point')).toHaveLength(2);
    expect(screen.getByText('100kg 5×3   80kg 8×3')).toBeTruthy();
    expect(screen.getAllByText('PR')).toHaveLength(1); // the latest session beats the first; the first has nothing to beat
  });

  it('switches the plotted series with the metric toggle', async () => {
    await render(<ExerciseDetail />);
    await waitFor(() => expect(screen.getByText('Barbell Deadlift')).toBeTruthy());
    await fireEvent.press(screen.getByRole('button', { name: 'Volume' }));
    // Volume y-axis ticks are in the thousands; top-set ticks are < 200.
    const labels = screen.getAllByTestId('chart-y-label').map((n) => Number(n.props.children));
    expect(Math.max(...labels)).toBeGreaterThan(1000);
  });

  it('shows an empty state for an unknown id', async () => {
    params = { id: 'nope' };
    await render(<ExerciseDetail />);
    await waitFor(() => expect(screen.getByText('No data for this exercise')).toBeTruthy());
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd mobile && npx jest __tests__/app/exercise-detail.test.tsx` → FAIL (module not found).

- [ ] **Step 3: Implement the screen**

```tsx
// mobile/app/exercise/[id].tsx
import { useCallback, useEffect, useState } from 'react';
import { View, ScrollView, Pressable, StyleSheet, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { router, useLocalSearchParams } from 'expo-router';
import { Text } from '@/components/Text';
import { TopBar } from '@/components/TopBar';
import { IconButton } from '@/components/IconButton';
import { ContentContainer } from '@/components/ContentContainer';
import { EmptyState } from '@/components/EmptyState';
import { Chip } from '@/components/Chip';
import { ProgressChart } from '@/src/components/ProgressChart';
import { RangeChips } from '@/src/components/RangeChips';
import { listStatsRows } from '@/src/db/statsRepo';
import {
  computeExerciseProgress, rangeStart, seriesFor, isPr, formatHeadline, formatDelta,
  type ExerciseProgress, type Metric, type Range, type SetLine,
} from '@/lib/exerciseProgress';
import { colors, spacing, typography } from '@/lib/theme';

const METRICS: Metric[] = ['topSet', 'est1rm', 'volume'];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatSet(s: SetLine): string {
  const w = s.weightKg != null ? `${s.weightKg}kg` : '';
  const rs = s.reps != null ? `${s.reps}×${s.sets ?? 1}` : '';
  return [w, rs].filter(Boolean).join(' ');
}

function formatDate(date: string): string {
  const [, m, d] = date.split('-').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[m - 1]} ${String(d).padStart(2, '0')}`;
}

export default function ExerciseDetail() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [range, setRange] = useState<Range>('3m');
  const [metric, setMetric] = useState<Metric>('topSet');
  const [progress, setProgress] = useState<ExerciseProgress | null | undefined>(undefined); // undefined = loading
  const [error, setError] = useState<string | null>(null);
  const today = todayIso();

  const load = useCallback(async () => {
    try {
      const rows = await listStatsRows(rangeStart(range, today));
      setProgress(computeExerciseProgress(rows).find((p) => p.exerciseId === id) ?? null);
      setError(null);
    } catch {
      setError(t('errors.generic'));
    }
  }, [id, range, today, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const metricLabel: Record<Metric, string> = {
    topSet: t('exercise.metricTopSet'),
    est1rm: t('exercise.metricEst1rm'),
    volume: t('exercise.metricVolume'),
  };
  // Bodyweight exercises only have a reps series.
  const metrics = progress?.unit === 'reps' ? (['topSet'] as Metric[]) : METRICS;
  const chartWidth = Math.min(width, 520) - spacing.s4 * 2;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <TopBar
        title={progress?.name ?? (progress === null ? '' : t('stats.unnamedExercise'))}
        left={<IconButton icon="chevron-left" label={t('common.back')} onPress={() => router.back()} />}
      />
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + spacing.s7 }}>
        <ContentContainer style={styles.content}>
          <RangeChips value={range} onChange={setRange} />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {progress === null ? (
            <EmptyState title={t('exercise.notFoundTitle')} body={t('exercise.notFoundBody')} icon="trending-up" />
          ) : progress ? (
            <>
              <View style={styles.headline}>
                <Text style={styles.headlineValue}>{formatHeadline(progress.headline)}</Text>
                <Text style={[styles.delta, { color: deltaColor(progress) }]}>{formatDelta(progress.delta)}</Text>
                <Text variant="bodyS" style={styles.muted}>{t('stats.sessions', { count: progress.sessionCount })}</Text>
              </View>

              <ProgressChart points={seriesFor(progress, metric)} unit={metric === 'topSet' ? progress.unit : ''} width={chartWidth} />

              {metrics.length > 1 ? (
                <View style={styles.toggle}>
                  {metrics.map((m) => (
                    <Pressable key={m} onPress={() => setMetric(m)} accessibilityRole="button" accessibilityLabel={metricLabel[m]} accessibilityState={{ selected: m === metric }}>
                      <Chip solid={m === metric}>{metricLabel[m]}</Chip>
                    </Pressable>
                  ))}
                </View>
              ) : null}

              <Text variant="bodyEmphasis" style={styles.heading}>{t('exercise.sessionsHeading')}</Text>
              {[...progress.points].reverse().map((pt, revIdx) => {
                const idx = progress.points.length - 1 - revIdx;
                return (
                  <View key={pt.date} style={styles.sessionRow}>
                    <Text style={styles.sessionDate}>{formatDate(pt.date)}</Text>
                    <Text style={styles.sessionSets} numberOfLines={2}>{pt.sets.map(formatSet).join('   ')}</Text>
                    {isPr(progress, idx) ? <Text style={styles.pr}>{t('exercise.pr')}</Text> : null}
                  </View>
                );
              })}
            </>
          ) : null}
        </ContentContainer>
      </ScrollView>
    </View>
  );
}

function deltaColor(p: ExerciseProgress): string {
  if (!p.delta || p.delta.value === 0) return colors.lead;
  return p.delta.value > 0 ? colors.moss : colors.brick;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  content: { gap: spacing.s4, paddingTop: spacing.s3 },
  error: { color: colors.brick },
  headline: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.s3 },
  headlineValue: { ...typography.amountL, color: colors.graphite },
  delta: { ...typography.monoBody },
  muted: { color: colors.lead },
  toggle: { flexDirection: 'row', gap: spacing.s2 },
  heading: { color: colors.graphite, marginTop: spacing.s2 },
  sessionRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.s3,
    paddingVertical: spacing.s2, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.ruleSoft,
  },
  sessionDate: { ...typography.monoBodyS, color: colors.lead, width: 56 },
  sessionSets: { ...typography.monoBodyS, color: colors.graphite, flex: 1 },
  pr: { ...typography.monoLabel, color: colors.moss },
});
```

Register the route in `mobile/app/_layout.tsx` next to `settings/about`:
```tsx
<Stack.Screen name="exercise/[id]" options={{ animation: 'slide_from_right' }} />
```

Add to `en.json`:
```json
"exercise": {
  "metricTopSet": "Top set",
  "metricEst1rm": "Est. 1RM",
  "metricVolume": "Volume",
  "notFoundTitle": "No data for this exercise",
  "notFoundBody": "Nothing logged in this range.",
  "sessionsHeading": "Sessions",
  "pr": "PR"
}
```
Run `npm run i18n:extract` and confirm the keys are present (`common.back` already exists).

- [ ] **Step 4: Run tests**

Run: `cd mobile && npx jest __tests__/app/exercise-detail.test.tsx && npm run i18n:check && npx tsc --noEmit -p .` → PASS.

- [ ] **Step 5: Commit**

```bash
cd mobile && git add "app/exercise/[id].tsx" app/_layout.tsx __tests__/app/exercise-detail.test.tsx lib/locales/en.json
git commit -m "feat(mobile): exercise detail screen with chart, metric toggle and session list" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DcYdmdCKf14Jte1MS7NMmi"
```

---

### Task 8: "View progress" link from the Log popover

**Files:**
- Modify: `mobile/src/components/EntryPopover.tsx`
- Modify: `mobile/__tests__/components/EntryPopover.test.tsx`
- Modify: `mobile/lib/locales/en.json` (`log.viewProgress` = "View progress ›")

**Interfaces:**
- Consumes: `router` from `expo-router`; existing `EntryPopover` props `{ entries, onConfirm, onClose }`.
- Produces: for `entries[0].status === 'resolved' && entries[0].exerciseId`, a button labelled `t('log.viewProgress')` that calls `onClose()` then `router.push({ pathname: '/exercise/[id]', params: { id } })`.

- [ ] **Step 1: Write the failing test** (append to the existing describe in `__tests__/components/EntryPopover.test.tsx`; add the router mock at the top of the file)

```tsx
const push = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (...a: unknown[]) => push(...a) } }));

  it('offers "View progress" for a resolved group and navigates to the exercise', async () => {
    const onClose = jest.fn();
    await render(
      <EntryPopover entries={[entry({ status: 'resolved', exerciseId: 'ex-1' })]} onConfirm={jest.fn()} onClose={onClose} />,
    );
    await fireEvent.press(screen.getByText('View progress ›'));
    expect(onClose).toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith({ pathname: '/exercise/[id]', params: { id: 'ex-1' } });
  });

  it('does not offer "View progress" for an unconfirmed group', async () => {
    await render(<EntryPopover entries={[entry({ status: 'needs-confirm' })]} onConfirm={jest.fn()} onClose={jest.fn()} />);
    expect(screen.queryByText('View progress ›')).toBeNull();
  });
```

Check whether `EntryPopover.test.tsx` already imports `fireEvent`/`screen`; add if missing. Also check whether the file already has `import '@/lib/i18n'` — `EntryPopover` currently has no `t()` calls, so add `import '@/lib/i18n';` at the top and `useTranslation` in the component.

- [ ] **Step 2: Run to verify it fails**

Run: `cd mobile && npx jest __tests__/components/EntryPopover.test.tsx` → the two new tests FAIL.

- [ ] **Step 3: Implement**

In `mobile/src/components/EntryPopover.tsx`:
```tsx
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
// …inside the component, after `const clarifyingQuestion = first.clarifyingQuestion;`
const { t } = useTranslation();
const canViewProgress = first.status === 'resolved' && !!first.exerciseId;
function viewProgress() {
  onClose();
  router.push({ pathname: '/exercise/[id]', params: { id: first.exerciseId! } });
}
// …render, just before the Close button:
{canViewProgress ? (
  <Pressable onPress={viewProgress} style={styles.linkBtn} accessibilityRole="button">
    <Text style={styles.linkLabel}>{t('log.viewProgress')}</Text>
  </Pressable>
) : null}
```
Styles: `linkBtn: { paddingVertical: spacing.s2 }`, `linkLabel: { ...typography.bodyEmphasis, color: colors.moss }`.

Add `"viewProgress": "View progress ›"` under the existing `log` block in `en.json` (create the block if absent) and run `npm run i18n:extract`.

- [ ] **Step 4: Run tests**

Run: `cd mobile && npx jest __tests__/components/EntryPopover.test.tsx __tests__/app/log.test.tsx && npm run i18n:check && npx tsc --noEmit -p .` → PASS. (`log.test.tsx` renders the popover too; if it now fails on `expo-router`, add the same `jest.mock('expo-router', …)` there.)

- [ ] **Step 5: Commit**

```bash
cd mobile && git add src/components/EntryPopover.tsx __tests__/components/EntryPopover.test.tsx __tests__/app/log.test.tsx lib/locales/en.json
git commit -m "feat(mobile): View progress link from the Log popover" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DcYdmdCKf14Jte1MS7NMmi"
```

---

### Task 9: Full verification + README

**Files:**
- Modify: `README.md` (repo root) — replace the Stats mention if any.

- [ ] **Step 1: Full suite**

Run: `cd mobile && npx jest && npx tsc --noEmit -p . && npm run i18n:check`
Expected: all PASS.

- [ ] **Step 2: README**

`grep -n -i "heatmap\|stats\|goal" README.md`. If the README describes the Stats tab as heatmap/goals, replace that sentence with: "**Stats** lists every exercise you've logged with a headline top-set weight, delta and sparkline; tap one for a chart (top set / est. 1RM / volume) and the session history." Otherwise skip.

- [ ] **Step 3: Manual smoke (phone/Expo)**

Open Stats → list shows confirmed exercises; change range; tap a row → detail; back; in Log tap a green highlight → "View progress ›" → detail.

- [ ] **Step 4: Commit**

```bash
git add README.md && git commit -m "docs: describe the per-exercise Stats tab" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DcYdmdCKf14Jte1MS7NMmi"
```
(Skip if README unchanged.)
