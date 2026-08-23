import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  Keyboard,
  Platform,
  Animated,
  InputAccessoryView,
  StyleSheet,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
  type TextInputSelectionChangeEventData,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { Feather } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors, radii, spacing, fonts, fontSize, typography } from '@/lib/theme';
import { formatPriorHistory, type ExerciseHistory } from '@/lib/priorHistory';
import { recommendProgression, type ProgressionTarget } from '@/lib/progression';
import { formatDate } from '@/lib/i18n';
import { KeyboardAccessoryBar, type GrammarChip } from './KeyboardAccessoryBar';
import {
  currentWordAt,
  suggestTokens,
  insertAtCaret,
  applyCompletion,
  spanOnLine,
  spansOnCaretLine,
} from '../parsing/editorTokens';

// Links the TextInput to its docked accessory bar on iOS.
const ACCESSORY_ID = 'workout-editor-accessory';

// Editor line height + top padding, shared by the text styles and the computed
// position of the prior-stats strip. The strip is placed from the line index
// (not a measured rect) because onLayout does not fire reliably on the nested
// inline <Text> spans on iOS, which would otherwise leave the strip unpositioned.
const LINE_HEIGHT = 26;
const TOP_PADDING = spacing.s4;
// Breathing room kept below the caret line when auto-scrolling it into view.
const CARET_SCROLL_MARGIN = LINE_HEIGHT * 2;

// Sample note shown (and insertable) while the editor is empty — one line per
// notation the parser understands: equipment prefix + packed sets, a plain
// "weight reps×sets" line, and a ⁃ continuation line for the same exercise.
export const EXAMPLE_LINES = ['BB RDL 40kgx8 50kgx8x4', 'Bench 60kg 8x3', '  ⁃ 65kg 6x2'] as const;
const EXAMPLE_TEXT = EXAMPLE_LINES.join('\n');

// Blue tint for exercises with prior-session history (also the legend swatch).
const HISTORY_TINT = '#DCE8FA';

export type HighlightSpan = {
  start: number;
  end: number;
  status: 'resolved' | 'needs-confirm';
  entryId: string;
  // The resolved/guessed exercise name, shown on the inline confirm island so
  // it reads "Confirm RDL" rather than echoing the raw shorthand.
  exerciseName?: string;
  // The resolved exercise id, used to look up prior-session stats for the hint.
  exerciseId?: string | null;
};

type SpanRect = { x: number; y: number; width: number; height: number };

function renderSegments(
  text: string,
  spans: HighlightSpan[],
  onSpanLayout: (entryId: string, rect: SpanRect) => void,
  historyIds: Set<string>,
  spanLabel: (text: string, status: HighlightSpan['status']) => string,
): ReactNode[] {
  const ordered = [...spans].sort((a, b) => a.start - b.start);
  const nodes: ReactNode[] = [];
  let cursor = 0;

  ordered.forEach((span, i) => {
    // Skip malformed/overlapping spans defensively so a bad offset never
    // corrupts the rendered text.
    if (span.start < cursor || span.end > text.length || span.start >= span.end) return;
    if (span.start > cursor) {
      nodes.push(
        <Text key={`plain-${i}`} pointerEvents="none">
          {text.slice(cursor, span.start)}
        </Text>,
      );
    }
    const spanText = text.slice(span.start, span.end);
    nodes.push(
      <Text
        key={`${span.entryId}-${span.start}`}
        style={[
          span.status === 'resolved' ? styles.resolved : styles.needsConfirm,
          // A recognized exercise with prior history gets a blue-tinted
          // background the moment it's resolved — the "you've logged this
          // before" cue, independent of where the caret is.
          historyIds.has(span.entryId) ? styles.historyTint : null,
        ]}
        onLayout={(e) => onSpanLayout(span.entryId, e.nativeEvent.layout)}
        pointerEvents="auto"
        accessibilityLabel={spanLabel(spanText, span.status)}
      >
        {spanText}
      </Text>,
    );
    cursor = span.end;
  });

  if (cursor < text.length) {
    nodes.push(
      <Text key="tail" pointerEvents="none">
        {text.slice(cursor)}
      </Text>,
    );
  }
  return nodes;
}

export function NotesEditor({
  value,
  onChangeText,
  spans,
  onSpanPress,
  placeholder,
  dictionaryTokens = [],
  priorSessionsByExercise = {},
}: {
  value: string;
  onChangeText: (t: string) => void;
  spans: HighlightSpan[];
  onSpanPress: (entryId: string) => void;
  placeholder?: string;
  // Known shorthand tokens from the user's dictionary, powering autocomplete.
  dictionaryTokens?: string[];
  // Recent prior sessions keyed by exercise id (newest first) — powers the
  // Progression hint (last-session stats + recommended targets).
  priorSessionsByExercise?: Record<string, ExerciseHistory[]>;
}) {
  const { t } = useTranslation();
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [accessoryHeight, setAccessoryHeight] = useState(0);
  const [spanRects, setSpanRects] = useState<Record<string, SpanRect>>({});
  const [exampleDismissed, setExampleDismissed] = useState(false);
  // The caret offset drives autocomplete + the inline confirm chip. We track it
  // in state (reactive), but only *control* the native selection transiently —
  // right after a programmatic insert (forcedSelection) — so ordinary typing
  // keeps its native cursor behavior and never fights a controlled value.
  const [caret, setCaret] = useState(0);
  const [forcedSelection, setForcedSelection] = useState<
    { start: number; end: number } | undefined
  >(undefined);
  // Refs mirror the latest caret and text so back-to-back accessory taps (e.g.
  // rapid number-row entry) each read the freshest value, not a stale render
  // closure. `caret` state stays for the reactive suggestion/confirm derivation.
  const caretRef = useRef(0);
  const valueRef = useRef(value);
  valueRef.current = value;
  // Drives the prior-stats panel's fade/slide as the caret moves between lines.
  const historyAnim = useRef(new Animated.Value(0)).current;
  // Scroll bookkeeping for keeping the caret line above the keyboard.
  const scrollRef = useRef<ScrollView>(null);
  const scrollOffsetRef = useRef(0);
  const viewportHeightRef = useRef(0);

  // Highlights are touch-inert: the native TextInput underneath handles tap
  // and long-press (iOS magnifier) cursor placement exactly like any text
  // field. Confirm/details for the caret's line live in the keyboard bar
  // (and the Confirm-all bar), so nothing needs to be tapped in the text.
  function handleSpanLayout(entryId: string, rect: SpanRect) {
    setSpanRects((prev) => ({ ...prev, [entryId]: rect }));
  }

  function handleSelectionChange(e: NativeSyntheticEvent<TextInputSelectionChangeEventData>) {
    const start = e.nativeEvent.selection.start;
    caretRef.current = start;
    setCaret(start);
    // Native selection has caught up to (or moved past) any forced value —
    // release control so we don't pin the cursor.
    if (forcedSelection) setForcedSelection(undefined);
  }

  function replaceText(next: string, nextCaret: number) {
    valueRef.current = next;
    caretRef.current = nextCaret;
    onChangeText(next);
    setCaret(nextCaret);
    setForcedSelection({ start: nextCaret, end: nextCaret });
  }

  // Splice a token (digit, x, kg, bar, ⁃ line) at the caret.
  function handleInsert(insert: string) {
    const c = caretRef.current;
    const { text, caret: next } = insertAtCaret(valueRef.current, { start: c, end: c }, insert);
    replaceText(text, next);
  }

  // Replace the caret's current word with a chosen dictionary token.
  function handleComplete(token: string) {
    const word = currentWordAt(valueRef.current, caretRef.current);
    const { text, caret: next } = applyCompletion(valueRef.current, word.start, word.end, token);
    replaceText(text, next);
  }

  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardDidShow', (e) => {
      setKeyboardVisible(true);
      setKeyboardHeight(e?.endCoordinates?.height ?? 0);
    });
    const hideSub = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardVisible(false);
      setKeyboardHeight(0);
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const currentWord = currentWordAt(value, caret).word;
  const suggestions = suggestTokens(dictionaryTokens, currentWord);
  const lineSpan = spanOnLine(value, spans, caret);
  const confirmSpan = lineSpan?.status === 'needs-confirm' ? lineSpan : null;
  const detailsSpan = lineSpan?.status === 'resolved' ? lineSpan : null;
  const confirmLabel = confirmSpan
    ? (confirmSpan.exerciseName ?? value.slice(confirmSpan.start, confirmSpan.end))
    : null;

  const hasHistory = (id: string) => (priorSessionsByExercise[id]?.length ?? 0) > 0;

  // The Progression hint shows only while the caret is on the exercise's own
  // line — so it never covers the line you move to next.
  const historySpan = spansOnCaretLine(value, spans, caret).find(
    (s) => s.exerciseId != null && hasHistory(s.exerciseId),
  );
  const activeSessions =
    historySpan?.exerciseId != null ? (priorSessionsByExercise[historySpan.exerciseId] ?? []) : [];
  const activeHistory = activeSessions[0] ?? null; // newest session, for the "Last · …" line
  const recommendations = recommendProgression(activeSessions);
  // Place the strip just below the CARET's line (not the exercise's), so it
  // follows the cursor and never covers the line you're currently typing on
  // when you move below the exercise. Computed from the line index rather than
  // a measured rect — see LINE_HEIGHT.
  const caretLineIndex = value.slice(0, caret).split('\n').length - 1;
  const caretLineBottom = TOP_PADDING + (caretLineIndex + 1) * LINE_HEIGHT;
  const historyTop = caretLineBottom;
  const historyKey = historySpan && activeHistory ? historySpan.entryId : null;
  // Space reserved under the text so the last lines clear the keyboard and
  // the accessory bar docked above it.
  const bottomInset = keyboardHeight + accessoryHeight;

  // Keep the caret's line in view while typing near the bottom: when it would
  // sit under the keyboard/accessory bar, scroll just enough to reveal it.
  useEffect(() => {
    const viewport = viewportHeightRef.current;
    if (!keyboardVisible || viewport === 0) return;
    const visibleBottom = scrollOffsetRef.current + viewport - bottomInset;
    const target = caretLineBottom + CARET_SCROLL_MARGIN;
    if (target > visibleBottom) {
      scrollRef.current?.scrollTo({ y: target - (viewport - bottomInset), animated: true });
    }
  }, [caretLineBottom, bottomInset, keyboardVisible, value.length]);

  // Insert a recommended set token at the end of its exercise's line, e.g.
  // `rdl` → `rdl 42.5kgx8`. The line is the one the Progression hint is for.
  function handleRecommend(token: string) {
    if (!historySpan) return;
    const nl = valueRef.current.indexOf('\n', historySpan.start);
    const pos = nl === -1 ? valueRef.current.length : nl;
    const prev = valueRef.current[pos - 1];
    const insert = pos > 0 && prev !== ' ' && prev !== '\n' ? ` ${token}` : token;
    const next = valueRef.current.slice(0, pos) + insert + valueRef.current.slice(pos);
    replaceText(next, pos + insert.length);
  }

  // Every span whose exercise has prior history — tinted regardless of caret.
  const historyIds = new Set(
    spans.filter((s) => s.exerciseId != null && hasHistory(s.exerciseId)).map((s) => s.entryId),
  );

  useEffect(() => {
    if (historyKey) {
      historyAnim.setValue(0);
      Animated.timing(historyAnim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyKey, historyTop]);

  const spanLabel = (text: string, status: HighlightSpan['status']) =>
    status === 'resolved'
      ? t('log.editor.spanConfirmed', { text })
      : t('log.editor.spanNeedsConfirm', { text });

  // Spoken form of a progression target: "42.5 kilograms by 8, plus 2.5 kilograms".
  function recA11yLabel(r: ProgressionTarget): string {
    const kgBy = r.display.match(/^([\d.]+)kg×(\d+)$/);
    const reps = r.display.match(/^(\d+) reps$/);
    const target = kgBy
      ? t('log.editor.recKgBy', { kg: kgBy[1], reps: kgBy[2] })
      : reps
        ? t('log.editor.recReps', { count: Number(reps[1]) })
        : r.display;
    const plusKg = r.label.match(/^\+([\d.]+)kg$/);
    const plusReps = r.label.match(/^\+(\d+) reps$/);
    const action =
      r.kind === 'repeat'
        ? t('log.editor.recRepeat')
        : plusKg
          ? t('log.editor.recPlusKg', { kg: plusKg[1] })
          : plusReps
            ? t('log.editor.recPlusReps', { count: Number(plusReps[1]) })
            : r.label;
    return `${target}, ${action}`;
  }

  // Order mirrors how a set is typed: weight unit, times sign, next line for
  // the same exercise, then the rarer bar-load token.
  const grammar: GrammarChip[] = [
    { label: 'kg', insert: 'kg', a11yLabel: t('log.accessory.insertKg') },
    { label: '×', insert: 'x', a11yLabel: t('log.accessory.insertTimes') },
    { label: t('log.accessory.sameExercise'), insert: '\n  ⁃ ', a11yLabel: t('log.accessory.newLine') },
    { label: 'bar', insert: 'bar', a11yLabel: t('log.accessory.insertBar') },
  ];

  const accessory = (
    <View onLayout={(e) => setAccessoryHeight(e.nativeEvent.layout.height)}>
      <KeyboardAccessoryBar
        confirmLabel={confirmLabel}
        onConfirm={confirmSpan ? () => onSpanPress(confirmSpan.entryId) : undefined}
        detailsLabel={detailsSpan ? (detailsSpan.exerciseName ?? value.slice(detailsSpan.start, detailsSpan.end)) : null}
        onDetails={detailsSpan ? () => onSpanPress(detailsSpan.entryId) : undefined}
        suggestions={suggestions}
        onComplete={handleComplete}
        grammar={grammar}
        onInsert={handleInsert}
      />
    </View>
  );

  const showExample = value === '' && !exampleDismissed;

  // Layer order matters. The TextInput is rendered first (underneath) and is
  // the real editing surface, with transparent text so the styled overlay
  // shows through and its caret (selectionColor) peeks through the gaps. The
  // styled overlay sits on top inside a `box-none` View and the overlay Text
  // itself is pointerEvents="none", so every touch — tap, long-press, drag —
  // reaches the TextInput and behaves exactly like a native text field.
  // Both layers live in the same scrolling container so they stay aligned.
  return (
    <View style={styles.container}>
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomInset }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="none"
        onScroll={(e: NativeSyntheticEvent<NativeScrollEvent>) => {
          scrollOffsetRef.current = e.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={32}
        onLayout={(e) => {
          viewportHeightRef.current = e.nativeEvent.layout.height;
        }}
      >
        <View style={[styles.editorArea, !showExample && styles.editorAreaGrow]}>
          <TextInput
            style={[styles.text, styles.input]}
            value={value}
            onChangeText={onChangeText}
            onSelectionChange={handleSelectionChange}
            selection={forcedSelection}
            placeholder={placeholder}
            placeholderTextColor={colors.lead}
            selectionColor={colors.graphite}
            multiline
            textAlignVertical="top"
            scrollEnabled={false}
            // Shorthand fidelity: the parser reads tokens exactly, so the keyboard
            // must not silently rewrite them. Autocorrect/spellcheck/smart
            // punctuation/autofill/auto-capitalization would each corrupt tokens
            // like `RDL`, `BB`, `barx12`, or `40kgx8` against transparent text the
            // user can't see being changed. Suggestions come from our own accessory
            // bar instead.
            autoCorrect={false}
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="none"
            keyboardType="default"
            importantForAutofill="no"
            textContentType="none"
            smartInsertDelete={false}
            inputAccessoryViewID={Platform.OS === 'ios' ? ACCESSORY_ID : undefined}
          />
          <View style={styles.overlay} pointerEvents="box-none">
            <Text style={styles.text} pointerEvents="none">
              {renderSegments(value, spans, handleSpanLayout, historyIds, spanLabel)}
            </Text>
            {/* Progression: a blue-tinted strip that fades/slides in below the
                exercise, showing last session + tap-to-fill recommended targets.
                box-none so the buttons receive taps but the panel body doesn't. */}
            {activeHistory ? (
              <Animated.View
                pointerEvents="box-none"
                style={[
                  styles.priorPanel,
                  {
                    top: historyTop,
                    opacity: historyAnim,
                    transform: [
                      {
                        translateY: historyAnim.interpolate({
                          inputRange: [0, 1],
                          outputRange: [-6, 0],
                        }),
                      },
                    ],
                  },
                ]}
              >
                <Text style={styles.priorEyebrow}>{t('log.editor.progression')}</Text>
                <Text style={styles.priorText} numberOfLines={1}>
                  {formatPriorHistory(activeHistory, formatDate)}
                </Text>
                {recommendations.length > 0 ? (
                  <View style={styles.recRow}>
                    {recommendations.map((r, i) => {
                      const primary = i === 0;
                      return (
                        <Pressable
                          key={r.kind}
                          onPress={() => handleRecommend(r.token)}
                          accessibilityRole="button"
                          accessibilityLabel={recA11yLabel(r)}
                          accessibilityHint={t('log.editor.recHint')}
                          style={({ pressed }) => [
                            styles.recBtn,
                            primary && styles.recBtnPrimary,
                            pressed && styles.pressed,
                          ]}
                        >
                          <Text style={[styles.recBtnValue, primary && styles.recBtnValuePrimary]}>
                            {r.display}
                          </Text>
                          <Text style={[styles.recBtnLabel, primary && styles.recBtnLabelPrimary]}>
                            {r.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                ) : null}
              </Animated.View>
            ) : null}
          </View>
        </View>
        {showExample ? (
          <ExampleBlock onUse={() => replaceText(EXAMPLE_TEXT, EXAMPLE_TEXT.length)} onDismiss={() => setExampleDismissed(true)} />
        ) : null}
      </ScrollView>
      {keyboardVisible ? (
        <View style={styles.toolbar} pointerEvents="box-none">
          <Pressable
            onPress={() => Keyboard.dismiss()}
            accessibilityLabel={t('common.done')}
            accessibilityHint={t('log.editor.doneHint')}
            accessibilityRole="button"
            style={({ pressed }) => [styles.doneButton, pressed && styles.pressed]}
          >
            <BlurView intensity={40} tint="light" style={styles.doneBlur}>
              <Feather name="chevrons-down" size={26} color={colors.graphite} />
            </BlurView>
          </Pressable>
        </View>
      ) : null}
      {/* iOS docks the bar to the keyboard via InputAccessoryView; Android has
          no equivalent, so we float it just above the reported keyboard height
          while the keyboard is up. */}
      {Platform.OS === 'ios' ? (
        <InputAccessoryView nativeID={ACCESSORY_ID}>{accessory}</InputAccessoryView>
      ) : keyboardVisible ? (
        <View style={[styles.androidAccessory, { bottom: keyboardHeight }]} pointerEvents="box-none">
          {accessory}
        </View>
      ) : null}
    </View>
  );
}

// Onboarding for an empty note: what to type, what the highlight colours
// mean, and a one-tap way to try it with the sample.
function ExampleBlock({ onUse, onDismiss }: { onUse: () => void; onDismiss: () => void }) {
  const { t } = useTranslation();
  return (
    <View style={styles.example}>
      <View style={styles.exampleHeader}>
        <View style={styles.exampleLines}>
          {EXAMPLE_LINES.map((line) => (
            <Text key={line} style={styles.exampleLine}>
              {line}
            </Text>
          ))}
        </View>
        <Pressable
          onPress={onDismiss}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('log.editor.dismissExample')}
          style={({ pressed }) => [styles.exampleDismiss, pressed && styles.pressed]}
        >
          <Feather name="x" size={20} color={colors.lead} />
        </Pressable>
      </View>
      <Text style={styles.exampleCaption}>{t('log.editor.exampleCaption')}</Text>
      <Pressable
        onPress={onUse}
        accessibilityRole="button"
        accessibilityLabel={t('log.editor.useExample')}
        style={({ pressed }) => [styles.exampleButton, pressed && styles.pressed]}
      >
        <Text style={styles.exampleButtonLabel}>{t('log.editor.useExample')}</Text>
      </Pressable>
      <View style={styles.legend}>
        <LegendRow swatch={styles.needsConfirm} label={t('log.editor.legendNeedsConfirm')} />
        <LegendRow swatch={styles.resolved} label={t('log.editor.legendConfirmed')} />
        <LegendRow swatch={[styles.resolved, styles.historyTint]} label={t('log.editor.legendHistory')} />
      </View>
    </View>
  );
}

function LegendRow({ swatch, label }: { swatch: object; label: string }) {
  return (
    <View style={styles.legendRow}>
      <View style={[styles.legendSwatch, swatch]} />
      <Text style={styles.legendLabel}>{label}</Text>
    </View>
  );
}

// Both layers MUST share fontFamily, fontSize, lineHeight, and padding so the
// styled overlay stays pixel-aligned with the transparent editing layer.
const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  editorArea: { position: 'relative' },
  editorAreaGrow: { flexGrow: 1 },
  text: {
    fontFamily: fonts.regular,
    fontSize: fontSize.body,
    lineHeight: LINE_HEIGHT,
    padding: TOP_PADDING,
    color: colors.graphite,
  },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  // Transparent text so the styled overlay shows through; the caret is still
  // visible via selectionColor. Grows with the editor area so a tap anywhere
  // in the empty space below the text still focuses the input.
  input: { flexGrow: 1, minHeight: TOP_PADDING * 2 + LINE_HEIGHT * 3, color: 'transparent' },
  // A confirmed exercise sits on a pastel green; an unconfirmed guess sits on
  // a citrine tint with a dotted amber underline until the user confirms it.
  resolved: {
    backgroundColor: colors.mossPale,
    textDecorationLine: 'underline',
    textDecorationColor: colors.moss,
    textDecorationStyle: 'solid',
  },
  needsConfirm: {
    backgroundColor: colors.citrinePale,
    textDecorationLine: 'underline',
    textDecorationColor: colors.citrine,
    textDecorationStyle: 'dotted',
  },
  // Overrides the highlight with a blue tint for exercises that have
  // prior-session history.
  historyTint: {
    backgroundColor: HISTORY_TINT,
  },
  // A small always-present affordance to blur the TextInput/dismiss the
  // keyboard — a full-bleed multiline editor otherwise gives no way to close
  // the keyboard (Enter correctly inserts a newline instead of submitting).
  // It's a "hide keyboard" chevron, not a ✓: ✓ is reserved for confirming.
  toolbar: {
    position: 'absolute',
    top: spacing.s2,
    right: spacing.s2,
  },
  doneButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(45, 31, 26, 0.15)',
    shadowColor: colors.graphite,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 3,
  },
  doneBlur: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.7 },
  androidAccessory: { position: 'absolute', left: 0, right: 0 },
  // Empty-state example + legend.
  example: {
    marginHorizontal: spacing.s4,
    marginTop: spacing.s2,
    padding: spacing.s3,
    gap: spacing.s3,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.lead,
    backgroundColor: colors.bone,
  },
  exampleHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.s2 },
  exampleLines: { flex: 1 },
  exampleLine: {
    fontFamily: fonts.regular,
    fontSize: fontSize.body,
    lineHeight: LINE_HEIGHT,
    color: colors.graphite,
  },
  exampleDismiss: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', margin: -spacing.s2 },
  exampleCaption: { ...typography.bodyS, color: colors.lead },
  exampleButton: {
    alignSelf: 'flex-start',
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.s4,
    borderRadius: radii.pill,
    backgroundColor: colors.graphite,
  },
  exampleButtonLabel: { ...typography.bodyEmphasis, color: colors.paper },
  legend: { gap: spacing.s1 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.s2 },
  legendSwatch: { width: 18, height: 14, borderRadius: radii.sm },
  legendLabel: { ...typography.monoCaption, color: colors.graphite },
  // Blue-tinted prior-stats strip, opaque so it reads cleanly over the line
  // beneath it (like an autocomplete dropdown).
  priorPanel: {
    position: 'absolute',
    left: spacing.s4,
    right: spacing.s4,
    marginTop: 2,
    paddingVertical: spacing.s2,
    paddingHorizontal: spacing.s3,
    borderRadius: 10,
    backgroundColor: '#EAF1FB',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(58, 90, 140, 0.3)',
    gap: spacing.s1,
    shadowColor: '#1C3A66',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 2,
  },
  priorEyebrow: {
    fontFamily: fonts.monoMedium,
    fontSize: 10,
    letterSpacing: 1,
    color: '#5B7BA8',
  },
  priorText: {
    fontFamily: fonts.mono,
    fontSize: fontSize.caption,
    color: '#3A5A8C',
  },
  recRow: {
    flexDirection: 'row',
    gap: spacing.s2,
    marginTop: spacing.s1,
  },
  recBtn: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.s3,
    paddingVertical: spacing.s1,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(58, 90, 140, 0.35)',
  },
  recBtnPrimary: {
    backgroundColor: '#3A5A8C',
    borderColor: '#3A5A8C',
  },
  recBtnValue: {
    fontFamily: fonts.monoMedium,
    fontSize: fontSize.caption,
    color: '#26436E',
  },
  recBtnValuePrimary: {
    color: '#FFFFFF',
  },
  recBtnLabel: {
    fontFamily: fonts.mono,
    fontSize: 10,
    color: '#5B7BA8',
  },
  recBtnLabelPrimary: {
    color: '#CFE0F5',
  },
});
