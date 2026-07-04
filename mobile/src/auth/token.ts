import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'strongnotes_api_token';

export async function getApiToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function setApiToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}
