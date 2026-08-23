import { useCallback, useState } from 'react';
import { View, StyleSheet, FlatList, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { router, useFocusEffect } from 'expo-router';
import { Text } from '@/components/Text';
import { TopBar } from '@/components/TopBar';
import { ContentContainer } from '@/components/ContentContainer';
import { EmptyState } from '@/components/EmptyState';
import { ErrorRetry } from '@/src/components/ErrorRetry';
import { SkeletonRows } from '@/src/components/SkeletonRows';
import { listAllLocalSessions, type LocalSession, type LocalSetEntry } from '@/src/db/sessionsRepo';
import { listExerciseNames } from '@/src/db/statsRepo';
import { formatSetLine, formatShortDate } from '@/lib/exerciseProgress';
import { colors, spacing, typography } from '@/lib/theme';

function currentYear(): string {
  return new Date().toISOString().slice(0, 4);
}

function EntryRow({ entry, name }: { entry: LocalSetEntry; name: string | undefined }) {
  const { t } = useTranslation();
  const title = name ?? entry.rawText;
  const summary = formatSetLine(entry);
  const unconfirmed = entry.exerciseId == null;
  const content = (
    <>
      <View style={styles.entryMain}>
        <Text variant="bodyEmphasis" style={styles.entryName}>{title}</Text>
        {summary ? <Text style={styles.entrySummary}>{summary}</Text> : null}
      </View>
      {unconfirmed ? <Text style={styles.flag}>{t('history.unconfirmed')}</Text> : null}
    </>
  );
  if (unconfirmed) return <View style={styles.entry}>{content}</View>;
  return (
    <Pressable
      style={({ pressed }) => [styles.entry, pressed && styles.pressed]}
      onPress={() => router.push({ pathname: '/exercise/[id]', params: { id: entry.exerciseId!, name: title } })}
      accessibilityRole="button"
      accessibilityLabel={summary ? `${title}, ${summary}` : title}
      accessibilityHint={t('stats.openProgressHint')}
    >
      {content}
    </Pressable>
  );
}

export default function HistoryScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  // null = loading.
  const [sessions, setSessions] = useState<LocalSession[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const year = currentYear();

  const load = useCallback(async () => {
    try {
      const [data, nameMap] = await Promise.all([listAllLocalSessions(), listExerciseNames()]);
      setNames(nameMap);
      setSessions(data);
      setError(null);
    } catch {
      setError(t('errors.generic'));
    }
  }, [t]);

  // Reload whenever the tab gains focus — a workout may have just been logged.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <TopBar title={t('history.title')} />
      {error ? (
        <ContentContainer style={styles.errorBox}>
          <ErrorRetry message={error} onRetry={() => void load()} />
        </ContentContainer>
      ) : null}
      {sessions === null && !error ? (
        <ContentContainer style={styles.errorBox}><SkeletonRows /></ContentContainer>
      ) : (
        <FlatList
          data={sessions ?? []}
          keyExtractor={(s) => s.date}
          contentContainerStyle={{ paddingBottom: insets.bottom + spacing.s7, flexGrow: 1 }}
          ListEmptyComponent={<EmptyState title={t('history.emptyTitle')} body={t('history.emptyBody')} icon="calendar" />}
          renderItem={({ item }) => (
            <ContentContainer style={styles.session}>
              <Text style={styles.date}>{formatShortDate(item.date, { withYear: !item.date.startsWith(year) })}</Text>
              {item.entries.map((e) => (
                <EntryRow key={e.id} entry={e} name={e.exerciseId ? names[e.exerciseId] : undefined} />
              ))}
              {item.notes ? <Text variant="bodyS" style={styles.notes}>{item.notes}</Text> : null}
            </ContentContainer>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  errorBox: { paddingHorizontal: spacing.s5, paddingTop: spacing.s3 },
  session: {
    paddingHorizontal: spacing.s5,
    paddingVertical: spacing.s4,
    borderBottomWidth: 1,
    borderBottomColor: colors.ruleSoft,
  },
  date: { ...typography.monoLabel, color: colors.lead, marginBottom: spacing.s2 },
  entry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s3,
    minHeight: 44,
    paddingVertical: spacing.s1,
  },
  pressed: { opacity: 0.6 },
  entryMain: { flex: 1, gap: 2 },
  entryName: { color: colors.graphite },
  entrySummary: { ...typography.monoBodyS, color: colors.lead },
  flag: { ...typography.monoLabel, color: colors.lead },
  notes: { color: colors.lead, marginTop: spacing.s2, fontStyle: 'italic' },
});
