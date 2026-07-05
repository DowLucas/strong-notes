import { render, screen, fireEvent, act } from '@testing-library/react-native';
import { Keyboard } from 'react-native';
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

  it('does not let the highlighted-span overlay swallow taps meant for plain text', async () => {
    await render(
      <NotesEditor value={value} onChangeText={jest.fn()} spans={spans} onSpanPress={jest.fn()} placeholder="Start typing…" />,
    );

    // The overlay's own wrapping Text must be pointerEvents="none" so a tap on
    // a plain (non-highlighted) run of text falls through to the TextInput
    // underneath for cursor placement, rather than the whole multi-line block
    // being captured just because ONE nested span has onPress (a known RN
    // gotcha: a parent Text with any pressable child can capture touches over
    // its entire bounding box).
    const plainSegment = screen.getByText('Warmup,');
    expect(plainSegment.props.pointerEvents).toBe('none');

    const highlighted = screen.getByText('then RDL 40kg 8x3');
    expect(highlighted.props.pointerEvents).toBe('auto');
  });

  it('provides a circular Done checkmark button that dismisses the keyboard', async () => {
    const dismissSpy = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => {});
    const listeners: Record<string, () => void> = {};
    jest.spyOn(Keyboard, 'addListener').mockImplementation(((event: string, cb: () => void) => {
      listeners[event] = cb;
      return { remove: jest.fn() };
    }) as unknown as typeof Keyboard.addListener);

    await render(
      <NotesEditor value={value} onChangeText={jest.fn()} spans={[]} onSpanPress={jest.fn()} placeholder="Start typing…" />,
    );

    // Simulate the keyboard opening — only then should Done appear.
    await act(async () => listeners['keyboardDidShow']?.());
    await fireEvent.press(screen.getByLabelText('Done'));
    expect(dismissSpy).toHaveBeenCalled();

    dismissSpy.mockRestore();
    jest.restoreAllMocks();
  });

  it('hides the Done button until the keyboard is shown, and hides it again once dismissed', async () => {
    const listeners: Record<string, () => void> = {};
    jest.spyOn(Keyboard, 'addListener').mockImplementation(((event: string, cb: () => void) => {
      listeners[event] = cb;
      return { remove: jest.fn() };
    }) as unknown as typeof Keyboard.addListener);

    await render(
      <NotesEditor value={value} onChangeText={jest.fn()} spans={[]} onSpanPress={jest.fn()} placeholder="Start typing…" />,
    );

    expect(screen.queryByLabelText('Done')).toBeNull();

    await act(async () => listeners['keyboardDidShow']?.());
    expect(screen.getByLabelText('Done')).toBeTruthy();

    await act(async () => listeners['keyboardDidHide']?.());
    expect(screen.queryByLabelText('Done')).toBeNull();

    jest.restoreAllMocks();
  });
});
