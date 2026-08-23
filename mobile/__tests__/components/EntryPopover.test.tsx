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
    muscles: ['CHEST', 'ARMS'], unresolvedToken: 'BP', groupId: 'g1', ...overrides,
  };
}

describe('EntryPopover', () => {
  it('shows what was written, the guess, and saves it with one tap (no clarifying question)', async () => {
    const onConfirm = jest.fn();
    const e = entry({});
    await render(<EntryPopover entries={[e]} rawLine="BP 60kg 8x3" onConfirm={onConfirm} onClose={jest.fn()} />);

    expect(screen.getByText('You wrote: BP 60kg 8x3')).toBeTruthy();
    expect(screen.getByText('We read this as Bench Press')).toBeTruthy();
    expect(screen.getByText('CHEST · ARMS')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Save as Bench Press' }));
    expect(onConfirm).toHaveBeenCalledWith([e], undefined, undefined);
  });

  it('saves an edited name through overrideName', async () => {
    const onConfirm = jest.fn();
    const e = entry({});
    await render(<EntryPopover entries={[e]} onConfirm={onConfirm} onClose={jest.fn()} />);

    const nameInput = screen.getByLabelText('Exercise name');
    expect(nameInput.props.value).toBe('Bench Press');
    await fireEvent.changeText(nameInput, 'Incline Bench Press');
    await fireEvent.press(screen.getByRole('button', { name: 'Save as Incline Bench Press' }));
    expect(onConfirm).toHaveBeenCalledWith([e], undefined, 'Incline Bench Press');
  });

  it('disables Save while the name is empty', async () => {
    const onConfirm = jest.fn();
    await render(<EntryPopover entries={[entry({})]} onConfirm={onConfirm} onClose={jest.fn()} />);

    await fireEvent.changeText(screen.getByLabelText('Exercise name'), '   ');
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    await fireEvent.press(save);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('closes when the scrim is tapped and when Close is pressed', async () => {
    const onClose = jest.fn();
    await render(<EntryPopover entries={[entry({})]} onConfirm={jest.fn()} onClose={onClose} />);
    await fireEvent.press(screen.getByLabelText('Dismiss'));
    expect(onClose).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('hides Save for a resolved group and lists its sets', async () => {
    const onClose = jest.fn();
    const entries = [
      entry({ id: 'e1', weightKg: 40, reps: 8, sets: 1, status: 'resolved', exerciseId: 'ex-1' }),
      entry({ id: 'e2', weightKg: 50, reps: 8, sets: 4, status: 'resolved', exerciseId: 'ex-1' }),
      entry({ id: 'e3', weightKg: null, reps: 10, sets: 3, status: 'resolved', exerciseId: 'ex-1' }),
    ];
    await render(<EntryPopover entries={entries} onConfirm={jest.fn()} onClose={onClose} />);

    expect(screen.getAllByText('Bench Press')).toHaveLength(1); // shared title, not repeated per row
    expect(screen.queryByRole('button', { name: /^Save/ })).toBeNull();
    expect(screen.queryByLabelText('Exercise name')).toBeNull();
    expect(screen.getByText('40 kg · 8 reps × 1 set')).toBeTruthy();
    expect(screen.getByText('50 kg · 8 reps × 4 sets')).toBeTruthy();
    expect(screen.getByText('10 reps × 3 sets')).toBeTruthy();
    await fireEvent.press(screen.getByText('Close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('shows the clarifying question with alternatives + free text, and confirms with the chosen alternative', async () => {
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
    const alt = screen.getByRole('button', { name: 'Assisted' });
    expect(alt.props.accessibilityHint).toBe('Saves the exercise with this answer');
    await fireEvent.press(alt);
    expect(onConfirm).toHaveBeenCalledWith([e], 'Assisted', undefined);
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
    await fireEvent.press(screen.getByRole('button', { name: 'Save as Bench Press' }));
    expect(onConfirm).toHaveBeenCalledWith([e], 'Ankle Strap', undefined);
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
