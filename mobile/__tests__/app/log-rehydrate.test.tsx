import { render, screen, waitFor } from '@testing-library/react-native';
import LogScreen from '../../app/(tabs)/index';
import { resolveLine } from '../../src/api/client';
import { resetDbForTests } from '../../src/db/client';
import { upsertLocalSession } from '../../src/db/sessionsRepo';

// Kept in its own file, not appended to log.test.tsx: this project has a
// known VirtualizedList/act() cross-test corruption quirk when multiple
// LogScreen renders share a module scope (see log-offline.test.tsx), so new
// LogScreen tests go in dedicated files.
jest.mock('../../src/api/client', () => ({
  resolveLine: jest.fn(),
}));

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

beforeEach(() => {
  resetDbForTests();
});

describe('LogScreen rehydration', () => {
  it('shows already-logged entries for today on mount, not a blank list', async () => {
    await upsertLocalSession({
      date: todayDate(),
      notes: null,
      synced: 1,
      entries: [
        {
          id: 'existing-1',
          exerciseId: 'ex-1',
          equipment: 'barbell',
          weightKg: 40,
          reps: 8,
          sets: 3,
          rawText: 'BB RDL 40kg 8x3',
          parsedBy: 'DICTIONARY',
          order: 0,
          synced: 1,
        },
      ],
    });

    await render(<LogScreen />);

    await waitFor(() => {
      expect(screen.getByText('BB RDL 40kg 8x3')).toBeTruthy();
    });
  });

  it('shows a blank list when there is no session for today', async () => {
    await render(<LogScreen />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Log a set...')).toBeTruthy();
    });
    expect(screen.queryByText('BB RDL 40kg 8x3')).toBeNull();
    expect(resolveLine).not.toHaveBeenCalled();
  });
});
