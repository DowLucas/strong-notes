import Svg, { Polyline, Circle } from 'react-native-svg';
import { colors } from '@/lib/theme';
import { scaleRuns, type ChartPoint } from './chartScale';

export type { ChartPoint };

const PAD = { top: 2, right: 3, bottom: 2, left: 3 };

/** Tiny trend line for a list row. Gaps (null values) break the line. */
export function Sparkline({ points, width = 80, height = 24 }: { points: ChartPoint[]; width?: number; height?: number }) {
  const numeric = points.filter((p) => p.value != null);
  if (numeric.length < 2) return null;
  const { runs } = scaleRuns(points, width, height, PAD);
  const last = runs[runs.length - 1]?.slice(-1)[0];
  return (
    <Svg width={width} height={height} accessible={false}>
      {runs.map((run, i) => (
        <Polyline
          key={i}
          testID="sparkline-segment"
          points={run.map((p) => `${p.x},${p.y}`).join(' ')}
          fill="none"
          stroke={colors.graphite}
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ))}
      {last ? <Circle cx={last.x} cy={last.y} r={2.2} fill={colors.moss} /> : null}
    </Svg>
  );
}
