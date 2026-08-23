import '@/lib/i18n';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { RangeChips } from '@/src/components/RangeChips';

describe('RangeChips', () => {
  it('renders all ranges as tabs in a labelled group, marks the selected one, and reports taps', async () => {
    const onChange = jest.fn();
    await render(<RangeChips value="3m" onChange={onChange} />);
    expect(screen.getByLabelText('Time range').props.accessibilityRole).toBe('tablist');
    expect(screen.getAllByRole('tab')).toHaveLength(5);
    expect(screen.getByRole('tab', { name: '3m' }).props.accessibilityState).toEqual({ selected: true });
    await fireEvent.press(screen.getByRole('tab', { name: 'All' }));
    expect(onChange).toHaveBeenCalledWith('all');
  });

  it('gives every chip a 44 pt touch target', async () => {
    await render(<RangeChips value="3m" onChange={jest.fn()} />);
    const style = StyleSheetFlatten(screen.getByRole('tab', { name: '1m' }).props.style);
    expect(style.minHeight).toBeGreaterThanOrEqual(44);
  });
});

function StyleSheetFlatten(style: unknown): Record<string, number> {
  return Object.assign({}, ...(Array.isArray(style) ? style.flat() : [style]).filter(Boolean));
}
