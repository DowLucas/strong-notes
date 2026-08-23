// Shared x/y scaling for Sparkline and ProgressChart.
export type ChartPoint = { date: string; value: number | null };

export type Scaled = { x: number; y: number; value: number; date: string };

export type ChartPad = { top: number; right: number; bottom: number; left: number };

/** Splits points into contiguous runs of non-null values, already scaled to pixels. */
export function scaleRuns(
  points: ChartPoint[],
  width: number,
  height: number,
  pad: ChartPad,
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
