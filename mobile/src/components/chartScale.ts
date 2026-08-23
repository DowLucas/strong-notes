// Shared x/y scaling for Sparkline and ProgressChart.
export type ChartPoint = {
  date: string;
  value: number | null;
  /** Personal record — drawn as a filled accent dot. */
  pr?: boolean;
};

export type Scaled = { x: number; y: number; value: number; date: string; pr: boolean };

export type ChartPad = { top: number; right: number; bottom: number; left: number };

const DAY_MS = 86_400_000;

export function epochDay(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

/** Maps ISO dates onto [pad.left, width − pad.right] by real elapsed time between the first and last point. */
export function xScale(points: { date: string }[], width: number, pad: ChartPad): (date: string) => number {
  const innerW = width - pad.left - pad.right;
  if (points.length === 0) return () => pad.left;
  const first = epochDay(points[0].date);
  const last = epochDay(points[points.length - 1].date);
  const span = Math.max(last - first, 1);
  return (date) => pad.left + (innerW * (epochDay(date) - first)) / span;
}

/** Value extent of a series; a flat series is padded ±5% (±1 around zero) so it never divides by 0. */
export function valueExtent(points: ChartPoint[]): { min: number; max: number } | null {
  const values = points.map((p) => p.value).filter((v): v is number => v != null);
  if (values.length === 0) return null;
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    const padding = min === 0 ? 1 : Math.abs(min) * 0.05;
    min -= padding;
    max += padding;
  }
  return { min, max };
}

/** Splits points into contiguous runs of non-null values, already scaled to pixels (optionally onto a fixed y domain). */
export function scaleRuns(
  points: ChartPoint[],
  width: number,
  height: number,
  pad: ChartPad,
  domain?: { min: number; max: number },
): { runs: Scaled[][]; min: number; max: number } {
  const extent = domain ?? valueExtent(points);
  if (!extent) return { runs: [], min: 0, max: 0 };
  const { min, max } = extent;
  const innerH = height - pad.top - pad.bottom;
  const xFor = xScale(points, width, pad);
  const runs: Scaled[][] = [];
  let current: Scaled[] = [];
  points.forEach((p) => {
    if (p.value == null) {
      if (current.length) runs.push(current);
      current = [];
      return;
    }
    current.push({
      date: p.date,
      value: p.value,
      pr: !!p.pr,
      x: xFor(p.date),
      y: pad.top + innerH - (innerH * (p.value - min)) / (max - min),
    });
  });
  if (current.length) runs.push(current);
  return { runs, min, max };
}

/** 3–5 "nice" tick values covering [min, max] — the first/last tick make a round y domain. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  const span = max - min || 1;
  const rawStep = span / (count - 1);
  const mag = 10 ** Math.floor(Math.log10(rawStep));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= rawStep) ?? mag * 10;
  const start = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; ; v += step) {
    ticks.push(Number(v.toFixed(2)));
    if (v >= max - 1e-9) break;
  }
  return ticks;
}

/** First-of-month dates strictly after `from` and up to `to` (inclusive) — real month boundaries for the x axis. */
export function monthBoundaries(from: string, to: string): string[] {
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  const out: string[] = [];
  let y = fy;
  let m = fm + 1;
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}-01`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out.filter((d) => d > from && d <= to);
}

/** Drops labels closer than `minGap` px to the previous kept label (the first is always kept). */
export function thinLabels<T extends { x: number }>(labels: T[], minGap: number): T[] {
  const kept: T[] = [];
  for (const l of labels) {
    if (kept.length === 0 || l.x - kept[kept.length - 1].x >= minGap) kept.push(l);
  }
  return kept;
}
