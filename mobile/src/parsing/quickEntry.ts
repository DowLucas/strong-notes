import type { ApiClient, ClarifyingQuestion, MuscleGroup } from '@/lib/api';
import { getCachedAbbreviations } from '../db/abbreviationsRepo';

export type ParsedLine = {
  rawText: string;
  status: 'pending' | 'resolved' | 'needs-confirm' | 'unresolved';
  exerciseId?: string;
  exerciseName?: string;
  equipment?: string;
  weightKg?: number;
  reps?: number;
  sets?: number;
  muscles?: MuscleGroup[];
  unresolvedToken?: string;
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

async function tryResolveLocally(line: string): Promise<ParsedLine | null> {
  const cached = await getCachedAbbreviations();
  const byToken = new Map(cached.map((a) => [a.token.toUpperCase(), a]));

  const wordTokens = line.trim().split(/\s+/).filter((t) => !NUMERIC_TOKEN.test(t));
  if (wordTokens.length === 0) return null;

  let exerciseId: string | undefined;
  let equipment: string | undefined;
  for (const token of wordTokens) {
    const match = byToken.get(token.toUpperCase());
    if (!match) return null; // any miss falls through to the network path
    if (match.exerciseId) exerciseId = match.exerciseId;
    if (match.modifierType === 'equipment' && match.modifierValue) equipment = match.modifierValue;
  }
  if (!exerciseId) return null;

  const numeric = parseNumericTokens(line);
  return {
    rawText: line,
    status: 'resolved',
    exerciseId,
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

  if (response.llmGuess) {
    // The clarifying-question token (if any) is a leftover modifier the LLM
    // flagged as ambiguous — it is NOT the exercise-name token. Whatever
    // remains after excluding it is what should get bound to the exercise on
    // confirm; without a clarifying question, this is unchanged from before
    // (unresolvedTokens[0]).
    const clarifyingQuestion = response.llmGuess.clarifyingQuestion ?? undefined;
    const exerciseTokens = clarifyingQuestion
      ? response.unresolvedTokens.filter((t) => t !== clarifyingQuestion.token)
      : response.unresolvedTokens;
    return {
      rawText: line,
      status: 'needs-confirm',
      exerciseName: response.llmGuess.exerciseName,
      equipment: response.llmGuess.equipment ?? undefined,
      weightKg: response.llmGuess.weightKg ?? numeric.weightKg,
      reps: response.llmGuess.reps ?? numeric.reps,
      sets: response.llmGuess.sets ?? numeric.sets,
      muscles: response.llmGuess.muscles,
      unresolvedToken: exerciseTokens[0] ?? response.unresolvedTokens[0],
      clarifyingQuestion,
      parsedBy: 'LLM',
    };
  }

  if (response.unresolvedTokens.length > 0) {
    return { rawText: line, status: 'unresolved', parsedBy: 'DICTIONARY' };
  }

  const exerciseToken = response.resolvedTokens.find((t) => t.type === 'exercise');
  const modifierToken = response.resolvedTokens.find((t) => t.type === 'modifier' && t.modifierType === 'equipment');
  return {
    rawText: line,
    status: 'resolved',
    exerciseId: exerciseToken?.exerciseId,
    equipment: modifierToken?.modifierValue,
    ...numeric,
    parsedBy: 'DICTIONARY',
  };
}
