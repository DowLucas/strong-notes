import { syncNow } from '../../src/sync/syncEngine';
import * as client from '../../src/api/client';
import * as sessionsRepo from '../../src/db/sessionsRepo';
import * as abbreviationsRepo from '../../src/db/abbreviationsRepo';

jest.mock('../../src/api/client');
jest.mock('../../src/db/sessionsRepo');
jest.mock('../../src/db/abbreviationsRepo');

describe('syncNow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('pushes each unsynced local session to the backend and marks it synced', async () => {
    (sessionsRepo.listUnsyncedSessions as jest.Mock).mockResolvedValue([
      { date: '2026-07-04', notes: 'leg day', synced: 0, entries: [] },
    ]);
    (client.putSession as jest.Mock).mockResolvedValue({});
    (client.listAbbreviations as jest.Mock).mockResolvedValue([]);

    const result = await syncNow();

    expect(client.putSession).toHaveBeenCalledWith('2026-07-04', { notes: 'leg day', entries: [] });
    expect(sessionsRepo.markSessionSynced).toHaveBeenCalledWith('2026-07-04');
    expect(result.pushed).toBe(1);
  });

  it('pulls the abbreviation dictionary and caches it', async () => {
    (sessionsRepo.listUnsyncedSessions as jest.Mock).mockResolvedValue([]);
    (client.listAbbreviations as jest.Mock).mockResolvedValue([{ id: '1', token: 'RDL', source: 'BUILT_IN' }]);

    const result = await syncNow();

    expect(abbreviationsRepo.cacheAbbreviations).toHaveBeenCalledWith([{ id: '1', token: 'RDL', source: 'BUILT_IN' }]);
    expect(result.pulled).toBe(1);
  });

  it('does not mark a session synced if the push fails', async () => {
    (sessionsRepo.listUnsyncedSessions as jest.Mock).mockResolvedValue([
      { date: '2026-07-05', notes: null, synced: 0, entries: [] },
    ]);
    (client.putSession as jest.Mock).mockRejectedValue(new Error('network down'));
    (client.listAbbreviations as jest.Mock).mockResolvedValue([]);

    const result = await syncNow();

    expect(sessionsRepo.markSessionSynced).not.toHaveBeenCalled();
    expect(result.pushed).toBe(0);
  });
});
