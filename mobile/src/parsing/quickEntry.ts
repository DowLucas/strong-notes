import { resolveLine } from '../api/client';
import { getCachedAbbreviations } from '../db/abbreviationsRepo';
import type { MuscleGroup } from '../api/types';

export type ParsedLine = {
  rawText: string;
  // 'pending' represents a raw line that's been saved locally but hasn't
  // been through parseQuickEntryLine yet (or whose parse attempt failed) -
  // see mobile/app/(tabs)/index.tsx's offline-first submit flow. It's an
  // additive union member; existing 'resolved' | 'needs-confirm' |
  // 'unresolved' producers/consumers are unaffected.
  status: 'pending' | 'resolved' | 'needs-confirm' | 'unresolved';
  exerciseName?: string;
  // Set once a line resolves to a known exercise, whether via the
  // local-cache-first dictionary check or the network dictionary/LLM path.
  // This is the field the sync engine needs to link a logged set back to
  // an exercise - see mobile/app/(tabs)/index.tsx's persistLines.
  exerciseId?: string;
  equipment?: string;
  weightKg?: number;
  reps?: number;
  sets?: number;
  // Unset while a line is 'pending' - only known once parseQuickEntryLine
  // resolves.
  parsedBy?: 'DICTIONARY' | 'LLM';
  // Set only for a 'needs-confirm' result: the literal token from the raw
  // line (e.g. "CRABWALK") that the LLM fell back to resolving, so the
  // confirm action knows exactly which token to save as a new Abbreviation.
  unresolvedToken?: string;
  // Set only for a 'needs-confirm' result: the LLM's muscle-group guess for
  // the new exercise, passed straight through to createExercise() when the
  // user confirms.
  muscles?: MuscleGroup[];
};

// Mirrors backend/src/parsing/dictionaryResolver.ts's NUMERIC_TOKEN so weight/rep-set
// tokens (e.g. "40kg", "8x3") are excluded from dictionary lookup the same way server-side.
const NUMERIC_TOKEN = /^\d+(\.\d+)?(kg|lb)?$|^\d+x\d+$/i;

// Matches a rep x set token like "8x3" - first number is reps, second is sets.
const REPS_SETS_TOKEN = /^(\d+)x(\d+)$/i;

// Matches a bare weight token like "40", "40.5", "40kg" or "40lb". Unit is
// captured but ignored - lb->kg conversion is out of scope, we just parse the
// numeric part, mirroring the backend's dictionary-only path which never
// converts units either.
const WEIGHT_TOKEN = /^(\d+(?:\.\d+)?)(kg|lb)?$/i;

// Neither the backend's dictionary-only resolution path (see
// backend/src/routes/resolve.ts + dictionaryResolver.ts) nor this app's
// local-cache-first path ever extract weight/reps/sets - only the LLM
// fallback's prompt does. So this is the one place that parses those numeric
// tokens out of the raw line text for the dictionary-resolved fast path.
function parseNumericTokens(line: string): { weightKg?: number; reps?: number; sets?: number } {
  let weightKg: number | undefined;
  let reps: number | undefined;
  let sets: number | undefined;

  for (const token of line.trim().split(/\s+/)) {
    const repsSetsMatch = token.match(REPS_SETS_TOKEN);
    if (repsSetsMatch) {
      reps = Number(repsSetsMatch[1]);
      sets = Number(repsSetsMatch[2]);
      continue;
    }

    const weightMatch = token.match(WEIGHT_TOKEN);
    if (weightMatch) {
      weightKg = Number(weightMatch[1]);
    }
  }

  return { weightKg, reps, sets };
}

type LocalResolution = { exerciseId?: string; equipment?: string };

async function tryResolveLocally(line: string): Promise<LocalResolution | null> {
  const tokens = line.trim().split(/\s+/);
  const wordTokens = tokens.filter((t) => !NUMERIC_TOKEN.test(t));

  if (wordTokens.length === 0) {
    // No word tokens to resolve (e.g. an all-numeric line) - nothing for the
    // dictionary to confirm, so let the network path handle classification.
    return null;
  }

  const cached = await getCachedAbbreviations();
  const byToken = new Map(cached.map((a) => [a.token.toUpperCase(), a]));

  if (!wordTokens.every((t) => byToken.has(t.toUpperCase()))) {
    return null;
  }

  let exerciseId: string | undefined;
  let equipment: string | undefined;
  for (const t of wordTokens) {
    const match = byToken.get(t.toUpperCase())!;
    if (match.exerciseId) {
      exerciseId = match.exerciseId;
    } else if (match.modifierType === 'equipment') {
      equipment = match.modifierValue;
    }
  }

  return { exerciseId, equipment };
}

export async function parseQuickEntryLine(line: string): Promise<ParsedLine> {
  const numeric = parseNumericTokens(line);

  const local = await tryResolveLocally(line);
  if (local) {
    return {
      rawText: line,
      status: 'resolved',
      parsedBy: 'DICTIONARY',
      exerciseId: local.exerciseId,
      equipment: local.equipment,
      ...numeric,
    };
  }

  const response = await resolveLine(line);

  if (response.llmGuess) {
    return {
      rawText: line,
      status: 'needs-confirm',
      exerciseName: response.llmGuess.exerciseName,
      equipment: response.llmGuess.equipment,
      // Prefer the LLM's own guess; only fall back to client-side regex
      // parsing of the raw text if the LLM didn't provide a value.
      weightKg: response.llmGuess.weightKg ?? numeric.weightKg,
      reps: response.llmGuess.reps ?? numeric.reps,
      sets: response.llmGuess.sets ?? numeric.sets,
      parsedBy: 'LLM',
      // There's always at least one unresolved token here - it's what
      // triggered the LLM fallback in the first place.
      unresolvedToken: response.unresolvedTokens[0],
      muscles: response.llmGuess.muscles,
    };
  }

  if (response.unresolvedTokens.length > 0) {
    return { rawText: line, status: 'unresolved', parsedBy: 'DICTIONARY' };
  }

  const exerciseId = response.resolvedTokens.find((t) => t.type === 'exercise')?.exerciseId;
  const equipment = response.resolvedTokens.find(
    (t) => t.type === 'modifier' && t.modifierType === 'equipment'
  )?.modifierValue;

  return {
    rawText: line,
    status: 'resolved',
    parsedBy: 'DICTIONARY',
    exerciseId,
    equipment,
    ...numeric,
  };
}
