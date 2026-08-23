// __tests__/components/EntryPopover.test.tsx
import '@/lib/i18n';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { EntryPopover } from '@/src/components/EntryPopover';
import type { ScannedEntry } from '@/src/parsing/scanNote';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (...a: unknown[]) => mockPush(...a) } }));

function entry(overrides: Partial<ScannedEntry>): ScannedEntry {
  return {
    id: 'e1', exerciseId: null, equipment: null, weightKg: 60, reps: 8, sets: 3,
    rawText: 'Bench Press 60kg 8x3', parsedBy: 'LLM', order: 0, synced: 0,
    spanStart: 0, spanEnd: 20, status: 'needs-confirm', exerciseName: 'Bench Press',
    unresolvedToken: 'BP', groupId: 'g1', ...overrides,
  };
}

describe('EntryPopover', () => {
  it('shows a Confirm action for a needs-confirm entry (no clarifying question) and fires it', async () => {
    const onConfirm = jest.fn();
    const e = entry({});
    await render(<EntryPopover entries={[e]} onConfirm={onConfirm} onClose={jest.fn()} />);

    expect(screen.getByText('Bench Press')).toBeTruthy();
    expect(screen.getByText(/60kg/)).toBeTruthy();
    await fireEvent.press(screen.getByText('Confirm exercise'));
    expect(onConfirm).toHaveBeenCalledWith([e], undefined);
  });

  it('hides Confirm for a resolved group and fires Close', async () => {
    const onClose = jest.fn();
    await render(
      <EntryPopover entries={[entry({ status: 'resolved', exerciseId: 'ex-1' })]} onConfirm={jest.fn()} onClose={onClose} />,
    );
    expect(screen.queryByText('Confirm exercise')).toBeNull();
    await fireEvent.press(screen.getByText('Close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('renders one row per entry in the group, under a single shared title', async () => {
    const entries = [
      entry({ id: 'e1', weightKg: 40, reps: 8, sets: 1, status: 'resolved', exerciseId: 'ex-1' }),
      entry({ id: 'e2', weightKg: 50, reps: 8, sets: 4, status: 'resolved', exerciseId: 'ex-1' }),
      entry({ id: 'e3', weightKg: 40, reps: 8, sets: 3, status: 'resolved', exerciseId: 'ex-1' }),
    ];
    await render(<EntryPopover entries={entries} onConfirm={jest.fn()} onClose={jest.fn()} />);

    expect(screen.getAllByText('Bench Press')).toHaveLength(1); // shared title, not repeated per row
    expect(screen.getByText(/40kg.*8×1/)).toBeTruthy();
    expect(screen.getByText(/50kg.*8×4/)).toBeTruthy();
    expect(screen.getByText(/40kg.*8×3/)).toBeTruthy();
  });

  it('shows the clarifying question with 2 alternatives + free text, and confirms with the chosen alternative', async () => {
    const onConfirm = jest.fn();
    const e = entry({
      clarifyingQuestion: {
        token: 'As',
        question: 'What does "As" mean?',
        alternatives: ['Assisted', 'As many reps as possible'],
      },
    });
    await render(<EntryPopover entries={[e]} onConfirm={onConfirm} onClose={jest.fn()} />);

    expect(screen.getByText('What does "As" mean?')).toBeTruthy();
    await fireEvent.press(screen.getByText('Assisted'));
    expect(onConfirm).toHaveBeenCalledWith([e], 'Assisted');
  });

  it('confirms with free-typed text when the user types their own answer', async () => {
    const onConfirm = jest.fn();
    const e = entry({
      clarifyingQuestion: {
        token: 'As',
        question: 'What does "As" mean?',
        alternatives: ['Assisted', 'As many reps as possible'],
      },
    });
    await render(<EntryPopover entries={[e]} onConfirm={onConfirm} onClose={jest.fn()} />);

    await fireEvent.changeText(screen.getByPlaceholderText('Or type your own…'), 'Ankle Strap');
    await fireEvent.press(screen.getByText('Save'));
    expect(onConfirm).toHaveBeenCalledWith([e], 'Ankle Strap');
  });

  it('offers "View progress" for a resolved group and navigates to the exercise', async () => {
    const onClose = jest.fn();
    await render(
      <EntryPopover entries={[entry({ status: 'resolved', exerciseId: 'ex-1' })]} onConfirm={jest.fn()} onClose={onClose} />,
    );
    await fireEvent.press(screen.getByText('View progress ›'));
    expect(onClose).toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/exercise/[id]', params: { id: 'ex-1' } });
  });

  it('does not offer "View progress" for an unconfirmed group', async () => {
    await render(<EntryPopover entries={[entry({ status: 'needs-confirm' })]} onConfirm={jest.fn()} onClose={jest.fn()} />);
    expect(screen.queryByText('View progress ›')).toBeNull();
  });
});
