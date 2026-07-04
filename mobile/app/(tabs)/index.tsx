import { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, FlatList, StyleSheet } from 'react-native';
import { useAuth } from '@/lib/auth';
import { parseQuickEntryLine, type ParsedLine } from '@/src/parsing/quickEntry';
import { upsertLocalSession, getLocalSession } from '@/src/db/sessionsRepo';
import { ParsedLineRow } from '@/src/components/ParsedLineRow';

type UiLine = ParsedLine & { id: string };

const ERROR_MESSAGE = "Couldn't load data. Pull down or reopen the app to retry.";

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

let idCounter = 0;
function makeEntryId(): string {
  idCounter += 1;
  return `entry-${Date.now()}-${idCounter}`;
}

export default function LogScreen() {
  const { api } = useAuth();
  const [text, setText] = useState('');
  const [lines, setLines] = useState<UiLine[]>([]);
  const [error, setError] = useState<string | null>(null);

  const linesRef = useRef<UiLine[]>([]);
  const persistQueueRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    (async () => {
      try {
        const existing = await getLocalSession(todayDate());
        if (!existing) return;
        const restored: UiLine[] = existing.entries.map((e) => ({
          id: e.id,
          rawText: e.rawText,
          status: e.exerciseId ? 'resolved' : 'pending',
          parsedBy: e.parsedBy,
          exerciseId: e.exerciseId ?? undefined,
          equipment: e.equipment ?? undefined,
          weightKg: e.weightKg ?? undefined,
          reps: e.reps ?? undefined,
          sets: e.sets ?? undefined,
        }));
        linesRef.current = restored;
        setLines(restored);
      } catch {
        setError(ERROR_MESSAGE);
      }
    })();
  }, []);

  async function persistLines(allLines: UiLine[]): Promise<void> {
    const date = todayDate();
    const existing = await getLocalSession(date);
    await upsertLocalSession({
      date,
      notes: existing?.notes ?? null,
      synced: 0,
      entries: allLines.map((l, i) => ({
        id: l.id,
        exerciseId: l.exerciseId ?? null,
        equipment: l.equipment ?? null,
        weightKg: l.weightKg ?? null,
        reps: l.reps ?? null,
        sets: l.sets ?? null,
        rawText: l.rawText,
        parsedBy: l.parsedBy ?? 'DICTIONARY',
        order: i,
        synced: 0,
      })),
    });
  }

  function persist(allLines: UiLine[]): Promise<void> {
    const task = persistQueueRef.current.then(() => persistLines(allLines));
    persistQueueRef.current = task.catch(() => undefined);
    return task;
  }

  function updateEntry(id: string, updates: Partial<ParsedLine>): Promise<void> {
    const updated = linesRef.current.map((l) => (l.id === id ? { ...l, ...updates } : l));
    linesRef.current = updated;
    setLines(updated);
    return persist(updated);
  }

  async function handleSubmit() {
    const line = text.trim();
    if (!line) return;
    setText('');

    const id = makeEntryId();
    const pendingEntry: UiLine = { id, rawText: line, status: 'pending', parsedBy: 'DICTIONARY' };

    const nextLines = [...linesRef.current, pendingEntry];
    linesRef.current = nextLines;
    setLines(nextLines);
    try {
      await persist(nextLines);
      setError(null);
    } catch {
      setError(ERROR_MESSAGE);
      return;
    }

    parseQuickEntryLine(api, line)
      .then((parsed) => {
        setError(null);
        return updateEntry(id, parsed);
      })
      .catch(() => {
        setError(ERROR_MESSAGE);
      });
  }

  async function handleConfirmLine(line: ParsedLine & { id: string }) {
    try {
      const exercise = await api.createExercise({ name: line.exerciseName!, muscles: line.muscles ?? [] });
      await api.createAbbreviation({ token: line.unresolvedToken!, exerciseId: exercise.id });
      await updateEntry(line.id, { status: 'resolved', exerciseId: exercise.id, parsedBy: 'LLM' });
      setError(null);
    } catch {
      setError(ERROR_MESSAGE);
    }
  }

  return (
    <View style={styles.container}>
      {error && <Text style={styles.error}>{error}</Text>}
      <FlatList
        data={lines}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <ParsedLineRow line={item} onConfirm={handleConfirmLine} />}
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
  error: { color: '#a33', marginBottom: 8 },
});
