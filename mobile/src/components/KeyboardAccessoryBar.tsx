import { ScrollView, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/components/Text';
import { colors, spacing, typography } from '@/lib/theme';

// A grammar shortcut chip: `label` is the glyph shown, `insert` the exact text
// spliced at the caret, `a11yLabel` the screen-reader announcement.
export type GrammarChip = { label: string; insert: string; a11yLabel: string };

// A persistent number row (like Android's keyboard number row) so digits and a
// decimal point are always one tap away on iOS too — weights and reps dominate
// entry, and this avoids a keyboard plane-switch per number.
const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '.'];

// A shorthand-first insert surface that docks above the keyboard (via
// InputAccessoryView on iOS). Purely presentational — the parent owns caret
// state and computes what to show. Layout, top to bottom:
//   • a floating "Confirm" island (only when the caret's line needs confirming)
//   • a scrolling row of dictionary autocompletions + grammar tokens
//   • a persistent number row nearest the keyboard
export function KeyboardAccessoryBar({
  confirmLabel,
  onConfirm,
  suggestions,
  onComplete,
  grammar,
  onInsert,
}: {
  confirmLabel?: string | null;
  onConfirm?: () => void;
  suggestions: string[];
  onComplete: (token: string) => void;
  grammar: GrammarChip[];
  onInsert: (insert: string) => void;
}) {
  return (
    <View style={styles.root}>
      {confirmLabel ? (
        <View style={styles.islandWrap} pointerEvents="box-none">
          <Pressable
            onPress={onConfirm}
            accessibilityRole="button"
            accessibilityLabel={`Confirm ${confirmLabel}`}
            style={styles.island}
          >
            <Text style={styles.islandText} numberOfLines={1}>
              ✓ Confirm {confirmLabel}
            </Text>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.bar}>
        <ScrollView
          horizontal
          keyboardShouldPersistTaps="always"
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.row}
        >
          {suggestions.map((s) => (
            <Pressable
              key={`sug-${s}`}
              onPress={() => onComplete(s)}
              accessibilityRole="button"
              accessibilityLabel={`Insert ${s}`}
              style={styles.chip}
            >
              <Text style={styles.chipText} numberOfLines={1}>
                {s}
              </Text>
            </Pressable>
          ))}

          {grammar.map((g) => (
            <Pressable
              key={`grammar-${g.label}`}
              onPress={() => onInsert(g.insert)}
              accessibilityRole="button"
              accessibilityLabel={g.a11yLabel}
              style={[styles.chip, styles.grammarChip]}
            >
              <Text style={[styles.chipText, styles.grammarText]} numberOfLines={1}>
                {g.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        {/* Number row sits at the bottom, nearest the keyboard, always visible. */}
        <View style={styles.numberRow}>
          {DIGITS.map((d) => (
            <Pressable
              key={`digit-${d}`}
              onPress={() => onInsert(d)}
              accessibilityRole="button"
              accessibilityLabel={d}
              style={styles.digit}
            >
              <Text style={styles.digitText}>{d}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {},
  // The confirm island floats above the shortcut/number section, detached and
  // centered, so it reads as a distinct call-to-action rather than a shortcut.
  islandWrap: {
    alignItems: 'center',
    paddingBottom: spacing.s2,
  },
  island: {
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.s5,
    borderRadius: 22,
    backgroundColor: colors.graphite,
    shadowColor: colors.graphite,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  islandText: {
    ...typography.monoBody,
    color: colors.paper,
  },
  bar: {
    backgroundColor: colors.bone,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.ruleSoft,
    paddingVertical: spacing.s2,
  },
  row: {
    paddingHorizontal: spacing.s3,
    gap: spacing.s2,
    alignItems: 'center',
  },
  chip: {
    minHeight: 44,
    minWidth: 44,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.s3,
    borderRadius: 8,
    backgroundColor: colors.paper,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.ruleSoft,
  },
  chipText: {
    ...typography.monoBody,
    color: colors.graphite,
  },
  grammarChip: {
    backgroundColor: colors.paper,
  },
  grammarText: {
    color: colors.lead,
  },
  numberRow: {
    flexDirection: 'row',
    gap: spacing.s1,
    paddingHorizontal: spacing.s3,
    paddingTop: spacing.s2,
  },
  digit: {
    flex: 1,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 6,
    backgroundColor: colors.paper,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.ruleSoft,
  },
  digitText: {
    ...typography.monoBodyL,
    color: colors.graphite,
  },
});
