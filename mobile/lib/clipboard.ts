import { Clipboard } from 'react-native';

/**
 * Copy text to the system clipboard. Isolated here so the deprecated
 * react-native `Clipboard` can be swapped for `expo-clipboard` in one place
 * once the dependency is added.
 */
export function copyToClipboard(text: string): void {
  Clipboard.setString(text);
}
