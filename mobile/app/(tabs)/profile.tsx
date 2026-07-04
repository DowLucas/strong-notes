import { useEffect, useState } from 'react';
import { View, Text, FlatList, Pressable, TextInput, StyleSheet } from 'react-native';
import { getCachedAbbreviations } from '../../src/db/abbreviationsRepo';
import { confirmAbbreviation } from '../../src/api/client';
import { syncNow } from '../../src/sync/syncEngine';
import { getApiToken, setApiToken } from '../../src/auth/token';
import type { Abbreviation } from '../../src/api/types';

export default function ProfileScreen() {
  const [abbreviations, setAbbreviations] = useState<Abbreviation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState('');

  async function refresh() {
    try {
      await syncNow();
      const cached = await getCachedAbbreviations();
      setAbbreviations(cached);
      setError(null);
    } catch {
      setError("Couldn't load data. Pull down or reopen the app to retry.");
    }
  }

  useEffect(() => {
    (async () => {
      const existing = await getApiToken();
      if (existing) {
        setToken(existing);
      }
    })();
    refresh();
  }, []);

  async function handleConfirm(id: string) {
    try {
      await confirmAbbreviation(id);
      await refresh();
    } catch {
      setError("Couldn't load data. Pull down or reopen the app to retry.");
    }
  }

  async function handleSaveToken() {
    await setApiToken(token);
    await refresh();
  }

  return (
    <View style={styles.container}>
      <View style={styles.tokenSection}>
        <Text style={styles.label}>API token</Text>
        <View style={styles.tokenRow}>
          <TextInput
            style={styles.tokenInput}
            placeholder="API token"
            value={token}
            onChangeText={setToken}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Pressable onPress={handleSaveToken}>
            <Text style={styles.confirm}>Save</Text>
          </Pressable>
        </View>
      </View>
      {error && <Text style={styles.error}>{error}</Text>}
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  row: { flexDirection: 'row', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: '#eee' },
  confirm: { color: '#2563eb', fontWeight: '600' },
  error: { color: '#a33', padding: 16 },
  tokenSection: { padding: 16, borderBottomWidth: 1, borderBottomColor: '#eee' },
  label: { fontWeight: '600', marginBottom: 8 },
  tokenRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  tokenInput: { flex: 1, borderWidth: 1, borderColor: '#ccc', borderRadius: 6, paddingHorizontal: 12, paddingVertical: 8 },
});
