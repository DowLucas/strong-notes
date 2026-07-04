import { View, Text, Pressable, StyleSheet } from 'react-native';
import type { ParsedLine } from '../parsing/quickEntry';

export function ParsedLineRow<T extends ParsedLine>({
  line,
  onConfirm,
}: {
  line: T;
  onConfirm?: (line: T) => void;
}) {
  return (
    <View style={styles.row}>
      <Text>{line.rawText}</Text>
      {line.status === 'pending' && <Text style={styles.pending}>Not yet parsed</Text>}
      {line.status === 'needs-confirm' && (
        <Pressable onPress={() => onConfirm?.(line)}>
          <Text style={styles.pending}>Confirm: {line.exerciseName}</Text>
        </Pressable>
      )}
      {line.status === 'unresolved' && <Text style={styles.pending}>Unrecognized</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { paddingVertical: 8 },
  pending: { color: '#a35', fontSize: 12 },
});
