import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  Keyboard,
  Platform,
  Animated,
  InputAccessoryView,
  StyleSheet,
  type NativeSyntheticEvent,
  type TextInputSelectionChangeEventData,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { Feather } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors, spacing, fonts, fontSize } from '@/lib/theme';
import { formatPriorHistory, type ExerciseHistory } from '@/lib/priorHistory';
import { recommendProgression } from '@/lib/progression';
import { formatDate } from '@/lib/i18n';
import { KeyboardAccessoryBar, type GrammarChip } from './KeyboardAccessoryBar';
import {
  currentWordAt,
  suggestTokens,
  insertAtCaret,
  applyCompletion,
  needsConfirmSpanOnLine,
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

// How far the invisible tap target extends beyond a highlight's rendered
// glyph bounds. React Native's Text doesn't support hitSlop, and nested Text
// hit-testing is imprecise right at a word's edges — see the enlarged
// Pressable rendered alongside each span in NotesEditor below.
const HIT_PADDING = 8;

function renderSegments(
  text: string,
  spans: HighlightSpan[],
  onSpanTap: (span: HighlightSpan) => void,
  onSpanLongPress: (span: HighlightSpan) => void,
  onSpanLayout: (entryId: string, rect: SpanRect) => void,
  historyIds: Set<string>,
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
        onPress={() => onSpanTap(span)}
        onLongPress={() => onSpanLongPress(span)}
        onLayout={(e) => onSpanLayout(span.entryId, e.nativeEvent.layout)}
        pointerEvents="auto"
      >
        {text.slice(span.start, span.end)}
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
  const [spanRects, setSpanRects] = useState<Record<string, SpanRect>>({});
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

  // Tap = place the caret (so a highlighted word can be edited like any
  // other text); long-press = open the group's popover (confirm / details).
  // Confirming is also one tap away via the keyboard bar and the Confirm-all
  // bar, so a plain tap never has to open anything.
  //
  // When the tap comes through the measured hit target we know where on the
  // span the finger landed and map it to a character offset (linear over the
  // span's width — close enough for a proportional font); the inline Text
  // tap has no position, so the caret goes to the span end.
  function handleSpanTap(span: HighlightSpan, locationX?: number) {
    const rect = spanRects[span.entryId];
    let caretPos = span.end;
    if (locationX != null && rect && rect.width > 0) {
      const frac = Math.min(1, Math.max(0, (locationX - HIT_PADDING) / rect.width));
      caretPos = span.start + Math.round(frac * (span.end - span.start));
    }
    caretRef.current = caretPos;
    setCaret(caretPos);
    setForcedSelection({ start: caretPos, end: caretPos });
  }

  function handleSpanLongPress(span: HighlightSpan) {
    caretRef.current = span.end;
    setCaret(span.end);
    setForcedSelection({ start: span.end, end: span.end });
    onSpanPress(span.entryId);
  }

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
  const confirmSpan = needsConfirmSpanOnLine(value, spans, caret);
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
  const historyTop = TOP_PADDING + (caretLineIndex + 1) * LINE_HEIGHT;
  const historyKey = historySpan && activeHistory ? historySpan.entryId : null;

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

  const grammar: GrammarChip[] = [
    { label: '×', insert: 'x', a11yLabel: t('log.accessory.insertTimes') },
    { label: 'kg', insert: 'kg', a11yLabel: t('log.accessory.insertKg') },
    { label: 'bar', insert: 'bar', a11yLabel: t('log.accessory.insertBar') },
    { label: '⁃ line', insert: '\n  ⁃ ', a11yLabel: t('log.accessory.newLine') },
  ];

  const accessory = (
    <KeyboardAccessoryBar
      confirmLabel={confirmLabel}
      onConfirm={confirmSpan ? () => onSpanPress(confirmSpan.entryId) : undefined}
      suggestions={suggestions}
      onComplete={handleComplete}
      grammar={grammar}
      onInsert={handleInsert}
    />
  );

  // Layer order matters. The TextInput is rendered first (underneath) and is
  // the real editing surface, with transparent text so the styled overlay
  // shows through and its caret (selectionColor) peeks through the gaps. The
  // styled overlay is rendered second (on top) inside a `box-none` View, so
  // the overlay itself is never a touch target — only its children can be.
  //
  // Each PLAIN (non-highlighted) segment is explicitly pointerEvents="none":
  // it's a touch-inert leaf (no children, no handler), so this only ever
  // narrows what can capture a tap, never widens it. NOTE: this must not be
  // set on the wrapping <Text> itself or on the highlighted spans — unlike a
  // View, pointerEvents="none" on a Text disables its entire subtree, so
  // applying it above the highlighted spans would silently break tapping
  // them (caught by a regression test after an earlier, incorrect attempt).
  return (
    <View style={styles.container}>
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
        <Text style={styles.text}>
          {renderSegments(value, spans, handleSpanTap, handleSpanLongPress, handleSpanLayout, historyIds)}
        </Text>
        {spans.map((span) => {
          const rect = spanRects[span.entryId];
          if (!rect) return null;
          // An invisible, enlarged tap target measured from the highlight's
          // own rendered position — decoupled from the text flow (absolutely
          // positioned, so it can never shift the pixel-aligned overlay/
          // TextInput sync) and independent of the nested Text's own
          // (imprecise, un-enlargeable) hit area.
          return (
            <Pressable
              key={`hit-${span.entryId}`}
              testID={`span-hit-target-${span.entryId}`}
              onPress={(e) => handleSpanTap(span, e.nativeEvent?.locationX)}
              onLongPress={() => handleSpanLongPress(span)}
              delayLongPress={350}
              accessibilityRole="button"
              accessibilityLabel={value.slice(span.start, span.end)}
              accessibilityHint={
                span.status === 'resolved'
                  ? 'tap to place the cursor, long-press to review this logged exercise'
                  : 'tap to place the cursor, long-press to confirm this exercise'
              }
              accessibilityState={{ selected: span.status === 'resolved' }}
              style={{
                position: 'absolute',
                left: rect.x - HIT_PADDING,
                top: rect.y - HIT_PADDING,
                width: rect.width + HIT_PADDING * 2,
                height: rect.height + HIT_PADDING * 2,
              }}
            />
          );
        })}
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
            <Text style={styles.priorEyebrow}>PROGRESSION</Text>
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
                      accessibilityLabel={`${r.label}, ${r.display}`}
                      style={[styles.recBtn, primary && styles.recBtnPrimary]}
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
      {keyboardVisible ? (
        <View style={styles.toolbar} pointerEvents="box-none">
          <Pressable
            onPress={() => Keyboard.dismiss()}
            accessibilityLabel="Done"
            accessibilityRole="button"
            style={styles.doneButton}
          >
            <BlurView intensity={40} tint="light" style={styles.doneBlur}>
              <Feather name="check" size={26} color={colors.graphite} />
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

// Both layers MUST share fontFamily, fontSize, lineHeight, and padding so the
// styled overlay stays pixel-aligned with the transparent editing layer.
const styles = StyleSheet.create({
  container: { flex: 1 },
  text: {
    fontFamily: fonts.regular,
    fontSize: fontSize.body,
    lineHeight: LINE_HEIGHT,
    padding: TOP_PADDING,
    color: colors.graphite,
  },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  // Transparent text so the styled overlay shows through; the caret is still
  // visible via selectionColor.
  input: { flex: 1, color: 'transparent' },
  // A confirmed exercise sits on a pastel green; an unconfirmed guess stays
  // on bone with a dotted amber underline until the user confirms it.
  resolved: {
    backgroundColor: colors.mossPale,
    textDecorationLine: 'underline',
    textDecorationColor: colors.moss,
    textDecorationStyle: 'solid',
  },
  needsConfirm: {
    backgroundColor: colors.bone,
    textDecorationLine: 'underline',
    textDecorationColor: colors.citrine,
    textDecorationStyle: 'dotted',
  },
  // Overrides the bone highlight with a blue tint for exercises that have
  // prior-session history.
  historyTint: {
    backgroundColor: '#DCE8FA',
  },
  // A small always-present affordance to blur the TextInput/dismiss the
  // keyboard — a full-bleed multiline editor otherwise gives no way to close
  // the keyboard (Enter correctly inserts a newline instead of submitting).
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
  androidAccessory: { position: 'absolute', left: 0, right: 0 },
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
