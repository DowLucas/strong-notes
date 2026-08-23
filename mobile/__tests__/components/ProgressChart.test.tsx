import { render, screen } from '@testing-library/react-native';
import { ProgressChart } from '@/src/components/ProgressChart';

const points = [
  { date: '2026-06-01', value: 90 }, { date: '2026-07-01', value: 95 },
  { date: '2026-08-01', value: null }, { date: '2026-08-15', value: 100 },
];

describe('ProgressChart', () => {
  it('draws a dot per numeric point, y tick labels and month x labels', async () => {
    await render(<ProgressChart points={points} unit="kg" width={320} />);
    expect(screen.getAllByTestId('chart-point')).toHaveLength(3);
    expect(screen.getAllByTestId('chart-y-label').length).toBeGreaterThanOrEqual(3);
    expect(screen.getAllByTestId('chart-x-label').map((n) => n.props.children)).toEqual(['Jun', 'Jul', 'Aug']);
  });

  it('shows a flat line with sensible ticks when every value is equal', async () => {
    await render(<ProgressChart points={[{ date: '2026-06-01', value: 50 }, { date: '2026-07-01', value: 50 }]} unit="kg" width={320} />);
    expect(screen.getAllByTestId('chart-point')).toHaveLength(2);
  });
});
