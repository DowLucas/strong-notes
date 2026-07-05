// src/components/EntryPopover.tsx
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { colors, spacing, typography } from '@/lib/theme';
import type { ScannedEntry } from '../parsing/scanNote';

export function EntryPopover({
  entry,
  onConfirm,
  onClose,
}: {
  entry: ScannedEntry;
  onConfirm: (entry: ScannedEntry) => void;
  onClose: () => void;
}) {
  const title = entry.exerciseName ?? entry.rawText;
  const detail = [
    entry.weightKg != null ? `${entry.weightKg}kg` : null,
    entry.reps != null && entry.sets != null ? `${entry.reps}×${entry.sets}` : null,
  ]
    .filter(Boolean)
    .join('   ');

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{title}</Text>
      {detail ? <Text style={styles.detail}>{detail}</Text> : null}
      {entry.status === 'needs-confirm' ? (
        <Pressable onPress={() => onConfirm(entry)} style={styles.confirmBtn}>
          <Text style={styles.confirmLabel}>Confirm exercise</Text>
        </Pressable>
      ) : null}
      <Pressable onPress={onClose} style={styles.closeBtn}>
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
  confirmBtn: {
    backgroundColor: colors.graphite,
    borderRadius: 6,
    paddingVertical: spacing.s2,
    alignItems: 'center',
  },
  confirmLabel: { ...typography.bodyEmphasis, color: colors.fgOnAccent },
  closeBtn: { alignItems: 'center', paddingVertical: spacing.s1 },
  closeLabel: { ...typography.monoCaption, color: colors.lead },
});
