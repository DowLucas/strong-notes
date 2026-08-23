import { View, Pressable, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Text } from '@/components/Text';
import { colors, spacing, typography } from '@/lib/theme';

/** Inline error message (announced to assistive tech) with a Retry button. */
export function ErrorRetry({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <View style={styles.row}>
      <Text style={styles.message} accessibilityRole="alert" accessibilityLiveRegion="polite">
        {message}
      </Text>
      <Pressable
        onPress={onRetry}
        style={({ pressed }) => [styles.button, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={t('common.retry')}
      >
        <Text style={styles.buttonLabel}>{t('common.retry')}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.s3 },
  message: { flex: 1, color: colors.brick },
  button: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.s3,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.graphite,
  },
  pressed: { opacity: 0.6 },
  buttonLabel: { ...typography.monoLabel, color: colors.graphite },
});
