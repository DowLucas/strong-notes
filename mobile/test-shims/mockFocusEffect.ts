// Test double for expo-router's useFocusEffect: runs the callback on mount and
// whenever it changes (as a focused screen would), and lets a test re-focus.
import { useEffect } from 'react';

export function createFocusEffectMock() {
  let current: (() => void) | null = null;
  return {
    useFocusEffect(cb: () => void) {
      current = cb;
      useEffect(cb, [cb]);
    },
    /** Simulate the screen regaining focus. */
    refocus() {
      current?.();
    },
  };
}
