import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, spacing, typography } from '@/lib/theme';
import { Text } from './Text';

interface Props {
  /** Primary text. */
  label: string;
  /** Secondary text on the right (a value) or under the label when `meta` is set. */
  value?: string;
  /** Small caption rendered under the label. */
  meta?: string;
  onPress?: () => void;
  /** What tapping does — read by screen readers after the label/value. */
  hint?: string;
  /** Red label: sign out, delete. */
  destructive?: boolean;
  /** Trailing glyph: navigation chevron (default), external link, or none. */
  trailing?: 'chevron' | 'external' | 'none';
  /** Custom trailing content (replaces the glyph). */
  right?: React.ReactNode;
  disabled?: boolean;
  testID?: string;
}

/**
 * A settings-style list row: label, optional value/meta, trailing glyph.
 * Always ≥44 pt tall, announced as one button ("‹label›, ‹value›") with
 * decorative chevrons hidden from assistive tech.
 */
export function ListRow({
  label,
  value,
  meta,
  onPress,
  hint,
  destructive,
  trailing = 'chevron',
  right,
  disabled,
  testID,
}: Props) {
  const tone = destructive ? colors.brick : colors.graphite;
  const glyph =
    trailing === 'chevron' ? 'chevron-right' : trailing === 'external' ? 'external-link' : null;
  const a11yLabel = [label, value, meta].filter(Boolean).join(', ');
  return (
    <TouchableOpacity
      style={styles.row}
      onPress={onPress}
      disabled={disabled || !onPress}
      activeOpacity={0.6}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      accessibilityHint={hint}
      accessibilityState={{ disabled: !!disabled }}
      testID={testID}
    >
      <View style={styles.left}>
        <Text style={[styles.label, { color: tone }]}>{label}</Text>
        {meta ? (
          <Text variant="monoCaption" color={colors.lead} style={styles.meta}>
            {meta}
          </Text>
        ) : null}
      </View>
      <View style={styles.right}>
        {right ??
          (value ? (
            <Text variant="monoBodyS" color={colors.lead} numberOfLines={1} style={styles.value}>
              {value}
            </Text>
          ) : null)}
        {right == null && glyph ? (
          <Feather
            name={glyph}
            size={18}
            color={destructive ? colors.brick : colors.lead}
            importantForAccessibility="no"
            accessibilityElementsHidden
          />
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

/** Eyebrow heading for a group of `ListRow`s. */
export function ListSectionHeader({ title }: { title: string }) {
  return (
    <Text variant="monoLabel" color={colors.lead} style={styles.eyebrow} accessibilityRole="header">
      {title}
    </Text>
  );
}

/** Bordered container for a run of `ListRow`s. */
export function ListGroup({ children }: { children: React.ReactNode }) {
  return <View style={styles.group}>{children}</View>;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 52,
    paddingHorizontal: spacing.s5,
    paddingVertical: spacing.s3,
    borderBottomWidth: 1,
    borderBottomColor: colors.ruleSoft,
    gap: spacing.s3,
  },
  left: { flex: 1, gap: 2 },
  label: { ...typography.body },
  meta: {},
  right: { flexDirection: 'row', alignItems: 'center', gap: spacing.s2, flexShrink: 1 },
  value: { flexShrink: 1 },
  eyebrow: {
    letterSpacing: 0.3,
    paddingHorizontal: spacing.s5,
    marginBottom: spacing.s2,
  },
  group: {
    borderTopWidth: 1,
    borderTopColor: colors.ruleSoft,
    marginBottom: spacing.s6,
  },
});
