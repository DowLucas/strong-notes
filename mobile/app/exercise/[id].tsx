import { useCallback, useEffect, useState } from 'react';
import { View, ScrollView, Pressable, StyleSheet, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { router, useLocalSearchParams } from 'expo-router';
import { Text } from '@/components/Text';
import { TopBar } from '@/components/TopBar';
import { IconButton } from '@/components/IconButton';
import { ContentContainer } from '@/components/ContentContainer';
import { EmptyState } from '@/components/EmptyState';
import { Chip } from '@/components/Chip';
import { ProgressChart } from '@/src/components/ProgressChart';
import { RangeChips } from '@/src/components/RangeChips';
import { listStatsRows } from '@/src/db/statsRepo';
import {
  computeExerciseProgress,
  rangeStart,
  seriesFor,
  isPr,
  formatHeadline,
  formatDelta,
  type ExerciseProgress,
  type Metric,
  type Range,
  type SetLine,
} from '@/lib/exerciseProgress';
import { colors, spacing, typography } from '@/lib/theme';

const METRICS: Metric[] = ['topSet', 'est1rm', 'volume'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatSet(s: SetLine): string {
  const w = s.weightKg != null ? `${s.weightKg}kg` : '';
  const rs = s.reps != null ? `${s.reps}×${s.sets ?? 1}` : '';
  return [w, rs].filter(Boolean).join(' ');
}

function formatDate(date: string): string {
  const [, m, d] = date.split('-').map(Number);
  return `${MONTHS[m - 1]} ${String(d).padStart(2, '0')}`;
}

function deltaColor(p: ExerciseProgress): string {
  if (!p.delta || p.delta.value === 0) return colors.lead;
  return p.delta.value > 0 ? colors.moss : colors.brick;
}

export default function ExerciseDetail() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [range, setRange] = useState<Range>('3m');
  const [metric, setMetric] = useState<Metric>('topSet');
  // undefined = loading, null = nothing logged for this id in the range.
  const [progress, setProgress] = useState<ExerciseProgress | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const today = todayIso();

  const load = useCallback(async () => {
    try {
      const rows = await listStatsRows(rangeStart(range, today));
      setProgress(computeExerciseProgress(rows).find((p) => p.exerciseId === id) ?? null);
      setError(null);
    } catch {
      setError(t('errors.generic'));
    }
  }, [id, range, today, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const metricLabel: Record<Metric, string> = {
    topSet: t('exercise.metricTopSet'),
    est1rm: t('exercise.metricEst1rm'),
    volume: t('exercise.metricVolume'),
  };
  // Bodyweight exercises only have a reps series.
  const metrics = progress?.unit === 'reps' ? (['topSet'] as Metric[]) : METRICS;
  const chartWidth = Math.min(width, 520) - spacing.s4 * 2;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <TopBar
        title={progress ? (progress.name ?? t('stats.unnamedExercise')) : ''}
        left={<IconButton icon="chevron-left" label={t('common.back')} onPress={() => router.back()} />}
      />
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + spacing.s7 }}>
        <ContentContainer style={styles.content}>
          <RangeChips value={range} onChange={setRange} />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {progress === null ? (
            <EmptyState title={t('exercise.notFoundTitle')} body={t('exercise.notFoundBody')} icon="trending-up" />
          ) : progress ? (
            <>
              <View style={styles.headline}>
                <Text style={styles.headlineValue}>{formatHeadline(progress.headline)}</Text>
                <Text style={[styles.delta, { color: deltaColor(progress) }]}>{formatDelta(progress.delta)}</Text>
                <Text variant="bodyS" style={styles.muted}>
                  {t('stats.sessions', { count: progress.sessionCount })}
                </Text>
              </View>

              <ProgressChart
                points={seriesFor(progress, metric)}
                unit={metric === 'topSet' ? progress.unit : ''}
                width={chartWidth}
              />

              {metrics.length > 1 ? (
                <View style={styles.toggle}>
                  {metrics.map((m) => (
                    <Pressable
                      key={m}
                      onPress={() => setMetric(m)}
                      accessibilityRole="button"
                      accessibilityLabel={metricLabel[m]}
                      accessibilityState={{ selected: m === metric }}
                    >
                      <Chip solid={m === metric}>{metricLabel[m]}</Chip>
                    </Pressable>
                  ))}
                </View>
              ) : null}

              <Text variant="bodyEmphasis" style={styles.heading}>
                {t('exercise.sessionsHeading')}
              </Text>
              {[...progress.points].reverse().map((pt, revIdx) => {
                const idx = progress.points.length - 1 - revIdx;
                return (
                  <View key={pt.date} style={styles.sessionRow}>
                    <Text style={styles.sessionDate}>{formatDate(pt.date)}</Text>
                    <Text style={styles.sessionSets} numberOfLines={2}>
                      {pt.sets.map(formatSet).join('   ')}
                    </Text>
                    {isPr(progress, idx) ? <Text style={styles.pr}>{t('exercise.pr')}</Text> : null}
                  </View>
                );
              })}
            </>
          ) : null}
        </ContentContainer>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  content: { gap: spacing.s4, paddingTop: spacing.s3, paddingHorizontal: spacing.s4 },
  error: { color: colors.brick },
  headline: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.s3 },
  headlineValue: { ...typography.amountL, color: colors.graphite },
  delta: { ...typography.monoBody },
  muted: { color: colors.lead },
  toggle: { flexDirection: 'row', gap: spacing.s2 },
  heading: { color: colors.graphite, marginTop: spacing.s2 },
  sessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s3,
    paddingVertical: spacing.s2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.ruleSoft,
  },
  sessionDate: { ...typography.monoBodyS, color: colors.lead, width: 56 },
  sessionSets: { ...typography.monoBodyS, color: colors.graphite, flex: 1 },
  pr: { ...typography.monoLabel, color: colors.moss },
});
