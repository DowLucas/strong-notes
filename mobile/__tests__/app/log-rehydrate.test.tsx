// __tests__/app/log-rehydrate.test.tsx
import { render, screen, waitFor } from '@testing-library/react-native';
import LogScreen from '../../app/(tabs)/index';
import { useAuth } from '@/lib/auth';
import { resetDbForTests } from '@/src/db/client';
import { upsertLocalSession } from '@/src/db/sessionsRepo';

jest.mock('@/lib/auth');

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

beforeEach(() => {
  resetDbForTests();
  (useAuth as jest.Mock).mockReturnValue({
    api: {
      resolveLine: jest.fn().mockResolvedValue({
        resolvedTokens: [{ token: 'RDL', type: 'exercise', exerciseId: 'ex-1' }],
        unresolvedTokens: [],
      }),
    },
  });
});

describe('LogScreen rehydration', () => {
  it('shows the already-saved note text for today on mount', async () => {
    await upsertLocalSession({
      date: todayDate(),
      notes: 'did RDL 40kg 8x3',
      synced: 1,
      entries: [],
    });

    await render(<LogScreen />);

    await waitFor(
      () => {
        expect(screen.getByDisplayValue('did RDL 40kg 8x3')).toBeTruthy();
      },
      { timeout: 3000 },
    );
  });
});
