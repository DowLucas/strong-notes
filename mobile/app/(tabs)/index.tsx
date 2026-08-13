// app/(tabs)/index.tsx
import { useEffect, useRef, useState } from 'react';
import { View, Text, Modal, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/lib/auth';
import { scanNote, type ScannedEntry } from '@/src/parsing/scanNote';
import {
  getLocalSession,
  upsertLocalSession,
  getRecentSessionsForExercise,
  type LocalSetEntry,
} from '@/src/db/sessionsRepo';
import { getCachedAbbreviations } from '@/src/db/abbreviationsRepo';
import { NotesEditor, type HighlightSpan } from '@/src/components/NotesEditor';
import { EntryPopover } from '@/src/components/EntryPopover';
import type { ExerciseHistory } from '@/lib/priorHistory';
import { colors, spacing } from '@/lib/theme';

const ERROR_MESSAGE = "Couldn't load data. Pull down or reopen the app to retry.";
const PERSIST_DELAY_MS = 300;
const SCAN_DELAY_MS = 700;

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function toLocalSetEntry(e: ScannedEntry): LocalSetEntry {
  return {
    id: e.id,
    exerciseId: e.exerciseId,
    equipment: e.equipment,
    weightKg: e.weightKg,
    reps: e.reps,
    sets: e.sets,
    rawText: e.rawText,
    parsedBy: e.parsedBy,
    order: e.order,
    synced: 0,
    spanStart: e.spanStart,
    spanEnd: e.spanEnd,
  };
}

export default function LogScreen() {
  const { api } = useAuth();
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const [entries, setEntries] = useState<ScannedEntry[]>([]);
  const [popoverGroupId, setPopoverGroupId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dictionaryTokens, setDictionaryTokens] = useState<string[]>([]);
  const [priorSessions, setPriorSessions] = useState<Record<string, ExerciseHistory[]>>({});

  const entriesRef = useRef<ScannedEntry[]>([]);
  const persistQueueRef = useRef<Promise<void>>(Promise.resolve());
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scanTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Monotonic counter guarding against out-of-order scan completion: if a
  // slower, earlier-started scan resolves after a faster, later one, its
  // (stale) result must be discarded rather than overwriting the newer state.
  const scanGenerationRef = useRef(0);

  function applyEntries(next: ScannedEntry[]) {
    entriesRef.current = next;
    setEntries(next);
  }

  function persist(noteText: string, list: ScannedEntry[]): Promise<void> {
    const task = persistQueueRef.current.then(() =>
      upsertLocalSession({
        date: todayDate(),
        notes: noteText,
        synced: 0,
        // A multi-group line's name-only highlight isn't a real logged set
        // (no weight/reps/sets) and must never be synced as one.
        entries: list.filter((e) => !e.isNameOnly).map(toLocalSetEntry),
      }),
    );
    persistQueueRef.current = task.catch(() => undefined);
    return task;
  }

  async function runScan(noteText: string): Promise<void> {
    const generation = ++scanGenerationRef.current;
    try {
      const scanned = await scanNote(api, noteText, entriesRef.current);
      // A newer scan may have started (and possibly already applied its own
      // result) while this one was awaiting the network — if so, this result
      // is stale and must be dropped, not applied on top of the newer state.
      if (generation !== scanGenerationRef.current) return;
      applyEntries(scanned);
      await persist(noteText, scanned);
      setError(null);
    } catch {
      if (generation !== scanGenerationRef.current) return;
      // Text is already persisted by the fast timer; a failed scan just leaves
      // the current highlights in place and will retry on the next edit.
      setError(ERROR_MESSAGE);
    }
  }

  // Load + initial scan on mount.
  useEffect(() => {
    (async () => {
      try {
        const existing = await getLocalSession(todayDate());
        const noteText = existing?.notes ?? '';
        setText(noteText);
        if (noteText) await runScan(noteText);
      } catch {
        setError(ERROR_MESSAGE);
      }
    })();
    return () => {
      if (persistTimer.current) clearTimeout(persistTimer.current);
      if (scanTimer.current) clearTimeout(scanTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load the cached shorthand dictionary once for accessory-bar autocomplete.
  // A failure here is non-fatal — the editor just has no completions.
  useEffect(() => {
    getCachedAbbreviations()
      .then((abbrs) => setDictionaryTokens(abbrs.map((a) => a.token)))
      .catch(() => setDictionaryTokens([]));
  }, []);

  // Look up prior-session stats for every resolved exercise in the note, so the
  // editor can hint "you did this before" on the caret's line. Local and fast.
  useEffect(() => {
    const ids = Array.from(
      new Set(entries.filter((e) => e.exerciseId).map((e) => e.exerciseId as string)),
    );
    if (ids.length === 0) {
      setPriorSessions({});
      return;
    }
    let cancelled = false;
    (async () => {
      const today = todayDate();
      const pairs = await Promise.all(
        ids.map(async (id) => [id, await getRecentSessionsForExercise(id, today, 3)] as const),
      );
      if (cancelled) return;
      const map: Record<string, ExerciseHistory[]> = {};
      for (const [id, sessions] of pairs) if (sessions.length > 0) map[id] = sessions;
      setPriorSessions(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [entries]);

  function handleChangeText(next: string) {
    setText(next);

    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      // Fast path: never lose the raw note text, even if scanning lags/fails.
      persist(next, entriesRef.current).then(
        () => setError(null),
        () => setError(ERROR_MESSAGE),
      );
    }, PERSIST_DELAY_MS);

    if (scanTimer.current) clearTimeout(scanTimer.current);
    scanTimer.current = setTimeout(() => {
      void runScan(next);
    }, SCAN_DELAY_MS);
  }

  // A tapped span's entryId maps to its group — every set-group resolved
  // from the same exercise name (on one line, plus any ⁃ continuations)
  // shares one popover rather than opening one per highlighted number.
  function handleSpanPress(entryId: string) {
    const target = entriesRef.current.find((e) => e.id === entryId);
    if (target) setPopoverGroupId(target.groupId);
  }

  async function handleConfirm(groupEntries: ScannedEntry[], modifierValue?: string) {
    setPopoverGroupId(null);
    const first = groupEntries[0];
    try {
      // A clarifying-question answer (e.g. "Assisted" for "As") is woven into
      // the exercise's own name, and its token gets its own dictionary entry
      // pointing at the same exercise — alongside the exercise-name token
      // (first.unresolvedToken) already bound below.
      const finalName = modifierValue ? `${modifierValue} ${first.exerciseName}` : first.exerciseName!;
      const exercise = await api.createExercise({ name: finalName, muscles: first.muscles ?? [] });
      await api.createAbbreviation({ token: first.unresolvedToken!, exerciseId: exercise.id });
      if (modifierValue && first.clarifyingQuestion) {
        await api.createAbbreviation({ token: first.clarifyingQuestion.token, exerciseId: exercise.id });
      }
      const groupIds = new Set(groupEntries.map((e) => e.id));
      const updated = entriesRef.current.map((e) =>
        groupIds.has(e.id) ? { ...e, status: 'resolved' as const, exerciseId: exercise.id } : e,
      );
      applyEntries(updated);
      await persist(text, updated);
      setError(null);
    } catch {
      setError(ERROR_MESSAGE);
    }
  }

  const spans: HighlightSpan[] = entries
    .filter((e) => e.spanStart != null && e.spanEnd != null)
    .map((e) => ({
      start: e.spanStart as number,
      end: e.spanEnd as number,
      status: e.status,
      entryId: e.id,
      exerciseName: e.exerciseName,
      exerciseId: e.exerciseId,
    }));

  const popoverEntries = entries.filter((e) => e.groupId === popoverGroupId);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {error ? (
        <Text style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
      <NotesEditor
        value={text}
        onChangeText={handleChangeText}
        spans={spans}
        onSpanPress={handleSpanPress}
        placeholder="Start typing your workout…"
        dictionaryTokens={dictionaryTokens}
        priorSessionsByExercise={priorSessions}
      />
      <Modal
        visible={popoverEntries.length > 0}
        transparent
        animationType="fade"
        onRequestClose={() => setPopoverGroupId(null)}
      >
        <Pressable style={styles.backdrop} onPress={() => setPopoverGroupId(null)}>
          <View style={styles.popoverWrap}>
            {popoverEntries.length > 0 ? (
              <EntryPopover
                entries={popoverEntries}
                onConfirm={handleConfirm}
                onClose={() => setPopoverGroupId(null)}
              />
            ) : null}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.paper },
  error: { color: colors.brick, paddingHorizontal: spacing.s4, paddingTop: spacing.s2 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.2)', justifyContent: 'center', padding: spacing.s5 },
  popoverWrap: { alignSelf: 'stretch' },
});
