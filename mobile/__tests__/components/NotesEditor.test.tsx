import { render, screen, fireEvent, act } from '@testing-library/react-native';
import { Keyboard } from 'react-native';
import { NotesEditor, type HighlightSpan } from '@/src/components/NotesEditor';

describe('NotesEditor', () => {
  const value = 'Warmup, then RDL 40kg 8x3';
  const spans: HighlightSpan[] = [
    { start: 8, end: 25, status: 'resolved', entryId: 'e1' }, // "then RDL 40kg 8x3"
  ];

  it('tap on a resolved span places the caret (no popover); long-press opens the details popover', async () => {
    const onSpanPress = jest.fn();
    await render(
      <NotesEditor value={value} onChangeText={jest.fn()} spans={spans} onSpanPress={onSpanPress} placeholder="Start typing…" />,
    );

    const span = screen.getByText('then RDL 40kg 8x3');
    await fireEvent.press(span);
    // Without a measured rect we can't map the tap to an offset, so the
    // caret goes to the span end — and the popover does NOT open.
    expect(screen.getByPlaceholderText('Start typing…').props.selection).toEqual({ start: 25, end: 25 });
    expect(onSpanPress).not.toHaveBeenCalled();

    await fireEvent(span, 'longPress');
    expect(onSpanPress).toHaveBeenCalledWith('e1');
  });

  it('tap on a needs-confirm span also just places the caret; long-press opens the confirm popover', async () => {
    const onSpanPress = jest.fn();
    const needsConfirm: HighlightSpan[] = [{ start: 8, end: 25, status: 'needs-confirm', entryId: 'e1' }];
    await render(
      <NotesEditor value={value} onChangeText={jest.fn()} spans={needsConfirm} onSpanPress={onSpanPress} placeholder="Start typing…" />,
    );

    await fireEvent.press(screen.getByText('then RDL 40kg 8x3'));
    expect(onSpanPress).not.toHaveBeenCalled();
    await fireEvent(screen.getByText('then RDL 40kg 8x3'), 'longPress');
    expect(onSpanPress).toHaveBeenCalledWith('e1');
  });

  it('maps a tap on the measured hit target to the character under the finger', async () => {
    const onSpanPress = jest.fn();
    await render(
      <NotesEditor value={value} onChangeText={jest.fn()} spans={spans} onSpanPress={onSpanPress} placeholder="Start typing…" />,
    );

    const span = screen.getByText('then RDL 40kg 8x3');
    // Report the span's measured layout, as RN would after it renders —
    // this is what makes the enlarged Pressable appear.
    await act(async () => {
      fireEvent(span, 'layout', { nativeEvent: { layout: { x: 40, y: 20, width: 170, height: 20 } } });
    });

    const hitTarget = screen.getByTestId('span-hit-target-e1');
    expect(hitTarget.props.style).toMatchObject({ left: 40 - 8, top: 20 - 8, width: 170 + 16, height: 20 + 16 });
    // Span is 17 chars over 170px → 10px per char. A tap 8px (padding) + 50px
    // in lands on offset 5 → caret at 8 + 5 = 13 ("then |RDL").
    await fireEvent.press(hitTarget, { nativeEvent: { locationX: 8 + 50, locationY: 10 } });
    expect(screen.getByPlaceholderText('Start typing…').props.selection).toEqual({ start: 13, end: 13 });
    expect(onSpanPress).not.toHaveBeenCalled();

    await fireEvent(hitTarget, 'longPress');
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
