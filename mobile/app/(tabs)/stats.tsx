import { useCallback, useRef, useState } from 'react';
import { View, FlatList, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { router, useFocusEffect } from 'expo-router';
import { Text } from '@/components/Text';
import { TopBar } from '@/components/TopBar';
import { ContentContainer } from '@/components/ContentContainer';
import { EmptyState } from '@/components/EmptyState';
import { ExerciseRow } from '@/src/components/ExerciseRow';
import { RangeChips } from '@/src/components/RangeChips';
import { ErrorRetry } from '@/src/components/ErrorRetry';
import { SkeletonRows } from '@/src/components/SkeletonRows';
import { listStatsRows } from '@/src/db/statsRepo';
import { computeExerciseProgress, rangeStart, type ExerciseProgress, type Range } from '@/lib/exerciseProgress';
import { colors, spacing } from '@/lib/theme';

// i18n parser hint — keys are built from a template below:
// t('stats.rangeLong.1m') t('stats.rangeLong.3m') t('stats.rangeLong.6m') t('stats.rangeLong.1y')

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function StatsScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [range, setRange] = useState<Range>('3m');
  // null = loading; [] = nothing logged in the range.
  const [items, setItems] = useState<ExerciseProgress[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Whether anything at all has been logged — decides between onboarding copy and a range hint.
  // Once true it stays true for the life of the screen (logging only adds data).
  const hasAnyData = useRef(false);
  const today = todayIso();

  const load = useCallback(async () => {
    try {
      const rows = await listStatsRows(rangeStart(range, today));
      if (rows.length > 0) hasAnyData.current = true;
      else if (!hasAnyData.current && range !== 'all') hasAnyData.current = (await listStatsRows(null)).length > 0;
      setItems(computeExerciseProgress(rows));
      setError(null);
    } catch {
      setError(t('errors.generic'));
    }
  }, [range, today, t]);

  // Reload whenever the tab gains focus (a workout may have been logged) and whenever the range changes.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const empty = items && items.length === 0
    ? range !== 'all' && hasAnyData.current
      ? (
        <EmptyState
          title={t('stats.emptyRangeTitle', { range: t(`stats.rangeLong.${range}`) })}
          body={t('stats.emptyRangeBody')}
          icon="trending-up"
          action={{ label: t('stats.showAllTime'), onPress: () => setRange('all') }}
        />
      )
      : <EmptyState title={t('stats.emptyTitle')} body={t('stats.emptyBody')} icon="trending-up" />
    : null;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <TopBar title={t('stats.title')} />
      <ContentContainer style={styles.content}>
        <View style={styles.rangeBlock}>
          <RangeChips value={range} onChange={setRange} />
          <Text variant="monoCaption" style={styles.caption}>{t('stats.deltaCaption')}</Text>
        </View>
        {error ? <ErrorRetry message={error} onRetry={() => void load()} /> : null}
        {items === null && !error ? (
          <SkeletonRows />
        ) : empty ?? (
          <FlatList
            data={items ?? []}
            keyExtractor={(p) => p.exerciseId}
            contentContainerStyle={{ paddingBottom: insets.bottom + spacing.s7 }}
            renderItem={({ item }) => (
              <ExerciseRow
                progress={item}
                today={today}
                onPress={() => router.push({ pathname: '/exercise/[id]', params: { id: item.exerciseId, name: item.name ?? '' } })}
              />
            )}
          />
        )}
      </ContentContainer>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  content: { flex: 1, gap: spacing.s3, paddingTop: spacing.s2, paddingHorizontal: spacing.s5 },
  rangeBlock: { gap: spacing.s1 },
  caption: { color: colors.lead },
});
