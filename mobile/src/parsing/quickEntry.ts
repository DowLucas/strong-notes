import type { ApiClient, ClarifyingQuestion, MuscleGroup } from '@/lib/api';
import { getCachedAbbreviations } from '../db/abbreviationsRepo';

export type ParsedLine = {
  rawText: string;
  status: 'pending' | 'resolved' | 'needs-confirm' | 'unresolved';
  exerciseId?: string;
  exerciseName?: string;
  equipment?: string;
  /** Raw token the LLM identified as equipment shorthand (e.g. "bb"); saved as an equipment modifier on confirm. */
  equipmentToken?: string;
  weightKg?: number;
  reps?: number;
  sets?: number;
  muscles?: MuscleGroup[];
  /** First exercise-name token (kept for callers that need one); see exerciseTokens for all. */
  unresolvedToken?: string;
  /**
   * Every unresolved token that names the exercise (excludes equipment/clarifying tokens) — all get bound on confirm.
   * Empty when the only unresolved tokens are equipment/clarifying (e.g. "bb" alone): confirm then creates no alias.
   */
  exerciseTokens?: string[];
  clarifyingQuestion?: ClarifyingQuestion;
  parsedBy: 'DICTIONARY' | 'LLM';
};

const NUMERIC_TOKEN = /^\d+(\.\d+)?(kg|lb)?$|^\d+x\d+$/i;
const WEIGHT_TOKEN = /^(\d+(?:\.\d+)?)(?:kg|lb)?$/i;
const REPS_SETS_TOKEN = /^(\d+)x(\d+)$/i;

function parseNumericTokens(line: string): { weightKg?: number; reps?: number; sets?: number } {
  const out: { weightKg?: number; reps?: number; sets?: number } = {};
  for (const token of line.trim().split(/\s+/)) {
    const repsSets = token.match(REPS_SETS_TOKEN);
    if (repsSets) {
      out.reps = Number(repsSets[1]);
      out.sets = Number(repsSets[2]);
      continue;
    }
    const weight = token.match(WEIGHT_TOKEN);
    if (weight) out.weightKg = Number(weight[1]);
  }
  return out;
}

/** "Deadlift" + "Barbell" -> "Barbell Deadlift"; leaves a name that already mentions the equipment alone. */
export function nameWithEquipment(exerciseName: string, equipment?: string | null): string {
  if (!equipment) return exerciseName;
  return exerciseName.toLowerCase().includes(equipment.toLowerCase()) ? exerciseName : `${equipment} ${exerciseName}`;
}

type ExerciseToken = { token: string; exerciseId?: string; exerciseName?: string };

/**
 * Picks which exercise a line is about when its tokens map to different
 * exercises — e.g. after confirming "shoulder press", both "shoulder" and
 * "press" point at Shoulder Press, so a later "bench press" line has
 * "bench"→Bench Press and "press"→Shoulder Press.
 *
 * Rule: the exercise backed by the MOST tokens on the line wins; on a tie,
 * the exercise whose first token appears FIRST on the line. The winner does
 * not have to account for every exercise token ("press" above is still
 * claimed by Shoulder Press) — the leftover tokens are simply treated as
 * part of the winner's name. Returns the winner's first token (carrying its
 * exerciseId/exerciseName), or undefined when no token maps to an exercise.
 */
export function pickExercise<T extends ExerciseToken>(tokens: T[]): T | undefined {
  const byExercise = new Map<string, { first: T; count: number }>();
  for (const t of tokens) {
    if (!t.exerciseId) continue;
    const entry = byExercise.get(t.exerciseId);
    if (entry) entry.count += 1;
    else byExercise.set(t.exerciseId, { first: t, count: 1 });
  }
  let winner: { first: T; count: number } | undefined;
  for (const entry of byExercise.values()) {
    // Map preserves insertion order, so on a tie the earlier exercise stays.
    if (!winner || entry.count > winner.count) winner = entry;
  }
  return winner?.first;
}

async function tryResolveLocally(line: string): Promise<ParsedLine | null> {
  const cached = await getCachedAbbreviations();
  const byToken = new Map(cached.map((a) => [a.token.toUpperCase(), a]));

  const wordTokens = line.trim().split(/\s+/).filter((t) => !NUMERIC_TOKEN.test(t));
  if (wordTokens.length === 0) return null;

  const matches: ExerciseToken[] = [];
  let equipment: string | undefined;
  for (const token of wordTokens) {
    const match = byToken.get(token.toUpperCase());
    if (!match) return null; // any miss falls through to the network path
    matches.push({ token, exerciseId: match.exerciseId, exerciseName: match.exerciseName });
    if (match.modifierType === 'equipment' && match.modifierValue) equipment = match.modifierValue;
  }
  const exercise = pickExercise(matches);
  if (!exercise) return null;

  const numeric = parseNumericTokens(line);
  return {
    rawText: line,
    status: 'resolved',
    exerciseId: exercise.exerciseId,
    exerciseName: exercise.exerciseName,
    equipment,
    ...numeric,
    parsedBy: 'DICTIONARY',
  };
}

export async function parseQuickEntryLine(api: ApiClient, line: string): Promise<ParsedLine> {
  const local = await tryResolveLocally(line);
  if (local) return local;

  const response = await api.resolveLine(line);
  const numeric = parseNumericTokens(line);
  // The server encodes an empty token list as null (Go nil slice) — treat it as [].
  const resolvedTokens = response.resolvedTokens ?? [];
  const unresolvedTokens = response.unresolvedTokens ?? [];
  const exerciseToken = pickExercise(resolvedTokens.filter((t) => t.type === 'exercise'));
  const modifierToken = resolvedTokens.find((t) => t.type === 'modifier' && t.modifierType === 'equipment');

  if (response.llmGuess) {
    // The clarifying-question token (if any) and the equipment-shorthand
    // token (if any) are NOT exercise-name tokens. Whatever remains after
    // excluding them (case-insensitively — the model may echo "BB" for "bb")
    // is what gets bound to the exercise on confirm. Nothing else is ever
    // bound: an equipment/clarifying token must never become an exercise alias.
    const clarifyingQuestion = response.llmGuess.clarifyingQuestion ?? undefined;
    const guessedName = (response.llmGuess.exerciseName ?? '').trim();
    const equipment = response.llmGuess.equipment ?? undefined;
    const equipmentToken = (equipment && response.llmGuess.equipmentToken) || undefined;
    const nonExerciseTokens = new Set(
      // A modifier question's token ("As") isn't part of the exercise name; an
      // exercise-kind question's token ("pc") IS the exercise token.
      [clarifyingQuestion?.kind !== 'exercise' ? clarifyingQuestion?.token : undefined, equipmentToken]
        .filter((t): t is string => Boolean(t))
        .map((t) => t.toUpperCase()),
    );
    const exerciseTokens = unresolvedTokens.filter((t) => !nonExerciseTokens.has(t.toUpperCase()));
    const llmNumeric = {
      weightKg: response.llmGuess.weightKg ?? numeric.weightKg,
      reps: response.llmGuess.reps ?? numeric.reps,
      sets: response.llmGuess.sets ?? numeric.sets,
    };

    // "bb deadlifts" with "deadlifts" already in the dictionary: every
    // unresolved token is accounted for as equipment, so there is no new
    // exercise to confirm — log it under the dictionary exercise. A pending
    // clarifying question ("As dip"?) still needs the user, so it stays
    // needs-confirm.
    if (exerciseTokens.length === 0 && exerciseToken && !clarifyingQuestion) {
      return {
        rawText: line,
        status: 'resolved',
        exerciseId: exerciseToken.exerciseId,
        exerciseName: exerciseToken.exerciseName,
        equipment: equipment ?? modifierToken?.modifierValue,
        ...llmNumeric,
        parsedBy: 'DICTIONARY',
      };
    }

    return {
      rawText: line,
      status: 'needs-confirm',
      exerciseName: guessedName ? nameWithEquipment(guessedName, equipment) : undefined,
      equipment,
      equipmentToken,
      ...llmNumeric,
      muscles: response.llmGuess.muscles,
      unresolvedToken: exerciseTokens[0],
      exerciseTokens,
      clarifyingQuestion,
      parsedBy: 'LLM',
    };
  }

  if (unresolvedTokens.length > 0) {
    return { rawText: line, status: 'unresolved', parsedBy: 'DICTIONARY' };
  }

  return {
    rawText: line,
    status: 'resolved',
    exerciseId: exerciseToken?.exerciseId,
    exerciseName: exerciseToken?.exerciseName,
    equipment: modifierToken?.modifierValue,
    ...numeric,
    parsedBy: 'DICTIONARY',
  };
}
