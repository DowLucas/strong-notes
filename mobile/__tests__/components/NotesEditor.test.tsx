import { render, screen, fireEvent, act } from '@testing-library/react-native';
import { Keyboard } from 'react-native';
import { NotesEditor, type HighlightSpan } from '@/src/components/NotesEditor';

describe('NotesEditor', () => {
  const value = 'Warmup, then RDL 40kg 8x3';
  const spans: HighlightSpan[] = [
    { start: 8, end: 25, status: 'resolved', entryId: 'e1' }, // "then RDL 40kg 8x3"
  ];

  it('moves the caret onto the exercise line when a resolved span is tapped', async () => {
    const onSpanPress = jest.fn();
    await render(
      <NotesEditor value={value} onChangeText={jest.fn()} spans={spans} onSpanPress={onSpanPress} placeholder="Start typing…" />,
    );

    const span = screen.getByText('then RDL 40kg 8x3');
    await fireEvent.press(span);
    // Caret jumps to the span end; the confirm popover is not opened for a
    // resolved exercise.
    expect(screen.getByPlaceholderText('Start typing…').props.selection).toEqual({ start: 25, end: 25 });
    expect(onSpanPress).not.toHaveBeenCalled();
  });

  it('opens the confirm popover when a needs-confirm span is tapped', async () => {
    const onSpanPress = jest.fn();
    const needsConfirm: HighlightSpan[] = [{ start: 8, end: 25, status: 'needs-confirm', entryId: 'e1' }];
    await render(
      <NotesEditor value={value} onChangeText={jest.fn()} spans={needsConfirm} onSpanPress={onSpanPress} placeholder="Start typing…" />,
    );

    await fireEvent.press(screen.getByText('then RDL 40kg 8x3'));
    expect(onSpanPress).toHaveBeenCalledWith('e1');
  });

  it('registers a tap slightly outside the rendered glyphs, via the measured enlarged hit target', async () => {
    const onSpanPress = jest.fn();
    await render(
      <NotesEditor value={value} onChangeText={jest.fn()} spans={spans} onSpanPress={onSpanPress} placeholder="Start typing…" />,
    );

    const span = screen.getByText('then RDL 40kg 8x3');
    // Report the span's measured layout, as RN would after it renders —
    // this is what makes the enlarged Pressable appear.
    await act(async () => {
      fireEvent(span, 'layout', { nativeEvent: { layout: { x: 40, y: 20, width: 100, height: 20 } } });
    });

    // A real hit-target Pressable should now exist beyond the exact glyph
    // bounds, enlarged by the hit-padding around the measured layout.
    const hitTarget = screen.getByTestId('span-hit-target-e1');
    expect(hitTarget.props.style).toMatchObject({ left: 40 - 8, top: 20 - 8, width: 100 + 16, height: 20 + 16 });
    await fireEvent.press(hitTarget);
    expect(screen.getByPlaceholderText('Start typing…').props.selection).toEqual({ start: 25, end: 25 });
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
