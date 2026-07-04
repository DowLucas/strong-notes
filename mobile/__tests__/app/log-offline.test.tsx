import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import LogScreen from '../../app/(tabs)/index';
import { useAuth } from '@/lib/auth';
import { resetDbForTests } from '@/src/db/client';
import { getLocalSession } from '@/src/db/sessionsRepo';

jest.mock('@/lib/auth');

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

beforeEach(() => {
  resetDbForTests();
});

describe('LogScreen offline-first behavior', () => {
  it('keeps the raw entry saved and visible when the background parse rejects (offline/network failure)', async () => {
    const resolveLine = jest.fn().mockRejectedValue(new Error('offline'));
    (useAuth as jest.Mock).mockReturnValue({ api: { resolveLine } });

    await render(<LogScreen />);
    const input = screen.getByPlaceholderText('Log a set...');
    await fireEvent.changeText(input, 'BB RDL 40kg 8x3');
    await fireEvent(input, 'submitEditing');

    await waitFor(async () => {
      expect(screen.getByText('BB RDL 40kg 8x3')).toBeTruthy();
      const session = await getLocalSession(todayDate());
      expect(session?.entries).toHaveLength(1);
    });
  });
});
