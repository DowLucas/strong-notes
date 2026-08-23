// __tests__/app/log-offline.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import LogScreen from '../../app/(tabs)/index';
import { useAuth } from '@/lib/auth';
import { resetDbForTests } from '@/src/db/client';
import { getLocalSession } from '@/src/db/sessionsRepo';

jest.mock('@/lib/auth');

function todayDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

beforeEach(() => {
  resetDbForTests();
});

describe('LogScreen offline-first behavior', () => {
  it('saves the raw note text even when the background parse rejects', async () => {
    const resolveLine = jest.fn().mockRejectedValue(new Error('offline'));
    (useAuth as jest.Mock).mockReturnValue({ api: { resolveLine } });

    await render(<LogScreen />);
    const input = screen.getByPlaceholderText('e.g. Bench 60kg 8x3');
    await fireEvent.changeText(input, 'did RDL 40kg 8x3');

    await waitFor(
      async () => {
        const session = await getLocalSession(todayDate());
        expect(session?.notes).toBe('did RDL 40kg 8x3');
      },
      { timeout: 3000 },
    );
    // The editable text is still present on screen (not dropped by the failed scan).
    expect(screen.getByDisplayValue('did RDL 40kg 8x3')).toBeTruthy();
  });
});
