// Prior-session history for an exercise, surfaced inline in the Log editor as
// an "you did this before" hint. Kept UI-agnostic and pure so it's testable.

export type PriorSetGroup = {
  weightKg: number | null;
  reps: number | null;
  sets: number | null;
};

export type ExerciseHistory = {
  // ISO date (YYYY-MM-DD) of the most recent prior session with this exercise.
  date: string;
  // Every set-group logged for the exercise on that date, in entry order.
  entries: PriorSetGroup[];
};

function formatGroup(g: PriorSetGroup): string {
  const weight = g.weightKg == null ? 'bar' : `${g.weightKg}kg`;
  const reps = g.reps ?? '?';
  const base = `${weight}×${reps}`;
  return g.sets && g.sets > 1 ? `${base}×${g.sets}` : base;
}

// e.g. "Last · 40kg×8  50kg×8×4 · 5 Mar". `formatDate` is injected so the
// caller controls locale (and so this stays pure/testable).
export function formatPriorHistory(
  history: ExerciseHistory,
  formatDate: (isoDate: string) => string,
): string {
  const groups = history.entries.map(formatGroup).join('  ');
  return `Last · ${groups} · ${formatDate(history.date)}`;
}
