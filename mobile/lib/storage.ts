/**
 * Session persistence. A single SecureStore blob at `scaffold.session` holds
 * the signed-in `{ token, user }`. Web has no SecureStore, so we fall back to
 * `localStorage` there (same platform split the rest of the app uses).
 *
 * This is the only module that reads or writes the session key. The auth
 * context (`auth.tsx`) is its sole consumer.
 */
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { User } from './api';

const SESSION_KEY = 'scaffold.session';
// Kept separately from the session so it survives sign-out / expiry and can
// pre-fill the sign-in form.
const LAST_EMAIL_KEY = 'strongnotes.lastEmail';

export interface Session {
  token: string;
  user: User;
}

async function getItem(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(key);
  }
  return SecureStore.getItemAsync(key);
}

async function setItem(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(key, value);
    return;
  }
  // Scope to this device — no iCloud backup, not restorable elsewhere.
  await SecureStore.setItemAsync(key, value, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

async function deleteItem(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

export async function loadSession(): Promise<Session | null> {
  const raw = await getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Session;
    if (parsed && typeof parsed.token === 'string' && parsed.user) return parsed;
    return null;
  } catch {
    return null;
  }
}

export async function saveSession(session: Session): Promise<void> {
  await setItem(SESSION_KEY, JSON.stringify(session));
}

export async function clearSession(): Promise<void> {
  await deleteItem(SESSION_KEY);
}

/** The email most recently used to sign in, or null. */
export async function loadLastEmail(): Promise<string | null> {
  try {
    return (await getItem(LAST_EMAIL_KEY)) || null;
  } catch {
    return null;
  }
}

export async function saveLastEmail(email: string): Promise<void> {
  try {
    await setItem(LAST_EMAIL_KEY, email.trim().toLowerCase());
  } catch {
    // Non-fatal: the user just types the address again next time.
  }
}
