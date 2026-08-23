import '@/lib/i18n';
import { render, screen, fireEvent, act } from '@testing-library/react-native';
import { Keyboard } from 'react-native';
import { NotesEditor, type HighlightSpan } from '@/src/components/NotesEditor';
import { colors } from '@/lib/theme';

describe('NotesEditor', () => {
  const value = 'Warmup, then RDL 40kg 8x3';
  const spans: HighlightSpan[] = [
    { start: 8, end: 25, status: 'resolved', entryId: 'e1' }, // "then RDL 40kg 8x3"
  ];

  it('highlights are touch-inert so the native TextInput handles tap/long-press cursor placement', async () => {
    const onSpanPress = jest.fn();
    await render(
      <NotesEditor value={value} onChangeText={jest.fn()} spans={spans} onSpanPress={onSpanPress} placeholder="Start typing…" />,
    );
    const span = screen.getByText('then RDL 40kg 8x3');
    expect(span.props.onPress).toBeUndefined();
    expect(span.props.onLongPress).toBeUndefined();
    // No enlarged hit targets are laid over the text any more.
    await act(async () => {
      fireEvent(span, 'layout', { nativeEvent: { layout: { x: 40, y: 20, width: 170, height: 20 } } });
    });
    expect(screen.queryByTestId('span-hit-target-e1')).toBeNull();
    expect(onSpanPress).not.toHaveBeenCalled();
  });

  it('offers a details button in the keyboard bar for a resolved exercise on the caret line', async () => {
    const onSpanPress = jest.fn();
    await render(
      <NotesEditor
        value={value}
        onChangeText={jest.fn()}
        spans={[{ ...spans[0], exerciseName: 'Romanian Deadlift' }]}
        onSpanPress={onSpanPress}
        placeholder="Start typing…"
      />,
    );
    await fireEvent.press(screen.getByLabelText('Romanian Deadlift details'));
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

  it('labels highlighted spans for screen readers and tints needs-confirm spans amber', async () => {
    await render(
      <NotesEditor
        value="RDL 40kg 8x3 then squats 60kg 8x3"
        onChangeText={jest.fn()}
        spans={[
          { start: 0, end: 12, status: 'resolved', entryId: 'e1' },
          { start: 18, end: 33, status: 'needs-confirm', entryId: 'e2' },
        ]}
        onSpanPress={jest.fn()}
      />,
    );
    const confirmed = screen.getByText('RDL 40kg 8x3');
    expect(confirmed.props.accessibilityLabel).toBe('RDL 40kg 8x3, confirmed');
    expect(confirmed).toHaveStyle({ backgroundColor: colors.mossPale });
    const pending = screen.getByText('squats 60kg 8x3');
    expect(pending.props.accessibilityLabel).toBe('squats 60kg 8x3, needs confirmation');
    expect(pending).toHaveStyle({ backgroundColor: colors.citrinePale });
  });

  it('shows a dismissible example + legend while the note is empty, and inserts the example on request', async () => {
    const onChangeText = jest.fn();
    await render(<NotesEditor value="" onChangeText={onChangeText} spans={[]} onSpanPress={jest.fn()} />);
    expect(screen.getByText('BB RDL 40kgx8 50kgx8x4')).toBeTruthy();
    expect(screen.getByText('Needs your OK')).toBeTruthy();
    expect(screen.getByText('Confirmed')).toBeTruthy();
    expect(screen.getByText("Confirmed · you've done this before")).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Use this example' }));
    expect(onChangeText).toHaveBeenCalledWith('BB RDL 40kgx8 50kgx8x4\nBench 60kg 8x3\n  ⁃ 65kg 6x2');
  });

  it('hides the example once there is text', async () => {
    await render(<NotesEditor value="x" onChangeText={jest.fn()} spans={[]} onSpanPress={jest.fn()} />);
    expect(screen.queryByText('Use this example')).toBeNull();
  });

  it('hides the example when dismissed', async () => {
    await render(<NotesEditor value="" onChangeText={jest.fn()} spans={[]} onSpanPress={jest.fn()} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Hide example' }));
    expect(screen.queryByText('Use this example')).toBeNull();
  });

  it('orders the grammar chips kg · × · ⁃ same exercise · bar', async () => {
    await render(<NotesEditor value="" onChangeText={jest.fn()} spans={[]} onSpanPress={jest.fn()} />);
    const labels = screen.getAllByRole('button').map((b) => b.props.accessibilityLabel);
    const grammar = labels.filter((l) =>
      ['Insert kilograms', 'Insert times sign', 'New line for the same exercise', 'Insert bar load'].includes(l),
    );
    expect(grammar).toEqual(['Insert kilograms', 'Insert times sign', 'New line for the same exercise', 'Insert bar load']);
  });

  it('provides a keyboard-dismiss button (labelled Done) that dismisses the keyboard', async () => {
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
    const done = screen.getByLabelText('Done');
    expect(done.props.accessibilityHint).toBe('Hides the keyboard');
    await fireEvent.press(done);
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
