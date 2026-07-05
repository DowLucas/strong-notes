import type { ReactNode } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
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
      nodes.push(<Text key={`plain-${i}`}>{text.slice(cursor, span.start)}</Text>);
    }
    nodes.push(
      <Text
        key={span.entryId}
        style={span.status === 'resolved' ? styles.resolved : styles.needsConfirm}
        onPress={() => onSpanPress(span.entryId)}
      >
        {text.slice(span.start, span.end)}
      </Text>,
    );
    cursor = span.end;
  });

  if (cursor < text.length) nodes.push(<Text key="tail">{text.slice(cursor)}</Text>);
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
  // Layer order matters. The TextInput is rendered first (underneath) and is
  // the real editing surface, with transparent text so the styled overlay
  // shows through and its caret (selectionColor) peeks through the gaps. The
  // styled overlay is rendered second (on top) inside a `box-none` View:
  // plain-text segments have no touch handler, so taps fall THROUGH to the
  // TextInput (positioning the cursor); span segments have onPress, so they
  // capture the tap and open the popover.
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
});
