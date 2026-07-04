import { render, screen } from '@testing-library/react-native';
import { MuscleHeatmap } from '../../src/components/MuscleHeatmap';

describe('MuscleHeatmap', () => {
  it('renders a labeled row per muscle with its set count', async () => {
    await render(
      <MuscleHeatmap
        progress={[
          { muscle: 'GLUTES', targetMin: 12, targetMax: 20, actualSets: 8 },
          { muscle: 'CHEST', targetMin: 10, targetMax: 18, actualSets: 2 },
        ]}
      />
    );

    expect(screen.getByText('GLUTES')).toBeTruthy();
    expect(screen.getByText('8 / 20')).toBeTruthy();
    expect(screen.getByText('CHEST')).toBeTruthy();
    expect(screen.getByText('2 / 18')).toBeTruthy();
  });
});
