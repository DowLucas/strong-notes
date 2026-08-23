import { AppState, type AppStateStatus } from 'react-native';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useAuth } from '@/lib/auth';
import { syncNow } from '@/src/sync/syncEngine';
import { useAutoSync } from '@/src/sync/useAutoSync';

jest.mock('@/lib/auth');
jest.mock('@/src/sync/syncEngine', () => ({ syncNow: jest.fn() }));

const api = { tag: 'api' };
type AppStateHandler = (state: AppStateStatus) => void;

let appStateHandler: AppStateHandler | null;
let removeListener: jest.Mock;

beforeEach(() => {
  appStateHandler = null;
  removeListener = jest.fn();
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((event: string, cb: AppStateHandler) => {
    if (event === 'change') appStateHandler = cb;
    return { remove: removeListener };
  }) as typeof AppState.addEventListener);
  (syncNow as jest.Mock).mockReset().mockResolvedValue({ pushed: 0, pulled: 0 });
  (useAuth as jest.Mock).mockReturnValue({ session: { token: 't', user: {} }, api });
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function foreground() {
  await act(async () => {
    appStateHandler?.('active');
  });
}

describe('useAutoSync', () => {
  it('syncs once on mount when signed in', async () => {
    await renderHook(() => useAutoSync());
    await waitFor(() => expect(syncNow).toHaveBeenCalledTimes(1));
    expect(syncNow).toHaveBeenCalledWith(api);
  });

  it('syncs again when the app returns to the foreground', async () => {
    await renderHook(() => useAutoSync());
    await waitFor(() => expect(syncNow).toHaveBeenCalledTimes(1));

    await act(async () => {
      appStateHandler?.('background');
    });
    expect(syncNow).toHaveBeenCalledTimes(1);

    await foreground();
    await waitFor(() => expect(syncNow).toHaveBeenCalledTimes(2));
  });

  it('does not start a sync while one is in flight', async () => {
    let resolveSync: (v: { pushed: number; pulled: number }) => void = () => {};
    (syncNow as jest.Mock).mockImplementation(
      () => new Promise((resolve) => { resolveSync = resolve; }),
    );

    await renderHook(() => useAutoSync());
    await waitFor(() => expect(syncNow).toHaveBeenCalledTimes(1));

    await foreground();
    await foreground();
    expect(syncNow).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveSync({ pushed: 0, pulled: 0 });
    });
    await foreground();
    await waitFor(() => expect(syncNow).toHaveBeenCalledTimes(2));
  });

  it('swallows sync failures and keeps syncing on later foregrounds', async () => {
    (syncNow as jest.Mock).mockRejectedValue(new Error('offline'));

    await renderHook(() => useAutoSync());
    await waitFor(() => expect(syncNow).toHaveBeenCalledTimes(1));

    await foreground();
    await waitFor(() => expect(syncNow).toHaveBeenCalledTimes(2));
  });

  it('does nothing without a session', async () => {
    (useAuth as jest.Mock).mockReturnValue({ session: null, api });

    await renderHook(() => useAutoSync());
    await foreground();

    expect(syncNow).not.toHaveBeenCalled();
  });

  it('removes the AppState listener on unmount', async () => {
    const { unmount } = await renderHook(() => useAutoSync());
    await waitFor(() => expect(syncNow).toHaveBeenCalledTimes(1));

    await unmount();
    expect(removeListener).toHaveBeenCalledTimes(1);
  });
});
