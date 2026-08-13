import { render, screen, fireEvent } from '@testing-library/react-native';
import { NotesEditor, type HighlightSpan } from '@/src/components/NotesEditor';
import type { ExerciseHistory } from '@/lib/priorHistory';

const span: HighlightSpan = {
  start: 0,
  end: 3,
  status: 'resolved',
  entryId: 'e1',
  exerciseId: 'ex-rdl',
};
const sessions: Record<string, ExerciseHistory[]> = {
  'ex-rdl': [{ date: '2026-03-05', entries: [{ weightKg: 40, reps: 8, sets: 1 }] }],
};

async function renderEditor(props: Partial<React.ComponentProps<typeof NotesEditor>> = {}) {
  const onChangeText = jest.fn();
  await render(
    <NotesEditor
      value="rdl"
      onChangeText={onChangeText}
      spans={[span]}
      onSpanPress={() => {}}
      priorSessionsByExercise={sessions}
      {...props}
    />,
  );
  return { onChangeText };
}

describe('NotesEditor Progression hint', () => {
  it('tints the span blue when its exercise has prior history', async () => {
    await renderEditor();
    expect(screen.getByText('rdl')).toHaveStyle({ backgroundColor: '#DCE8FA' });
  });

  it('renders the strip (history + eyebrow) positioned without onLayout', async () => {
    await renderEditor();
    expect(screen.getByText('PROGRESSION')).toBeTruthy();
    expect(screen.getByText(/Last · 40kg×8/)).toBeTruthy();
  });

  it('inserts a recommended set onto the line when a target is tapped', async () => {
    const { onChangeText } = await renderEditor();
    // reps 8 → progression leads: "+2.5kg" → 42.5kg×8
    await fireEvent.press(screen.getByLabelText('+2.5kg, 42.5kg×8'));
    expect(onChangeText).toHaveBeenCalledWith('rdl 42.5kgx8');
  });

  it('does NOT tint the span when there is no history for its exercise', async () => {
    await renderEditor({ priorSessionsByExercise: {} });
    expect(screen.getByText('rdl')).not.toHaveStyle({ backgroundColor: '#DCE8FA' });
  });
});
