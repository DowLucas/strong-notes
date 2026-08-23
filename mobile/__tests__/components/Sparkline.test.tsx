import { render, screen } from '@testing-library/react-native';
import { Sparkline } from '@/src/components/Sparkline';

describe('Sparkline', () => {
  it('renders one polyline per contiguous run (gaps split the line)', async () => {
    await render(
      <Sparkline points={[
        { date: '2026-06-01', value: 60 }, { date: '2026-06-08', value: 65 },
        { date: '2026-06-15', value: null },
        { date: '2026-06-22', value: 70 }, { date: '2026-06-29', value: 72 },
      ]} />,
    );
    expect(screen.getAllByTestId('sparkline-segment')).toHaveLength(2);
  });

  it('renders nothing for fewer than two numeric points', async () => {
    await render(<Sparkline points={[{ date: '2026-06-01', value: 60 }]} />);
    expect(screen.queryAllByTestId('sparkline-segment')).toHaveLength(0);
  });
});
