import { View, Pressable, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Feather } from '@expo/vector-icons';
import { Text } from '@/components/Text';
import { colors, radii, spacing, typography } from '@/lib/theme';

export type PendingGroup = {
  groupId: string;
  /** Guessed exercise name (or raw text) for the preview line. */
  label: string;
  /** True when this group has a clarifying question and can't be bulk-confirmed. */
  needsAnswer: boolean;
};

/**
 * Bottom bar listing every unconfirmed (amber) group in the note with a
 * one-tap "Confirm all", so the user doesn't have to open each highlight.
 * Groups with a clarifying question are excluded from the bulk action and
 * called out separately. `progress` (n of total) is shown while confirming.
 */
export function ConfirmBar({
  pending,
  progress,
  onConfirmAll,
  onDismiss,
}: {
  pending: PendingGroup[];
  progress: { done: number; total: number } | null;
  onConfirmAll: () => void;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  if (pending.length === 0) return null;
  const confirmable = pending.filter((p) => !p.needsAnswer);
  const needAnswer = pending.length - confirmable.length;
  const preview = pending.map((p) => p.label).join(' · ');
  const busy = progress != null;

  return (
    <View style={styles.bar} accessibilityRole="summary">
      <View style={styles.header}>
        <Text variant="bodyEmphasis" style={styles.title}>
          {t('log.confirmBar.count', { count: pending.length })}
        </Text>
        <Pressable
          onPress={onDismiss}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={t('log.confirmBar.dismiss')}
          disabled={busy}
        >
          <Feather name="x" size={18} color={colors.lead} />
        </Pressable>
      </View>
      <Text variant="bodyS" style={styles.preview} numberOfLines={1}>
        {preview}
      </Text>
      {needAnswer > 0 ? (
        <Text variant="bodyS" style={styles.needAnswer}>
          {t('log.confirmBar.needsAnswer', { count: needAnswer })}
        </Text>
      ) : null}
      {confirmable.length > 0 ? (
        <Pressable
          onPress={onConfirmAll}
          disabled={busy}
          style={({ pressed }) => [styles.button, (pressed || busy) && styles.buttonPressed]}
          accessibilityRole="button"
          accessibilityLabel={
            busy
              ? t('log.confirmBar.confirming', { done: progress.done, total: progress.total })
              : t('log.confirmBar.confirmAll', { count: confirmable.length })
          }
        >
          <Text style={styles.buttonLabel}>
            {busy
              ? t('log.confirmBar.confirming', { done: progress.done, total: progress.total })
              : t('log.confirmBar.confirmAll', { count: confirmable.length })}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    marginHorizontal: spacing.s3,
    marginBottom: spacing.s3,
    padding: spacing.s3,
    gap: spacing.s1,
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.graphite,
    borderRadius: radii.md,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: colors.graphite },
  preview: { color: colors.lead },
  needAnswer: { color: colors.brick },
  button: {
    alignSelf: 'flex-end',
    marginTop: spacing.s1,
    paddingHorizontal: spacing.s4,
    paddingVertical: spacing.s2,
    borderRadius: radii.pill,
    backgroundColor: colors.graphite,
  },
  buttonPressed: { opacity: 0.7 },
  buttonLabel: { ...typography.bodyEmphasis, color: colors.paper },
});
