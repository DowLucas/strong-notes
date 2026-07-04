import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import LogScreen from '../../app/(tabs)/index';
import { resolveLine } from '../../src/api/client';
import { resetDbForTests } from '../../src/db/client';
import { upsertLocalSession } from '../../src/db/sessionsRepo';

jest.mock('../../src/api/client', () => ({
  resolveLine: jest.fn(),
}));

jest.mock('../../src/db/sessionsRepo', () => {
  const actual = jest.requireActual('../../src/db/sessionsRepo');
  return { ...actual, upsertLocalSession: jest.fn(actual.upsertLocalSession) };
});

const mockResolveLine = resolveLine as jest.Mock;
const mockUpsertLocalSession = upsertLocalSession as jest.Mock;

beforeEach(() => {
  resetDbForTests();
  mockResolveLine.mockResolvedValue({ resolvedTokens: [], unresolvedTokens: [] });
});

// The initial `persist(nextLines)` call in handleSubmit runs before the
// background parseQuickEntryLine call and, until this fix, wasn't wrapped in
// try/catch - a rejection there (disk full, DB locked, etc.) would surface as
// an unhandled promise rejection with no error UI at all. This proves the
// same error-state pattern used elsewhere in the file now covers this path
// too, instead of the submission blowing up silently.
describe('LogScreen persist failure', () => {
  it('shows the error message instead of throwing when the initial persist write rejects', async () => {
    mockUpsertLocalSession.mockRejectedValueOnce(new Error('disk full'));

    await render(<LogScreen />);
    const input = screen.getByPlaceholderText('Log a set...');
    await fireEvent.changeText(input, 'BB RDL 40kg 8x3');
    await fireEvent(input, 'submitEditing');

    await waitFor(() => {
      expect(screen.getByText("Couldn't load data. Pull down or reopen the app to retry.")).toBeTruthy();
    });
  });
});
