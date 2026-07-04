import { render, screen, waitFor, fireEvent } from '@testing-library/react-native';
import StatsScreen from '../../app/(tabs)/stats';
import { resetDbForTests } from '../../src/db/client';
import { getGoalProgress, createGoal, resolveGoal, ApiError } from '../../src/api/client';
import { syncNow } from '../../src/sync/syncEngine';

jest.mock('../../src/api/client', () => {
  const actual = jest.requireActual('../../src/api/client');
  return {
    ...actual,
    getGoalProgress: jest.fn().mockResolvedValue([]),
    createGoal: jest.fn().mockResolvedValue({}),
    resolveGoal: jest.fn().mockResolvedValue({ type: 'HYPERTROPHY', muscles: [] }),
  };
});

jest.mock('../../src/sync/syncEngine', () => ({
  syncNow: jest.fn().mockResolvedValue({ pushed: 0, pulled: 0 }),
}));

const mockGetGoalProgress = getGoalProgress as jest.Mock;
const mockCreateGoal = createGoal as jest.Mock;
const mockResolveGoal = resolveGoal as jest.Mock;
const mockSyncNow = syncNow as jest.Mock;

beforeEach(() => {
  resetDbForTests();
  mockGetGoalProgress.mockReset().mockResolvedValue([]);
  mockCreateGoal.mockReset().mockResolvedValue({});
  mockResolveGoal.mockReset().mockResolvedValue({ type: 'HYPERTROPHY', muscles: [] });
  mockSyncNow.mockReset().mockResolvedValue({ pushed: 0, pulled: 0 });
});

describe('StatsScreen', () => {
  it('loads goal progress after syncing', async () => {
    mockGetGoalProgress.mockResolvedValueOnce([
      { muscle: 'CHEST', actualSets: 4, targetMin: 6, targetMax: 10 },
    ]);

    await render(<StatsScreen />);

    await waitFor(() => {
      expect(screen.getByLabelText('Chest: 4 of 10 sets')).toBeTruthy();
    });
  });

  it('shows an error message when getGoalProgress rejects', async () => {
    mockGetGoalProgress.mockRejectedValueOnce(new Error('network down'));

    await render(<StatsScreen />);

    await waitFor(() => {
      expect(screen.getByText("Couldn't load data. Pull down or reopen the app to retry.")).toBeTruthy();
    });
  });

  it('shows a friendly empty state (not the error banner) when getGoalProgress 404s (no active goal yet)', async () => {
    mockGetGoalProgress.mockRejectedValueOnce(new ApiError('no active goal', 404));

    await render(<StatsScreen />);

    await waitFor(() => {
      expect(screen.getByText('No goal set yet — pick one below to start tracking.')).toBeTruthy();
    });
    expect(screen.queryByText("Couldn't load data. Pull down or reopen the app to retry.")).toBeNull();
  });

  it('still shows the generic error banner when getGoalProgress fails with a real error (500)', async () => {
    mockGetGoalProgress.mockRejectedValueOnce(new ApiError('server error', 500));

    await render(<StatsScreen />);

    await waitFor(() => {
      expect(screen.getByText("Couldn't load data. Pull down or reopen the app to retry.")).toBeTruthy();
    });
    expect(screen.queryByText('No goal set yet — pick one below to start tracking.')).toBeNull();
  });

  it('shows an error message when syncNow rejects', async () => {
    mockSyncNow.mockRejectedValueOnce(new Error('network down'));

    await render(<StatsScreen />);

    await waitFor(() => {
      expect(screen.getByText("Couldn't load data. Pull down or reopen the app to retry.")).toBeTruthy();
    });
  });

  it('pressing a preset calls createGoal with that type and refetches progress', async () => {
    await render(<StatsScreen />);

    await waitFor(() => {
      expect(mockGetGoalProgress).toHaveBeenCalledTimes(1);
    });

    mockGetGoalProgress.mockResolvedValueOnce([
      { muscle: 'CHEST', actualSets: 2, targetMin: 6, targetMax: 10 },
    ]);

    await fireEvent.press(screen.getByText('Hypertrophy'));

    await waitFor(() => {
      expect(mockCreateGoal).toHaveBeenCalledWith({ type: 'HYPERTROPHY' });
    });
    await waitFor(() => {
      expect(mockGetGoalProgress).toHaveBeenCalledTimes(2);
    });
  });

  it('entering free text and pressing Set Goal resolves then creates the goal', async () => {
    mockResolveGoal.mockResolvedValueOnce({ type: 'STRENGTH', muscles: ['GLUTES'] });

    await render(<StatsScreen />);

    await waitFor(() => {
      expect(mockGetGoalProgress).toHaveBeenCalledTimes(1);
    });

    await fireEvent.changeText(screen.getByPlaceholderText('Or describe your goal...'), 'I want a bigger booty');
    await fireEvent.press(screen.getByText('Set Goal'));

    await waitFor(() => {
      expect(mockResolveGoal).toHaveBeenCalledWith('I want a bigger booty');
    });
    await waitFor(() => {
      expect(mockCreateGoal).toHaveBeenCalledWith({
        type: 'STRENGTH',
        description: 'I want a bigger booty',
        overrides: [{ muscle: 'GLUTES', min: 8, max: 12 }],
      });
    });
    await waitFor(() => {
      expect(mockGetGoalProgress).toHaveBeenCalledTimes(2);
    });
  });

  it('entering free text with no identified muscles creates the goal without overrides', async () => {
    mockResolveGoal.mockResolvedValueOnce({ type: 'HYPERTROPHY', muscles: [] });

    await render(<StatsScreen />);

    await waitFor(() => {
      expect(mockGetGoalProgress).toHaveBeenCalledTimes(1);
    });

    await fireEvent.changeText(screen.getByPlaceholderText('Or describe your goal...'), 'get generally fitter');
    await fireEvent.press(screen.getByText('Set Goal'));

    await waitFor(() => {
      expect(mockCreateGoal).toHaveBeenCalledWith({ type: 'HYPERTROPHY', description: 'get generally fitter' });
    });
  });

  it('shows an error message when createGoal rejects from a preset press', async () => {
    await render(<StatsScreen />);

    await waitFor(() => {
      expect(mockGetGoalProgress).toHaveBeenCalledTimes(1);
    });

    mockCreateGoal.mockRejectedValueOnce(new Error('server error'));

    await fireEvent.press(screen.getByText('Strength'));

    await waitFor(() => {
      expect(screen.getByText("Couldn't load data. Pull down or reopen the app to retry.")).toBeTruthy();
    });
  });

  it('shows an error message when resolveGoal rejects from the free-text flow', async () => {
    await render(<StatsScreen />);

    await waitFor(() => {
      expect(mockGetGoalProgress).toHaveBeenCalledTimes(1);
    });

    mockResolveGoal.mockRejectedValueOnce(new Error('llm down'));

    await fireEvent.changeText(screen.getByPlaceholderText('Or describe your goal...'), 'a bigger booty');
    await fireEvent.press(screen.getByText('Set Goal'));

    await waitFor(() => {
      expect(screen.getByText("Couldn't load data. Pull down or reopen the app to retry.")).toBeTruthy();
    });
  });
});
