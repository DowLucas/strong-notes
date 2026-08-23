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
