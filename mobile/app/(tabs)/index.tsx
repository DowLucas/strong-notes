import { useState } from 'react';
import { View, TextInput, FlatList, StyleSheet } from 'react-native';
import { parseQuickEntryLine, type ParsedLine } from '../../src/parsing/quickEntry';
import { upsertLocalSession, getLocalSession } from '../../src/db/sessionsRepo';
import { ParsedLineRow } from '../../src/components/ParsedLineRow';

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function LogScreen() {
  const [text, setText] = useState('');
  const [lines, setLines] = useState<ParsedLine[]>([]);

  async function handleSubmit() {
    const line = text.trim();
    if (!line) return;
    setText('');

    const parsed = await parseQuickEntryLine(line);
    const nextLines = [...lines, parsed];
    setLines(nextLines);

    const date = todayDate();
    const existing = await getLocalSession(date);
    await upsertLocalSession({
      date,
      notes: existing?.notes ?? null,
      synced: 0,
      entries: nextLines.map((l, i) => ({
        id: existing?.entries[i]?.id ?? `${date}-${i}-${Date.now()}`,
        exerciseId: null,
        equipment: l.equipment ?? null,
        weightKg: l.weightKg ?? null,
        reps: l.reps ?? null,
        sets: l.sets ?? null,
        rawText: l.rawText,
        parsedBy: l.parsedBy,
        order: i,
        synced: 0,
      })),
    });
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={lines}
        keyExtractor={(_, i) => String(i)}
        renderItem={({ item }) => <ParsedLineRow line={item} />}
      />
      <TextInput
        style={styles.input}
        placeholder="Log a set..."
        value={text}
        onChangeText={setText}
        onSubmitEditing={handleSubmit}
        returnKeyType="done"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12, marginTop: 8 },
});
