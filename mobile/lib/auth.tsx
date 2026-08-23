/**
 * Single-account auth context.
 *
 * Holds one `{ token, user }` session, persisted in SecureStore via
 * `storage.ts`. The shared API client (`api`) reads the live token through a
 * ref-backed getter, so authenticated requests always use the current token
 * without recreating the client on every sign-in.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createClient, defaultBaseUrl, type ApiClient } from './api';
import {
  clearSession,
  loadSession,
  saveSession,
  type Session,
} from './storage';

interface AuthContextValue {
  /** True until the persisted session has been loaded on mount. */
  loading: boolean;
  session: Session | null;
  /** The shared API client, bound to the configured base URL. */
  api: ApiClient;
  /** Persist a token: fetch the profile, store `{ token, user }`, sign in. */
  signInWithToken: (token: string) => Promise<void>;
  /** Drop the session locally (best-effort server logout first). */
  signOut: () => Promise<void>;
  /** Re-fetch the current profile and update the stored session. */
  refreshMe: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const BASE_URL = defaultBaseUrl();

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);

  // The client reads the token lazily through this ref so it never goes stale
  // and never needs to be recreated.
  const tokenRef = useRef<string | null>(null);
  const applySession = useCallback((next: Session | null) => {
    tokenRef.current = next?.token ?? null;
    setSession(next);
  }, []);

  // An expired/revoked session: drop it locally so the router sends the user
  // back to sign-in, instead of every request silently failing with 401.
  // No server logout call — the token is already useless.
  const handleUnauthorized = useCallback(() => {
    if (!tokenRef.current) return; // already cleared by a concurrent 401
    applySession(null);
    void clearSession();
  }, [applySession]);

  // applySession/handleUnauthorized are stable, so the client is created once.
  const api = useMemo(
    () => createClient(BASE_URL, async () => tokenRef.current, { onUnauthorized: handleUnauthorized }),
    [handleUnauthorized],
  );

  useEffect(() => {
    let active = true;
    loadSession()
      .then((s) => {
        if (active) applySession(s);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [applySession]);

  const signInWithToken = useCallback(
    async (magicLinkToken: string) => {
      // The magic-link token is single-use and only good for the verify
      // exchange — it must be traded in for a session JWT before any
      // authenticated request (e.g. /api/me) will accept it.
      const { token, user } = await api.verify(magicLinkToken);
      const next: Session = { token, user };
      await saveSession(next);
      applySession(next);
    },
    [api, applySession],
  );

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // Best effort — local sign-out proceeds regardless.
    }
    await clearSession();
    applySession(null);
  }, [api, applySession]);

  const refreshMe = useCallback(async () => {
    if (!tokenRef.current) return;
    const user = await api.getMe();
    const next: Session = { token: tokenRef.current, user };
    await saveSession(next);
    applySession(next);
  }, [api, applySession]);

  const value = useMemo<AuthContextValue>(
    () => ({ loading, session, api, signInWithToken, signOut, refreshMe }),
    [loading, session, api, signInWithToken, signOut, refreshMe],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
