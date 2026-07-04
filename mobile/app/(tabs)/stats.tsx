import { useEffect, useState } from 'react';
import { View, ScrollView, Text } from 'react-native';
import { getGoalProgress } from '../../src/api/client';
import { syncNow } from '../../src/sync/syncEngine';
import { MuscleHeatmap } from '../../src/components/MuscleHeatmap';
import type { GoalProgress } from '../../src/api/types';

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

  useEffect(() => {
    (async () => {
      try {
        await syncNow();
        const data = await getGoalProgress(currentWeekStart());
        setProgress(data);
        setError(null);
      } catch {
        setError("Couldn't load data. Pull down or reopen the app to retry.");
      }
    })();
  }, []);

  return (
    <ScrollView>
      <View style={{ padding: 16 }}>
        {error && <Text style={{ color: '#a33', marginBottom: 8 }}>{error}</Text>}
        <MuscleHeatmap progress={progress} />
      </View>
    </ScrollView>
  );
}
