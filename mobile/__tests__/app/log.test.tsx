import { render, screen } from '@testing-library/react-native';
import LogScreen from '../../app/(tabs)/index';

describe('LogScreen', () => {
  it('renders the Log screen stub', async () => {
    await render(<LogScreen />);
    expect(screen.getByText('Log')).toBeTruthy();
  });
});
