import { render, screen, fireEvent } from '@testing-library/react-native';
import { ParsedLineRow } from '../../src/components/ParsedLineRow';
import type { ParsedLine } from '../../src/parsing/quickEntry';

describe('ParsedLineRow', () => {
  it('calls onConfirm with the line when the "Confirm: X" text is pressed on a needs-confirm line', async () => {
    const line: ParsedLine = {
      rawText: 'CRABWALK 8x2',
      status: 'needs-confirm',
      exerciseName: 'Cable Crab Walk',
      unresolvedToken: 'CRABWALK',
      muscles: ['GLUTES'],
    };
    const onConfirm = jest.fn();

    await render(<ParsedLineRow line={line} onConfirm={onConfirm} />);

    await fireEvent.press(screen.getByText('Confirm: Cable Crab Walk'));

    expect(onConfirm).toHaveBeenCalledWith(line);
  });

  it('does not render a Confirm affordance for pending/unresolved lines', async () => {
    await render(<ParsedLineRow line={{ rawText: 'foo', status: 'pending' }} />);
    expect(screen.queryByText(/Confirm:/)).toBeNull();
  });
});
