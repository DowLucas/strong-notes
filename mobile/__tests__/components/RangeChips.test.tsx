import '@/lib/i18n';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { RangeChips } from '@/src/components/RangeChips';

describe('RangeChips', () => {
  it('renders all ranges, marks the selected one, and reports taps', async () => {
    const onChange = jest.fn();
    await render(<RangeChips value="3m" onChange={onChange} />);
    expect(screen.getAllByRole('button')).toHaveLength(5);
    expect(screen.getByRole('button', { name: '3m' }).props.accessibilityState).toEqual({ selected: true });
    await fireEvent.press(screen.getByRole('button', { name: 'All' }));
    expect(onChange).toHaveBeenCalledWith('all');
  });
});
