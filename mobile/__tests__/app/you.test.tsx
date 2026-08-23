import '@/lib/i18n';
import { Platform } from 'react-native';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import YouScreen from '../../app/(tabs)/you';
import { useAuth } from '@/lib/auth';
import { showAlert } from '@/lib/app-alert';
import { resetDbForTests } from '@/src/db/client';
import { cacheAbbreviations } from '@/src/db/abbreviationsRepo';
import { upsertLocalSession } from '@/src/db/sessionsRepo';
import { syncNow } from '@/src/sync/syncEngine';
import { setSyncStatus, __resetSyncStatusForTests } from '@/src/sync/syncStatus';

jest.mock('@/lib/auth');
jest.mock('@/lib/app-alert', () => ({ showAlert: jest.fn().mockResolvedValue('ok') }));
jest.mock('@/src/sync/syncEngine', () => ({ syncNow: jest.fn().mockResolvedValue({ pushed: 0, pulled: 0, failed: 0 }) }));
jest.mock('expo-router', () => {
  const React = require('react');
  return {
    router: { push: jest.fn(), back: jest.fn() },
    useFocusEffect: (cb: () => void) => React.useEffect(cb, [cb]),
  };
});

const { router } = jest.requireMock('expo-router');
const signOut = jest.fn().mockResolvedValue(undefined);
const deleteAccount = jest.fn().mockResolvedValue(undefined);

function mockAuth(overrides: Record<string, unknown> = {}) {
  (useAuth as jest.Mock).mockReturnValue({
    session: { token: 'tok', user: { id: 'u1', email: 'test@example.com', name: 'Test User' } },
    api: { deleteAccount, logout: jest.fn(), avatarImageSource: jest.fn(() => null) },
    signOut,
    refreshMe: jest.fn(),
    ...overrides,
  });
}

beforeEach(async () => {
  jest.clearAllMocks();
  resetDbForTests();
  __resetSyncStatusForTests();
  (showAlert as jest.Mock).mockResolvedValue('ok');
  mockAuth();
  await cacheAbbreviations([
    { id: '1', token: 'RDL', exerciseId: 'ex-1', exerciseName: 'Romanian deadlift', source: 'BUILT_IN', createdAt: '' },
    { id: '2', token: 'CRABWALK', source: 'LLM_SUGGESTED_PENDING_CONFIRM', createdAt: '' },
  ]);
});

describe('You tab', () => {
  it('shows the dictionary row with the cached term count and opens the dictionary', async () => {
    await render(<YouScreen />);
    expect(await screen.findByText('2 terms')).toBeTruthy();
    // The inline list is gone — the dictionary has its own screen.
    expect(screen.queryByText('RDL')).toBeNull();

    await fireEvent.press(screen.getByTestId('dictionary-row'));
    expect(router.push).toHaveBeenCalledWith('/settings/dictionary');
  });

  it('hides the Language row while only one locale exists', async () => {
    await render(<YouScreen />);
    await screen.findByText('2 terms');
    expect(screen.queryByText('Language')).toBeNull();
    expect(screen.getByText('About the app')).toBeTruthy();
  });

  describe('sync row', () => {
    it('shows "Not synced yet" and the pending session count, and syncs on tap', async () => {
      await upsertLocalSession({ date: '2026-08-20', notes: null, entries: [], synced: 0 });
      let resolveSync: (v: unknown) => void = () => {};
      (syncNow as jest.Mock).mockImplementationOnce(
        () => new Promise((resolve) => { resolveSync = resolve; }),
      );

      await render(<YouScreen />);
      expect(await screen.findByText('Not synced yet')).toBeTruthy();
      expect(screen.getByText('1 session pending')).toBeTruthy();

      await fireEvent.press(screen.getByTestId('sync-row'));
      expect(syncNow).toHaveBeenCalledTimes(1);

      // While the engine runs, the store says so and the row shows a spinner.
      await act(async () => {
        setSyncStatus({ running: true });
      });
      expect(screen.getByTestId('sync-spinner')).toBeTruthy();
      expect(screen.getByText('Syncing…')).toBeTruthy();

      await act(async () => {
        setSyncStatus({ running: false, lastRunAt: Date.now(), lastSuccessAt: Date.now(), error: null, pushed: 1 });
        resolveSync({ pushed: 1, pulled: 0, failed: 0 });
      });
      expect(await screen.findByText(/Last synced less than a minute ago/)).toBeTruthy();
    });

    it('shows the error line when the last run failed', async () => {
      setSyncStatus({ lastRunAt: Date.now(), error: 'network' });
      await render(<YouScreen />);
      expect(await screen.findByText("Couldn't reach the server — tap to retry")).toBeTruthy();
    });
  });

  describe('account', () => {
    it('sign-out asks for confirmation with the new copy', async () => {
      (showAlert as jest.Mock).mockResolvedValueOnce('signout');
      await render(<YouScreen />);
      await fireEvent.press(screen.getByText('Sign out'));
      await waitFor(() => expect(signOut).toHaveBeenCalled());
      expect(showAlert).toHaveBeenCalledWith(
        expect.objectContaining({ message: "You'll need to sign in again." }),
      );
    });

    it('delete account confirms, calls the API, then signs out locally', async () => {
      (showAlert as jest.Mock).mockResolvedValueOnce('delete');
      await render(<YouScreen />);
      await fireEvent.press(screen.getByText('Delete account'));
      await waitFor(() => expect(deleteAccount).toHaveBeenCalled());
      await waitFor(() => expect(signOut).toHaveBeenCalled());
    });

    it('delete account does nothing when cancelled', async () => {
      (showAlert as jest.Mock).mockResolvedValueOnce('cancel');
      await render(<YouScreen />);
      await fireEvent.press(screen.getByText('Delete account'));
      await waitFor(() => expect(showAlert).toHaveBeenCalled());
      expect(deleteAccount).not.toHaveBeenCalled();
      expect(signOut).not.toHaveBeenCalled();
    });
  });

  it('keeps the name visible and shows the avatar spinner while uploading', async () => {
    // Drive the upload path through the exposed remove flow: deleteAvatar is
    // slow, so the spinner overlay should be up while it runs.
    let resolveDelete: () => void = () => {};
    const deleteAvatar = jest.fn(() => new Promise<void>((resolve) => { resolveDelete = resolve; }));
    mockAuth({
      session: {
        token: 'tok',
        user: { id: 'u1', email: 'test@example.com', name: 'Test User', avatar_object_url: '/api/me/avatar' },
      },
      api: { deleteAccount, deleteAvatar, avatarImageSource: jest.fn(() => null) },
    });
    (showAlert as jest.Mock).mockResolvedValueOnce('remove');
    // The ActionSheet fires its option after a short timeout on Android; on
    // iOS it waits for the Modal's onDismiss, which never fires under jest.
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });

    await render(<YouScreen />);
    await fireEvent.press(screen.getByLabelText('Change profile photo'));
    await fireEvent.press(await screen.findByText('Remove photo'));

    await waitFor(() => expect(deleteAvatar).toHaveBeenCalled());
    expect(showAlert).toHaveBeenCalledWith(expect.objectContaining({ title: 'Remove photo?' }));
    expect(screen.getByTestId('avatar-uploading')).toBeTruthy();
    expect(screen.getByText('Test User')).toBeTruthy();

    await act(async () => {
      resolveDelete();
    });
    await waitFor(() => expect(screen.queryByTestId('avatar-uploading')).toBeNull());
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
  });
});
