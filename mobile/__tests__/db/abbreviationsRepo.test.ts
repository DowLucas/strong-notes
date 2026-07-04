import { resetDbForTests } from '../../src/db/client';
import { cacheAbbreviations, getCachedAbbreviations } from '../../src/db/abbreviationsRepo';

beforeEach(() => {
  resetDbForTests();
});

describe('abbreviationsRepo', () => {
  it('replaces the entire cache on each call', async () => {
    await cacheAbbreviations([
      { id: '1', token: 'RDL', exerciseId: 'ex-1', source: 'BUILT_IN' },
    ]);
    await cacheAbbreviations([
      { id: '2', token: 'HT', exerciseId: 'ex-2', source: 'BUILT_IN' },
    ]);

    const cached = await getCachedAbbreviations();
    expect(cached).toHaveLength(1);
    expect(cached[0].token).toBe('HT');
  });
});
