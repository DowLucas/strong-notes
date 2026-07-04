import { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import Svg, { Rect, Ellipse, Circle } from 'react-native-svg';
import { progressColor } from '../science/muscleColor';
import type { GoalProgress, MuscleGroup } from '../api/types';

const NEUTRAL = '#e5e7eb';
const SKIN = '#e5c9a8';

function colorFor(muscle: MuscleGroup, progress: GoalProgress[]): string {
  const p = progress.find((x) => x.muscle === muscle);
  if (!p) return NEUTRAL;
  return progressColor(p.actualSets, p.targetMin, p.targetMax);
}

function actualSetsLabel(muscle: MuscleGroup, progress: GoalProgress[]): string {
  const p = progress.find((x) => x.muscle === muscle);
  if (!p) return 'no data';
  return `${p.actualSets} of ${p.targetMax} sets`;
}

function FrontBody({ progress }: { progress: GoalProgress[] }) {
  return (
    <Svg width={160} height={340} viewBox="0 0 160 340" accessibilityLabel="Front body diagram">
      <Circle cx={80} cy={30} r={22} fill={SKIN} />
      {/* hips rendered wider than shoulders -- deliberate feminine silhouette proportion */}
      <Ellipse cx={80} cy={168} rx={34} ry={16} fill={colorFor('QUADS', progress)} accessibilityLabel={`Hips/Quads: ${actualSetsLabel('QUADS', progress)}`} />
      <Ellipse cx={50} cy={65} rx={16} ry={10} fill={colorFor('SHOULDERS', progress)} accessibilityLabel={`Shoulders: ${actualSetsLabel('SHOULDERS', progress)}`} />
      <Ellipse cx={110} cy={65} rx={16} ry={10} fill={colorFor('SHOULDERS', progress)} accessibilityLabel={`Shoulders: ${actualSetsLabel('SHOULDERS', progress)}`} />
      <Rect x={55} y={60} width={50} height={55} rx={12} fill={colorFor('CHEST', progress)} accessibilityLabel={`Chest: ${actualSetsLabel('CHEST', progress)}`} />
      <Rect x={30} y={70} width={16} height={80} rx={8} fill={colorFor('ARMS', progress)} accessibilityLabel={`Arms: ${actualSetsLabel('ARMS', progress)}`} />
      <Rect x={114} y={70} width={16} height={80} rx={8} fill={colorFor('ARMS', progress)} accessibilityLabel={`Arms: ${actualSetsLabel('ARMS', progress)}`} />
      <Rect x={58} y={118} width={44} height={50} rx={10} fill={colorFor('CORE', progress)} accessibilityLabel={`Core: ${actualSetsLabel('CORE', progress)}`} />
      <Rect x={55} y={170} width={20} height={70} rx={10} fill={colorFor('QUADS', progress)} accessibilityLabel={`Quads: ${actualSetsLabel('QUADS', progress)}`} />
      <Rect x={85} y={170} width={20} height={70} rx={10} fill={colorFor('QUADS', progress)} accessibilityLabel={`Quads: ${actualSetsLabel('QUADS', progress)}`} />
      <Rect x={57} y={244} width={16} height={60} rx={8} fill={colorFor('CALVES', progress)} accessibilityLabel={`Calves: ${actualSetsLabel('CALVES', progress)}`} />
      <Rect x={87} y={244} width={16} height={60} rx={8} fill={colorFor('CALVES', progress)} accessibilityLabel={`Calves: ${actualSetsLabel('CALVES', progress)}`} />
    </Svg>
  );
}

function BackBody({ progress }: { progress: GoalProgress[] }) {
  return (
    <Svg width={160} height={340} viewBox="0 0 160 340" accessibilityLabel="Back body diagram">
      <Circle cx={80} cy={30} r={22} fill={SKIN} />
      <Ellipse cx={80} cy={168} rx={34} ry={16} fill={colorFor('GLUTES', progress)} accessibilityLabel={`Glutes: ${actualSetsLabel('GLUTES', progress)}`} />
      <Ellipse cx={50} cy={65} rx={16} ry={10} fill={colorFor('SHOULDERS', progress)} accessibilityLabel={`Shoulders: ${actualSetsLabel('SHOULDERS', progress)}`} />
      <Ellipse cx={110} cy={65} rx={16} ry={10} fill={colorFor('SHOULDERS', progress)} accessibilityLabel={`Shoulders: ${actualSetsLabel('SHOULDERS', progress)}`} />
      <Rect x={55} y={60} width={50} height={70} rx={12} fill={colorFor('BACK', progress)} accessibilityLabel={`Back: ${actualSetsLabel('BACK', progress)}`} />
      <Rect x={30} y={70} width={16} height={80} rx={8} fill={colorFor('ARMS', progress)} accessibilityLabel={`Arms: ${actualSetsLabel('ARMS', progress)}`} />
      <Rect x={114} y={70} width={16} height={80} rx={8} fill={colorFor('ARMS', progress)} accessibilityLabel={`Arms: ${actualSetsLabel('ARMS', progress)}`} />
      <Rect x={55} y={178} width={20} height={55} rx={10} fill={colorFor('HAMSTRINGS', progress)} accessibilityLabel={`Hamstrings: ${actualSetsLabel('HAMSTRINGS', progress)}`} />
      <Rect x={85} y={178} width={20} height={55} rx={10} fill={colorFor('HAMSTRINGS', progress)} accessibilityLabel={`Hamstrings: ${actualSetsLabel('HAMSTRINGS', progress)}`} />
      <Rect x={57} y={236} width={16} height={60} rx={8} fill={colorFor('CALVES', progress)} accessibilityLabel={`Calves: ${actualSetsLabel('CALVES', progress)}`} />
      <Rect x={87} y={236} width={16} height={60} rx={8} fill={colorFor('CALVES', progress)} accessibilityLabel={`Calves: ${actualSetsLabel('CALVES', progress)}`} />
    </Svg>
  );
}

export function MuscleHeatmap({ progress }: { progress: GoalProgress[] }) {
  const [view, setView] = useState<'front' | 'back'>('front');
  return (
    <View style={styles.container}>
      <View style={styles.toggleRow}>
        <Pressable testID="toggle-front" onPress={() => setView('front')}>
          <Text style={view === 'front' ? styles.toggleActive : styles.toggle}>Front</Text>
        </Pressable>
        <Pressable testID="toggle-back" onPress={() => setView('back')}>
          <Text style={view === 'back' ? styles.toggleActive : styles.toggle}>Back</Text>
        </Pressable>
      </View>
      {view === 'front' ? <FrontBody progress={progress} /> : <BackBody progress={progress} />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center' },
  toggleRow: { flexDirection: 'row', gap: 24, marginBottom: 12 },
  toggle: { fontWeight: '400', color: '#666', fontSize: 16 },
  toggleActive: { fontWeight: '700', color: '#111', fontSize: 16 },
});
