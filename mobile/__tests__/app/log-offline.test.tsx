import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import LogScreen from '../../app/(tabs)/index';
import { resolveLine } from '../../src/api/client';
import { resetDbForTests } from '../../src/db/client';
import { getLocalSession } from '../../src/db/sessionsRepo';

jest.mock('../../src/api/client', () => ({
  resolveLine: jest.fn(),
}));

const mockResolveLine = resolveLine as jest.Mock;

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

beforeEach(() => {
  resetDbForTests();
  mockResolveLine.mockResolvedValue({ resolvedTokens: [], unresolvedTokens: [] });
});

// Split into its own file (rather than living alongside log.test.tsx's other
// LogScreen tests) because Jest's real-timer FlatList/VirtualizedList
// internals can leak an "overlapping act() calls" state across tests that
// run back-to-back in the same file when a prior test leaves unresolved
// background work in flight; a fresh test file gets a clean module/globals
// scope.
describe('LogScreen offline-first behavior', () => {
  it('saves and shows the raw line immediately, before the background parse settles', async () => {
    // Never resolves during this test - proves the entry is visible/saved
    // without waiting on the network call at all.
    mockResolveLine.mockImplementationOnce(() => new Promise(() => {}));

    await render(<LogScreen />);
    const input = screen.getByPlaceholderText('Log a set...');
    await fireEvent.changeText(input, 'BB RDL 40kg 8x3');
    await fireEvent(input, 'submitEditing');

    await waitFor(() => {
      expect(screen.getByText('BB RDL 40kg 8x3')).toBeTruthy();
    });

    const session = await getLocalSession(todayDate());
    expect(session?.entries).toHaveLength(1);
    expect(session?.entries[0].rawText).toBe('BB RDL 40kg 8x3');
  });

  it('keeps the raw entry saved and visible when the background parse rejects (offline/network failure)', async () => {
    mockResolveLine.mockRejectedValueOnce(new Error('network down'));

    await render(<LogScreen />);
    const input = screen.getByPlaceholderText('Log a set...');
    await fireEvent.changeText(input, 'BB RDL 40kg 8x3');
    await fireEvent(input, 'submitEditing');

    await waitFor(() => {
      expect(screen.getByText('BB RDL 40kg 8x3')).toBeTruthy();
    });

    await waitFor(() => {
      expect(screen.getByText("Couldn't load data. Pull down or reopen the app to retry.")).toBeTruthy();
    });

    const session = await getLocalSession(todayDate());
    expect(session?.entries).toHaveLength(1);
    expect(session?.entries[0].rawText).toBe('BB RDL 40kg 8x3');
  });
});
