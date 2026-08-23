import React from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, typography } from '@/lib/theme';
import { Text } from './Text';

interface Props {
  title: string;
  body?: string;
  icon?: React.ComponentProps<typeof Feather>['name'];
  /** Optional call to action rendered as an outlined button under the body. */
  action?: { label: string; onPress: () => void };
}

export function EmptyState({ title, body, icon = 'file-text', action }: Props) {
  return (
    <View style={styles.container}>
      <Feather name={icon} size={28} color={colors.lead} />
      <Text style={styles.title}>{title}</Text>
      {body ? <Text style={styles.body}>{body}</Text> : null}
      {action ? (
        <Pressable
          onPress={action.onPress}
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={action.label}
        >
          <Text style={styles.actionLabel}>{action.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
    gap: 8,
  },
  title: {
    ...typography.displayS,
    color: colors.graphite,
    textAlign: 'center',
    letterSpacing: -0.5,
  },
  body: {
    ...typography.bodyS,
    color: colors.lead,
    textAlign: 'center',
    lineHeight: 20,
  },
  action: {
    marginTop: 8,
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 20,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.graphite,
  },
  pressed: { opacity: 0.6 },
  actionLabel: {
    ...typography.bodyEmphasis,
    color: colors.graphite,
  },
});
