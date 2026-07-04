import { resetDbForTests } from '../../src/db/client';
import {
  upsertLocalSession,
  getLocalSession,
  listUnsyncedSessions,
  markSessionSynced,
} from '../../src/db/sessionsRepo';

beforeEach(() => {
  resetDbForTests();
});

describe('sessionsRepo', () => {
  it('upserts a session with entries and reads it back', async () => {
    await upsertLocalSession({
      date: '2026-07-04',
      notes: 'leg day',
      synced: 0,
      entries: [
        {
          id: 'entry-1',
          exerciseId: null,
          equipment: 'barbell',
          weightKg: 40,
          reps: 8,
          sets: 3,
          rawText: 'BB RDL 40kg 8x3',
          parsedBy: 'DICTIONARY',
          order: 0,
          synced: 0,
        },
      ],
    });

    const session = await getLocalSession('2026-07-04');
    expect(session?.notes).toBe('leg day');
    expect(session?.entries).toHaveLength(1);
    expect(session?.entries[0].rawText).toBe('BB RDL 40kg 8x3');
  });

  it('replaces entries on repeat upsert of the same date', async () => {
    await upsertLocalSession({
      date: '2026-07-05',
      notes: null,
      synced: 0,
      entries: [{ id: 'a', exerciseId: null, equipment: null, weightKg: null, reps: null, sets: null, rawText: 'first', parsedBy: 'DICTIONARY', order: 0, synced: 0 }],
    });
    await upsertLocalSession({
      date: '2026-07-05',
      notes: null,
      synced: 0,
      entries: [{ id: 'b', exerciseId: null, equipment: null, weightKg: null, reps: null, sets: null, rawText: 'second', parsedBy: 'DICTIONARY', order: 0, synced: 0 }],
    });

    const session = await getLocalSession('2026-07-05');
    expect(session?.entries).toHaveLength(1);
    expect(session?.entries[0].rawText).toBe('second');
  });

  it('lists unsynced sessions and marks them synced', async () => {
    await upsertLocalSession({ date: '2026-07-06', notes: null, synced: 0, entries: [] });

    let unsynced = await listUnsyncedSessions();
    expect(unsynced.some((s) => s.date === '2026-07-06')).toBe(true);

    await markSessionSynced('2026-07-06');

    unsynced = await listUnsyncedSessions();
    expect(unsynced.some((s) => s.date === '2026-07-06')).toBe(false);
  });
});
