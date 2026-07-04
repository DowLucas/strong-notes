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

  useEffect(() => {
    (async () => {
      const data = await listLocalSessions(ninetyDaysAgo(), today());
      setSessions(data);
    })();
  }, []);

  return (
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
  );
}

const styles = StyleSheet.create({
  session: { padding: 16, borderBottomWidth: 1, borderBottomColor: '#eee' },
  date: { fontWeight: '700', marginBottom: 4 },
});
