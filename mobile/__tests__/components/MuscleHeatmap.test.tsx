import { render, screen, fireEvent } from '@testing-library/react-native';
import { MuscleHeatmap } from '@/src/components/MuscleHeatmap';
import type { GoalProgress } from '@/lib/api';

describe('MuscleHeatmap', () => {
  const progress: GoalProgress[] = [
    { muscle: 'GLUTES', targetMin: 12, targetMax: 20, actualSets: 8 },
    { muscle: 'CHEST', targetMin: 10, targetMax: 18, actualSets: 2 },
  ];

  it('renders the front view by default with region accessibility labels', async () => {
    await render(<MuscleHeatmap progress={progress} />);
    expect(screen.getByLabelText('Chest: 2 of 18 sets')).toBeTruthy();
  });

  it('switches to the back view showing back-only regions', async () => {
    await render(<MuscleHeatmap progress={progress} />);
    await fireEvent.press(screen.getByText('Back'));
    expect(screen.getByLabelText('Glutes: 8 of 20 sets')).toBeTruthy();
    expect(screen.queryByLabelText('Chest: 2 of 18 sets')).toBeNull();
  });
});
