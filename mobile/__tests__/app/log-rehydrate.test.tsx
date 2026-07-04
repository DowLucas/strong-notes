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
  (useAuth as jest.Mock).mockReturnValue({ api: { resolveLine: jest.fn() } });
});

describe('LogScreen rehydration', () => {
  it('shows already-logged entries for today on mount, not a blank list', async () => {
    await upsertLocalSession({
      date: todayDate(),
      notes: null,
      synced: 1,
      entries: [
        { id: 'existing-1', exerciseId: 'ex-1', equipment: 'barbell', weightKg: 40, reps: 8, sets: 3, rawText: 'BB RDL 40kg 8x3', parsedBy: 'DICTIONARY', order: 0, synced: 1 },
      ],
    });

    await render(<LogScreen />);

    await waitFor(() => {
      expect(screen.getByText('BB RDL 40kg 8x3')).toBeTruthy();
    });
  });
});
