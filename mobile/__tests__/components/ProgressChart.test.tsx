import '@/lib/i18n';
import { render, screen } from '@testing-library/react-native';
import { ProgressChart } from '@/src/components/ProgressChart';

// The axis-label layer is hidden from assistive tech (the chart View carries a summary instead).
const hidden = { includeHiddenElements: true };

const points = [
  { date: '2026-06-01', value: 90 }, { date: '2026-07-01', value: 95 },
  { date: '2026-08-01', value: null }, { date: '2026-08-15', value: 100 },
];

describe('ProgressChart', () => {
  it('draws a dot per numeric point, y tick labels and month x labels', async () => {
    await render(<ProgressChart points={points} unit="kg" label="Top set" width={320} />);
    expect(screen.getAllByTestId('chart-point')).toHaveLength(3);
    expect(screen.getAllByTestId('chart-y-label', hidden).length).toBeGreaterThanOrEqual(3);
    expect(screen.getAllByTestId('chart-x-label', hidden).map((n) => n.props.children)).toEqual(['Jun', 'Jul', 'Aug']);
  });

  it('places month labels by real dates and adds the year when the series spans years', async () => {
    await render(<ProgressChart points={[{ date: '2025-12-20', value: 90 }, { date: '2026-02-10', value: 95 }]} unit="kg" label="Top set" width={320} />);
    expect(screen.getAllByTestId('chart-x-label', hidden).map((n) => n.props.children)).toEqual(["Dec '25", "Jan '26", "Feb '26"]);
  });

  it('thins month labels that would overlap', async () => {
    // ~1 year of data in 320 px: 12 boundaries ≈ 22 px apart, so roughly every other one survives.
    await render(<ProgressChart points={[{ date: '2025-08-01', value: 90 }, { date: '2026-08-01', value: 95 }]} unit="kg" label="Top set" width={320} />);
    const labels = screen.getAllByTestId('chart-x-label', hidden);
    expect(labels.length).toBeLessThan(13);
    expect(labels.length).toBeGreaterThan(4);
  });

  it('fills PR points moss and draws weightless sessions as hollow markers', async () => {
    await render(
      <ProgressChart
        points={[{ date: '2026-06-01', value: 90 }, { date: '2026-06-08', value: null, hollow: true }, { date: '2026-06-15', value: 100, pr: true }]}
        unit="kg"
        label="Top set"
        width={320}
      />,
    );
    expect(screen.getAllByTestId('chart-point')).toHaveLength(1);
    expect(screen.getAllByTestId('chart-pr-point')).toHaveLength(1);
    expect(screen.getAllByTestId('chart-hollow-point')).toHaveLength(1);
  });

  it('summarises the series for screen readers and hides the label layer', async () => {
    await render(<ProgressChart points={points} unit="kg" label="Top set" width={320} />);
    expect(screen.getByLabelText('Top set, 4 sessions, from 90 kg on Mon 1 Jun to 100 kg on Sat 15 Aug, best 100 kg')).toBeTruthy();
  });

  it('shows a flat line with sensible ticks when every value is equal', async () => {
    await render(<ProgressChart points={[{ date: '2026-06-01', value: 50 }, { date: '2026-07-01', value: 50 }]} unit="kg" label="Top set" width={320} />);
    expect(screen.getAllByTestId('chart-point')).toHaveLength(2);
    const ticks = screen.getAllByTestId('chart-y-label', hidden).map((n) => parseFloat(String(n.props.children)));
    expect(ticks).toContain(50);
  });
});
