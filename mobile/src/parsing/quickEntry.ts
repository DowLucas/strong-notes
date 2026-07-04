import { resolveLine } from '../api/client';

export type ParsedLine = {
  rawText: string;
  status: 'resolved' | 'needs-confirm' | 'unresolved';
  exerciseName?: string;
  equipment?: string;
  weightKg?: number;
  reps?: number;
  sets?: number;
  parsedBy: 'DICTIONARY' | 'LLM';
};

export async function parseQuickEntryLine(line: string): Promise<ParsedLine> {
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
