// __tests__/app/log.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import LogScreen from '../../app/(tabs)/index';
import { useAuth } from '@/lib/auth';
import { resetDbForTests } from '@/src/db/client';
import { getLocalSession } from '@/src/db/sessionsRepo';

jest.mock('@/lib/auth');

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

const mockResolveLine = jest.fn();

beforeEach(() => {
  resetDbForTests();
  mockResolveLine.mockReset().mockResolvedValue({
    resolvedTokens: [{ token: 'RDL', type: 'exercise', exerciseId: 'ex-1' }],
    unresolvedTokens: [],
  });
  (useAuth as jest.Mock).mockReturnValue({ api: { resolveLine: mockResolveLine } });
});

describe('LogScreen (notes-style)', () => {
  it('highlights a recognized set after the debounced scan and persists it', async () => {
    await render(<LogScreen />);
    const input = screen.getByPlaceholderText('Start typing your workout…');

    await fireEvent.changeText(input, 'Warmup, then RDL 40kg 8x3');

    await waitFor(
      () => {
        expect(screen.getByText('40kg 8x3')).toBeTruthy();
      },
      { timeout: 3000 },
    );

    const session = await getLocalSession(todayDate());
    expect(session?.notes).toBe('Warmup, then RDL 40kg 8x3');
    expect(session?.entries).toHaveLength(1);
    expect(session?.entries[0].exerciseId).toBe('ex-1');
  });
});
