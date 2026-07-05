import { useEffect, useState } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Text } from '@/components/Text';
import { TopBar } from '@/components/TopBar';
import { ContentContainer } from '@/components/ContentContainer';
import { EmptyState } from '@/components/EmptyState';
import { Chip } from '@/components/Chip';
import { Field } from '@/components/Field';
import { Button } from '@/components/Button';
import { MuscleHeatmap } from '@/src/components/MuscleHeatmap';
import { useAuth } from '@/lib/auth';
import type { GoalProgress, GoalType } from '@/lib/api';
import { syncNow } from '@/src/sync/syncEngine';
import { colors, spacing } from '@/lib/theme';

const PRESETS: { labelKey: string; type: GoalType }[] = [
  { labelKey: 'stats.presetHypertrophy', type: 'HYPERTROPHY' },
  { labelKey: 'stats.presetStrength', type: 'STRENGTH' },
  { labelKey: 'stats.presetEndurance', type: 'ENDURANCE' },
];

function currentWeekStart(): string {
  const now = new Date();
  const day = now.getUTCDay();
  const diff = (day + 6) % 7;
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() - diff);
  return monday.toISOString().slice(0, 10);
}

export default function StatsScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { api } = useAuth();
  const [progress, setProgress] = useState<GoalProgress[]>([]);
  const [noActiveGoal, setNoActiveGoal] = useState(false);
  const [goalText, setGoalText] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function refreshProgress() {
    try {
      const data = await api.getGoalProgress(currentWeekStart());
      setProgress(data);
      setNoActiveGoal(false);
      setError(null);
    } catch (err) {
      if ((err as { status?: number })?.status === 404) {
        setNoActiveGoal(true);
        setError(null);
      } else {
        setError(t('errors.generic'));
      }
    }
  }

  useEffect(() => {
    (async () => {
      await syncNow(api);
      await refreshProgress();
    })();
  }, []);

  async function handlePresetPress(type: GoalType) {
    try {
      await api.createGoal({ type });
      await refreshProgress();
    } catch {
      setError(t('errors.generic'));
    }
  }

  async function handleSetGoal() {
    const description = goalText.trim();
    if (!description) return;
    try {
      const guess = await api.resolveGoal(description);
      // The backend applies its per-muscle science-table defaults for `type`
      // when `overrides` is omitted; sending overrides here with placeholder
      // min/max values would overwrite (zero out) those defaults instead of
      // emphasizing the guessed muscles, since the backend takes override
      // values literally rather than treating them as a bump.
      await api.createGoal({ type: guess.type, description });
      setGoalText('');
      await refreshProgress();
    } catch {
      setError(t('errors.generic'));
    }
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <TopBar title={t('stats.title')} />
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + spacing.s7 }}>
        <ContentContainer style={styles.content}>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {noActiveGoal ? (
            <EmptyState title={t('stats.noGoalTitle')} body={t('stats.noGoalBody')} icon="target" />
          ) : null}

          <View style={styles.presetRow}>
            {PRESETS.map((p) => (
              <TouchableOpacity key={p.type} onPress={() => void handlePresetPress(p.type)}>
                <Chip>{t(p.labelKey)}</Chip>
              </TouchableOpacity>
            ))}
          </View>

          <Field
            label={t('stats.goalPlaceholder')}
            value={goalText}
            onChangeText={setGoalText}
            placeholder={t('stats.goalPlaceholder')}
            onSubmitEditing={() => void handleSetGoal()}
            returnKeyType="done"
          />
          <Button kind="secondary" onPress={() => void handleSetGoal()} style={styles.setGoalButton}>
            {t('stats.setGoal')}
          </Button>

          <MuscleHeatmap progress={progress} />
        </ContentContainer>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  content: { paddingTop: spacing.s5, paddingHorizontal: spacing.s5 },
  presetRow: { flexDirection: 'row', gap: spacing.s2, marginBottom: spacing.s4 },
  setGoalButton: { marginTop: spacing.s3, marginBottom: spacing.s6 },
  error: { color: colors.brick, marginBottom: spacing.s3 },
});
