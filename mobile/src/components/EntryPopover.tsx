// src/components/EntryPopover.tsx
import { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { colors, spacing, typography } from '@/lib/theme';
import type { ScannedEntry } from '../parsing/scanNote';

function detailFor(entry: ScannedEntry): string {
  return [
    entry.weightKg != null ? `${entry.weightKg}kg` : null,
    entry.reps != null && entry.sets != null ? `${entry.reps}×${entry.sets}` : null,
  ]
    .filter(Boolean)
    .join('   ');
}

export function EntryPopover({
  entries,
  onConfirm,
  onClose,
}: {
  entries: ScannedEntry[];
  onConfirm: (entries: ScannedEntry[], modifierValue?: string) => void;
  onClose: () => void;
}) {
  const [customValue, setCustomValue] = useState('');
  const first = entries[0];
  const title = first.exerciseName || first.rawText;
  const needsConfirm = first.status === 'needs-confirm';
  const clarifyingQuestion = first.clarifyingQuestion;
  const { t } = useTranslation();
  const canViewProgress = first.status === 'resolved' && !!first.exerciseId;

  function viewProgress() {
    onClose();
    router.push({ pathname: '/exercise/[id]', params: { id: first.exerciseId! } });
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{title}</Text>
      {entries.map((entry) => {
        const detail = detailFor(entry);
        return detail ? (
          <Text key={entry.id} style={styles.detail}>
            {detail}
          </Text>
        ) : null;
      })}

      {needsConfirm && clarifyingQuestion ? (
        <View style={styles.clarify}>
          <Text style={styles.question}>{clarifyingQuestion.question}</Text>
          {clarifyingQuestion.alternatives.map((alt) => (
            <Pressable
              key={alt}
              onPress={() => onConfirm(entries, alt)}
              style={styles.altBtn}
              accessibilityRole="button"
              accessibilityLabel={alt}
            >
              <Text style={styles.altLabel}>{alt}</Text>
            </Pressable>
          ))}
          <TextInput
            style={styles.customInput}
            value={customValue}
            onChangeText={setCustomValue}
            placeholder="Or type your own…"
            placeholderTextColor={colors.lead}
            accessibilityLabel="Custom exercise name"
          />
          <Pressable
            onPress={() => onConfirm(entries, customValue.trim() || undefined)}
            style={styles.confirmBtn}
            accessibilityRole="button"
          >
            <Text style={styles.confirmLabel}>Save</Text>
          </Pressable>
        </View>
      ) : needsConfirm ? (
        <Pressable
          onPress={() => onConfirm(entries, undefined)}
          style={styles.confirmBtn}
          accessibilityRole="button"
        >
          <Text style={styles.confirmLabel}>Confirm exercise</Text>
        </Pressable>
      ) : null}

      {canViewProgress ? (
        <Pressable onPress={viewProgress} style={styles.linkBtn} accessibilityRole="button">
          <Text style={styles.linkLabel}>{t('log.viewProgress')}</Text>
        </Pressable>
      ) : null}

      <Pressable onPress={onClose} style={styles.closeBtn} accessibilityRole="button">
        <Text style={styles.closeLabel}>Close</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.graphite,
    borderRadius: 10,
    padding: spacing.s4,
    gap: spacing.s2,
  },
  title: { ...typography.title, color: colors.graphite },
  detail: { ...typography.monoBodyS, color: colors.lead },
  clarify: { gap: spacing.s2, marginTop: spacing.s2 },
  question: { ...typography.bodyEmphasis, color: colors.graphite },
  altBtn: {
    borderWidth: 1,
    borderColor: colors.graphite,
    borderRadius: 6,
    paddingVertical: spacing.s2,
    alignItems: 'center',
  },
  altLabel: { ...typography.bodyEmphasis, color: colors.graphite },
  customInput: {
    borderWidth: 1,
    borderColor: colors.ruleSoft,
    borderRadius: 6,
    padding: spacing.s2,
    color: colors.graphite,
  },
  confirmBtn: {
    backgroundColor: colors.graphite,
    borderRadius: 6,
    paddingVertical: spacing.s2,
    alignItems: 'center',
  },
  confirmLabel: { ...typography.bodyEmphasis, color: colors.fgOnAccent },
  linkBtn: { paddingVertical: spacing.s2 },
  linkLabel: { ...typography.bodyEmphasis, color: colors.moss },
  closeBtn: { alignItems: 'center', paddingVertical: spacing.s1 },
  closeLabel: { ...typography.monoCaption, color: colors.lead },
});
