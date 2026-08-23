import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { AuthProvider, useAuth } from '@/lib/auth';
import { createClient } from '@/lib/api';
import { clearSession, loadSession } from '@/lib/storage';

jest.mock('@/lib/storage', () => ({
  loadSession: jest.fn(),
  saveSession: jest.fn().mockResolvedValue(undefined),
  clearSession: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/lib/api', () => ({
  defaultBaseUrl: () => 'http://x',
  createClient: jest.fn(),
}));

let onUnauthorized: (() => void) | undefined;
const logout = jest.fn().mockResolvedValue(undefined);

beforeEach(() => {
  jest.clearAllMocks();
  (createClient as jest.Mock).mockImplementation((_base, _getToken, opts) => {
    onUnauthorized = opts?.onUnauthorized;
    return { logout };
  });
  (loadSession as jest.Mock).mockResolvedValue({ token: 't', user: { id: 'u', email: 'e@x.se', name: '' } });
});

const wrapper = ({ children }: { children: React.ReactNode }) => <AuthProvider>{children}</AuthProvider>;

describe('AuthProvider signedOutReason', () => {
  it('records "expired" when the server rejects the token, and clears the session', async () => {
    const { result } = await renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.session).not.toBeNull());
    expect(result.current.signedOutReason).toBeNull();

    await act(async () => {
      onUnauthorized?.();
    });

    expect(result.current.session).toBeNull();
    expect(result.current.signedOutReason).toBe('expired');
    expect(clearSession).toHaveBeenCalled();
  });

  it('does not set a reason on a deliberate sign-out', async () => {
    const { result } = await renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.session).not.toBeNull());

    await act(async () => {
      await result.current.signOut();
    });

    expect(result.current.session).toBeNull();
    expect(result.current.signedOutReason).toBeNull();
    expect(logout).toHaveBeenCalled();
  });
});
