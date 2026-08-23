// mobile/__tests__/exerciseProgress.test.ts
import {
  computeExerciseProgress, rangeStart, seriesFor, isPr, prDates, headlineFor, deltaFor,
  formatHeadline, formatDelta, formatSetLine, formatShortDate, relativeDay, type StatsRow,
} from '@/lib/exerciseProgress';

function row(p: Partial<StatsRow> & { sessionDate: string }): StatsRow {
  return {
    exerciseId: 'ex-dl', exerciseName: 'Barbell Deadlift', latestRawText: 'DL',
    weightKg: 100, reps: 5, sets: 3, entryOrder: 0, ...p,
  };
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

  it('falls back to the latest raw text when the cache has no name, and null when neither exists', () => {
    const [raw] = computeExerciseProgress([row({ sessionDate: '2026-08-01', exerciseName: null, latestRawText: 'deads' })]);
    expect(raw.name).toBe('deads');
    const [none] = computeExerciseProgress([row({ sessionDate: '2026-08-01', exerciseName: null, latestRawText: null })]);
    expect(none.name).toBeNull();
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
    expect([...prDates(p)]).toEqual(['2026-07-01', '2026-08-15']);
  });
  it('headline and delta follow the metric: est1rm rounds to 0.5 kg, volume to whole kg', () => {
    expect(headlineFor(p, 'topSet')).toEqual({ value: 100, unit: 'kg' });
    expect(headlineFor(p, 'est1rm')).toEqual({ value: 110, unit: 'kg' }); // 100 × (1 + 3/30)
    expect(headlineFor(p, 'volume')).toEqual({ value: 900, unit: 'kg' });
    expect(deltaFor(p, 'topSet')).toEqual({ value: 10, unit: 'kg' });
    expect(deltaFor(p, 'est1rm')).toEqual({ value: 5, unit: 'kg' }); // 110 − 105
    expect(deltaFor(p, 'volume')).toEqual({ value: -450, unit: 'kg' });
  });
  it('est1rm headline rounds to the nearest 0.5 kg', () => {
    const [q] = computeExerciseProgress([row({ sessionDate: '2026-06-01', weightKg: 100, reps: 4 })]);
    expect(headlineFor(q, 'est1rm')).toEqual({ value: 113.5, unit: 'kg' }); // 113.33…
    expect(deltaFor(q, 'est1rm')).toBeNull();
  });
});

describe('formatting', () => {
  it('formats headlines with a spaced unit', () => {
    expect(formatHeadline({ value: 100, unit: 'kg' })).toBe('100 kg');
    expect(formatHeadline({ value: 22.5, unit: 'kg' })).toBe('22.5 kg');
    expect(formatHeadline({ value: 12, unit: 'reps' })).toBe('12 reps');
  });
  it('formats deltas with sign and unit; null (first session) is empty', () => {
    expect(formatDelta({ value: 10, unit: 'kg' })).toBe('▲ +10 kg');
    expect(formatDelta({ value: -2.5, unit: 'kg' })).toBe('▼ −2.5 kg');
    expect(formatDelta({ value: 3, unit: 'reps' })).toBe('▲ +3 reps');
    expect(formatDelta({ value: 0, unit: 'kg' })).toBe('±0 kg');
    expect(formatDelta(null)).toBe('');
  });
  it('formats set lines in the Log notation', () => {
    expect(formatSetLine({ weightKg: 40, reps: 8, sets: 4 })).toBe('40kg×8×4');
    expect(formatSetLine({ weightKg: 40, reps: 8, sets: 1 })).toBe('40kg×8');
    expect(formatSetLine({ weightKg: 40, reps: null, sets: null })).toBe('40kg');
    expect(formatSetLine({ weightKg: null, reps: 12, sets: 3 })).toBe('12 reps × 3');
    expect(formatSetLine({ weightKg: null, reps: 12, sets: 1 })).toBe('12 reps');
    expect(formatSetLine({ weightKg: null, reps: 12, sets: 3 }, { weightlessAs: 'bw' })).toBe('BW×12×3');
    expect(formatSetLine({ weightKg: null, reps: null, sets: null })).toBe('');
  });
  it('formats short dates with weekday and an optional year', () => {
    expect(formatShortDate('2026-07-01', { withYear: false })).toBe('Wed 1 Jul');
    expect(formatShortDate('2025-12-25', { withYear: true })).toBe('Thu 25 Dec 2025');
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
