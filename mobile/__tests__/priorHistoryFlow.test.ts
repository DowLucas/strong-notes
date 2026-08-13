import { resetDbForTests } from '@/src/db/client';
import { cacheAbbreviations } from '@/src/db/abbreviationsRepo';
import { seedPriorSessions } from '@/src/db/devSeed';
import { getLastSessionForExercise } from '@/src/db/sessionsRepo';
import { scanNote } from '@/src/parsing/scanNote';
import type { ApiClient, Abbreviation } from '@/lib/api';

function fakeApi(): ApiClient {
  return { resolveLine: jest.fn() } as unknown as ApiClient;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

beforeEach(() => {
  resetDbForTests();
});

describe('prior-history end-to-end data path', () => {
  it('resolves a typed token and finds seeded history under the same id', async () => {
    // Dictionary as it would be after a sync: token 'rdl' -> a real exercise id.
    await cacheAbbreviations([
      { id: 'a1', token: 'rdl', exerciseId: 'ex-rdl', source: 'USER_ADDED', createdAt: '' },
    ] as Abbreviation[]);

    const res = await seedPriorSessions();
    expect(res.tokens).toContain('rdl');

    // Typing "rdl 40kgx8" resolves locally to the same exercise id.
    const entries = await scanNote(fakeApi(), 'rdl 40kgx8', []);
    const resolved = entries.find((e) => e.exerciseId);
    expect(resolved?.exerciseId).toBe('ex-rdl');

    // History exists under that id, strictly before today.
    const h = await getLastSessionForExercise('ex-rdl', today());
    expect(h).not.toBeNull();
    expect(h?.entries.length).toBeGreaterThan(0);
  });
});
