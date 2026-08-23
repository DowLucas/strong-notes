// mobile/lib/exerciseProgress.ts
// Pure per-exercise progress metrics for the Stats tab. No I/O: rows come
// from src/db/statsRepo.ts and everything here is deterministic.

export type StatsRow = {
  exerciseId: string;
  exerciseName: string | null;
  /** Raw text of the most recently logged entry for this exercise — the name fallback when the cache has none. */
  latestRawText: string | null;
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

export type Measure = { value: number; unit: Unit };

export type ExerciseProgress = {
  exerciseId: string;
  name: string | null;
  unit: Unit;
  points: SessionPoint[];
  /** Top-set headline (last session). See `headlineFor` for the other metrics. */
  headline: Measure;
  /** Top-set change vs the first session in range; null with a single session. */
  delta: Measure | null;
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
    name: rows.find((r) => r.exerciseName)?.exerciseName ?? rows.find((r) => r.latestRawText)?.latestRawText ?? null,
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

/** Dates of every PR point (see `isPr`). Computed once so callers can flag points from a narrower range. */
export function prDates(p: ExerciseProgress): Set<string> {
  return new Set(p.points.filter((_, i) => isPr(p, i)).map((pt) => pt.date));
}

function roundMetric(metric: Metric, value: number): number {
  // est1rm is an estimate — half-kilo precision is plenty; volume is a whole-kg sum.
  return metric === 'est1rm' ? Math.round(value * 2) / 2 : metric === 'volume' ? Math.round(value) : value;
}

/** Headline for a metric: last session's value (rounded per metric). */
export function headlineFor(p: ExerciseProgress, metric: Metric): Measure {
  if (metric === 'topSet') return p.headline;
  const series = seriesFor(p, metric);
  const last = [...series].reverse().find((s) => s.value != null)?.value ?? 0;
  return { value: roundMetric(metric, last), unit: 'kg' };
}

/** Change on a metric vs the first session in range; null with fewer than two measured sessions. */
export function deltaFor(p: ExerciseProgress, metric: Metric): Measure | null {
  if (metric === 'topSet') return p.delta;
  const measured = seriesFor(p, metric).filter((s) => s.value != null);
  if (measured.length < 2) return null;
  const first = measured[0].value as number;
  const last = measured[measured.length - 1].value as number;
  return { value: roundMetric(metric, last) - roundMetric(metric, first), unit: 'kg' };
}

export function formatHeadline(h: Measure): string {
  return `${h.value} ${h.unit}`;
}

/** "▲ +10 kg" / "▼ −2.5 kg" / "±0 kg"; empty for a null (first-session) delta — callers label that case. */
export function formatDelta(d: Measure | null): string {
  if (!d) return '';
  if (d.value === 0) return `±0 ${d.unit}`;
  const arrow = d.value > 0 ? '▲ +' : '▼ −';
  return `${arrow}${Math.abs(d.value)} ${d.unit}`;
}

/**
 * One set-group in the Log notation: "40kg×8×4", "40kg×8" (single set), "12 reps × 3" when
 * weightless — or "BW×12×3" when the caller wants weightless sets of a weighted exercise flagged.
 */
export function formatSetLine(s: SetLine, opts: { weightlessAs?: 'reps' | 'bw' } = {}): string {
  const multi = s.sets != null && s.sets > 1 ? s.sets : null;
  if (s.weightKg == null) {
    if (s.reps == null) return '';
    if (opts.weightlessAs === 'bw') return multi ? `BW×${s.reps}×${multi}` : `BW×${s.reps}`;
    return multi ? `${s.reps} reps × ${multi}` : `${s.reps} reps`;
  }
  const base = s.reps != null ? `${s.weightKg}kg×${s.reps}` : `${s.weightKg}kg`;
  return multi && s.reps != null ? `${base}×${multi}` : base;
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

/** Short month label for chart axes, e.g. "Jun" — with a two-digit year ("Jun '26") when asked. */
export function monthLabel(date: string, withYear = false): string {
  const d = utc(date);
  const m = MONTHS[d.getUTCMonth()];
  return withYear ? `${m} '${String(d.getUTCFullYear()).slice(2)}` : m;
}

/** Short absolute date for lists: "Thu 1 Jul", or "Thu 1 Jul 2025" with the year. */
export function formatShortDate(date: string, opts: { withYear: boolean }): string {
  const d = utc(date);
  const base = `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  return opts.withYear ? `${base} ${d.getUTCFullYear()}` : base;
}

/** True when two ISO dates fall in different calendar years. */
export function spansYears(from: string, to: string): boolean {
  return from.slice(0, 4) !== to.slice(0, 4);
}
