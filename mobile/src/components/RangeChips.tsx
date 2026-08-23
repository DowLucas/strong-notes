import { View, Pressable, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Chip } from '@/components/Chip';
import { spacing } from '@/lib/theme';
import { RANGES, type Range } from '@/lib/exerciseProgress';

// i18n parser hint — keys are built from a template below:
// t('stats.range.1m') t('stats.range.3m') t('stats.range.6m') t('stats.range.1y') t('stats.range.all')

interface Props {
  value: Range;
  onChange: (r: Range) => void;
}

export function RangeChips({ value, onChange }: Props) {
  const { t } = useTranslation();
  return (
    <View style={styles.row} accessibilityRole="tablist">
      {RANGES.map((r) => {
        const label = t(`stats.range.${r}`);
        const selected = r === value;
        return (
          <Pressable
            key={r}
            onPress={() => onChange(r)}
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ selected }}
          >
            <Chip solid={selected}>{label}</Chip>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.s2, flexWrap: 'wrap' },
});
