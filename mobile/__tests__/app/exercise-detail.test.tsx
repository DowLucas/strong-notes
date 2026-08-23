import '@/lib/i18n';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import ExerciseDetail from '../../app/exercise/[id]';
import { resetDbForTests } from '@/src/db/client';
import { upsertLocalSession } from '@/src/db/sessionsRepo';
import { cacheAbbreviations } from '@/src/db/abbreviationsRepo';
import * as statsRepo from '@/src/db/statsRepo';

let mockParams: Record<string, string> = { id: 'ex-dl' };
const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true) };
jest.mock('expo-router', () => ({
  get router() { return mockRouter; },
  useLocalSearchParams: () => mockParams,
}));

const hidden = { includeHiddenElements: true };

function daysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}
const entry = (id: string, weightKg: number | null, reps: number, order = 0) => ({
  id, exerciseId: 'ex-dl', equipment: null, weightKg, reps, sets: 3, rawText: 'deads', parsedBy: 'DICTIONARY' as const, order, synced: 0 as const,
});

beforeEach(async () => {
  resetDbForTests();
  jest.clearAllMocks();
  mockRouter.canGoBack.mockReturnValue(true);
  mockParams = { id: 'ex-dl' };
  await cacheAbbreviations([{ id: '1', token: 'DL', exerciseId: 'ex-dl', exerciseName: 'Barbell Deadlift', source: 'USER_ADDED', createdAt: '' }]);
  await upsertLocalSession({ date: daysAgo(30), notes: null, synced: 0, entries: [entry('a', 90, 5)] });
  await upsertLocalSession({ date: daysAgo(2), notes: null, synced: 0, entries: [entry('b', 100, 5), entry('c', 80, 8, 1)] });
});

describe('ExerciseDetail', () => {
  it('renders name, headline, chart points and the session list with a PR marker', async () => {
    await render(<ExerciseDetail />);
    await waitFor(() => expect(screen.getByText('Barbell Deadlift')).toBeTruthy());
    expect(screen.getByText('100 kg')).toBeTruthy();
    expect(screen.getByText('▲ +10 kg')).toBeTruthy();
    expect(screen.getAllByTestId('chart-point')).toHaveLength(1);
    expect(screen.getAllByTestId('chart-pr-point')).toHaveLength(1);
    expect(screen.getByText('100kg×5×3   80kg×8×3')).toBeTruthy();
    expect(screen.getAllByText('PR')).toHaveLength(1); // the latest session beats the first; the first has nothing to beat
  });

  it('paints the title from the route param before data arrives', async () => {
    mockParams = { id: 'ex-dl', name: 'Deadlift (param)' };
    const spy = jest.spyOn(statsRepo, 'listStatsRows').mockImplementationOnce(() => new Promise(() => {}));
    await render(<ExerciseDetail />);
    expect(screen.getByText('Deadlift (param)')).toBeTruthy();
    spy.mockRestore();
  });

  it('switches the plotted series, headline and unit with the metric toggle', async () => {
    await render(<ExerciseDetail />);
    await waitFor(() => expect(screen.getByText('Barbell Deadlift')).toBeTruthy());
    await fireEvent.press(screen.getByRole('tab', { name: 'Volume' }));
    // Volume = 100×5×3 + 80×8×3 = 3420 kg; y-axis ticks are in the thousands.
    expect(screen.getByText('3420 kg')).toBeTruthy();
    const labels = screen.getAllByTestId('chart-y-label', hidden).map((n) => parseFloat(String(n.props.children)));
    expect(Math.max(...labels)).toBeGreaterThanOrEqual(3420);
    await fireEvent.press(screen.getByRole('tab', { name: 'Est. 1RM' }));
    expect(screen.getByText('116.5 kg')).toBeTruthy(); // 100 × (1 + 5/30) = 116.67 → 116.5
  });

  it('distinguishes an unknown exercise from an empty range, and offers all time', async () => {
    mockParams = { id: 'nope' };
    await render(<ExerciseDetail />);
    await waitFor(() => expect(screen.getByText('Unknown exercise')).toBeTruthy());

    resetDbForTests();
    await cacheAbbreviations([{ id: '1', token: 'DL', exerciseId: 'ex-dl', exerciseName: 'Barbell Deadlift', source: 'USER_ADDED', createdAt: '' }]);
    await upsertLocalSession({ date: daysAgo(200), notes: null, synced: 0, entries: [entry('z', 90, 5)] });
    mockParams = { id: 'ex-dl' };
    await render(<ExerciseDetail />);
    await waitFor(() => expect(screen.getByText('No sessions in the last 3 months')).toBeTruthy());
    expect(screen.getByText('Barbell Deadlift')).toBeTruthy(); // title still known
    await fireEvent.press(screen.getByRole('button', { name: 'Show all time' }));
    await waitFor(() => expect(screen.getByText('1 session — log it again to see a trend')).toBeTruthy());
  });

  it('judges PRs against all-time history even when the range hides earlier sessions', async () => {
    await upsertLocalSession({ date: daysAgo(400), notes: null, synced: 0, entries: [entry('old', 120, 3)] });
    await render(<ExerciseDetail />);
    await waitFor(() => expect(screen.getByText('Barbell Deadlift')).toBeTruthy());
    expect(screen.queryAllByText('PR')).toHaveLength(0); // 100 kg never beat the old 120 kg
  });

  it('shows weightless sessions as BW with hollow markers and a caption', async () => {
    await upsertLocalSession({ date: daysAgo(10), notes: null, synced: 0, entries: [entry('bw', null, 12)] });
    await render(<ExerciseDetail />);
    await waitFor(() => expect(screen.getByText('Barbell Deadlift')).toBeTruthy());
    expect(screen.getByText('BW×12×3')).toBeTruthy();
    expect(screen.getAllByTestId('chart-hollow-point')).toHaveLength(1);
    expect(screen.getByText(/Hollow dot/)).toBeTruthy();
  });

  it('goes back when it can, otherwise replaces with the Progress tab', async () => {
    await render(<ExerciseDetail />);
    await fireEvent.press(screen.getByLabelText('Back'));
    expect(mockRouter.back).toHaveBeenCalled();
    mockRouter.canGoBack.mockReturnValue(false);
    await fireEvent.press(screen.getByLabelText('Back'));
    expect(mockRouter.replace).toHaveBeenCalledWith('/(tabs)/stats');
  });

  it('shows an alert with Retry when loading fails', async () => {
    const spy = jest.spyOn(statsRepo, 'listStatsRows').mockRejectedValueOnce(new Error('boom'));
    await render(<ExerciseDetail />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    await fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByText('Barbell Deadlift')).toBeTruthy());
    spy.mockRestore();
  });
});
