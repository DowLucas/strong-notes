import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { colors, radii, spacing, typography } from '@/lib/theme';
import { Text } from './Text';

const DEFAULT_DURATION_MS = 1800;
const FADE_MS = 180;

/**
 * Transient status message state: `show(message)` displays it for
 * `durationMs` (re-showing restarts the timer), then hides it.
 */
export function useToast(durationMs = DEFAULT_DURATION_MS) {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback(
    (next: string) => {
      if (timer.current) clearTimeout(timer.current);
      setMessage(next);
      timer.current = setTimeout(() => setMessage(null), durationMs);
    },
    [durationMs],
  );

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return { message, show };
}

/**
 * Small bottom-anchored pill for non-blocking confirmations ("Saved"). Fades
 * in/out, doesn't intercept touches, and is announced politely to screen
 * readers. Render it last inside a full-screen container so it floats above
 * the content; `bottomOffset` lifts it above the keyboard/tab bar if needed.
 */
export function Toast({ message, bottomOffset = spacing.s5 }: { message: string | null; bottomOffset?: number }) {
  const opacity = useRef(new Animated.Value(0)).current;
  // Keep the last message mounted during the fade-out.
  const [shown, setShown] = useState<string | null>(message);

  useEffect(() => {
    if (message) {
      setShown(message);
      Animated.timing(opacity, { toValue: 1, duration: FADE_MS, useNativeDriver: true }).start();
    } else {
      Animated.timing(opacity, { toValue: 0, duration: FADE_MS, useNativeDriver: true }).start(({ finished }) => {
        if (finished) setShown(null);
      });
    }
  }, [message, opacity]);

  if (!shown) return null;
  return (
    <View pointerEvents="none" style={[styles.host, { bottom: bottomOffset }]}>
      <Animated.View style={[styles.pill, { opacity }]} accessibilityRole="alert" accessibilityLiveRegion="polite">
        <Text style={styles.label}>{shown}</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  pill: {
    backgroundColor: colors.graphite,
    paddingHorizontal: spacing.s4,
    paddingVertical: spacing.s2,
    borderRadius: radii.pill,
  },
  label: { ...typography.monoLabel, color: colors.paper },
});
