import { View, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors, spacing } from '@/lib/theme';

/** Placeholder list rows shown while a list loads — three muted blocks in the shape of a list row. */
export function SkeletonRows({ count = 3 }: { count?: number }) {
  const { t } = useTranslation();
  return (
    <View accessibilityLabel={t('common.loading')} accessibilityRole="progressbar" testID="skeleton-rows">
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={styles.row}>
          <View style={styles.main}>
            <View style={[styles.block, styles.title]} />
            <View style={[styles.block, styles.sub]} />
          </View>
          <View style={[styles.block, styles.spark]} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s3,
    paddingVertical: spacing.s3,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.ruleSoft,
  },
  main: { flex: 1, gap: spacing.s2 },
  block: { backgroundColor: colors.bone, borderRadius: 4 },
  title: { height: 16, width: '60%' },
  sub: { height: 12, width: '40%' },
  spark: { width: 80, height: 24 },
});
