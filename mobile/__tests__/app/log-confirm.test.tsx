import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import LogScreen from '../../app/(tabs)/index';
import { resolveLine, createExercise, createAbbreviation } from '../../src/api/client';
import { resetDbForTests } from '../../src/db/client';
import { getLocalSession } from '../../src/db/sessionsRepo';

jest.mock('../../src/api/client', () => ({
  resolveLine: jest.fn(),
  createExercise: jest.fn(),
  createAbbreviation: jest.fn(),
}));

const mockResolveLine = resolveLine as jest.Mock;
const mockCreateExercise = createExercise as jest.Mock;
const mockCreateAbbreviation = createAbbreviation as jest.Mock;

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

beforeEach(() => {
  resetDbForTests();
  mockResolveLine.mockReset();
  mockCreateExercise.mockReset();
  mockCreateAbbreviation.mockReset();
});

// Split into its own file (rather than living alongside log.test.tsx's other
// LogScreen tests) because Jest's real-timer FlatList/VirtualizedList
// internals can leak an "overlapping act() calls" state across tests that
// run back-to-back in the same file when a prior test leaves unresolved
// background work in flight - see log-offline.test.tsx/log-rehydrate.test.tsx
// for the same pattern.
describe('LogScreen confirm flow', () => {
  it('tapping Confirm creates the exercise, saves the abbreviation, and marks the entry resolved', async () => {
    mockResolveLine.mockResolvedValue({
      resolvedTokens: [],
      unresolvedTokens: ['CRABWALK'],
      llmGuess: { exerciseName: 'Cable Crab Walk', equipment: undefined, weightKg: 20, reps: 8, sets: 2, muscles: ['GLUTES'] },
    });
    mockCreateExercise.mockResolvedValue({ id: 'ex-new', name: 'Cable Crab Walk', muscleMap: [] });
    mockCreateAbbreviation.mockResolvedValue({ id: 'abbr-1', token: 'CRABWALK', exerciseId: 'ex-new', source: 'LLM_CONFIRMED' });

    await render(<LogScreen />);
    const input = screen.getByPlaceholderText('Log a set...');
    await fireEvent.changeText(input, 'CRABWALK 20kg 8x2');
    await fireEvent(input, 'submitEditing');

    await waitFor(() => {
      expect(screen.getByText('Confirm: Cable Crab Walk')).toBeTruthy();
    });

    await fireEvent.press(screen.getByText('Confirm: Cable Crab Walk'));

    await waitFor(() => {
      expect(mockCreateExercise).toHaveBeenCalledWith({ name: 'Cable Crab Walk', muscles: ['GLUTES'] });
    });
    expect(mockCreateAbbreviation).toHaveBeenCalledWith({ token: 'CRABWALK', exerciseId: 'ex-new' });

    await waitFor(() => {
      expect(screen.queryByText('Confirm: Cable Crab Walk')).toBeNull();
    });

    const session = await getLocalSession(todayDate());
    expect(session?.entries).toHaveLength(1);
    expect(session?.entries[0].exerciseId).toBe('ex-new');
  });

  it('shows the error message instead of crashing when confirm fails (e.g. network down)', async () => {
    mockResolveLine.mockResolvedValue({
      resolvedTokens: [],
      unresolvedTokens: ['CRABWALK'],
      llmGuess: { exerciseName: 'Cable Crab Walk', equipment: undefined, weightKg: 20, reps: 8, sets: 2, muscles: ['GLUTES'] },
    });
    mockCreateExercise.mockRejectedValue(new Error('network down'));

    await render(<LogScreen />);
    const input = screen.getByPlaceholderText('Log a set...');
    await fireEvent.changeText(input, 'CRABWALK 20kg 8x2');
    await fireEvent(input, 'submitEditing');

    await waitFor(() => {
      expect(screen.getByText('Confirm: Cable Crab Walk')).toBeTruthy();
    });

    await fireEvent.press(screen.getByText('Confirm: Cable Crab Walk'));

    await waitFor(() => {
      expect(screen.getByText("Couldn't load data. Pull down or reopen the app to retry.")).toBeTruthy();
    });

    // The entry stays visible in its pre-confirm state rather than being lost.
    expect(screen.getByText('Confirm: Cable Crab Walk')).toBeTruthy();
    expect(mockCreateAbbreviation).not.toHaveBeenCalled();
  });
});
