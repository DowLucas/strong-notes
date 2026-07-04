import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'strongnotes_api_token';

// expo-secure-store has no native web implementation (SecureStore has no web
// equivalent); fall back to localStorage on web so the app doesn't crash
// when previewed in a browser. Native iOS/Android behavior is unchanged.
export async function getApiToken(): Promise<string | null> {
  if (Platform.OS === 'web') {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null;
  }
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function setApiToken(token: string): Promise<void> {
  if (Platform.OS === 'web') {
    if (typeof localStorage !== 'undefined') localStorage.setItem(TOKEN_KEY, token);
    return;
  }
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}
