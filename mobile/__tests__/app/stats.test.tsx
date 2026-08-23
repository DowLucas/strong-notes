import '@/lib/i18n';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native';
import StatsScreen from '../../app/(tabs)/stats';
import { resetDbForTests } from '@/src/db/client';
import { upsertLocalSession } from '@/src/db/sessionsRepo';
import { cacheAbbreviations } from '@/src/db/abbreviationsRepo';
import * as statsRepo from '@/src/db/statsRepo';
import { createFocusEffectMock } from '../../test-shims/mockFocusEffect';

const mockPush = jest.fn();
const mockFocus = createFocusEffectMock();
jest.mock('expo-router', () => ({
  router: { push: (...a: unknown[]) => mockPush(...a), back: jest.fn() },
  useFocusEffect: (cb: () => void) => mockFocus.useFocusEffect(cb),
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
  it('shows skeleton rows while loading', async () => {
    const spy = jest.spyOn(statsRepo, 'listStatsRows').mockImplementationOnce(() => new Promise(() => {}));
    await render(<StatsScreen />);
    expect(screen.getByTestId('skeleton-rows')).toBeTruthy();
    spy.mockRestore();
  });

  it('shows the onboarding empty state when nothing is logged', async () => {
    await render(<StatsScreen />);
    await waitFor(() => expect(screen.getByText('No progress yet')).toBeTruthy());
    expect(screen.queryByTestId('skeleton-rows')).toBeNull();
  });

  it('lists exercises with headline and delta, explains the delta, and navigates on tap with the name', async () => {
    await upsertLocalSession({ date: daysAgo(20), notes: null, synced: 0, entries: [entry('a', 90)] });
    await upsertLocalSession({ date: todayIso(), notes: null, synced: 0, entries: [entry('b', 100)] });

    await render(<StatsScreen />);
    await waitFor(() => expect(screen.getByText('Barbell Deadlift')).toBeTruthy());
    expect(screen.getByText('100 kg')).toBeTruthy();
    expect(screen.getByText('▲ +10 kg')).toBeTruthy();
    expect(screen.getByText('Change vs first session in range')).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: /Barbell Deadlift/ }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/exercise/[id]', params: { id: 'ex-dl', name: 'Barbell Deadlift' } });
  });

  it('changing the range reloads the list', async () => {
    await upsertLocalSession({ date: daysAgo(200), notes: null, synced: 0, entries: [entry('a', 90)] });

    await render(<StatsScreen />);
    await waitFor(() => expect(screen.getByText('Nothing in the last 3 months')).toBeTruthy()); // outside 3m
    await fireEvent.press(screen.getByRole('tab', { name: 'All' }));
    await waitFor(() => expect(screen.getByText('Barbell Deadlift')).toBeTruthy());
  });

  it('offers "Show all time" when the range is empty but older data exists', async () => {
    await upsertLocalSession({ date: daysAgo(200), notes: null, synced: 0, entries: [entry('a', 90)] });

    await render(<StatsScreen />);
    await waitFor(() => expect(screen.getByText('Nothing in the last 3 months')).toBeTruthy());
    await fireEvent.press(screen.getByRole('button', { name: 'Show all time' }));
    await waitFor(() => expect(screen.getByText('Barbell Deadlift')).toBeTruthy());
    expect(screen.getByRole('tab', { name: 'All' }).props.accessibilityState).toEqual({ selected: true });
  });

  it('reloads when the tab regains focus', async () => {
    await render(<StatsScreen />);
    await waitFor(() => expect(screen.getByText('No progress yet')).toBeTruthy());

    await upsertLocalSession({ date: todayIso(), notes: null, synced: 0, entries: [entry('b', 100)] });
    await act(async () => { mockFocus.refocus(); });
    await waitFor(() => expect(screen.getByText('Barbell Deadlift')).toBeTruthy());
  });

  it('shows an alert with Retry when loading fails, and recovers on retry', async () => {
    const spy = jest.spyOn(statsRepo, 'listStatsRows').mockRejectedValueOnce(new Error('boom'));
    await render(<StatsScreen />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    await fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByText('No progress yet')).toBeTruthy());
    expect(screen.queryByRole('alert')).toBeNull();
    spy.mockRestore();
  });
});
