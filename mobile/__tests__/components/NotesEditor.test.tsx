import '@/lib/i18n';
import { render, screen, fireEvent, act } from '@testing-library/react-native';
import { useState } from 'react';
import { Keyboard, TextInput } from 'react-native';
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

// A stateful parent so a programmatic insert flows back in as the new `value`,
// exactly as the Log screen does.
function StatefulEditor({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);
  return <NotesEditor value={value} onChangeText={setValue} spans={[]} onSpanPress={jest.fn()} placeholder="Start typing…" />;
}

describe('NotesEditor caret placement', () => {
  afterEach(() => jest.restoreAllMocks());

  it('never controls the native selection during ordinary typing', async () => {
    await render(<StatefulEditor initial="RDL" />);
    const input = screen.getByPlaceholderText('Start typing…');
    await fireEvent(input, 'selectionChange', { nativeEvent: { selection: { start: 3, end: 3 } } });
    await fireEvent.changeText(input, 'RDL ');
    expect(input.props.selection).toBeUndefined();
  });

  it('places the caret imperatively after a chip insert instead of pinning the selection prop', async () => {
    const setSelection = jest.spyOn(TextInput.prototype, 'setSelection');
    await render(<StatefulEditor initial="RDL 40" />);
    const input = screen.getByPlaceholderText('Start typing…');
    await fireEvent(input, 'selectionChange', { nativeEvent: { selection: { start: 6, end: 6 } } });

    await fireEvent.press(screen.getByLabelText('Insert kilograms'));
    expect(input.props.value).toBe('RDL 40kg');
    // The caret is moved once, to just after the insert…
    expect(setSelection).toHaveBeenCalledTimes(1);
    expect(setSelection).toHaveBeenCalledWith(8, 8);
    // …and the `selection` prop is never set, so nothing can re-pin the caret
    // later (iOS swallows the selection event for programmatic changes, which
    // used to leave the prop stuck on the old offset).
    expect(input.props.selection).toBeUndefined();

    // Back-to-back taps read the fresh caret, not a stale render closure.
    await fireEvent.press(screen.getByLabelText('Insert times sign'));
    expect(input.props.value).toBe('RDL 40kgx');
    expect(setSelection).toHaveBeenLastCalledWith(9, 9);
  });
});

describe('NotesEditor status', () => {
  const base = { value: 'RDL 40kg 8x3', onChangeText: jest.fn(), spans: [], onSpanPress: jest.fn() };

  it('renders no status by default', async () => {
    await render(<NotesEditor {...base} />);
    expect(screen.queryByTestId('editor-status')).toBeNull();
  });

  it('floats the status over the editor so it can never reflow the page', async () => {
    await render(<NotesEditor {...base} status={{ kind: 'busy', label: 'Reading…' }} />);
    const status = screen.getByTestId('editor-status');
    // Absolutely positioned and touch-transparent: it sits above the text
    // instead of taking part in layout, so showing/hiding it moves nothing.
    expect(status).toHaveStyle({ position: 'absolute' });
    expect(status.props.pointerEvents).toBe('none');
    expect(screen.getByText('Reading…')).toBeTruthy();
  });

  it('announces the status politely to screen readers', async () => {
    await render(<NotesEditor {...base} status={{ kind: 'offline', label: 'Offline' }} />);
    expect(screen.getByTestId('editor-status').props.accessibilityLiveRegion).toBe('polite');
  });
});

describe('NotesEditor keyboard measurement', () => {
  it('re-measures the keyboard overlap when the keyboard frame changes', async () => {
    // iOS re-reports the frame when the docked accessory bar changes height
    // (the confirm island appearing/disappearing). Without this subscription
    // the editor keeps a stale overlap and mis-scrolls the caret line.
    const events: string[] = [];
    jest.spyOn(Keyboard, 'addListener').mockImplementation(((event: string) => {
      events.push(event);
      return { remove: jest.fn() };
    }) as unknown as typeof Keyboard.addListener);

    await render(
      <NotesEditor value="RDL" onChangeText={jest.fn()} spans={[]} onSpanPress={jest.fn()} />,
    );
    expect(events).toEqual(
      expect.arrayContaining(['keyboardDidShow', 'keyboardDidChangeFrame', 'keyboardDidHide']),
    );
    jest.restoreAllMocks();
  });
});

describe('NotesEditor caret safety', () => {
  afterEach(() => jest.restoreAllMocks());

  function OverridingParent() {
    const [value, setValue] = useState('RDL 40');
    // Commits something other than what the editor asked for, the way a
    // reload (loadToday / the error strip's Retry) does.
    return (
      <NotesEditor value={value} onChangeText={() => setValue('ab')} spans={[]} onSpanPress={jest.fn()} placeholder="Start typing…" />
    );
  }

  it('does not place the caret when the parent commits different text', async () => {
    const setSelection = jest.spyOn(TextInput.prototype, 'setSelection');
    await render(<OverridingParent />);
    const input = screen.getByPlaceholderText('Start typing…');
    await fireEvent(input, 'selectionChange', { nativeEvent: { selection: { start: 6, end: 6 } } });

    await fireEvent.press(screen.getByLabelText('Insert kilograms'));
    // The editor asked for caret 8 of 'RDL 40kg', but 'ab' was committed.
    // Placing 8 in a 2-character field is out of bounds and throws on Android.
    expect(input.props.value).toBe('ab');
    expect(setSelection).not.toHaveBeenCalled();
  });

  it('re-measures the keyboard overlap when the editor itself is resized', async () => {
    // The ConfirmBar mounting below the editor shrinks it while the keyboard
    // is up, so the overlap measured on keyboardDidShow goes stale.
    await render(
      <NotesEditor value="RDL" onChangeText={jest.fn()} spans={[]} onSpanPress={jest.fn()} />,
    );
    const root = screen.getByTestId('editor-root');
    expect(typeof root.props.onLayout).toBe('function');
  });
});
