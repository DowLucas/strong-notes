import '@/lib/i18n';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import ExerciseDetail from '../../app/exercise/[id]';
import { resetDbForTests } from '@/src/db/client';
import { upsertLocalSession } from '@/src/db/sessionsRepo';
import { cacheAbbreviations } from '@/src/db/abbreviationsRepo';

let mockParams: Record<string, string> = { id: 'ex-dl' };
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => mockParams,
}));

function daysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}
const entry = (id: string, weightKg: number, reps: number, order = 0) => ({
  id, exerciseId: 'ex-dl', equipment: null, weightKg, reps, sets: 3, rawText: 'x', parsedBy: 'DICTIONARY' as const, order, synced: 0 as const,
});

beforeEach(async () => {
  resetDbForTests();
  mockParams = { id: 'ex-dl' };
  await cacheAbbreviations([{ id: '1', token: 'DL', exerciseId: 'ex-dl', exerciseName: 'Barbell Deadlift', source: 'USER_ADDED', createdAt: '' }]);
  await upsertLocalSession({ date: daysAgo(30), notes: null, synced: 0, entries: [entry('a', 90, 5)] });
  await upsertLocalSession({ date: daysAgo(2), notes: null, synced: 0, entries: [entry('b', 100, 5), entry('c', 80, 8, 1)] });
});

describe('ExerciseDetail', () => {
  it('renders name, headline, chart points and the session list with a PR marker', async () => {
    await render(<ExerciseDetail />);
    await waitFor(() => expect(screen.getByText('Barbell Deadlift')).toBeTruthy());
    expect(screen.getByText('100kg')).toBeTruthy();
    expect(screen.getByText('▲ +10')).toBeTruthy();
    expect(screen.getAllByTestId('chart-point')).toHaveLength(2);
    expect(screen.getByText('100kg 5×3   80kg 8×3')).toBeTruthy();
    expect(screen.getAllByText('PR')).toHaveLength(1); // the latest session beats the first; the first has nothing to beat
  });

  it('switches the plotted series with the metric toggle', async () => {
    await render(<ExerciseDetail />);
    await waitFor(() => expect(screen.getByText('Barbell Deadlift')).toBeTruthy());
    await fireEvent.press(screen.getByRole('button', { name: 'Volume' }));
    // Volume y-axis ticks are in the thousands; top-set ticks are < 200.
    const labels = screen.getAllByTestId('chart-y-label').map((n) => Number(n.props.children));
    expect(Math.max(...labels)).toBeGreaterThan(1000);
  });

  it('shows an empty state for an unknown id', async () => {
    mockParams = { id: 'nope' };
    await render(<ExerciseDetail />);
    await waitFor(() => expect(screen.getByText('No data for this exercise')).toBeTruthy());
  });
});
