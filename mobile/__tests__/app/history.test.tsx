import { render, screen, waitFor } from '@testing-library/react-native';
import HistoryScreen from '../../app/(tabs)/history';
import { resetDbForTests } from '../../src/db/client';
import { upsertLocalSession, listLocalSessions } from '../../src/db/sessionsRepo';

jest.mock('../../src/db/sessionsRepo', () => {
  const actual = jest.requireActual('../../src/db/sessionsRepo');
  return { ...actual, listLocalSessions: jest.fn(actual.listLocalSessions) };
});

const mockListLocalSessions = listLocalSessions as jest.Mock;

beforeEach(async () => {
  resetDbForTests();
  await upsertLocalSession({
    date: '2026-07-01',
    notes: 'leg day',
    synced: 1,
    entries: [{ id: 'e1', exerciseId: null, equipment: null, weightKg: 40, reps: 8, sets: 3, rawText: 'BB RDL 40kg 8x3', parsedBy: 'DICTIONARY', order: 0, synced: 1 }],
  });
});

describe('HistoryScreen', () => {
  it('lists past sessions with their raw entry text', async () => {
    await render(<HistoryScreen />);

    await waitFor(() => {
      expect(screen.getByText('2026-07-01')).toBeTruthy();
      expect(screen.getByText('BB RDL 40kg 8x3')).toBeTruthy();
    });
  });

  it('shows an error message when loading sessions rejects', async () => {
    mockListLocalSessions.mockRejectedValueOnce(new Error('db error'));

    await render(<HistoryScreen />);

    await waitFor(() => {
      expect(screen.getByText("Couldn't load data. Pull down or reopen the app to retry.")).toBeTruthy();
    });
  });
});
