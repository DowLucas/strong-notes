import { resolveLine } from '../api/client';
import { getCachedAbbreviations } from '../db/abbreviationsRepo';

export type ParsedLine = {
  rawText: string;
  // 'pending' represents a raw line that's been saved locally but hasn't
  // been through parseQuickEntryLine yet (or whose parse attempt failed) -
  // see mobile/app/(tabs)/index.tsx's offline-first submit flow. It's an
  // additive union member; existing 'resolved' | 'needs-confirm' |
  // 'unresolved' producers/consumers are unaffected.
  status: 'pending' | 'resolved' | 'needs-confirm' | 'unresolved';
  exerciseName?: string;
  equipment?: string;
  weightKg?: number;
  reps?: number;
  sets?: number;
  // Unset while a line is 'pending' - only known once parseQuickEntryLine
  // resolves.
  parsedBy?: 'DICTIONARY' | 'LLM';
};

// Mirrors backend/src/parsing/dictionaryResolver.ts's NUMERIC_TOKEN so weight/rep-set
// tokens (e.g. "40kg", "8x3") are excluded from dictionary lookup the same way server-side.
const NUMERIC_TOKEN = /^\d+(\.\d+)?(kg|lb)?$|^\d+x\d+$/i;

async function tryResolveLocally(line: string): Promise<boolean> {
  const tokens = line.trim().split(/\s+/);
  const wordTokens = tokens.filter((t) => !NUMERIC_TOKEN.test(t));

  if (wordTokens.length === 0) {
    // No word tokens to resolve (e.g. an all-numeric line) - nothing for the
    // dictionary to confirm, so let the network path handle classification.
    return false;
  }

  const cached = await getCachedAbbreviations();
  const byToken = new Map(cached.map((a) => [a.token.toUpperCase(), a]));

  return wordTokens.every((t) => byToken.has(t.toUpperCase()));
}

export async function parseQuickEntryLine(line: string): Promise<ParsedLine> {
  if (await tryResolveLocally(line)) {
    return { rawText: line, status: 'resolved', parsedBy: 'DICTIONARY' };
  }

  const response = await resolveLine(line);

  if (response.llmGuess) {
    return {
      rawText: line,
      status: 'needs-confirm',
      exerciseName: response.llmGuess.exerciseName,
      equipment: response.llmGuess.equipment,
      weightKg: response.llmGuess.weightKg,
      reps: response.llmGuess.reps,
      sets: response.llmGuess.sets,
      parsedBy: 'LLM',
    };
  }

  if (response.unresolvedTokens.length > 0) {
    return { rawText: line, status: 'unresolved', parsedBy: 'DICTIONARY' };
  }

  return { rawText: line, status: 'resolved', parsedBy: 'DICTIONARY' };
}
