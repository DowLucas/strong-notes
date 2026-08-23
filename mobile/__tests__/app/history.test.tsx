import '@/lib/i18n';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native';
import HistoryScreen from '../../app/(tabs)/history';
import { resetDbForTests } from '@/src/db/client';
import { upsertLocalSession } from '@/src/db/sessionsRepo';
import { cacheAbbreviations } from '@/src/db/abbreviationsRepo';
import * as sessionsRepo from '@/src/db/sessionsRepo';
import { createFocusEffectMock } from '../../test-shims/mockFocusEffect';

const mockPush = jest.fn();
const mockFocus = createFocusEffectMock();
jest.mock('expo-router', () => ({
  router: { push: (...a: unknown[]) => mockPush(...a) },
  useFocusEffect: (cb: () => void) => mockFocus.useFocusEffect(cb),
}));

const year = new Date().toISOString().slice(0, 4);
// 1 July of the current year; weekday label computed so the test holds every year.
const julyFirst = `${year}-07-01`;
const julyFirstLabel = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(`${julyFirst}T00:00:00Z`).getUTCDay()] + ' 1 Jul';

beforeEach(async () => {
  resetDbForTests();
  mockPush.mockClear();
  await cacheAbbreviations([{ id: '1', token: 'DL', exerciseId: 'ex-dl', exerciseName: 'Barbell Deadlift', source: 'USER_ADDED', createdAt: '' }]);
  await upsertLocalSession({
    date: julyFirst,
    notes: 'leg day',
    synced: 1,
    entries: [
      { id: 'e1', exerciseId: null, equipment: null, weightKg: 40, reps: 8, sets: 3, rawText: 'BB RDL', parsedBy: 'DICTIONARY', order: 0, synced: 1 },
      { id: 'e2', exerciseId: 'ex-dl', equipment: null, weightKg: 100, reps: 5, sets: 3, rawText: 'DL', parsedBy: 'DICTIONARY', order: 1, synced: 1 },
    ],
  });
});

describe('HistoryScreen', () => {
  it('shows day cards with a short date, exercise names, set summaries, flags and notes', async () => {
    await render(<HistoryScreen />);
    await waitFor(() => expect(screen.getByText(julyFirstLabel)).toBeTruthy());
    expect(screen.getByText('Barbell Deadlift')).toBeTruthy(); // cached name for a confirmed entry
    expect(screen.getByText('100kg×5×3')).toBeTruthy();
    expect(screen.getByText('BB RDL')).toBeTruthy(); // raw text for an unconfirmed entry
    expect(screen.getByText('40kg×8×3')).toBeTruthy();
    expect(screen.getByText('unconfirmed')).toBeTruthy();
    expect(screen.getByText('leg day')).toBeTruthy();
  });

  it('shows the year for sessions outside the current year and lists newest first (no 90-day cutoff)', async () => {
    await upsertLocalSession({
      date: '2020-12-25', notes: null, synced: 1,
      entries: [{ id: 'old', exerciseId: null, equipment: null, weightKg: null, reps: 10, sets: 2, rawText: 'Push ups', parsedBy: 'DICTIONARY', order: 0, synced: 1 }],
    });
    await render(<HistoryScreen />);
    await waitFor(() => expect(screen.getByText('Fri 25 Dec 2020')).toBeTruthy());
    expect(screen.getByText('10 reps × 2')).toBeTruthy();
    const dates = screen.getAllByText(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d/).map((n) => n.props.children);
    expect(dates).toEqual([julyFirstLabel, 'Fri 25 Dec 2020']);
  });

  it('opens progress for a confirmed entry, but not for an unconfirmed one', async () => {
    await render(<HistoryScreen />);
    await waitFor(() => expect(screen.getByText('Barbell Deadlift')).toBeTruthy());
    await fireEvent.press(screen.getByRole('button', { name: /Barbell Deadlift/ }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/exercise/[id]', params: { id: 'ex-dl', name: 'Barbell Deadlift' } });
    expect(screen.queryByRole('button', { name: /BB RDL/ })).toBeNull();
  });

  it('explains how to log in the empty state', async () => {
    resetDbForTests();
    await render(<HistoryScreen />);
    await waitFor(() => expect(screen.getByText('No sessions logged yet')).toBeTruthy());
    expect(screen.getByText(/Bench 60kg 8x3/)).toBeTruthy();
  });

  it('reloads when the tab regains focus', async () => {
    resetDbForTests();
    await render(<HistoryScreen />);
    await waitFor(() => expect(screen.getByText('No sessions logged yet')).toBeTruthy());
    await upsertLocalSession({
      date: julyFirst, notes: null, synced: 1,
      entries: [{ id: 'n', exerciseId: null, equipment: null, weightKg: 60, reps: 8, sets: 3, rawText: 'Bench', parsedBy: 'DICTIONARY', order: 0, synced: 1 }],
    });
    await act(async () => { mockFocus.refocus(); });
    await waitFor(() => expect(screen.getByText('Bench')).toBeTruthy());
  });

  it('shows an alert with Retry when loading fails', async () => {
    const spy = jest.spyOn(sessionsRepo, 'listAllLocalSessions').mockRejectedValueOnce(new Error('boom'));
    await render(<HistoryScreen />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    await fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByText('Barbell Deadlift')).toBeTruthy());
    spy.mockRestore();
  });
});
