// __tests__/components/EntryPopover.test.tsx
import { render, screen, fireEvent } from '@testing-library/react-native';
import { EntryPopover } from '@/src/components/EntryPopover';
import type { ScannedEntry } from '@/src/parsing/scanNote';

function entry(overrides: Partial<ScannedEntry>): ScannedEntry {
  return {
    id: 'e1', exerciseId: null, equipment: null, weightKg: 60, reps: 8, sets: 3,
    rawText: 'Bench Press 60kg 8x3', parsedBy: 'LLM', order: 0, synced: 0,
    spanStart: 0, spanEnd: 20, status: 'needs-confirm', exerciseName: 'Bench Press',
    unresolvedToken: 'BP', ...overrides,
  };
}

describe('EntryPopover', () => {
  it('shows a Confirm action for a needs-confirm entry and fires it', async () => {
    const onConfirm = jest.fn();
    const e = entry({});
    await render(<EntryPopover entry={e} onConfirm={onConfirm} onClose={jest.fn()} />);

    expect(screen.getByText('Bench Press')).toBeTruthy();
    expect(screen.getByText(/60kg/)).toBeTruthy();
    await fireEvent.press(screen.getByText('Confirm exercise'));
    expect(onConfirm).toHaveBeenCalledWith(e);
  });

  it('hides Confirm for a resolved entry and fires Close', async () => {
    const onClose = jest.fn();
    await render(
      <EntryPopover entry={entry({ status: 'resolved', exerciseId: 'ex-1' })} onConfirm={jest.fn()} onClose={onClose} />,
    );
    expect(screen.queryByText('Confirm exercise')).toBeNull();
    await fireEvent.press(screen.getByText('Close'));
    expect(onClose).toHaveBeenCalled();
  });
});
