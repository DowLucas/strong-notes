// src/components/EntryPopover.tsx
import { useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  Modal,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { colors, radii, spacing, typography } from '@/lib/theme';
import type { ScannedEntry } from '../parsing/scanNote';

type ConfirmHandler = (entries: ScannedEntry[], modifierValue?: string, overrideName?: string) => void;

/**
 * Bottom sheet for one highlighted group. For an unconfirmed guess it shows
 * what the user wrote, what we read it as (editable), any clarifying
 * question, and a single "Save as ‹name›" action. For a confirmed group it
 * lists the sets and links to the exercise's progress.
 *
 * Owns its Modal so the slide-up/scrim behaviour lives in one place; the
 * parent just renders it with the group's entries (empty = hidden).
 */
export function EntryPopover({
  entries,
  rawLine,
  onConfirm,
  onClose,
}: {
  entries: ScannedEntry[];
  /** The note line the group was read from, shown as "You wrote: …". */
  rawLine?: string;
  onConfirm: ConfirmHandler;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  // Keep the last non-empty group mounted so the sheet can slide out after
  // the parent clears it, instead of vanishing mid-animation.
  const lastEntries = useRef(entries);
  if (entries.length > 0) lastEntries.current = entries;
  const shown = lastEntries.current;
  if (shown.length === 0) return null;

  return (
    <Modal visible={entries.length > 0} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable
          style={styles.scrim}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t('log.popover.dismiss')}
        />
        <SheetContent
          key={shown[0].groupId}
          entries={shown}
          rawLine={rawLine}
          onConfirm={onConfirm}
          onClose={onClose}
        />
      </KeyboardAvoidingView>
    </Modal>
  );
}

function SheetContent({
  entries,
  rawLine,
  onConfirm,
  onClose,
}: {
  entries: ScannedEntry[];
  rawLine?: string;
  onConfirm: ConfirmHandler;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const first = entries[0];
  const guess = first.exerciseName || first.rawText;
  const [name, setName] = useState(guess);
  const [customAnswer, setCustomAnswer] = useState('');
  const needsConfirm = first.status === 'needs-confirm';
  const clarifyingQuestion = first.clarifyingQuestion;
  const canViewProgress = first.status === 'resolved' && !!first.exerciseId;
  const trimmedName = name.trim();
  // Only an actual edit travels as overrideName; the unchanged guess goes
  // through the normal (clarifying-answer aware) naming path.
  const overrideName = trimmedName && trimmedName !== guess ? trimmedName : undefined;
  const saveLabel = trimmedName ? t('log.popover.saveAs', { name: trimmedName }) : t('log.popover.save');

  function viewProgress() {
    onClose();
    router.push({ pathname: '/exercise/[id]', params: { id: first.exerciseId! } });
  }

  function setRow(entry: ScannedEntry): string | null {
    const volume =
      entry.reps != null && entry.sets != null
        ? `${t('log.popover.reps', { count: entry.reps })} × ${t('log.popover.sets', { count: entry.sets })}`
        : null;
    const parts = [
      entry.weightKg != null ? t('log.popover.kg', { value: entry.weightKg }) : null,
      volume,
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(' · ') : null;
  }

  return (
    <View style={styles.sheet}>
      <View style={styles.grabber} />
      {needsConfirm ? (
        <>
          {rawLine ? (
            <Text style={styles.youWrote} numberOfLines={2}>
              {t('log.popover.youWrote', { line: rawLine })}
            </Text>
          ) : null}
          <Text style={styles.title}>{t('log.popover.readAs', { name: guess })}</Text>
          {first.muscles && first.muscles.length > 0 ? (
            <Text style={styles.muscles}>{first.muscles.join(' · ')}</Text>
          ) : null}
          <TextInput
            style={styles.nameInput}
            value={name}
            onChangeText={setName}
            placeholder={t('log.popover.namePlaceholder')}
            placeholderTextColor={colors.lead}
            accessibilityLabel={t('log.popover.nameLabel')}
            autoCorrect={false}
            autoCapitalize="words"
          />
          {clarifyingQuestion ? (
            <View style={styles.clarify}>
              <Text style={styles.question}>{clarifyingQuestion.question}</Text>
              {clarifyingQuestion.alternatives.map((alt) => (
                <Pressable
                  key={alt}
                  onPress={() => onConfirm(entries, alt, overrideName)}
                  style={({ pressed }) => [styles.altBtn, pressed && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityLabel={alt}
                  accessibilityHint={t('log.popover.answerHint')}
                >
                  <Text style={styles.altLabel}>{alt}</Text>
                </Pressable>
              ))}
              <TextInput
                style={styles.customInput}
                value={customAnswer}
                onChangeText={setCustomAnswer}
                placeholder={t('log.popover.customAnswerPlaceholder')}
                placeholderTextColor={colors.lead}
                accessibilityLabel={t('log.popover.customAnswerLabel')}
              />
            </View>
          ) : null}
          <Pressable
            onPress={() => onConfirm(entries, customAnswer.trim() || undefined, overrideName)}
            disabled={!trimmedName}
            style={({ pressed }) => [
              styles.primaryBtn,
              !trimmedName && styles.primaryBtnDisabled,
              pressed && styles.pressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel={saveLabel}
            accessibilityState={{ disabled: !trimmedName }}
          >
            <Text style={styles.primaryLabel} numberOfLines={1}>
              {saveLabel}
            </Text>
          </Pressable>
        </>
      ) : (
        <>
          <Text style={styles.title}>{guess}</Text>
          {entries.map((entry) => {
            const row = setRow(entry);
            return row ? (
              <Text key={entry.id} style={styles.setRow}>
                {row}
              </Text>
            ) : null;
          })}
          {canViewProgress ? (
            <Pressable
              onPress={viewProgress}
              style={({ pressed }) => [styles.linkBtn, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={t('log.viewProgress')}
            >
              <Text style={styles.linkLabel}>{t('log.viewProgress')}</Text>
            </Pressable>
          ) : null}
        </>
      )}

      <Pressable
        onPress={onClose}
        style={({ pressed }) => [styles.closeBtn, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={t('log.popover.close')}
      >
        <Text style={styles.closeLabel}>{t('log.popover.close')}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, justifyContent: 'flex-end' },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(45, 31, 26, 0.35)' },
  sheet: {
    backgroundColor: colors.paper,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: colors.graphite,
    paddingHorizontal: spacing.s4,
    paddingTop: spacing.s2,
    paddingBottom: spacing.s6,
    gap: spacing.s2,
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: radii.pill,
    backgroundColor: colors.ruleSoft,
    marginBottom: spacing.s1,
  },
  youWrote: { ...typography.monoCaption, color: colors.lead },
  title: { ...typography.title, color: colors.graphite },
  muscles: { ...typography.monoCaption, color: colors.lead, textTransform: 'lowercase' },
  setRow: { ...typography.monoBodyS, color: colors.graphite },
  nameInput: {
    ...typography.body,
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.graphite,
    borderRadius: radii.md,
    paddingHorizontal: spacing.s3,
    paddingVertical: spacing.s2,
    color: colors.graphite,
    backgroundColor: colors.paper,
  },
  clarify: { gap: spacing.s2, marginTop: spacing.s1 },
  question: { ...typography.bodyEmphasis, color: colors.graphite },
  altBtn: {
    minHeight: 44,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.graphite,
    borderRadius: radii.md,
    paddingVertical: spacing.s2,
    paddingHorizontal: spacing.s3,
    alignItems: 'center',
  },
  altLabel: { ...typography.bodyEmphasis, color: colors.graphite },
  customInput: {
    ...typography.body,
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.ruleSoft,
    borderRadius: radii.md,
    paddingHorizontal: spacing.s3,
    paddingVertical: spacing.s2,
    color: colors.graphite,
  },
  primaryBtn: {
    minHeight: 48,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.graphite,
    borderRadius: radii.md,
    paddingHorizontal: spacing.s4,
    marginTop: spacing.s1,
  },
  primaryBtnDisabled: { opacity: 0.4 },
  primaryLabel: { ...typography.bodyEmphasis, color: colors.fgOnAccent },
  linkBtn: { minHeight: 44, justifyContent: 'center' },
  linkLabel: { ...typography.bodyEmphasis, color: colors.moss },
  closeBtn: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  closeLabel: { ...typography.bodyEmphasis, color: colors.lead },
  pressed: { opacity: 0.7 },
});
