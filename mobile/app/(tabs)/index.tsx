import { useRef, useState } from 'react';
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

  // `lines` (React state) is only current as of the last render, so a
  // handleSubmit call that's been suspended on the `await parseQuickEntryLine`
  // network round-trip can end up closing over a stale value if another
  // submission commits state in the meantime. `linesRef` is a plain mutable
  // ref we update synchronously ourselves, so it always reflects the latest
  // known list regardless of render timing - each submission appends onto
  // whatever the ref holds "right now", never onto a stale snapshot.
  const linesRef = useRef<ParsedLine[]>([]);

  // SQLite writes read-then-write (fetch existing entries to preserve their
  // ids, then upsert the full list). If two submissions' writes overlapped,
  // the second could read state from before the first write committed and
  // clobber it. Chaining every persist call onto this queue serializes them
  // so writes always happen one at a time, in the order their submissions
  // resolved.
  const persistQueueRef = useRef<Promise<void>>(Promise.resolve());

  async function persistLines(allLines: ParsedLine[]): Promise<void> {
    const date = todayDate();
    const existing = await getLocalSession(date);
    await upsertLocalSession({
      date,
      notes: existing?.notes ?? null,
      synced: 0,
      entries: allLines.map((l, i) => ({
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

  async function handleSubmit() {
    const line = text.trim();
    if (!line) return;
    setText('');

    const parsed = await parseQuickEntryLine(line);

    const nextLines = [...linesRef.current, parsed];
    linesRef.current = nextLines;
    setLines(nextLines);

    const task = persistQueueRef.current.then(() => persistLines(nextLines));
    // Swallow errors on the shared queue itself so one failed write doesn't
    // permanently wedge the queue for subsequent submissions; the failure
    // still propagates to this call's own awaiter below.
    persistQueueRef.current = task.catch(() => undefined);
    await task;
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
