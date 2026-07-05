import { useEffect, useState } from 'react';
import { View, StyleSheet, FlatList } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Text } from '@/components/Text';
import { TopBar } from '@/components/TopBar';
import { ContentContainer } from '@/components/ContentContainer';
import { EmptyState } from '@/components/EmptyState';
import { listLocalSessions, type LocalSession } from '@/src/db/sessionsRepo';
import { colors, spacing, typography } from '@/lib/theme';

function ninetyDaysAgo(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 90);
  return d.toISOString().slice(0, 10);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function HistoryScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [sessions, setSessions] = useState<LocalSession[]>([]);

  useEffect(() => {
    (async () => {
      const data = await listLocalSessions(ninetyDaysAgo(), today());
      setSessions(data);
    })();
  }, []);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <TopBar title={t('history.title')} />
      <FlatList
        data={sessions}
        keyExtractor={(s) => s.date}
        contentContainerStyle={{ paddingBottom: insets.bottom + spacing.s7 }}
        ListEmptyComponent={<EmptyState title={t('history.emptyTitle')} body={t('history.emptyBody')} icon="calendar" />}
        renderItem={({ item }) => (
          <ContentContainer style={styles.session}>
            <Text style={styles.date}>{item.date}</Text>
            {item.entries.map((e) => (
              <Text key={e.id} style={styles.entry}>{e.rawText}</Text>
            ))}
          </ContentContainer>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  session: {
    paddingHorizontal: spacing.s5,
    paddingVertical: spacing.s4,
    borderBottomWidth: 1,
    borderBottomColor: colors.ruleSoft,
  },
  date: { ...typography.monoBodyS, color: colors.lead, marginBottom: spacing.s2 },
  entry: { ...typography.body, color: colors.graphite },
});
