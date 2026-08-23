import { View, Pressable, StyleSheet } from 'react-native';
import { Chip } from '@/components/Chip';
import { spacing } from '@/lib/theme';

export type ChipTabOption<T extends string> = { value: T; label: string };

interface Props<T extends string> {
  options: ChipTabOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Group label for assistive tech, e.g. "Time range". */
  label: string;
}

/** A row of single-select chips exposed as tabs, each with a ≥44 pt touch target. */
export function ChipTabs<T extends string>({ options, value, onChange, label }: Props<T>) {
  return (
    <View style={styles.row} accessibilityRole="tablist" accessibilityLabel={label}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            style={({ pressed }) => [styles.hit, pressed && styles.pressed]}
            accessibilityRole="tab"
            accessibilityLabel={o.label}
            accessibilityState={{ selected }}
          >
            <Chip solid={selected}>{o.label}</Chip>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.s2, flexWrap: 'wrap' },
  hit: { minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'center' },
  pressed: { opacity: 0.6 },
});
