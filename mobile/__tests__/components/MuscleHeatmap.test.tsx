import { processColor } from 'react-native';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { MuscleHeatmap } from '../../src/components/MuscleHeatmap';
import { progressColor } from '../../src/science/muscleColor';

const NEUTRAL = '#e5e7eb';

// react-native-svg processes `fill` through RN's processColor before it
// reaches the native prop, so the rendered prop is an int/object payload
// rather than the original hex string. Compare through the same
// transform rather than asserting on the raw hex value.
function expectFill(node: { props: { fill: unknown } }, hex: string) {
  const fill = node.props.fill as { payload: number } | number;
  const actual = typeof fill === 'object' ? fill.payload : fill;
  expect(actual).toEqual(processColor(hex));
}

describe('MuscleHeatmap', () => {
  it('renders the front view by default with labels reflecting the passed progress data', async () => {
    await render(
      <MuscleHeatmap
        progress={[
          { muscle: 'CHEST', targetMin: 10, targetMax: 18, actualSets: 2 },
          { muscle: 'ARMS', targetMin: 8, targetMax: 16, actualSets: 16 },
        ]}
      />
    );

    expect(screen.getByLabelText('Front body diagram')).toBeTruthy();
    expect(screen.getByLabelText('Chest: 2 of 18 sets')).toBeTruthy();
    // Arms are rendered as two regions (left/right), so both share the label.
    expect(screen.getAllByLabelText('Arms: 16 of 16 sets')).toHaveLength(2);

    // back view is not mounted yet
    expect(screen.queryByLabelText('Back body diagram')).toBeNull();
  });

  it('switches to the back view when "Back" is pressed, revealing back-region labels', async () => {
    await render(
      <MuscleHeatmap
        progress={[
          { muscle: 'GLUTES', targetMin: 12, targetMax: 20, actualSets: 8 },
          { muscle: 'BACK', targetMin: 10, targetMax: 18, actualSets: 18 },
        ]}
      />
    );

    await fireEvent.press(screen.getByTestId('toggle-back'));

    expect(screen.getByLabelText('Back body diagram')).toBeTruthy();
    expect(screen.getByLabelText('Glutes: 8 of 20 sets')).toBeTruthy();
    expect(screen.getByLabelText('Back: 18 of 18 sets')).toBeTruthy();
    expect(screen.queryByLabelText('Front body diagram')).toBeNull();
  });

  it('renders a muscle with no matching GoalProgress entry in the neutral color', async () => {
    // No CORE entry supplied -> its region should fall back to the neutral fill
    // and its label should read "no data".
    await render(
      <MuscleHeatmap
        progress={[{ muscle: 'CHEST', targetMin: 10, targetMax: 18, actualSets: 2 }]}
      />
    );

    const coreRegion = screen.getByLabelText('Core: no data');
    expectFill(coreRegion, NEUTRAL);

    // Sanity-check that a muscle *with* data does not get the neutral color.
    const chestRegion = screen.getByLabelText('Chest: 2 of 18 sets');
    expectFill(chestRegion, progressColor(2, 10, 18));
    expect(() => expectFill(chestRegion, NEUTRAL)).toThrow();
  });
});
