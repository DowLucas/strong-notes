// app/(tabs)/index.tsx
import { useEffect, useRef, useState } from 'react';
import { View, Text, Modal, Pressable, StyleSheet, Keyboard } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError } from '@/lib/api';
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
import { Toast, useToast } from '@/components/Toast';
import { ConfirmBar, type PendingGroup } from '@/src/components/ConfirmBar';
import { upsertCachedAbbreviations } from '@/src/db/abbreviationsRepo';
import type { Abbreviation } from '@/lib/api';
import { EntryPopover } from '@/src/components/EntryPopover';
import type { ExerciseHistory } from '@/lib/priorHistory';
import { colors, spacing, typography } from '@/lib/theme';
import { formatLongDate } from '@/lib/i18n';
import { useTranslation } from 'react-i18next';

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
  const { t } = useTranslation();
  const { api } = useAuth();
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const [entries, setEntries] = useState<ScannedEntry[]>([]);
  const [popoverGroupId, setPopoverGroupId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dictionaryTokens, setDictionaryTokens] = useState<string[]>([]);
  const [priorSessions, setPriorSessions] = useState<Record<string, ExerciseHistory[]>>({});

  const toast = useToast();
  // Bulk confirm: progress while running, and the pending-set signature the
  // user dismissed (the bar comes back when a different set is pending).
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  const [dismissedPending, setDismissedPending] = useState<string | null>(null);
  // Edits made since the user last left writing mode (keyboard dismissed);
  // only then is there something to confirm as saved.
  const dirtyRef = useRef(false);
  const textRef = useRef('');

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
        textRef.current = noteText;
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

  // Leaving writing mode (keyboard dismissed): persist right away instead of
  // waiting out the debounce, then confirm with a transient "Saved" toast —
  // the mobile-friendly cue that the note is safe to walk away from.
  useEffect(() => {
    const sub = Keyboard.addListener('keyboardDidHide', () => {
      if (!dirtyRef.current) return;
      if (persistTimer.current) clearTimeout(persistTimer.current);
      persist(textRef.current, entriesRef.current).then(
        () => {
          dirtyRef.current = false;
          setError(null);
          toast.show(t('log.saved'));
        },
        () => setError(ERROR_MESSAGE),
      );
    });
    return () => sub.remove();
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
    textRef.current = next;
    dirtyRef.current = true;

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
    await confirmGroup(groupEntries, modifierValue);
  }

  /** Confirms one group (same path for the popover and bulk confirm). Returns false on failure. */
  async function confirmGroup(groupEntries: ScannedEntry[], modifierValue?: string): Promise<boolean> {
    const first = groupEntries[0];
    try {
      // A clarifying-question answer (e.g. "Assisted" for "As") is woven into
      // the exercise's own name, and its token gets its own dictionary entry
      // pointing at the same exercise — alongside the exercise-name token
      // (first.unresolvedToken) already bound below.
      const finalName = modifierValue ? `${modifierValue} ${first.exerciseName}` : first.exerciseName!;
      const exercise = await api.createExercise({ name: finalName, muscles: first.muscles ?? [] });
      // Every token that names the exercise is bound to it ("shoulder" AND
      // "rotation"), otherwise the next scan finds the leftovers unresolved
      // and asks the LLM — and the user — all over again. An equipment-only
      // line ("bb 30kg") has no name token, so nothing gets aliased here.
      const exerciseTokens = [...(first.exerciseTokens ?? (first.unresolvedToken ? [first.unresolvedToken] : []))];
      if (modifierValue && first.clarifyingQuestion) exerciseTokens.push(first.clarifyingQuestion.token);
      const created: Abbreviation[] = [];
      for (const token of exerciseTokens) {
        created.push(await api.createAbbreviation({ token, exerciseId: exercise.id }));
      }
      // Equipment shorthand ("bb" → Barbell) is taught as a reusable
      // equipment modifier, not tied to this exercise — so "bb bench" later
      // resolves its equipment from the dictionary.
      if (first.equipmentToken && first.equipment) {
        created.push(
          await api.createAbbreviation({
            token: first.equipmentToken,
            modifierType: 'equipment',
            modifierValue: first.equipment,
          }),
        );
      }
      // Teach the local dictionary immediately so a reload/re-scan resolves
      // this line offline instead of bouncing back to "needs confirm".
      await upsertCachedAbbreviations(created.filter((a) => a?.token));
      const groupIds = new Set(groupEntries.map((e) => e.id));
      const updated = entriesRef.current.map((e) =>
        groupIds.has(e.id) ? { ...e, status: 'resolved' as const, exerciseId: exercise.id } : e,
      );
      applyEntries(updated);
      await persist(textRef.current, updated);
      setError(null);
      return true;
    } catch (err) {
      // A server-side rejection (e.g. validation) is actionable — show its
      // message rather than the generic "couldn't load" banner.
      setError(err instanceof ApiError ? `Couldn't save exercise: ${err.message}` : ERROR_MESSAGE);
      return false;
    }
  }

  // Unconfirmed groups, one entry per group (for the bottom confirm bar).
  const pendingGroups: PendingGroup[] = [];
  {
    const seen = new Set<string>();
    for (const e of entries) {
      if (e.status !== 'needs-confirm' || seen.has(e.groupId)) continue;
      seen.add(e.groupId);
      pendingGroups.push({ groupId: e.groupId, label: e.exerciseName || e.rawText, needsAnswer: !!e.clarifyingQuestion });
    }
  }
  const pendingSignature = pendingGroups.map((g) => g.groupId).sort().join('|');
  const showConfirmBar = pendingGroups.length > 0 && dismissedPending !== pendingSignature && popoverGroupId == null;

  async function handleConfirmAll() {
    const targets = pendingGroups.filter((g) => !g.needsAnswer);
    setBulkProgress({ done: 0, total: targets.length });
    let confirmed = 0;
    for (const target of targets) {
      const groupEntries = entriesRef.current.filter((e) => e.groupId === target.groupId);
      if (groupEntries.length === 0) continue;
      const ok = await confirmGroup(groupEntries);
      if (!ok) break; // error banner already shown; leave the rest pending
      confirmed += 1;
      setBulkProgress({ done: confirmed, total: targets.length });
    }
    setBulkProgress(null);
    if (confirmed > 0) toast.show(t('log.confirmBar.confirmed', { count: confirmed }));
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
      <Text style={styles.dateLabel} accessibilityRole="header">
        {t('log.entryDate', { date: formatLongDate(todayDate()) })}
      </Text>
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
      {showConfirmBar ? (
        <ConfirmBar
          pending={pendingGroups}
          progress={bulkProgress}
          onConfirmAll={() => void handleConfirmAll()}
          onDismiss={() => setDismissedPending(pendingSignature)}
        />
      ) : null}
      <Toast message={toast.message} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.paper },
  dateLabel: { ...typography.monoLabel, color: colors.lead, paddingHorizontal: spacing.s4, paddingTop: spacing.s3, textTransform: 'uppercase' },
  error: { color: colors.brick, paddingHorizontal: spacing.s4, paddingTop: spacing.s2 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.2)', justifyContent: 'center', padding: spacing.s5 },
  popoverWrap: { alignSelf: 'stretch' },
});
