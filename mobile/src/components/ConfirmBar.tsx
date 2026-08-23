import { View, Pressable, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Feather } from '@expo/vector-icons';
import { Text } from '@/components/Text';
import { colors, radii, spacing, typography } from '@/lib/theme';

export type PendingGroup = {
  groupId: string;
  /** Guessed exercise name (or raw text) for the chip. */
  label: string;
  /** True when this group has a clarifying question and can't be bulk-confirmed. */
  needsAnswer: boolean;
};

/**
 * Bottom bar listing every unconfirmed (amber) group in the note. Each name
 * is a chip that opens that group's sheet; "Confirm all N" confirms the ones
 * without a clarifying question in one tap. `progress` (n of total) is shown
 * while confirming. When `collapsed`, only a small "N to confirm ›" pill is
 * shown (bottom-right) so the editor stays clear until the user wants it back.
 */
export function ConfirmBar({
  pending,
  progress,
  collapsed,
  onConfirmAll,
  onOpenGroup,
  onDismiss,
  onExpand,
}: {
  pending: PendingGroup[];
  progress: { done: number; total: number } | null;
  collapsed: boolean;
  onConfirmAll: () => void;
  onOpenGroup: (groupId: string) => void;
  onDismiss: () => void;
  onExpand: () => void;
}) {
  const { t } = useTranslation();
  if (pending.length === 0) return null;
  const confirmable = pending.filter((p) => !p.needsAnswer);
  const needAnswer = pending.length - confirmable.length;
  const busy = progress != null;

  if (collapsed) {
    const pillLabel = t('log.confirmBar.pill', { count: pending.length });
    return (
      <View style={styles.pillWrap} pointerEvents="box-none">
        <Pressable
          onPress={onExpand}
          style={({ pressed }) => [styles.pill, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={pillLabel}
          accessibilityHint={t('log.confirmBar.pillHint')}
        >
          <Text style={styles.pillLabel}>{pillLabel} ›</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.bar} accessibilityRole="summary">
      <View style={styles.header}>
        <Text variant="bodyEmphasis" style={styles.title}>
          {t('log.confirmBar.count', { count: pending.length })}
        </Text>
        <Pressable
          onPress={onDismiss}
          hitSlop={10}
          style={({ pressed }) => [styles.hideBtn, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={t('log.confirmBar.dismiss')}
          disabled={busy}
        >
          <Feather name="x" size={20} color={colors.lead} />
        </Pressable>
      </View>
      <View style={styles.chips}>
        {pending.map((p) => (
          <Pressable
            key={p.groupId}
            onPress={() => onOpenGroup(p.groupId)}
            disabled={busy}
            style={({ pressed }) => [styles.chip, p.needsAnswer && styles.chipNeedsAnswer, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={p.label}
            accessibilityHint={t('log.confirmBar.openGroupHint')}
          >
            <Text variant="bodyS" style={styles.chipLabel} numberOfLines={1}>
              {p.label}
            </Text>
            <Feather name="chevron-right" size={16} color={colors.graphite} />
          </Pressable>
        ))}
      </View>
      {needAnswer > 0 ? (
        <Text variant="bodyS" style={styles.needAnswer}>
          {t('log.confirmBar.needsAnswer', { count: needAnswer })}
        </Text>
      ) : null}
      {confirmable.length > 0 ? (
        <Pressable
          onPress={onConfirmAll}
          disabled={busy}
          style={({ pressed }) => [styles.button, (pressed || busy) && styles.pressed]}
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
    gap: spacing.s2,
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.graphite,
    borderRadius: radii.md,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: colors.graphite },
  hideBtn: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', marginRight: -spacing.s2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.s2 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s1,
    minHeight: 44,
    paddingLeft: spacing.s3,
    paddingRight: spacing.s2,
    borderRadius: radii.pill,
    backgroundColor: colors.citrinePale,
    borderWidth: 1,
    borderColor: colors.citrine,
  },
  chipNeedsAnswer: { borderStyle: 'dashed' },
  chipLabel: { color: colors.graphite, maxWidth: 220 },
  needAnswer: { color: colors.brick },
  button: {
    alignSelf: 'flex-end',
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.s4,
    borderRadius: radii.pill,
    backgroundColor: colors.graphite,
  },
  buttonLabel: { ...typography.bodyEmphasis, color: colors.paper },
  pillWrap: { alignItems: 'flex-end', paddingHorizontal: spacing.s3, paddingBottom: spacing.s3 },
  pill: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.s4,
    borderRadius: radii.pill,
    backgroundColor: colors.graphite,
  },
  pillLabel: { ...typography.bodyEmphasis, color: colors.paper },
  pressed: { opacity: 0.7 },
});
