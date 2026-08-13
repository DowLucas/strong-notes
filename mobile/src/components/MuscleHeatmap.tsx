import { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import Svg, { Rect, Ellipse, Circle } from 'react-native-svg';
import { progressColor } from '../science/muscleColor';
import type { GoalProgress, MuscleGroup } from '@/lib/api';
import { colors } from '@/lib/theme';

const NEUTRAL = '#e5e7eb';
const SKIN = '#e5c9a8';

// Mirrors the thresholds in `progressColor` so the legend and the
// screen-reader summary describe the same three tiers (plus "no goal" for a
// muscle with no progress entry at all).
const LEGEND = [
  { swatch: '#dc2626', label: 'Met' },
  { swatch: '#f59e42', label: 'On track' },
  { swatch: '#fde2e2', label: 'Behind' },
  { swatch: NEUTRAL, label: 'No goal' },
] as const;

// Unique, visually-ordered muscle lists per view — used to build the single
// spoken summary for the whole diagram (individual per-shape SVG
// accessibilityLabels below don't reach screen readers on-device).
const FRONT_MUSCLES: MuscleGroup[] = ['CHEST', 'SHOULDERS', 'ARMS', 'CORE', 'QUADS', 'CALVES'];
const BACK_MUSCLES: MuscleGroup[] = ['BACK', 'SHOULDERS', 'ARMS', 'GLUTES', 'HAMSTRINGS', 'CALVES'];

function colorFor(muscle: MuscleGroup, progress: GoalProgress[]): string {
  const p = progress.find((x) => x.muscle === muscle);
  if (!p) return NEUTRAL;
  return progressColor(p.actualSets, p.targetMin, p.targetMax);
}

function labelFor(muscle: MuscleGroup, progress: GoalProgress[]): string {
  const p = progress.find((x) => x.muscle === muscle);
  const name = muscle.charAt(0) + muscle.slice(1).toLowerCase();
  return p ? `${name}: ${p.actualSets} of ${p.targetMax} sets` : `${name}: no data`;
}

function statusPhraseFor(muscle: MuscleGroup, progress: GoalProgress[]): string {
  const p = progress.find((x) => x.muscle === muscle);
  const name = muscle.charAt(0) + muscle.slice(1).toLowerCase();
  if (!p) return `${name}: no goal set`;
  const ratio = p.targetMax > 0 ? p.actualSets / p.targetMax : 0;
  const status = ratio >= 1 ? 'target met' : p.actualSets >= p.targetMin ? 'on track' : 'below target';
  return `${name} ${p.actualSets} of ${p.targetMax} sets, ${status}`;
}

function summaryFor(muscles: MuscleGroup[], progress: GoalProgress[]): string {
  return `${muscles.map((m) => statusPhraseFor(m, progress)).join('. ')}.`;
}

function FrontBody({ progress }: { progress: GoalProgress[] }) {
  return (
    <Svg width={160} height={340} viewBox="0 0 160 340" accessibilityLabel="Front body diagram">
      <Circle cx={80} cy={30} r={22} fill={SKIN} />
      <Ellipse cx={80} cy={168} rx={34} ry={16} fill={colorFor('QUADS', progress)} accessibilityLabel={labelFor('QUADS', progress)} />
      <Ellipse cx={50} cy={65} rx={16} ry={10} fill={colorFor('SHOULDERS', progress)} accessibilityLabel={labelFor('SHOULDERS', progress)} />
      <Ellipse cx={110} cy={65} rx={16} ry={10} fill={colorFor('SHOULDERS', progress)} accessibilityLabel={labelFor('SHOULDERS', progress)} />
      <Rect x={55} y={60} width={50} height={55} rx={12} fill={colorFor('CHEST', progress)} accessibilityLabel={labelFor('CHEST', progress)} />
      <Rect x={30} y={70} width={16} height={80} rx={8} fill={colorFor('ARMS', progress)} accessibilityLabel={labelFor('ARMS', progress)} />
      <Rect x={114} y={70} width={16} height={80} rx={8} fill={colorFor('ARMS', progress)} accessibilityLabel={labelFor('ARMS', progress)} />
      <Rect x={58} y={118} width={44} height={50} rx={10} fill={colorFor('CORE', progress)} accessibilityLabel={labelFor('CORE', progress)} />
      <Rect x={55} y={170} width={20} height={70} rx={10} fill={colorFor('QUADS', progress)} accessibilityLabel={labelFor('QUADS', progress)} />
      <Rect x={85} y={170} width={20} height={70} rx={10} fill={colorFor('QUADS', progress)} accessibilityLabel={labelFor('QUADS', progress)} />
      <Rect x={57} y={244} width={16} height={60} rx={8} fill={colorFor('CALVES', progress)} accessibilityLabel={labelFor('CALVES', progress)} />
      <Rect x={87} y={244} width={16} height={60} rx={8} fill={colorFor('CALVES', progress)} accessibilityLabel={labelFor('CALVES', progress)} />
    </Svg>
  );
}

function BackBody({ progress }: { progress: GoalProgress[] }) {
  return (
    <Svg width={160} height={340} viewBox="0 0 160 340" accessibilityLabel="Back body diagram">
      <Circle cx={80} cy={30} r={22} fill={SKIN} />
      <Ellipse cx={80} cy={168} rx={34} ry={16} fill={colorFor('GLUTES', progress)} accessibilityLabel={labelFor('GLUTES', progress)} />
      <Ellipse cx={50} cy={65} rx={16} ry={10} fill={colorFor('SHOULDERS', progress)} accessibilityLabel={labelFor('SHOULDERS', progress)} />
      <Ellipse cx={110} cy={65} rx={16} ry={10} fill={colorFor('SHOULDERS', progress)} accessibilityLabel={labelFor('SHOULDERS', progress)} />
      <Rect x={55} y={60} width={50} height={70} rx={12} fill={colorFor('BACK', progress)} accessibilityLabel={labelFor('BACK', progress)} />
      <Rect x={30} y={70} width={16} height={80} rx={8} fill={colorFor('ARMS', progress)} accessibilityLabel={labelFor('ARMS', progress)} />
      <Rect x={114} y={70} width={16} height={80} rx={8} fill={colorFor('ARMS', progress)} accessibilityLabel={labelFor('ARMS', progress)} />
      <Rect x={55} y={178} width={20} height={55} rx={10} fill={colorFor('HAMSTRINGS', progress)} accessibilityLabel={labelFor('HAMSTRINGS', progress)} />
      <Rect x={85} y={178} width={20} height={55} rx={10} fill={colorFor('HAMSTRINGS', progress)} accessibilityLabel={labelFor('HAMSTRINGS', progress)} />
      <Rect x={57} y={236} width={16} height={60} rx={8} fill={colorFor('CALVES', progress)} accessibilityLabel={labelFor('CALVES', progress)} />
      <Rect x={87} y={236} width={16} height={60} rx={8} fill={colorFor('CALVES', progress)} accessibilityLabel={labelFor('CALVES', progress)} />
    </Svg>
  );
}

function Legend() {
  return (
    <View style={styles.legendRow}>
      {LEGEND.map((item) => (
        <View key={item.label} style={styles.legendItem}>
          <View style={[styles.legendSwatch, { backgroundColor: item.swatch }]} />
          <Text style={styles.legendLabel}>{item.label}</Text>
        </View>
      ))}
    </View>
  );
}

export function MuscleHeatmap({ progress }: { progress: GoalProgress[] }) {
  const [view, setView] = useState<'front' | 'back'>('front');
  const muscles = view === 'front' ? FRONT_MUSCLES : BACK_MUSCLES;
  return (
    <View style={styles.container}>
      <View style={styles.toggleRow}>
        <Pressable
          testID="toggle-front"
          onPress={() => setView('front')}
          accessibilityRole="tab"
          accessibilityState={{ selected: view === 'front' }}
        >
          <Text style={view === 'front' ? styles.toggleActive : styles.toggle}>Front</Text>
        </Pressable>
        <Pressable
          testID="toggle-back"
          onPress={() => setView('back')}
          accessibilityRole="tab"
          accessibilityState={{ selected: view === 'back' }}
        >
          <Text style={view === 'back' ? styles.toggleActive : styles.toggle}>Back</Text>
        </Pressable>
      </View>
      <View accessible accessibilityRole="image" accessibilityLabel={summaryFor(muscles, progress)}>
        {view === 'front' ? <FrontBody progress={progress} /> : <BackBody progress={progress} />}
      </View>
      <Legend />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center' },
  toggleRow: { flexDirection: 'row', gap: 16, marginBottom: 8 },
  toggle: { color: colors.lead },
  toggleActive: { color: '#111', fontWeight: '700' },
  legendRow: { flexDirection: 'row', gap: 12, marginTop: 8, flexWrap: 'wrap', justifyContent: 'center' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendSwatch: { width: 10, height: 10, borderRadius: 2 },
  legendLabel: { color: colors.lead, fontSize: 12 },
});
