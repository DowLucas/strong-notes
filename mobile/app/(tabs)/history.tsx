import { useEffect, useState } from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { listLocalSessions } from '../../src/db/sessionsRepo';
import type { LocalSession } from '../../src/db/sessionsRepo';

function ninetyDaysAgo(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 90);
  return d.toISOString().slice(0, 10);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function HistoryScreen() {
  const [sessions, setSessions] = useState<LocalSession[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const data = await listLocalSessions(ninetyDaysAgo(), today());
        setSessions(data);
        setError(null);
      } catch {
        setError("Couldn't load data. Pull down or reopen the app to retry.");
      }
    })();
  }, []);

  return (
    <View style={styles.container}>
      {error && <Text style={styles.error}>{error}</Text>}
      <FlatList
        data={sessions}
        keyExtractor={(s) => s.date}
        renderItem={({ item }) => (
          <View style={styles.session}>
            <Text style={styles.date}>{item.date}</Text>
            {item.entries.map((e) => (
              <Text key={e.id}>{e.rawText}</Text>
            ))}
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  session: { padding: 16, borderBottomWidth: 1, borderBottomColor: '#eee' },
  date: { fontWeight: '700', marginBottom: 4 },
  error: { color: '#a33', padding: 16 },
});
