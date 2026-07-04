import { render, screen, waitFor } from '@testing-library/react-native';
import StatsScreen from '../../app/(tabs)/stats';
import { resetDbForTests } from '../../src/db/client';
import { getGoalProgress } from '../../src/api/client';
import { syncNow } from '../../src/sync/syncEngine';

jest.mock('../../src/api/client', () => ({
  getGoalProgress: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../src/sync/syncEngine', () => ({
  syncNow: jest.fn().mockResolvedValue({ pushed: 0, pulled: 0 }),
}));

const mockGetGoalProgress = getGoalProgress as jest.Mock;
const mockSyncNow = syncNow as jest.Mock;

beforeEach(() => {
  resetDbForTests();
  mockGetGoalProgress.mockResolvedValue([]);
  mockSyncNow.mockResolvedValue({ pushed: 0, pulled: 0 });
});

describe('StatsScreen', () => {
  it('loads goal progress after syncing', async () => {
    mockGetGoalProgress.mockResolvedValueOnce([
      { muscle: 'CHEST', actualSets: 4, targetMin: 6, targetMax: 10 },
    ]);

    await render(<StatsScreen />);

    await waitFor(() => {
      expect(screen.getByText('CHEST')).toBeTruthy();
    });
  });

  it('shows an error message when getGoalProgress rejects', async () => {
    mockGetGoalProgress.mockRejectedValueOnce(new Error('network down'));

    await render(<StatsScreen />);

    await waitFor(() => {
      expect(screen.getByText("Couldn't load data. Pull down or reopen the app to retry.")).toBeTruthy();
    });
  });

  it('shows an error message when syncNow rejects', async () => {
    mockSyncNow.mockRejectedValueOnce(new Error('network down'));

    await render(<StatsScreen />);

    await waitFor(() => {
      expect(screen.getByText("Couldn't load data. Pull down or reopen the app to retry.")).toBeTruthy();
    });
  });
});
