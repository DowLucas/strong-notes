import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { View, ScrollView, StyleSheet, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { router, useLocalSearchParams } from 'expo-router';
import { Text } from '@/components/Text';
import { TopBar } from '@/components/TopBar';
import { IconButton } from '@/components/IconButton';
import { ContentContainer } from '@/components/ContentContainer';
import { EmptyState } from '@/components/EmptyState';
import { ProgressChart, type ProgressChartPoint } from '@/src/components/ProgressChart';
import { RangeChips } from '@/src/components/RangeChips';
import { ChipTabs } from '@/src/components/ChipTabs';
import { ErrorRetry } from '@/src/components/ErrorRetry';
import { useDeltaText } from '@/src/components/useDeltaText';
import { listStatsRows } from '@/src/db/statsRepo';
import {
  computeExerciseProgress,
  rangeStart,
  seriesFor,
  prDates,
  headlineFor,
  deltaFor,
  formatHeadline,
  formatSetLine,
  formatShortDate,
  spansYears,
  type ExerciseProgress,
  type Metric,
  type Range,
  type StatsRow,
} from '@/lib/exerciseProgress';
import { colors, spacing, typography } from '@/lib/theme';

// i18n parser hint — keys are built from a template below:
// t('stats.rangeLong.1m') t('stats.rangeLong.3m') t('stats.rangeLong.6m') t('stats.rangeLong.1y')

const METRICS: Metric[] = ['topSet', 'est1rm', 'volume'];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function goBack() {
  if (router.canGoBack()) router.back();
  else router.replace('/(tabs)/stats');
}

export default function ExerciseDetail() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { id, name: nameParam } = useLocalSearchParams<{ id: string; name?: string }>();
  const [range, setRange] = useState<Range>('3m');
  const [metric, setMetric] = useState<Metric>('topSet');
  // All-time rows for this exercise: undefined = loading. The range is applied client-side so
  // switching ranges is instant and PRs are always judged against the full history.
  const [rows, setRows] = useState<StatsRow[] | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const today = todayIso();

  const load = useCallback(async () => {
    try {
      const all = await listStatsRows(null);
      setRows(all.filter((r) => r.exerciseId === id));
      setError(null);
    } catch {
      setError(t('errors.generic'));
    }
  }, [id, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const allTime = useMemo(() => (rows?.length ? computeExerciseProgress(rows)[0] : null), [rows]);
  const progress = useMemo<ExerciseProgress | null>(() => {
    if (!rows?.length) return null;
    const from = rangeStart(range, today);
    const inRange = from ? rows.filter((r) => r.sessionDate >= from) : rows;
    return inRange.length ? computeExerciseProgress(inRange)[0] : null;
  }, [rows, range, today]);
  const prs = useMemo(() => (allTime ? prDates(allTime) : new Set<string>()), [allTime]);

  const metricLabel: Record<Metric, string> = {
    topSet: t('exercise.metricTopSet'),
    est1rm: t('exercise.metricEst1rm'),
    volume: t('exercise.metricVolume'),
  };
  // Bodyweight exercises only have a reps series.
  const metrics = progress?.unit === 'reps' ? (['topSet'] as Metric[]) : METRICS;
  const activeMetric = metrics.includes(metric) ? metric : 'topSet';
  const chartWidth = Math.min(width, 520) - spacing.s4 * 2;
  const title = progress?.name ?? allTime?.name ?? nameParam ?? (rows ? t('stats.unnamedExercise') : '');
  const delta = useDeltaText(progress ? deltaFor(progress, activeMetric) : null);
  const rangeLong = range === 'all' ? '' : t(`stats.rangeLong.${range}`);

  const chartPoints: ProgressChartPoint[] = progress
    ? seriesFor(progress, activeMetric).map((s, i) => ({
        ...s,
        pr: prs.has(s.date),
        hollow: progress.unit === 'kg' && progress.points[i].topWeightKg == null,
      }))
    : [];
  const hasHollow = chartPoints.some((p) => p.hollow);
  const showYear = progress ? spansYears(progress.points[0].date, progress.lastDate) : false;
  const chartUnit = progress ? (activeMetric === 'topSet' ? progress.unit : 'kg') : '';

  let body: ReactNode = null;
  if (rows && !allTime) {
    body = <EmptyState title={t('exercise.unknownTitle')} body={t('exercise.unknownBody')} icon="trending-up" />;
  } else if (rows && !progress) {
    body = (
      <>
        <RangeChips value={range} onChange={setRange} />
        <EmptyState
          title={t('exercise.emptyRangeTitle', { range: rangeLong })}
          body={t('exercise.emptyRangeBody')}
          icon="trending-up"
          action={{ label: t('stats.showAllTime'), onPress: () => setRange('all') }}
        />
      </>
    );
  } else if (progress) {
    body = (
      <>
        <View style={styles.headline}>
          <Text style={styles.headlineValue}>{formatHeadline(headlineFor(progress, activeMetric))}</Text>
          <Text style={[styles.delta, { color: delta.color }]} accessibilityLabel={delta.a11y}>{delta.text}</Text>
        </View>
        <Text variant="monoCaption" style={styles.muted}>
          {metricLabel[activeMetric]} · {t('stats.sessions', { count: progress.sessionCount })} · {t('stats.deltaCaption')}
        </Text>

        {metrics.length > 1 ? (
          <ChipTabs
            label={t('stats.metricGroup')}
            options={metrics.map((m) => ({ value: m, label: metricLabel[m] }))}
            value={activeMetric}
            onChange={setMetric}
          />
        ) : null}

        {progress.sessionCount < 2 ? (
          <Text variant="bodyS" style={[styles.muted, styles.singleSession]}>{t('exercise.singleSession')}</Text>
        ) : (
          <ProgressChart points={chartPoints} unit={chartUnit} label={metricLabel[activeMetric]} width={chartWidth} />
        )}
        {hasHollow ? <Text variant="monoCaption" style={styles.muted}>{t('exercise.hollowCaption')}</Text> : null}

        <RangeChips value={range} onChange={setRange} />

        <Text variant="bodyEmphasis" style={styles.heading}>
          {t('exercise.sessionsHeading')}
        </Text>
        {[...progress.points].reverse().map((pt) => (
          <View key={pt.date} style={styles.sessionRow}>
            <Text style={[styles.sessionDate, showYear && styles.sessionDateWide]}>
              {formatShortDate(pt.date, { withYear: showYear })}
            </Text>
            <Text style={styles.sessionSets}>
              {pt.sets.map((s) => formatSetLine(s, { weightlessAs: progress.unit === 'kg' ? 'bw' : 'reps' })).join('   ')}
            </Text>
            {prs.has(pt.date) ? <Text style={styles.pr} accessibilityLabel={t('exercise.prLabel')}>{t('exercise.pr')}</Text> : null}
          </View>
        ))}
      </>
    );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <TopBar title={title} left={<IconButton icon="chevron-left" label={t('common.back')} onPress={goBack} />} />
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + spacing.s7 }}>
        <ContentContainer style={styles.content}>
          {error ? <ErrorRetry message={error} onRetry={() => void load()} /> : null}
          {body}
        </ContentContainer>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  content: { gap: spacing.s3, paddingTop: spacing.s3, paddingHorizontal: spacing.s4 },
  headline: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.s3 },
  headlineValue: { ...typography.amountL, color: colors.graphite },
  delta: { ...typography.monoBody },
  muted: { color: colors.lead },
  singleSession: { paddingVertical: spacing.s5, textAlign: 'center' },
  heading: { color: colors.graphite, marginTop: spacing.s2 },
  sessionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.s3,
    paddingVertical: spacing.s2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.ruleSoft,
  },
  sessionDate: { ...typography.monoBodyS, color: colors.lead, width: 96 },
  sessionDateWide: { width: 140 },
  sessionSets: { ...typography.monoBodyS, color: colors.graphite, flex: 1 },
  pr: { ...typography.monoLabel, color: colors.moss },
});
