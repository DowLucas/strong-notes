import { render, fireEvent, screen } from '@testing-library/react-native';
import { KeyboardAccessoryBar, type GrammarChip } from '@/src/components/KeyboardAccessoryBar';

const grammar: GrammarChip[] = [{ label: '×', insert: 'x', a11yLabel: 'Insert times sign' }];

async function setup(overrides: Partial<React.ComponentProps<typeof KeyboardAccessoryBar>> = {}) {
  const onInsert = jest.fn();
  const onComplete = jest.fn();
  const onConfirm = jest.fn();
  await render(
    <KeyboardAccessoryBar
      suggestions={[]}
      onComplete={onComplete}
      grammar={grammar}
      onInsert={onInsert}
      onConfirm={onConfirm}
      {...overrides}
    />,
  );
  return { onInsert, onComplete, onConfirm };
}

describe('KeyboardAccessoryBar', () => {
  it('renders the persistent number row and inserts a tapped digit', async () => {
    const { onInsert } = await setup();
    // A representative digit and the decimal point are present.
    await fireEvent.press(screen.getByLabelText('7'));
    await fireEvent.press(screen.getByLabelText('.'));
    expect(onInsert).toHaveBeenNthCalledWith(1, '7');
    expect(onInsert).toHaveBeenNthCalledWith(2, '.');
  });

  it('inserts a grammar token when its chip is pressed', async () => {
    const { onInsert } = await setup();
    await fireEvent.press(screen.getByLabelText('Insert times sign'));
    expect(onInsert).toHaveBeenCalledWith('x');
  });

  it('completes a suggestion when tapped', async () => {
    const { onComplete } = await setup({ suggestions: ['RDL'] });
    await fireEvent.press(screen.getByLabelText('Insert RDL'));
    expect(onComplete).toHaveBeenCalledWith('RDL');
  });

  it('shows the confirm chip only when a confirmLabel is given', async () => {
    await setup({ confirmLabel: 'Squats' });
    expect(screen.getByLabelText('Confirm Squats')).toBeTruthy();
  });

  it('hides the confirm chip when confirmLabel is null', async () => {
    await setup({ confirmLabel: null });
    expect(screen.queryByLabelText(/^Confirm /)).toBeNull();
  });
});
