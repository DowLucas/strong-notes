import '@/lib/i18n';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import StatsScreen from '../../app/(tabs)/stats';
import { useAuth } from '@/lib/auth';

jest.mock('@/lib/auth');
jest.mock('@/src/sync/syncEngine', () => ({ syncNow: jest.fn().mockResolvedValue({ pushed: 0, pulled: 0 }) }));

function fakeApi(overrides: Record<string, jest.Mock> = {}) {
  return {
    getGoalProgress: jest.fn().mockRejectedValue(Object.assign(new Error('not found'), { status: 404 })),
    createGoal: jest.fn().mockResolvedValue({ id: 'g1', type: 'HYPERTROPHY', targets: [] }),
    resolveGoal: jest.fn(),
    ...overrides,
  };
}

describe('StatsScreen', () => {
  it('shows a no-goal-yet empty state on a 404, not a generic error', async () => {
    (useAuth as jest.Mock).mockReturnValue({ api: fakeApi() });
    await render(<StatsScreen />);

    await waitFor(() => {
      expect(screen.getByText(/no goal set yet/i)).toBeTruthy();
    });
  });

  it('creates a preset goal and refreshes progress', async () => {
    const api = fakeApi();
    (useAuth as jest.Mock).mockReturnValue({ api });
    await render(<StatsScreen />);
    await waitFor(() => screen.getByText('Hypertrophy'));

    await fireEvent.press(screen.getByText('Hypertrophy'));

    await waitFor(() => {
      expect(api.createGoal).toHaveBeenCalledWith({ type: 'HYPERTROPHY' });
      expect(api.getGoalProgress).toHaveBeenCalledTimes(2); // initial mount + post-create refresh
    });
  });
});
