import '@/lib/i18n';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import StatsScreen from '../../app/(tabs)/stats';
import { resetDbForTests } from '@/src/db/client';
import { upsertLocalSession } from '@/src/db/sessionsRepo';
import { cacheAbbreviations } from '@/src/db/abbreviationsRepo';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...a: unknown[]) => mockPush(...a), back: jest.fn() },
}));

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
function daysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}
const entry = (id: string, weightKg: number) => ({
  id, exerciseId: 'ex-dl', equipment: null, weightKg, reps: 5, sets: 3, rawText: 'x', parsedBy: 'DICTIONARY' as const, order: 0, synced: 0 as const,
});

beforeEach(async () => {
  resetDbForTests();
  mockPush.mockClear();
  await cacheAbbreviations([{ id: '1', token: 'DL', exerciseId: 'ex-dl', exerciseName: 'Barbell Deadlift', source: 'USER_ADDED', createdAt: '' }]);
});

describe('StatsScreen', () => {
  it('shows the empty state when nothing is logged', async () => {
    await render(<StatsScreen />);
    await waitFor(() => expect(screen.getByText('No progress yet')).toBeTruthy());
  });

  it('lists exercises with headline and delta, and navigates on tap', async () => {
    await upsertLocalSession({ date: daysAgo(20), notes: null, synced: 0, entries: [entry('a', 90)] });
    await upsertLocalSession({ date: todayIso(), notes: null, synced: 0, entries: [entry('b', 100)] });

    await render(<StatsScreen />);
    await waitFor(() => expect(screen.getByText('Barbell Deadlift')).toBeTruthy());
    expect(screen.getByText('100kg')).toBeTruthy();
    expect(screen.getByText('▲ +10')).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: /Barbell Deadlift/ }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/exercise/[id]', params: { id: 'ex-dl' } });
  });

  it('changing the range reloads the list', async () => {
    await upsertLocalSession({ date: daysAgo(200), notes: null, synced: 0, entries: [entry('a', 90)] });

    await render(<StatsScreen />);
    await waitFor(() => expect(screen.getByText('No progress yet')).toBeTruthy()); // outside 3m
    await fireEvent.press(screen.getByRole('button', { name: 'All' }));
    await waitFor(() => expect(screen.getByText('Barbell Deadlift')).toBeTruthy());
  });
});
