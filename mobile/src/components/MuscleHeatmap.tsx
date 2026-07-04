import { View, Text, StyleSheet } from 'react-native';
import { progressColor } from '../science/muscleColor';
import type { GoalProgress } from '../api/types';

export function MuscleHeatmap({ progress }: { progress: GoalProgress[] }) {
  return (
    <View>
      {progress.map((p) => (
        <View key={p.muscle} style={[styles.row, { backgroundColor: progressColor(p.actualSets, p.targetMin, p.targetMax) }]}>
          <Text style={styles.label}>{p.muscle}</Text>
          <Text style={styles.count}>{p.actualSets} / {p.targetMax}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', padding: 12, borderRadius: 8, marginBottom: 6 },
  label: { fontWeight: '600' },
  count: {},
});
