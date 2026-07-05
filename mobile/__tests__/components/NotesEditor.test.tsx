import { render, screen, fireEvent } from '@testing-library/react-native';
import { NotesEditor, type HighlightSpan } from '@/src/components/NotesEditor';

describe('NotesEditor', () => {
  const value = 'Warmup, then RDL 40kg 8x3';
  const spans: HighlightSpan[] = [
    { start: 8, end: 25, status: 'resolved', entryId: 'e1' }, // "then RDL 40kg 8x3"
  ];

  it('renders the highlighted span as its own tappable node', async () => {
    const onSpanPress = jest.fn();
    await render(
      <NotesEditor value={value} onChangeText={jest.fn()} spans={spans} onSpanPress={onSpanPress} placeholder="Start typing…" />,
    );

    const span = screen.getByText('then RDL 40kg 8x3');
    await fireEvent.press(span);
    expect(onSpanPress).toHaveBeenCalledWith('e1');
  });

  it('exposes the editable text and reports changes', async () => {
    const onChangeText = jest.fn();
    await render(
      <NotesEditor value={value} onChangeText={onChangeText} spans={[]} onSpanPress={jest.fn()} placeholder="Start typing…" />,
    );

    const input = screen.getByPlaceholderText('Start typing…');
    await fireEvent.changeText(input, 'new text');
    expect(onChangeText).toHaveBeenCalledWith('new text');
  });
});
