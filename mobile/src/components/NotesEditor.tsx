import { useEffect, useState, type ReactNode } from 'react';
import { View, Text, TextInput, Pressable, Keyboard, StyleSheet } from 'react-native';
import { BlurView } from 'expo-blur';
import { Feather } from '@expo/vector-icons';
import { colors, spacing, fonts, fontSize } from '@/lib/theme';

export type HighlightSpan = {
  start: number;
  end: number;
  status: 'resolved' | 'needs-confirm';
  entryId: string;
};

function renderSegments(
  text: string,
  spans: HighlightSpan[],
  onSpanPress: (entryId: string) => void,
): ReactNode[] {
  const ordered = [...spans].sort((a, b) => a.start - b.start);
  const nodes: ReactNode[] = [];
  let cursor = 0;

  ordered.forEach((span, i) => {
    // Skip malformed/overlapping spans defensively so a bad offset never
    // corrupts the rendered text.
    if (span.start < cursor || span.end > text.length || span.start >= span.end) return;
    if (span.start > cursor) {
      nodes.push(
        <Text key={`plain-${i}`} pointerEvents="none">
          {text.slice(cursor, span.start)}
        </Text>,
      );
    }
    nodes.push(
      <Text
        key={span.entryId}
        style={span.status === 'resolved' ? styles.resolved : styles.needsConfirm}
        onPress={() => onSpanPress(span.entryId)}
        pointerEvents="auto"
      >
        {text.slice(span.start, span.end)}
      </Text>,
    );
    cursor = span.end;
  });

  if (cursor < text.length) {
    nodes.push(
      <Text key="tail" pointerEvents="none">
        {text.slice(cursor)}
      </Text>,
    );
  }
  return nodes;
}

export function NotesEditor({
  value,
  onChangeText,
  spans,
  onSpanPress,
  placeholder,
}: {
  value: string;
  onChangeText: (t: string) => void;
  spans: HighlightSpan[];
  onSpanPress: (entryId: string) => void;
  placeholder?: string;
}) {
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true));
    const hideSub = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // Layer order matters. The TextInput is rendered first (underneath) and is
  // the real editing surface, with transparent text so the styled overlay
  // shows through and its caret (selectionColor) peeks through the gaps. The
  // styled overlay is rendered second (on top) inside a `box-none` View, so
  // the overlay itself is never a touch target — only its children can be.
  //
  // Each PLAIN (non-highlighted) segment is explicitly pointerEvents="none":
  // it's a touch-inert leaf (no children, no handler), so this only ever
  // narrows what can capture a tap, never widens it. NOTE: this must not be
  // set on the wrapping <Text> itself or on the highlighted spans — unlike a
  // View, pointerEvents="none" on a Text disables its entire subtree, so
  // applying it above the highlighted spans would silently break tapping
  // them (caught by a regression test after an earlier, incorrect attempt).
  return (
    <View style={styles.container}>
      <TextInput
        style={[styles.text, styles.input]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.lead}
        selectionColor={colors.graphite}
        multiline
        textAlignVertical="top"
        scrollEnabled={false}
      />
      <View style={styles.overlay} pointerEvents="box-none">
        <Text style={styles.text}>{renderSegments(value, spans, onSpanPress)}</Text>
      </View>
      {keyboardVisible ? (
        <View style={styles.toolbar} pointerEvents="box-none">
          <Pressable
            onPress={() => Keyboard.dismiss()}
            accessibilityLabel="Done"
            accessibilityRole="button"
            style={styles.doneButton}
          >
            <BlurView intensity={40} tint="light" style={styles.doneBlur}>
              <Feather name="check" size={26} color={colors.graphite} />
            </BlurView>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

// Both layers MUST share fontFamily, fontSize, lineHeight, and padding so the
// styled overlay stays pixel-aligned with the transparent editing layer.
const styles = StyleSheet.create({
  container: { flex: 1 },
  text: {
    fontFamily: fonts.regular,
    fontSize: fontSize.body,
    lineHeight: 26,
    padding: spacing.s4,
    color: colors.graphite,
  },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  // Transparent text so the styled overlay shows through; the caret is still
  // visible via selectionColor.
  input: { flex: 1, color: 'transparent' },
  resolved: {
    backgroundColor: colors.bone,
    textDecorationLine: 'underline',
    textDecorationColor: colors.moss,
  },
  needsConfirm: {
    backgroundColor: colors.bone,
    textDecorationLine: 'underline',
    textDecorationColor: colors.citrine,
  },
  // A small always-present affordance to blur the TextInput/dismiss the
  // keyboard — a full-bleed multiline editor otherwise gives no way to close
  // the keyboard (Enter correctly inserts a newline instead of submitting).
  toolbar: {
    position: 'absolute',
    top: spacing.s2,
    right: spacing.s2,
  },
  doneButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(45, 31, 26, 0.15)',
    shadowColor: colors.graphite,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 3,
  },
  doneBlur: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
