import { recommendProgression } from '@/lib/progression';
import type { ExerciseHistory, PriorSetGroup } from '@/lib/priorHistory';

const sess = (date: string, entries: PriorSetGroup[]): ExerciseHistory => ({ date, entries });

describe('recommendProgression', () => {
  it('leads with progression when last reps were solid (>=8)', () => {
    const r = recommendProgression([
      sess('2026-03-05', [
        { weightKg: 40, reps: 8, sets: 1 },
        { weightKg: 50, reps: 8, sets: 4 },
      ]),
    ]);
    // Top set is 50kg×8 → progress first (+2.5), then repeat.
    expect(r[0]).toMatchObject({ kind: 'progress', token: '52.5kgx8', display: '52.5kg×8' });
    expect(r[1]).toMatchObject({ kind: 'repeat', token: '50kgx8' });
  });

  it('leads with repeat when last reps were low (<8)', () => {
    const r = recommendProgression([sess('2026-03-05', [{ weightKg: 60, reps: 5, sets: 5 }])]);
    expect(r[0]).toMatchObject({ kind: 'repeat', token: '60kgx5' });
    expect(r[1]).toMatchObject({ kind: 'progress', token: '62.5kgx5' });
  });

  it('infers the step from the most recent jump', () => {
    const r = recommendProgression([
      sess('2026-03-05', [{ weightKg: 45, reps: 8, sets: 3 }]),
      sess('2026-03-03', [{ weightKg: 40, reps: 8, sets: 3 }]), // +5kg last time
    ]);
    expect(r[0]).toMatchObject({ kind: 'progress', token: '50kgx8' }); // 45 + 5
  });

  it('progresses a bodyweight lift by reps, not load', () => {
    const r = recommendProgression([sess('2026-03-05', [{ weightKg: null, reps: 8, sets: 3 }])]);
    expect(r[0]).toMatchObject({ kind: 'progress', token: 'barx10', display: '10 reps' });
    expect(r[1]).toMatchObject({ kind: 'repeat', token: 'barx8' });
  });

  it('returns nothing without usable history', () => {
    expect(recommendProgression([])).toEqual([]);
    expect(recommendProgression([sess('2026-03-05', [])])).toEqual([]);
  });
});
