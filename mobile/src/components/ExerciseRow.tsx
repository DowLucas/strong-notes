import { View, Pressable, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Text } from '@/components/Text';
import { colors, spacing, typography } from '@/lib/theme';
import {
  formatDelta, formatHeadline, relativeDay, seriesFor, type ExerciseProgress,
} from '@/lib/exerciseProgress';
import { Sparkline } from './Sparkline';

function deltaColor(delta: ExerciseProgress['delta']): string {
  if (!delta || delta.value === 0) return colors.lead;
  return delta.value > 0 ? colors.moss : colors.brick;
}

/** One exercise in the Stats list: name, headline value, delta, sessions/last line and a sparkline. */
export function ExerciseRow({ progress, today, onPress }: { progress: ExerciseProgress; today: string; onPress: () => void }) {
  const { t } = useTranslation();
  const name = progress.name ?? t('stats.unnamedExercise');
  const headline = formatHeadline(progress.headline);
  const delta = formatDelta(progress.delta);
  const sub = `${t('stats.sessions', { count: progress.sessionCount })} · ${t('stats.last', { when: relativeDay(progress.lastDate, today) })}`;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${headline}, ${delta}, ${sub}`}
    >
      <View style={styles.main}>
        <View style={styles.topLine}>
          <Text variant="bodyEmphasis" style={styles.name} numberOfLines={1}>{name}</Text>
          <Text style={styles.headline}>{headline}</Text>
          <Text style={[styles.delta, { color: deltaColor(progress.delta) }]}>{delta}</Text>
        </View>
        <Text variant="bodyS" style={styles.sub}>{sub}</Text>
      </View>
      <Sparkline points={seriesFor(progress, 'topSet')} />
    </Pressable>
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
  pressed: { opacity: 0.6 },
  main: { flex: 1, gap: spacing.s1 },
  topLine: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.s2 },
  name: { flex: 1, color: colors.graphite },
  headline: { ...typography.amountS, color: colors.graphite },
  delta: { ...typography.monoCaption },
  sub: { color: colors.lead },
});
