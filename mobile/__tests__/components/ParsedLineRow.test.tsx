import { render, screen, fireEvent } from '@testing-library/react-native';
import { ParsedLineRow } from '@/src/components/ParsedLineRow';
import type { ParsedLine } from '@/src/parsing/quickEntry';

describe('ParsedLineRow', () => {
  it('renders raw text and calls onConfirm when tapped for a needs-confirm line', async () => {
    const line: ParsedLine = { rawText: 'PLANK 5x1', status: 'needs-confirm', exerciseName: 'Plank', parsedBy: 'LLM' };
    const onConfirm = jest.fn();
    await render(<ParsedLineRow line={line} onConfirm={onConfirm} />);

    expect(screen.getByText('PLANK 5x1')).toBeTruthy();
    await fireEvent.press(screen.getByText('Confirm: Plank'));
    expect(onConfirm).toHaveBeenCalledWith(line);
  });

  it('shows "Not yet parsed" for a pending line', async () => {
    const line: ParsedLine = { rawText: 'PLANK 5x1', status: 'pending', parsedBy: 'DICTIONARY' };
    await render(<ParsedLineRow line={line} />);
    expect(screen.getByText('Not yet parsed')).toBeTruthy();
  });
});
