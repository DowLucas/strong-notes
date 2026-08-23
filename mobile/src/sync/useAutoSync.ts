import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useAuth } from '@/lib/auth';
import { syncNow } from './syncEngine';

/**
 * Best-effort background sync for a signed-in user.
 *
 * Runs `syncNow(api)` once when mounted with a session and again each time the
 * app returns to the foreground. Failures are swallowed (the next run retries
 * any unsynced sessions) and overlapping runs are skipped — a sync that is
 * still in flight is never joined by a second one.
 */
export function useAutoSync(): void {
  const { session, api } = useAuth();
  const signedIn = !!session;
  const inFlight = useRef(false);

  useEffect(() => {
    if (!signedIn) return;

    const run = () => {
      if (inFlight.current) return;
      inFlight.current = true;
      syncNow(api)
        .catch(() => {
          // Best effort: offline or server errors are retried on the next run.
        })
        .finally(() => {
          inFlight.current = false;
        });
    };

    run();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') run();
    });
    return () => subscription.remove();
  }, [signedIn, api]);
}
