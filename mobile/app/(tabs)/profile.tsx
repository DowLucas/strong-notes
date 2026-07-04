import { useEffect, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet } from 'react-native';
import { getCachedAbbreviations } from '../../src/db/abbreviationsRepo';
import { confirmAbbreviation } from '../../src/api/client';
import { syncNow } from '../../src/sync/syncEngine';
import type { Abbreviation } from '../../src/api/types';

export default function ProfileScreen() {
  const [abbreviations, setAbbreviations] = useState<Abbreviation[]>([]);

  async function refresh() {
    await syncNow();
    const cached = await getCachedAbbreviations();
    setAbbreviations(cached);
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleConfirm(id: string) {
    await confirmAbbreviation(id);
    await refresh();
  }

  return (
    <FlatList
      data={abbreviations}
      keyExtractor={(a) => a.id}
      renderItem={({ item }) => (
        <View style={styles.row}>
          <Text>{item.token}</Text>
          {item.source === 'LLM_SUGGESTED_PENDING_CONFIRM' && (
            <Pressable onPress={() => handleConfirm(item.id)}>
              <Text style={styles.confirm}>Confirm</Text>
            </Pressable>
          )}
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: '#eee' },
  confirm: { color: '#2563eb', fontWeight: '600' },
});
