// "Progression" — turns prior-session history into recommended targets for
// today, applying a simple progressive-overload heuristic. Pure and testable;
// the editor renders the returned targets as tap-to-fill buttons.
import type { ExerciseHistory, PriorSetGroup } from './priorHistory';

export type ProgressionTarget = {
  kind: 'repeat' | 'progress';
  // Short action label, e.g. "Repeat" or "+2.5kg".
  label: string;
  // Human-readable target, e.g. "42.5kg×8" or "10 reps".
  display: string;
  // Packed token inserted into the note on tap, e.g. "42.5kgx8" or "barx10".
  token: string;
};

function roundHalf(x: number): number {
  return Math.round(x * 2) / 2;
}

// The heaviest set of a session; ties (or all-bodyweight) break to the most reps.
function topSet(history: ExerciseHistory): PriorSetGroup {
  return history.entries.reduce((best, e) => {
    const bw = best.weightKg ?? -1;
    const ew = e.weightKg ?? -1;
    if (ew > bw || (ew === bw && (e.reps ?? 0) > (best.reps ?? 0))) return e;
    return best;
  }, history.entries[0]);
}

// Recommends today's targets from recent sessions (most recent first). Returns
// the emphasized target first. Empty when there's no usable history.
export function recommendProgression(sessions: ExerciseHistory[]): ProgressionTarget[] {
  const withSets = sessions.filter((s) => s.entries.length > 0);
  if (withSets.length === 0) return [];

  const last = topSet(withSets[0]);
  const reps = last.reps ?? 8;

  // Bodyweight / bar: progress by adding reps rather than load.
  if (last.weightKg == null) {
    const repeat: ProgressionTarget = {
      kind: 'repeat',
      label: 'Repeat',
      display: `${reps} reps`,
      token: `barx${reps}`,
    };
    const progress: ProgressionTarget = {
      kind: 'progress',
      label: '+2 reps',
      display: `${reps + 2} reps`,
      token: `barx${reps + 2}`,
    };
    return [progress, repeat];
  }

  const weight = last.weightKg;
  // Infer the step from the most recent jump, if the athlete is progressing;
  // otherwise nudge by the standard smallest-plate pair.
  const prevWeight = withSets[1] ? topSet(withSets[1]).weightKg : null;
  let step = 2.5;
  if (prevWeight != null && weight > prevWeight) {
    step = Math.min(5, Math.max(1.25, weight - prevWeight));
  }

  const repeat: ProgressionTarget = {
    kind: 'repeat',
    label: 'Repeat',
    display: `${roundHalf(weight)}kg×${reps}`,
    token: `${roundHalf(weight)}kgx${reps}`,
  };
  const nextWeight = roundHalf(weight + step);
  const progress: ProgressionTarget = {
    kind: 'progress',
    label: `+${roundHalf(step)}kg`,
    display: `${nextWeight}kg×${reps}`,
    token: `${nextWeight}kgx${reps}`,
  };

  // Hit solid reps last time → lead with progression; otherwise consolidate.
  return reps >= 8 ? [progress, repeat] : [repeat, progress];
}
