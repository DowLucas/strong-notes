// src/parsing/scanNote.ts
import type { ApiClient, MuscleGroup } from '@/lib/api';
import type { LocalSetEntry } from '../db/sessionsRepo';
import { extractCandidates } from './extractCandidates';
import { parseQuickEntryLine } from './quickEntry';

export type ScannedEntry = LocalSetEntry & {
  status: 'resolved' | 'needs-confirm';
  exerciseName?: string;
  muscles?: MuscleGroup[];
  unresolvedToken?: string;
};

let idCounter = 0;
function makeEntryId(): string {
  idCounter += 1;
  return `entry-${Date.now()}-${idCounter}`;
}

export async function scanNote(
  api: ApiClient,
  text: string,
  previous: ScannedEntry[],
): Promise<ScannedEntry[]> {
  const candidates = extractCandidates(text);
  const prevByText = new Map(previous.map((e) => [e.rawText, e]));
  const result: ScannedEntry[] = [];

  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];

    // Unchanged clause text → reuse the prior resolution (and its stable id +
    // any confirm state); only the span offsets and order can have shifted.
    const reuse = prevByText.get(candidate.text);
    if (reuse) {
      result.push({ ...reuse, spanStart: candidate.start, spanEnd: candidate.end, order: i });
      continue;
    }

    const parsed = await parseQuickEntryLine(api, candidate.text);
    if (parsed.status !== 'resolved' && parsed.status !== 'needs-confirm') continue;

    result.push({
      id: makeEntryId(),
      exerciseId: parsed.exerciseId ?? null,
      equipment: parsed.equipment ?? null,
      weightKg: parsed.weightKg ?? null,
      reps: parsed.reps ?? null,
      sets: parsed.sets ?? null,
      rawText: parsed.rawText,
      parsedBy: parsed.parsedBy,
      order: i,
      synced: 0,
      spanStart: candidate.start,
      spanEnd: candidate.end,
      status: parsed.status,
      exerciseName: parsed.exerciseName,
      muscles: parsed.muscles,
      unresolvedToken: parsed.unresolvedToken,
    });
  }

  return result;
}
