import { useRef, useState } from 'react';
import { View, Text, TextInput, FlatList, StyleSheet } from 'react-native';
import { parseQuickEntryLine, type ParsedLine } from '../../src/parsing/quickEntry';
import { upsertLocalSession, getLocalSession } from '../../src/db/sessionsRepo';
import { ParsedLineRow } from '../../src/components/ParsedLineRow';

// The UI/persistence list carries a stable id per entry, generated the
// moment it's submitted - independent of whatever parseQuickEntryLine later
// resolves it to. That id is how the background parse (below) finds its way
// back to the right entry to update, and how SQLite rows stay stable across
// re-persists instead of being re-derived from array position.
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
  const [text, setText] = useState('');
  const [lines, setLines] = useState<UiLine[]>([]);
  const [error, setError] = useState<string | null>(null);

  // `lines` (React state) is only current as of the last render, so a
  // handleSubmit call that's been suspended on the `await parseQuickEntryLine`
  // network round-trip can end up closing over a stale value if another
  // submission commits state in the meantime. `linesRef` is a plain mutable
  // ref we update synchronously ourselves, so it always reflects the latest
  // known list regardless of render timing - each submission appends onto
  // whatever the ref holds "right now", never onto a stale snapshot.
  const linesRef = useRef<UiLine[]>([]);

  // SQLite writes read-then-write (fetch existing entries to preserve their
  // ids, then upsert the full list). If two submissions' writes overlapped,
  // the second could read state from before the first write committed and
  // clobber it. Chaining every persist call onto this queue serializes them
  // so writes always happen one at a time, in the order their submissions
  // resolved.
  const persistQueueRef = useRef<Promise<void>>(Promise.resolve());

  async function persistLines(allLines: UiLine[]): Promise<void> {
    const date = todayDate();
    const existing = await getLocalSession(date);
    await upsertLocalSession({
      date,
      notes: existing?.notes ?? null,
      synced: 0,
      entries: allLines.map((l, i) => ({
        id: l.id,
        exerciseId: null,
        equipment: l.equipment ?? null,
        weightKg: l.weightKg ?? null,
        reps: l.reps ?? null,
        sets: l.sets ?? null,
        rawText: l.rawText,
        // Storage still requires a concrete parsedBy; a still-'pending' line
        // hasn't been classified yet, so this is just a placeholder until
        // the background parse (or a later resolution) overwrites it.
        parsedBy: l.parsedBy ?? 'DICTIONARY',
        order: i,
        synced: 0,
      })),
    });
  }

  function persist(allLines: UiLine[]): Promise<void> {
    const task = persistQueueRef.current.then(() => persistLines(allLines));
    // Swallow errors on the shared queue itself so one failed write doesn't
    // permanently wedge the queue for subsequent submissions; the failure
    // still propagates to this call's own awaiter below.
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

    // Offline-first: the raw line is written to local SQLite (and shown in
    // the UI) immediately, before parseQuickEntryLine is even called. That
    // call may hit the network (see quickEntry.ts's local-dictionary-first
    // resolution) and can fail if the device is offline or the backend is
    // down - by the time that happens the entry is already durable, so a
    // rejection can never lose the line the user just typed.
    const id = makeEntryId();
    const pendingEntry: UiLine = { id, rawText: line, status: 'pending' };

    const nextLines = [...linesRef.current, pendingEntry];
    linesRef.current = nextLines;
    setLines(nextLines);
    try {
      await persist(nextLines);
      setError(null);
    } catch {
      // The write that's supposed to make this entry durable failed (disk
      // full, DB locked, etc.) - surface the same retry hint used elsewhere
      // rather than letting the rejection go unhandled.
      setError(ERROR_MESSAGE);
      return;
    }

    // Classification runs in the background - handleSubmit does not await
    // it, so submitting never blocks on the network.
    parseQuickEntryLine(line)
      .then((parsed) => {
        setError(null);
        return updateEntry(id, parsed);
      })
      .catch(() => {
        // The raw entry is already saved and visible; leave it in its
        // 'pending' (unparsed) state rather than dropping it, and surface a
        // retry hint.
        setError(ERROR_MESSAGE);
      });
  }

  return (
    <View style={styles.container}>
      {error && <Text style={styles.error}>{error}</Text>}
      <FlatList
        data={lines}
        keyExtractor={(item) => item.id}
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
  error: { color: '#a33', marginBottom: 8 },
});
