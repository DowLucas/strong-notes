import { StyleSheet, View } from 'react-native';
import Svg, { Polyline, Circle, Line } from 'react-native-svg';
import { Text } from '@/components/Text';
import { colors, fontSize } from '@/lib/theme';
import { monthLabel } from '@/lib/exerciseProgress';
import { scaleRuns, niceTicks, type ChartPoint } from './chartScale';

const PAD = { top: 12, right: 12, bottom: 24, left: 40 };
// Axis labels are RN Text (theme typography, font scaling) laid over the svg.
const LABEL_H = fontSize.caption + 4;
const X_LABEL_W = 48;

/** Detail-screen line chart: y ticks with unit, month labels on x, dots per session, gaps for nulls. */
export function ProgressChart({
  points, unit, width, height = 180,
}: { points: ChartPoint[]; unit: 'kg' | 'reps' | ''; width: number; height?: number }) {
  const { runs, min, max } = scaleRuns(points, width, height, PAD);
  const ticks = niceTicks(min, max);
  const innerH = height - PAD.top - PAD.bottom;
  const yFor = (v: number) => PAD.top + innerH - (innerH * (v - min)) / (max - min || 1);

  // One x label per month, placed at that month's first point.
  const monthStarts: { x: number; label: string }[] = [];
  const n = Math.max(points.length - 1, 1);
  const innerW = width - PAD.left - PAD.right;
  points.forEach((p, i) => {
    const label = monthLabel(p.date);
    if (monthStarts.length === 0 || monthStarts[monthStarts.length - 1].label !== label) {
      monthStarts.push({ x: PAD.left + (innerW * i) / n, label });
    }
  });

  return (
    <View style={{ width, height }}>
      <Svg width={width} height={height}>
        {ticks.map((t) => (
          <Line key={`g${t}`} x1={PAD.left} x2={width - PAD.right} y1={yFor(t)} y2={yFor(t)} stroke={colors.ruleSoft} strokeWidth={1} />
        ))}
        {runs.map((run, i) => (
          <Polyline key={i} points={run.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke={colors.graphite} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {runs.flat().map((p) => (
          <Circle key={p.date} testID="chart-point" cx={p.x} cy={p.y} r={3.5} fill={colors.paper} stroke={colors.graphite} strokeWidth={2} />
        ))}
      </Svg>
      {ticks.map((t, i) => (
        <Text
          key={`y${t}`}
          testID="chart-y-label"
          variant="monoCaption"
          color={colors.lead}
          numberOfLines={1}
          style={[styles.yLabel, { width: PAD.left - 6, top: yFor(t) - LABEL_H / 2 }]}
        >
          {/* Only the top tick carries the unit, so the axis stays narrow. */}
          {i === ticks.length - 1 && unit ? `${t} ${unit}` : String(t)}
        </Text>
      ))}
      {monthStarts.map((m) => (
        <Text
          key={`x${m.x}`}
          testID="chart-x-label"
          variant="monoCaption"
          color={colors.lead}
          numberOfLines={1}
          style={[styles.xLabel, { left: m.x - X_LABEL_W / 2, top: height - LABEL_H - 2 }]}
        >
          {m.label}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  yLabel: { position: 'absolute', left: 0, height: LABEL_H, lineHeight: LABEL_H, textAlign: 'right' },
  xLabel: { position: 'absolute', width: X_LABEL_W, height: LABEL_H, lineHeight: LABEL_H, textAlign: 'center' },
});
