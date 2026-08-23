// app/(tabs)/index.tsx
import { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, StyleSheet, Keyboard } from 'react-native';
import { Feather } from '@expo/vector-icons';
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
import { TopBar } from '@/components/TopBar';
import { ConfirmBar, type PendingGroup } from '@/src/components/ConfirmBar';
import { upsertCachedAbbreviations } from '@/src/db/abbreviationsRepo';
import type { Abbreviation } from '@/lib/api';
import { EntryPopover } from '@/src/components/EntryPopover';
import type { ExerciseHistory } from '@/lib/priorHistory';
import { colors, radii, spacing, typography } from '@/lib/theme';
import { formatLongDate } from '@/lib/i18n';
import { useTranslation } from 'react-i18next';

const PERSIST_DELAY_MS = 300;
const SCAN_DELAY_MS = 700;

// What went wrong, so the strip can say so honestly (and offer the right
// action): the note couldn't be loaded (Retry), couldn't be saved locally
// (persistent), the server is unreachable (note is safe, lines unread), or a
// confirm was rejected (server message).
type LogError =
  | { kind: 'load' }
  | { kind: 'saveLocal' }
  | { kind: 'network' }
  | { kind: 'confirm'; message: string };

/** Today's date as a LOCAL calendar day (YYYY-MM-DD) — the key the note is stored under. */
function todayDate(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** The full note line containing character offset `at` (trimmed). */
function lineAt(note: string, at: number | null | undefined): string | undefined {
  if (at == null) return undefined;
  const start = note.lastIndexOf('\n', at - 1) + 1;
  const nl = note.indexOf('\n', at);
  return note.slice(start, nl === -1 ? note.length : nl).trim() || undefined;
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
  const [error, setError] = useState<LogError | null>(null);
  // Scan status for the header: a scan in flight, and whether the last one
  // failed to reach the server (cleared by the next successful scan).
  const [scanning, setScanning] = useState(false);
  const [offline, setOffline] = useState(false);
  const offlineRef = useRef(false);
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
    setScanning(true);
    let unreachable = false;
    try {
      const scanned = await scanNote(api, noteText, entriesRef.current, {
        onNetworkError: () => {
          unreachable = true;
        },
      });
      // A newer scan may have started (and possibly already applied its own
      // result) while this one was awaiting the network — if so, this result
      // is stale and must be dropped, not applied on top of the newer state.
      if (generation !== scanGenerationRef.current) return;
      applyEntries(scanned);
      if (unreachable) {
        // Only announce going offline once per episode — the header status
        // keeps saying so until a scan gets through.
        if (!offlineRef.current) setError({ kind: 'network' });
        offlineRef.current = true;
        setOffline(true);
      } else {
        offlineRef.current = false;
        setOffline(false);
        setError((e) => (e?.kind === 'network' ? null : e));
      }
      try {
        await persist(noteText, scanned);
        setError((e) => (e?.kind === 'saveLocal' ? null : e));
      } catch (err) {
        if (generation !== scanGenerationRef.current) return;
        if (__DEV__) console.warn('[log] local save failed', err);
        setError({ kind: 'saveLocal' });
      }
    } catch (err) {
      if (generation !== scanGenerationRef.current) return;
      // scanNote swallows per-line resolver failures, so an exception here is
      // a genuine bug (e.g. a parser edge case on some line). Don't blame the
      // local save for it — keep the note, show the network strip and log.
      if (__DEV__) console.warn('[log] scan failed', err);
      setError({ kind: 'network' });
    } finally {
      if (generation === scanGenerationRef.current) setScanning(false);
    }
  }

  async function loadToday(): Promise<void> {
    try {
      const existing = await getLocalSession(todayDate());
      const noteText = existing?.notes ?? '';
      setText(noteText);
      textRef.current = noteText;
      setError((e) => (e?.kind === 'load' ? null : e));
      if (noteText) await runScan(noteText);
    } catch {
      setError({ kind: 'load' });
    }
  }

  // Load + initial scan on mount.
  useEffect(() => {
    void loadToday();
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
          setError((e) => (e?.kind === 'saveLocal' ? null : e));
          toast.show(t('log.saved'));
        },
        (err) => {
          if (__DEV__) console.warn('[log] local save failed', err);
          setError({ kind: 'saveLocal' });
        },
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
        () => setError((e) => (e?.kind === 'saveLocal' ? null : e)),
        (err) => {
          if (__DEV__) console.warn('[log] local save failed', err);
          setError({ kind: 'saveLocal' });
        },
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

  async function handleConfirm(groupEntries: ScannedEntry[], modifierValue?: string, overrideName?: string) {
    setPopoverGroupId(null);
    await confirmGroup(groupEntries, modifierValue, overrideName);
  }

  /**
   * Confirms one group (same path for the popover and bulk confirm). Returns
   * false on failure. `overrideName` is a name the user edited in the sheet
   * and replaces the guessed name (a modifier answer still prefixes it).
   */
  async function confirmGroup(
    groupEntries: ScannedEntry[],
    modifierValue?: string,
    overrideName?: string,
  ): Promise<boolean> {
    const first = groupEntries[0];
    try {
      // A clarifying-question answer (e.g. "Assisted" for "As") is woven into
      // the exercise's own name, and its token gets its own dictionary entry
      // pointing at the same exercise — alongside the exercise-name token
      // (first.unresolvedToken) already bound below.
      // A clarifying answer either replaces the name ("Did you mean…?" about
      // the exercise itself) or is woven in front of it (a qualifier like
      // "Assisted").
      const isExerciseQuestion = first.clarifyingQuestion?.kind === 'exercise';
      const baseName = overrideName ?? first.exerciseName!;
      const finalName = modifierValue
        ? isExerciseQuestion && !overrideName
          ? modifierValue
          : `${modifierValue} ${baseName}`
        : baseName;
      const exercise = await api.createExercise({ name: finalName, muscles: first.muscles ?? [] });
      // Every token that names the exercise is bound to it ("shoulder" AND
      // "rotation"), otherwise the next scan finds the leftovers unresolved
      // and asks the LLM — and the user — all over again. An equipment-only
      // line ("bb 30kg") has no name token, so nothing gets aliased here.
      const exerciseTokens = [...(first.exerciseTokens ?? (first.unresolvedToken ? [first.unresolvedToken] : []))];
      if (modifierValue && first.clarifyingQuestion && !isExerciseQuestion) exerciseTokens.push(first.clarifyingQuestion.token);
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
      setError((e) => (e?.kind === 'confirm' || e?.kind === 'network' ? null : e));
      return true;
    } catch (err) {
      // A server-side rejection (e.g. validation) is actionable — show its
      // message; anything else here is the server being unreachable.
      setError(err instanceof ApiError ? { kind: 'confirm', message: err.message } : { kind: 'network' });
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
  // Hidden bars come back as a small pill; a different pending set re-expands.
  const confirmBarCollapsed = dismissedPending === pendingSignature;

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
  const popoverLine = popoverEntries.length > 0 ? lineAt(text, popoverEntries[0].spanStart) : undefined;

  const errorMessage = error
    ? error.kind === 'load'
      ? t('log.errors.load')
      : error.kind === 'saveLocal'
        ? t('log.errors.saveLocal')
        : error.kind === 'network'
          ? t('log.errors.network')
          : t('log.errors.confirm', { message: error.message })
    : null;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <TopBar title={t('log.title')} />
      <View style={styles.header}>
        <Text style={styles.dateLabel} accessibilityRole="header">
          {t('log.entryDate', { date: formatLongDate(todayDate()) })}
        </Text>
        {scanning ? (
          <View style={styles.status} accessibilityLiveRegion="polite">
            <ActivityIndicator size="small" color={colors.lead} />
            <Text style={styles.statusText}>{t('log.status.reading')}</Text>
          </View>
        ) : offline ? (
          <View style={styles.status} accessibilityLiveRegion="polite">
            <Feather name="cloud-off" size={14} color={colors.lead} />
            <Text style={styles.statusText}>{t('log.status.offline')}</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.editorWrap}>
        <NotesEditor
          value={text}
          onChangeText={handleChangeText}
          spans={spans}
          onSpanPress={handleSpanPress}
          placeholder={t('log.placeholder')}
          dictionaryTokens={dictionaryTokens}
          priorSessionsByExercise={priorSessions}
        />
        {/* Errors float over the top of the editor (absolute) so showing or
            clearing one never shifts the text the user is typing into. */}
        {error && errorMessage ? (
          <View style={styles.errorStrip} accessibilityRole="alert" accessibilityLiveRegion="assertive">
            <Text style={styles.errorText}>{errorMessage}</Text>
            {error.kind === 'load' ? (
              <Pressable
                onPress={() => void loadToday()}
                style={({ pressed }) => [styles.errorAction, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={t('log.errors.retry')}
              >
                <Text style={styles.errorActionLabel}>{t('log.errors.retry')}</Text>
              </Pressable>
            ) : error.kind === 'saveLocal' ? null : (
              <Pressable
                onPress={() => setError(null)}
                hitSlop={8}
                style={({ pressed }) => [styles.errorDismiss, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={t('log.errors.dismiss')}
              >
                <Feather name="x" size={18} color={colors.paper} />
              </Pressable>
            )}
          </View>
        ) : null}
      </View>
      <EntryPopover
        entries={popoverEntries}
        rawLine={popoverLine}
        onConfirm={handleConfirm}
        onClose={() => setPopoverGroupId(null)}
      />
      <ConfirmBar
        pending={pendingGroups}
        progress={bulkProgress}
        collapsed={confirmBarCollapsed}
        onConfirmAll={() => void handleConfirmAll()}
        onOpenGroup={setPopoverGroupId}
        onDismiss={() => setDismissedPending(pendingSignature)}
        onExpand={() => setDismissedPending(null)}
      />
      <Toast message={toast.message} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.paper },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.s2,
    paddingHorizontal: spacing.s4,
    paddingTop: spacing.s3,
  },
  dateLabel: { ...typography.title, color: colors.graphite, flexShrink: 1 },
  status: { flexDirection: 'row', alignItems: 'center', gap: spacing.s1 },
  statusText: { ...typography.monoCaption, color: colors.lead },
  editorWrap: { flex: 1 },
  errorStrip: {
    position: 'absolute',
    top: spacing.s2,
    left: spacing.s3,
    right: spacing.s3,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s2,
    paddingVertical: spacing.s2,
    paddingLeft: spacing.s3,
    paddingRight: spacing.s2,
    borderRadius: radii.md,
    backgroundColor: colors.brick,
  },
  errorText: { ...typography.bodyS, color: colors.paper, flex: 1 },
  errorAction: {
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: spacing.s3,
    borderRadius: radii.pill,
    backgroundColor: colors.paper,
  },
  errorActionLabel: { ...typography.bodyEmphasis, color: colors.brick },
  errorDismiss: { minWidth: 36, minHeight: 36, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.7 },
});
