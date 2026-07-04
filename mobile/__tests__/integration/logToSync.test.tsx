// End-to-end integration test for the "log a set -> see it in Stats" flow.
//
// This is the test that should have existed and would have caught the
// critical bug where parseQuickEntryLine discarded resolvedTokens entirely
// and persistLines hardcoded exerciseId: null for every entry. Without an
// exerciseId AND a sets value, the backend's progress computation
// (backend/src/routes/goals.ts: `if (!entry.exercise || !entry.sets)
// continue;`) silently skips the entry, so nothing logged through the app
// would ever show up in the Stats heatmap.
//
// This test drives the real LogScreen component against the real (in-memory)
// SQLite db used by sessionsRepo/abbreviationsRepo, mocking only the network
// boundary (api/client) and the local abbreviation cache lookup, then runs
// the real syncEngine.syncNow to prove the exact payload that would be sent
// to the backend carries exerciseId, sets, reps, and weightKg.
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import LogScreen from '../../app/(tabs)/index';
import { resolveLine, putSession, listAbbreviations } from '../../src/api/client';
import { getCachedAbbreviations } from '../../src/db/abbreviationsRepo';
import { resetDbForTests } from '../../src/db/client';
import { getLocalSession } from '../../src/db/sessionsRepo';
import { syncNow } from '../../src/sync/syncEngine';

jest.mock('../../src/api/client', () => ({
  resolveLine: jest.fn(),
  putSession: jest.fn(),
  listAbbreviations: jest.fn(),
}));

jest.mock('../../src/db/abbreviationsRepo', () => ({
  getCachedAbbreviations: jest.fn(),
  cacheAbbreviations: jest.fn(),
}));

const mockResolveLine = resolveLine as jest.Mock;
const mockGetCachedAbbreviations = getCachedAbbreviations as jest.Mock;
const mockPutSession = putSession as jest.Mock;
const mockListAbbreviations = listAbbreviations as jest.Mock;

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

describe('log a set -> sync flow (integration)', () => {
  beforeEach(() => {
    resetDbForTests();
    mockResolveLine.mockReset();
    mockGetCachedAbbreviations.mockReset();
    mockPutSession.mockReset();
    mockListAbbreviations.mockReset();
    mockPutSession.mockResolvedValue({});
    mockListAbbreviations.mockResolvedValue([]);
  });

  it('carries exerciseId and parsed sets/reps/weightKg from a locally-cached dictionary match all the way to the synced payload', async () => {
    // The token "RDL" resolves purely from the local abbreviation cache
    // (no network round-trip), just like the local-cache-first fast path in
    // quickEntry.ts.
    mockGetCachedAbbreviations.mockResolvedValue([
      { id: 'abbr-1', token: 'RDL', exerciseId: 'ex-99', source: 'BUILT_IN' },
    ]);

    await render(<LogScreen />);
    const input = screen.getByPlaceholderText('Log a set...');
    await fireEvent.changeText(input, 'RDL 40kg 8x3');
    await fireEvent(input, 'submitEditing');

    await waitFor(() => {
      expect(screen.getByText('RDL 40kg 8x3')).toBeTruthy();
    });

    // The dictionary-only path never hits the network - resolveLine should
    // not have been called at all.
    expect(mockResolveLine).not.toHaveBeenCalled();

    // What actually landed in local SQLite must carry the exerciseId and the
    // client-side-parsed weight/reps/sets, not the old hardcoded nulls.
    let session: Awaited<ReturnType<typeof getLocalSession>>;
    await waitFor(async () => {
      session = await getLocalSession(todayDate());
      expect(session?.entries).toHaveLength(1);
    });

    const entry = session!.entries[0];
    expect(entry.exerciseId).toBe('ex-99');
    expect(entry.weightKg).toBe(40);
    expect(entry.reps).toBe(8);
    expect(entry.sets).toBe(3);

    // Now drive it through the real sync engine and inspect exactly what
    // would be pushed to the backend's /sessions/:date endpoint - this is
    // the payload the backend's progress computation reads `entry.exercise`
    // and `entry.sets` off of.
    await syncNow();

    expect(mockPutSession).toHaveBeenCalledTimes(1);
    const [date, body] = mockPutSession.mock.calls[0];
    expect(date).toBe(todayDate());
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0]).toMatchObject({
      exerciseId: 'ex-99',
      weightKg: 40,
      reps: 8,
      sets: 3,
      rawText: 'RDL 40kg 8x3',
      parsedBy: 'DICTIONARY',
    });
  });
});
