import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import Svg, { Polyline, Circle, Line } from 'react-native-svg';
import { Text } from '@/components/Text';
import { colors, fontSize } from '@/lib/theme';
import { monthLabel, formatShortDate, spansYears, type Unit } from '@/lib/exerciseProgress';
import {
  scaleRuns, niceTicks, valueExtent, xScale, monthBoundaries, thinLabels, type ChartPoint,
} from './chartScale';

const PAD = { top: 12, right: 12, bottom: 24, left: 44 };
// Axis labels are RN Text (theme typography, font scaling) laid over the svg.
const LABEL_H = fontSize.caption + 4;
const X_LABEL_W = 56;
const MIN_LABEL_GAP = 36;

export type ProgressChartPoint = ChartPoint & {
  /** Session without a weight on a weighted exercise — drawn as a hollow marker. */
  hollow?: boolean;
};

function formatValue(v: number, unit: string): string {
  return unit ? `${v} ${unit}` : String(v);
}

/**
 * Detail-screen line chart: y ticks with unit, month labels at real month boundaries,
 * dots per session (PRs filled moss, bodyweight sessions hollow), gaps for nulls.
 */
export function ProgressChart({
  points, unit, label, width, height = 180,
}: { points: ProgressChartPoint[]; unit: Unit | ''; label: string; width: number; height?: number }) {
  const { t } = useTranslation();
  const extent = valueExtent(points);
  const ticks = extent ? niceTicks(extent.min, extent.max) : [];
  const domain = ticks.length ? { min: ticks[0], max: ticks[ticks.length - 1] } : undefined;
  const { runs, min, max } = scaleRuns(points, width, height, PAD, domain);
  const innerH = height - PAD.top - PAD.bottom;
  const yFor = (v: number) => PAD.top + innerH - (innerH * (v - min)) / (max - min || 1);
  const xFor = xScale(points, width, PAD);

  const first = points[0]?.date;
  const last = points[points.length - 1]?.date;
  const withYear = !!first && !!last && spansYears(first, last);
  const xLabels = first && last
    ? thinLabels(
        [first, ...monthBoundaries(first, last)].map((d) => ({ x: xFor(d), label: monthLabel(d, withYear) })),
        MIN_LABEL_GAP,
      )
    : [];

  const hollow = points.filter((p) => p.hollow);
  const measured = points.filter((p) => p.value != null) as (ProgressChartPoint & { value: number })[];
  const best = measured.length ? Math.max(...measured.map((p) => p.value)) : null;
  const firstMeasured = measured[0];
  const lastMeasured = measured[measured.length - 1];
  const summary = firstMeasured && lastMeasured && best != null
    ? t('stats.chartSummary', {
        label,
        sessions: t('stats.sessions', { count: points.length }),
        first: formatValue(firstMeasured.value, unit),
        firstDate: formatShortDate(firstMeasured.date, { withYear }),
        last: formatValue(lastMeasured.value, unit),
        lastDate: formatShortDate(lastMeasured.date, { withYear }),
        best: formatValue(best, unit),
      })
    : label;

  return (
    <View style={{ width, height }} accessible accessibilityRole="image" accessibilityLabel={summary}>
      <Svg width={width} height={height}>
        {ticks.map((tick) => (
          <Line key={`g${tick}`} x1={PAD.left} x2={width - PAD.right} y1={yFor(tick)} y2={yFor(tick)} stroke={colors.ruleSoft} strokeWidth={1} />
        ))}
        {runs.map((run, i) => (
          <Polyline key={i} points={run.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke={colors.graphite} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {runs.flat().map((p) => (
          <Circle
            key={p.date}
            testID={p.pr ? 'chart-pr-point' : 'chart-point'}
            cx={p.x}
            cy={p.y}
            r={p.pr ? 4.5 : 3.5}
            fill={p.pr ? colors.moss : colors.graphite}
            stroke={p.pr ? colors.moss : colors.graphite}
            strokeWidth={2}
          />
        ))}
        {hollow.map((p) => (
          <Circle
            key={`h${p.date}`}
            testID="chart-hollow-point"
            cx={xFor(p.date)}
            cy={p.value != null ? yFor(p.value) : PAD.top + innerH}
            r={3.5}
            fill={colors.paper}
            stroke={colors.graphite}
            strokeWidth={1.5}
          />
        ))}
      </Svg>
      <View style={StyleSheet.absoluteFill} importantForAccessibility="no-hide-descendants" pointerEvents="none">
        {ticks.map((tick, i) => (
          <Text
            key={`y${tick}`}
            testID="chart-y-label"
            variant="monoCaption"
            color={colors.lead}
            numberOfLines={1}
            style={[styles.yLabel, { width: PAD.left - 6, top: yFor(tick) - LABEL_H / 2 }]}
          >
            {/* Only the top tick carries the unit, so the axis stays narrow. */}
            {i === ticks.length - 1 && unit ? `${tick} ${unit}` : String(tick)}
          </Text>
        ))}
        {xLabels.map((m) => (
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
    </View>
  );
}

const styles = StyleSheet.create({
  yLabel: { position: 'absolute', left: 0, height: LABEL_H, lineHeight: LABEL_H, textAlign: 'right' },
  xLabel: { position: 'absolute', width: X_LABEL_W, height: LABEL_H, lineHeight: LABEL_H, textAlign: 'center' },
});
