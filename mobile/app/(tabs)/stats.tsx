import { useCallback, useEffect, useState } from 'react';
import { View, FlatList, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { router } from 'expo-router';
import { Text } from '@/components/Text';
import { TopBar } from '@/components/TopBar';
import { ContentContainer } from '@/components/ContentContainer';
import { EmptyState } from '@/components/EmptyState';
import { ExerciseRow } from '@/src/components/ExerciseRow';
import { RangeChips } from '@/src/components/RangeChips';
import { listStatsRows } from '@/src/db/statsRepo';
import { computeExerciseProgress, rangeStart, type ExerciseProgress, type Range } from '@/lib/exerciseProgress';
import { colors, spacing } from '@/lib/theme';

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
  const today = todayIso();

  const load = useCallback(async () => {
    try {
      const rows = await listStatsRows(rangeStart(range, today));
      setItems(computeExerciseProgress(rows));
      setError(null);
    } catch {
      setError(t('errors.generic'));
    }
  }, [range, today, t]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <TopBar title={t('stats.title')} />
      <ContentContainer style={styles.content}>
        <RangeChips value={range} onChange={setRange} />
        {error ? (
          <Text style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
        {items && items.length === 0 ? (
          <EmptyState title={t('stats.emptyTitle')} body={t('stats.emptyBody')} icon="trending-up" />
        ) : (
          <FlatList
            data={items ?? []}
            keyExtractor={(p) => p.exerciseId}
            contentContainerStyle={{ paddingBottom: insets.bottom + spacing.s7 }}
            renderItem={({ item }) => (
              <ExerciseRow
                progress={item}
                today={today}
                onPress={() => router.push({ pathname: '/exercise/[id]', params: { id: item.exerciseId } })}
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
  content: { flex: 1, gap: spacing.s4, paddingTop: spacing.s3, paddingHorizontal: spacing.s5 },
  error: { color: colors.brick },
});
