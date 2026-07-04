import { View, Text, StyleSheet } from 'react-native';
import type { ParsedLine } from '../parsing/quickEntry';

export function ParsedLineRow({ line }: { line: ParsedLine }) {
  return (
    <View style={styles.row}>
      <Text>{line.rawText}</Text>
      {line.status === 'needs-confirm' && <Text style={styles.pending}>Confirm: {line.exerciseName}</Text>}
      {line.status === 'unresolved' && <Text style={styles.pending}>Unrecognized</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { paddingVertical: 8 },
  pending: { color: '#a35', fontSize: 12 },
});
