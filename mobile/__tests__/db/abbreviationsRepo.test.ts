import { resetDbForTests } from '@/src/db/client';
import { cacheAbbreviations, getCachedAbbreviations, upsertCachedAbbreviations } from '@/src/db/abbreviationsRepo';

beforeEach(() => {
  resetDbForTests();
});

describe('abbreviationsRepo', () => {
  it('replaces the entire cache on each call', async () => {
    await cacheAbbreviations([
      { id: '1', token: 'RDL', exerciseId: 'ex-1', source: 'BUILT_IN', createdAt: '2026-01-01T00:00:00Z' },
    ]);
    await cacheAbbreviations([
      { id: '2', token: 'HT', exerciseId: 'ex-2', source: 'BUILT_IN', createdAt: '2026-01-01T00:00:00Z' },
    ]);

    const cached = await getCachedAbbreviations();
    expect(cached).toHaveLength(1);
    expect(cached[0].token).toBe('HT');
  });
});

describe('upsertCachedAbbreviations', () => {
  it('adds new tokens and replaces existing ones without dropping the rest of the cache', async () => {
    await cacheAbbreviations([
      { id: '1', token: 'RDL', exerciseId: 'ex-1', source: 'BUILT_IN', createdAt: '' },
      { id: '2', token: 'BB', modifierType: 'equipment', modifierValue: 'Barbell', source: 'USER_ADDED', createdAt: '' },
    ]);
    await upsertCachedAbbreviations([
      { id: '3', token: 'ROWS', exerciseId: 'ex-rows', exerciseName: 'Barbell Rows', source: 'USER_ADDED', createdAt: '' },
      { id: '1', token: 'RDL', exerciseId: 'ex-1', exerciseName: 'Romanian Deadlift', source: 'BUILT_IN', createdAt: '' },
    ]);
    const all = await getCachedAbbreviations();
    expect(all.map((a) => a.token).sort()).toEqual(['BB', 'RDL', 'ROWS']);
    expect(all.find((a) => a.token === 'RDL')?.exerciseName).toBe('Romanian Deadlift');
    expect(all.find((a) => a.token === 'ROWS')?.exerciseId).toBe('ex-rows');
  });
});

