import { resetDbForTests } from '@/src/db/client';
import { upsertLocalSession, getLocalSession } from '@/src/db/sessionsRepo';
import { cacheAbbreviations, getCachedAbbreviations } from '@/src/db/abbreviationsRepo';

beforeEach(() => resetDbForTests());

const entry = (id: string) => ({
  id, exerciseId: 'ex', equipment: null, weightKg: 10, reps: 5, sets: 1, rawText: 'x', parsedBy: 'DICTIONARY' as const, order: 0, synced: 0 as const,
});

it('concurrent write transactions (save note while sync caches the dictionary) all succeed', async () => {
  // Fire several overlapping writers at once — what happens when the editor's
  // debounced save races the auto-sync's cache refresh.
  await Promise.all([
    upsertLocalSession({ date: '2026-08-23', notes: 'a', synced: 0, entries: [entry('a')] }),
    cacheAbbreviations([{ id: '1', token: 'RDL', exerciseId: 'ex', source: 'USER_ADDED', createdAt: '' }]),
    upsertLocalSession({ date: '2026-08-23', notes: 'b', synced: 0, entries: [entry('b')] }),
    cacheAbbreviations([{ id: '2', token: 'BB', modifierType: 'equipment', modifierValue: 'Barbell', source: 'USER_ADDED', createdAt: '' }]),
    upsertLocalSession({ date: '2026-08-24', notes: 'c', synced: 0, entries: [entry('c')] }),
  ]);
  expect((await getLocalSession('2026-08-23'))?.notes).toBe('b');
  expect((await getLocalSession('2026-08-24'))?.notes).toBe('c');
  expect((await getCachedAbbreviations()).map((a) => a.token)).toEqual(['BB']);
});
