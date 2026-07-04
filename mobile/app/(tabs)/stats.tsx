import { useEffect, useState } from 'react';
import { View, ScrollView, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { getGoalProgress, createGoal, resolveGoal, buildEmphasisOverrides, ApiError } from '../../src/api/client';
import { syncNow } from '../../src/sync/syncEngine';
import { MuscleHeatmap } from '../../src/components/MuscleHeatmap';
import type { GoalProgress, GoalType } from '../../src/api/types';

const ERROR_MESSAGE = "Couldn't load data. Pull down or reopen the app to retry.";
const NO_GOAL_MESSAGE = 'No goal set yet — pick one below to start tracking.';

const PRESETS: { type: GoalType; label: string }[] = [
  { type: 'HYPERTROPHY', label: 'Hypertrophy' },
  { type: 'STRENGTH', label: 'Strength' },
  { type: 'ENDURANCE', label: 'Endurance' },
];

function currentWeekStart(): string {
  const now = new Date();
  const day = now.getUTCDay();
  const diff = (day + 6) % 7; // days since Monday
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() - diff);
  return monday.toISOString().slice(0, 10);
}

export default function StatsScreen() {
  const [progress, setProgress] = useState<GoalProgress[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [noActiveGoal, setNoActiveGoal] = useState(false);
  const [goalText, setGoalText] = useState('');

  async function refreshProgress() {
    const data = await getGoalProgress(currentWeekStart());
    setProgress(data);
  }

  useEffect(() => {
    (async () => {
      try {
        await syncNow();
        await refreshProgress();
        setError(null);
        setNoActiveGoal(false);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          // No active goal yet (e.g. fresh install) — expected, not a real failure.
          setNoActiveGoal(true);
          setError(null);
        } else {
          setError(ERROR_MESSAGE);
        }
      }
    })();
  }, []);

  async function handlePresetPress(type: GoalType) {
    try {
      await createGoal({ type });
      await refreshProgress();
      setError(null);
      setNoActiveGoal(false);
    } catch {
      setError(ERROR_MESSAGE);
    }
  }

  async function handleSetGoal() {
    const description = goalText.trim();
    if (!description) return;
    try {
      const guess = await resolveGoal(description);
      const overrides =
        guess.muscles.length > 0 ? buildEmphasisOverrides(guess.type, guess.muscles) : undefined;
      await createGoal({ type: guess.type, description, ...(overrides ? { overrides } : {}) });
      await refreshProgress();
      setGoalText('');
      setError(null);
      setNoActiveGoal(false);
    } catch {
      setError(ERROR_MESSAGE);
    }
  }

  return (
    <ScrollView>
      <View style={{ padding: 16 }}>
        {error && <Text style={{ color: '#a33', marginBottom: 8 }}>{error}</Text>}
        {!error && noActiveGoal && <Text style={{ marginBottom: 8 }}>{NO_GOAL_MESSAGE}</Text>}

        <View style={styles.presetRow}>
          {PRESETS.map((preset) => (
            <Pressable
              key={preset.type}
              style={styles.presetChip}
              onPress={() => handlePresetPress(preset.type)}
            >
              <Text>{preset.label}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.freeTextRow}>
          <TextInput
            style={styles.input}
            placeholder="Or describe your goal..."
            value={goalText}
            onChangeText={setGoalText}
            onSubmitEditing={handleSetGoal}
            returnKeyType="done"
          />
          <Pressable style={styles.setGoalButton} onPress={handleSetGoal}>
            <Text>Set Goal</Text>
          </Pressable>
        </View>

        <MuscleHeatmap progress={progress} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  presetRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  presetChip: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 16,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  freeTextRow: { flexDirection: 'row', gap: 8, marginBottom: 16, alignItems: 'center' },
  input: { flex: 1, borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12 },
  setGoalButton: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
});
