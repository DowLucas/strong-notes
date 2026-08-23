# Exercise Progress Stats — Design

Date: 2026-08-23
Status: approved in brainstorming, pending spec review

## Goal

Replace the Stats tab's weekly muscle heatmap + goal section with a per-exercise
progress view: a scannable list of every exercise the user has logged, each with
a headline number, delta and sparkline, and a tappable detail screen with a real
chart and the session history behind it.

## Decisions (from brainstorming)

| Topic | Decision |
| --- | --- |
| Overview layout | Dense list, one row per exercise, inline sparkline ("A") |
| Detail layout | Chart card + metric toggle + session list ("B"), as a **pushed screen** `/exercise/[id]` |
| Heatmap + goals | Removed from Stats (not relocated) |
| Headline metric | **Top-set weight** (easy to understand). Bodyweight exercises use best reps. Est. 1RM and volume are toggles on the detail chart only |
| Time range | Default **3 months**, picker `1m · 3m · 6m · 1y · All` |
| Data source | **Local SQLite only**, structured so a future "pull sessions" sync fills the same tables with no Stats changes |
| Reuse | The detail route is also linked from the Log tab's popover for a confirmed exercise ("View progress ›") |

## Non-goals (v1)

- No server endpoint; no pulling other devices' sessions (separate follow-up).
- No chart animation, pinch/zoom, or per-point tooltips.
- No PR notifications; PR markers are display-only in the session list.
- Goals/heatmap are not moved elsewhere — they're simply gone from the UI
  (API client methods and backend stay).

## Architecture

```
app/(tabs)/stats.tsx ──┐
app/exercise/[id].tsx ─┼─▶ src/db/statsRepo.ts ──▶ SQLite (set_entries ⋈ abbreviations_cache)
                       └─▶ lib/exerciseProgress.ts (pure metrics)
src/components/Sparkline.tsx, ProgressChart.tsx, ExerciseRow.tsx  (react-native-svg)
src/components/EntryPopover.tsx  ── "View progress ›" → /exercise/[id]
```

### `lib/exerciseProgress.ts` — pure metrics (no I/O)

```ts
export type SetLine = { weightKg: number | null; reps: number | null; sets: number | null };

export type SessionPoint = {
  date: string;                 // YYYY-MM-DD
  topWeightKg: number | null;   // max weight; tie → the set with more reps
  topReps: number;              // reps of that top set (or best reps when bodyweight)
  est1rm: number | null;        // Epley on the top set: w * (1 + reps/30)
  volume: number;               // Σ weight×reps×sets (weightless sets contribute 0)
  sets: SetLine[];              // in entry order, for the detail session list
};

export type Metric = 'topSet' | 'est1rm' | 'volume';
export type Unit = 'kg' | 'reps';

export type ExerciseProgress = {
  exerciseId: string;
  name: string;
  points: SessionPoint[];       // ascending by date, within range
  headline: { value: number; unit: Unit };      // latest point's top set (or reps)
  delta: { value: number; unit: Unit } | null;  // vs first point in range; null if < 2 points
  lastDate: string;
  sessionCount: number;
};

export type Range = '1m' | '3m' | '6m' | '1y' | 'all';

export function rangeStart(range: Range, today: string): string | null;   // null = no lower bound
export function computeExerciseProgress(
  rows: StatsRow[],             // from statsRepo, already range-filtered
  today: string,
): ExerciseProgress[];         // sorted by lastDate desc
export function seriesFor(p: ExerciseProgress, metric: Metric): { date: string; value: number | null }[];
```

Rules:
- **Top set**: highest `weightKg`; ties broken by higher `reps`. If every set in the
  session has `weightKg == null` the exercise point is bodyweight: `topWeightKg = null`,
  `topReps = max reps`.
- **Unit**: an exercise is `reps`-unit if *all* points are bodyweight; otherwise `kg`
  (weightless sessions of a weighted exercise plot as gaps, not zeros).
- **Delta**: `latest.topWeightKg − first.topWeightKg` in kg. If equal and
  `latest.topReps > first.topReps`, delta is `{ reps }`. For reps-unit exercises, delta is in reps.
- **Est. 1RM** uses the top set; null when bodyweight. **Volume** ignores weightless sets.
- Entries with `exercise_id IS NULL` (unconfirmed) are excluded everywhere.
- `rangeStart('3m', today)` = today minus 3 calendar months (same day-of-month, clamped).

### `src/db/statsRepo.ts`

```ts
export type StatsRow = {
  exerciseId: string; exerciseName: string | null;
  sessionDate: string; weightKg: number | null; reps: number | null; sets: number | null; entryOrder: number;
};
export async function listStatsRows(fromDate: string | null): Promise<StatsRow[]>;
```

One query: `set_entries` where `exercise_id IS NOT NULL` and (`fromDate` null or
`session_date >= ?`), `LEFT JOIN` the first matching `abbreviations_cache` row per
`exercise_id` for `exercise_name`, ordered by `exercise_id, session_date, entry_order`.
Name fallback (in `computeExerciseProgress`): i18n `"Unnamed exercise"` until the
dictionary sync supplies a name. The repo does no math; a later pull-sync only has to
insert into `sessions`/`set_entries`.

### UI

**`app/(tabs)/stats.tsx`** (rewritten, heatmap/goals removed)
- `TopBar` title "Progress"; range `Chip` row (state, default `3m`).
- Loads `listStatsRows(rangeStart(range))` on focus and when range changes → `computeExerciseProgress`.
- `FlatList` of `ExerciseRow`; `EmptyState` when no rows ("Log a workout with a confirmed exercise to see progress here").
- Row tap → `router.push({ pathname: '/exercise/[id]', params: { id } })`.

**`src/components/ExerciseRow.tsx`**
```
│ Barbell Deadlift      100kg ▲ +10    ╱╱  │
│ 14 sessions · last Thu          ___╱     │
```
Delta colour: up `colors.moss`, down `colors.brick`, flat/none `colors.lead`. Headline
formats `100kg` / `×12` (reps unit) / `22.5kg`. "last" uses a short relative date
(today / weekday within 6 days / `2w ago` / date). Accessibility label summarises the row.

**`src/components/Sparkline.tsx`** — `react-native-svg` polyline of the top-set series
(gaps break the line), fixed 80×24, stroke `colors.graphite`, last point dotted in moss.

**`app/exercise/[id].tsx`** (new route under a stack with back; outside the tab bar)
- Header: name; headline + delta line; `sessionCount`.
- `ProgressChart` (svg line + points, 3–4 y ticks, month labels on x, gaps for nulls).
- Metric `Chip` toggle `Top set · Est. 1RM · Volume` (hidden for reps-unit exercises → only Top set/reps).
- Range chips, same as the list.
- Session list (newest first): `Aug 21   100kg 8×3   65kg 6×2` with a `▲` (moss) marker on
  a session whose top set beats every earlier point in range.
- Reads the same repo + metrics; the toggle only changes `seriesFor(...)`.

**`src/components/EntryPopover.tsx`** — for `status === 'resolved'` with an `exerciseId`,
a "View progress ›" link that closes the popover and pushes `/exercise/[id]`.

**Removal**: `MuscleHeatmap` and its test are deleted if `stats.tsx` was the only user
(verify with grep). Goal API client methods remain.

**i18n**: all new strings via `useTranslation`; run `npm run i18n:extract`.

### Error handling

- DB read failure → existing `EmptyState`/error message pattern used by other tabs; never crash.
- Unknown `id` in `/exercise/[id]` (e.g. stale link) → empty state with back.
- Names missing → fallback label, never blank.

### Testing

- `__tests__/exerciseProgress.test.ts`: top-set tie-break, bodyweight unit, weighted exercise
  with a weightless session (gap), delta kg / reps / null, est1rm & volume, `rangeStart`
  month clamping (e.g. May 31 → Feb 28/29), sorting by lastDate, exclusion of null exerciseId, name fallback.
- `__tests__/db/statsRepo.test.ts`: seeds sessions + cache into the test DB; asserts join, range filter, ordering.
- `__tests__/app/stats.test.tsx`: rows render headline/delta, empty state, range chip reloads, tap navigates (mock `expo-router`).
- `__tests__/app/exercise-detail.test.tsx`: chart + session list render, metric toggle switches series, PR marker, unknown id.
- `__tests__/components/EntryPopover.test.tsx`: "View progress" shown only for resolved entries.

## Follow-ups (out of scope)

- Pull sessions from the server on sync so Stats covers all devices.
- Exercise rename / merge from the detail screen.
- Per-point tooltips and horizontal scrubbing on the chart.
