import '@/lib/i18n';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { ConfirmBar, type PendingGroup } from '@/src/components/ConfirmBar';

const pending: PendingGroup[] = [
  { groupId: 'g1', label: 'Barbell Squat', needsAnswer: false },
  { groupId: 'g2', label: 'Dip', needsAnswer: true },
];

async function setup(overrides: Partial<React.ComponentProps<typeof ConfirmBar>> = {}) {
  const props = {
    pending,
    progress: null,
    collapsed: false,
    onConfirmAll: jest.fn(),
    onOpenGroup: jest.fn(),
    onDismiss: jest.fn(),
    onExpand: jest.fn(),
    ...overrides,
  };
  await render(<ConfirmBar {...props} />);
  return props;
}

describe('ConfirmBar', () => {
  it('lists each pending exercise as a tappable chip that opens its group', async () => {
    const { onOpenGroup } = await setup();
    expect(screen.getByText('2 exercises to confirm')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Barbell Squat' }));
    expect(onOpenGroup).toHaveBeenCalledWith('g1');
    await fireEvent.press(screen.getByRole('button', { name: 'Dip' }));
    expect(onOpenGroup).toHaveBeenCalledWith('g2');
  });

  it('explains that a clarifying-question group must be opened by name', async () => {
    await setup();
    expect(screen.getByText('1 needs an answer — tap its name')).toBeTruthy();
  });

  it('offers "Confirm all N" for the confirmable groups only', async () => {
    const { onConfirmAll } = await setup();
    await fireEvent.press(screen.getByRole('button', { name: 'Confirm all 1' }));
    expect(onConfirmAll).toHaveBeenCalled();
  });

  it('shows progress while a bulk confirm runs', async () => {
    await setup({ progress: { done: 1, total: 3 } });
    expect(screen.getByText('Confirming 1/3…')).toBeTruthy();
  });

  it('hides via the × (labelled "Hide") and collapses to a pill that re-expands', async () => {
    const { onDismiss } = await setup();
    await fireEvent.press(screen.getByRole('button', { name: 'Hide' }));
    expect(onDismiss).toHaveBeenCalled();
  });

  it('renders the collapsed pill "N to confirm ›" and expands on tap', async () => {
    const { onExpand } = await setup({ collapsed: true });
    expect(screen.queryByText('2 exercises to confirm')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: '2 to confirm' }));
    expect(onExpand).toHaveBeenCalled();
  });
});
