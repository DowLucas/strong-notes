import { resetDbForTests } from '@/src/db/client';
import { upsertLocalSession, getLocalSession } from '@/src/db/sessionsRepo';

beforeEach(() => {
  resetDbForTests();
});

describe('sessionsRepo span tracking', () => {
  it('round-trips spanStart/spanEnd on an entry', async () => {
    await upsertLocalSession({
      date: '2026-07-05',
      notes: 'did RDL 40kg 8x3',
      synced: 0,
      entries: [
        {
          id: 'e1', exerciseId: 'ex-1', equipment: null, weightKg: 40, reps: 8, sets: 3,
          rawText: 'did RDL 40kg 8x3', parsedBy: 'DICTIONARY', order: 0, synced: 0,
          spanStart: 0, spanEnd: 16,
        },
      ],
    });

    const session = await getLocalSession('2026-07-05');
    expect(session?.entries[0].spanStart).toBe(0);
    expect(session?.entries[0].spanEnd).toBe(16);
  });

  it('defaults missing spans to null', async () => {
    await upsertLocalSession({
      date: '2026-07-06', notes: null, synced: 0,
      entries: [
        { id: 'e2', exerciseId: null, equipment: null, weightKg: null, reps: null, sets: null,
          rawText: 'note', parsedBy: 'DICTIONARY', order: 0, synced: 0 },
      ],
    });
    const session = await getLocalSession('2026-07-06');
    expect(session?.entries[0].spanStart ?? null).toBeNull();
    expect(session?.entries[0].spanEnd ?? null).toBeNull();
  });
});
