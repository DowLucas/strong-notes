import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import ProfileScreen from '../../app/(tabs)/profile';
import { resetDbForTests } from '../../src/db/client';
import { cacheAbbreviations } from '../../src/db/abbreviationsRepo';
import { confirmAbbreviation } from '../../src/api/client';
import { syncNow } from '../../src/sync/syncEngine';
import { getApiToken, setApiToken } from '../../src/auth/token';

jest.mock('../../src/api/client', () => ({
  confirmAbbreviation: jest.fn().mockResolvedValue({}),
  listAbbreviations: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../src/sync/syncEngine', () => ({
  syncNow: jest.fn().mockResolvedValue({ pushed: 0, pulled: 0 }),
}));

jest.mock('../../src/auth/token', () => ({
  getApiToken: jest.fn().mockResolvedValue(null),
  setApiToken: jest.fn().mockResolvedValue(undefined),
}));

const mockSyncNow = syncNow as jest.Mock;
const mockGetApiToken = getApiToken as jest.Mock;
const mockSetApiToken = setApiToken as jest.Mock;

beforeEach(async () => {
  resetDbForTests();
  mockGetApiToken.mockResolvedValue(null);
  mockSetApiToken.mockClear();
  await cacheAbbreviations([
    { id: '1', token: 'RDL', exerciseId: 'ex-1', source: 'BUILT_IN' },
    { id: '2', token: 'CRABWALK', source: 'LLM_SUGGESTED_PENDING_CONFIRM' },
  ]);
});

describe('ProfileScreen', () => {
  it('lists cached abbreviations and confirms a pending one', async () => {
    await render(<ProfileScreen />);

    await waitFor(() => {
      expect(screen.getByText('RDL')).toBeTruthy();
      expect(screen.getByText('CRABWALK')).toBeTruthy();
    });

    await fireEvent.press(screen.getByText('Confirm'));

    await waitFor(() => {
      expect(confirmAbbreviation).toHaveBeenCalledWith('2');
    });
  });

  it('shows an error message when syncNow rejects on load', async () => {
    mockSyncNow.mockRejectedValueOnce(new Error('network down'));

    await render(<ProfileScreen />);

    await waitFor(() => {
      expect(screen.getByText("Couldn't load data. Pull down or reopen the app to retry.")).toBeTruthy();
    });
  });

  it('saves a newly entered API token and refreshes', async () => {
    await render(<ProfileScreen />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText('API token')).toBeTruthy();
    });

    await fireEvent.changeText(screen.getByPlaceholderText('API token'), 'my-secret-token');
    await fireEvent.press(screen.getByText('Save'));

    await waitFor(() => {
      expect(setApiToken).toHaveBeenCalledWith('my-secret-token');
      expect(syncNow).toHaveBeenCalled();
    });
  });

  it('pre-fills the token input when a token already exists', async () => {
    mockGetApiToken.mockResolvedValue('existing-token');

    await render(<ProfileScreen />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('existing-token')).toBeTruthy();
    });
  });

  it('shows an error message when setApiToken rejects', async () => {
    mockSetApiToken.mockRejectedValueOnce(new Error('storage failure'));

    await render(<ProfileScreen />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText('API token')).toBeTruthy();
    });

    await fireEvent.changeText(screen.getByPlaceholderText('API token'), 'my-secret-token');
    await fireEvent.press(screen.getByText('Save'));

    await waitFor(() => {
      expect(screen.getByText("Couldn't load data. Pull down or reopen the app to retry.")).toBeTruthy();
    });
  });

  it('does not save a blank or whitespace-only token', async () => {
    await render(<ProfileScreen />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText('API token')).toBeTruthy();
    });

    await fireEvent.changeText(screen.getByPlaceholderText('API token'), '   ');
    await fireEvent.press(screen.getByText('Save'));

    expect(setApiToken).not.toHaveBeenCalled();
  });
});
