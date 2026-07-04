import { syncNow } from '@/src/sync/syncEngine';
import * as sessionsRepo from '@/src/db/sessionsRepo';
import * as abbreviationsRepo from '@/src/db/abbreviationsRepo';
import type { ApiClient } from '@/lib/api';

jest.mock('@/src/db/sessionsRepo');
jest.mock('@/src/db/abbreviationsRepo');

function fakeApi(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    putSession: jest.fn(),
    listAbbreviations: jest.fn(),
    ...overrides,
  } as unknown as ApiClient;
}

describe('syncNow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('pushes each unsynced local session to the backend and marks it synced', async () => {
    (sessionsRepo.listUnsyncedSessions as jest.Mock).mockResolvedValue([
      { date: '2026-07-04', notes: 'leg day', synced: 0, entries: [] },
    ]);
    const api = fakeApi({
      putSession: jest.fn().mockResolvedValue({}),
      listAbbreviations: jest.fn().mockResolvedValue([]),
    });

    const result = await syncNow(api);

    expect(api.putSession).toHaveBeenCalledWith('2026-07-04', { notes: 'leg day', entries: [] });
    expect(sessionsRepo.markSessionSynced).toHaveBeenCalledWith('2026-07-04');
    expect(result.pushed).toBe(1);
  });

  it('pulls the abbreviation dictionary and caches it', async () => {
    (sessionsRepo.listUnsyncedSessions as jest.Mock).mockResolvedValue([]);
    const api = fakeApi({
      listAbbreviations: jest.fn().mockResolvedValue([{ id: '1', token: 'RDL', source: 'BUILT_IN', createdAt: '' }]),
    });

    const result = await syncNow(api);

    expect(abbreviationsRepo.cacheAbbreviations).toHaveBeenCalledWith([{ id: '1', token: 'RDL', source: 'BUILT_IN', createdAt: '' }]);
    expect(result.pulled).toBe(1);
  });

  it('does not mark a session synced if the push fails', async () => {
    (sessionsRepo.listUnsyncedSessions as jest.Mock).mockResolvedValue([
      { date: '2026-07-05', notes: null, synced: 0, entries: [] },
    ]);
    const api = fakeApi({
      putSession: jest.fn().mockRejectedValue(new Error('network down')),
      listAbbreviations: jest.fn().mockResolvedValue([]),
    });

    const result = await syncNow(api);

    expect(sessionsRepo.markSessionSynced).not.toHaveBeenCalled();
    expect(result.pushed).toBe(0);
  });
});
