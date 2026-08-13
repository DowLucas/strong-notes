import { formatPriorHistory, type ExerciseHistory } from '@/lib/priorHistory';

// Deterministic date stub so the test doesn't depend on locale.
const fmt = (iso: string) => iso;

describe('formatPriorHistory', () => {
  it('formats all set-groups with weight×reps×sets and the date', () => {
    const h: ExerciseHistory = {
      date: '2026-03-05',
      entries: [
        { weightKg: 40, reps: 8, sets: 1 },
        { weightKg: 50, reps: 8, sets: 4 },
      ],
    };
    expect(formatPriorHistory(h, fmt)).toBe('Last · 40kg×8  50kg×8×4 · 2026-03-05');
  });

  it('renders a null weight as "bar" and omits ×1 sets', () => {
    const h: ExerciseHistory = {
      date: '2026-03-05',
      entries: [{ weightKg: null, reps: 12, sets: 1 }],
    };
    expect(formatPriorHistory(h, fmt)).toBe('Last · bar×12 · 2026-03-05');
  });
});
