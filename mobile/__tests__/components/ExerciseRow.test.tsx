import '@/lib/i18n';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { ExerciseRow } from '@/src/components/ExerciseRow';
import { computeExerciseProgress } from '@/lib/exerciseProgress';

const rows = [
  { exerciseId: 'ex-dl', exerciseName: 'Barbell Deadlift', latestRawText: 'DL', sessionDate: '2026-06-10', weightKg: 90, reps: 5, sets: 3, entryOrder: 0 },
  { exerciseId: 'ex-dl', exerciseName: 'Barbell Deadlift', latestRawText: 'DL', sessionDate: '2026-08-20', weightKg: 100, reps: 5, sets: 3, entryOrder: 0 },
];
const [progress] = computeExerciseProgress(rows);

describe('ExerciseRow', () => {
  it('shows name, headline, delta and the sessions/last line, and fires onPress', async () => {
    const onPress = jest.fn();
    await render(<ExerciseRow progress={progress} today="2026-08-23" onPress={onPress} />);
    expect(screen.getByText('Barbell Deadlift')).toBeTruthy();
    expect(screen.getByText('100 kg')).toBeTruthy();
    expect(screen.getByText('▲ +10 kg')).toBeTruthy();
    expect(screen.getByText('2 sessions · last Thu')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button'));
    expect(onPress).toHaveBeenCalled();
  });

  it('speaks the delta in words', async () => {
    await render(<ExerciseRow progress={progress} today="2026-08-23" onPress={jest.fn()} />);
    expect(screen.getByRole('button').props.accessibilityLabel).toBe('Barbell Deadlift, 100 kg, up 10 kilograms, 2 sessions · last Thu');
  });

  it('labels a single session "1 session" instead of a dash, with a placeholder sparkline', async () => {
    const [single] = computeExerciseProgress([rows[1]]);
    await render(<ExerciseRow progress={single} today="2026-08-23" onPress={jest.fn()} />);
    expect(screen.getByText('1 session')).toBeTruthy();
    expect(screen.getByTestId('sparkline-placeholder')).toBeTruthy();
  });

  it('falls back to "Unnamed exercise" when the name is unknown', async () => {
    await render(<ExerciseRow progress={{ ...progress, name: null }} today="2026-08-23" onPress={jest.fn()} />);
    expect(screen.getByText('Unnamed exercise')).toBeTruthy();
  });
});
