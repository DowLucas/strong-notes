// src/parsing/scanNote.ts
import type { ApiClient, MuscleGroup } from '@/lib/api';
import type { LocalSetEntry } from '../db/sessionsRepo';
import { parseSetGroups, type SetGroup } from './parseSetGroups';
import { parseQuickEntryLine, type ParsedLine } from './quickEntry';

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

// The subset of a resolved name we carry onto each of its set-groups.
type NameResolution = Pick<
  ParsedLine,
  'status' | 'exerciseId' | 'equipment' | 'parsedBy' | 'exerciseName' | 'muscles' | 'unresolvedToken'
>;

function buildEntry(
  group: SetGroup,
  lineStart: number,
  name: NameResolution,
  order: number,
  reuseId?: string,
): ScannedEntry {
  return {
    id: reuseId ?? makeEntryId(),
    exerciseId: name.exerciseId ?? null,
    equipment: name.equipment ?? null,
    weightKg: group.weightKg,
    reps: group.reps,
    sets: group.sets,
    rawText: group.token,
    parsedBy: name.parsedBy,
    order,
    synced: 0,
    spanStart: lineStart + group.start,
    spanEnd: lineStart + group.end,
    status: name.status === 'needs-confirm' ? 'needs-confirm' : 'resolved',
    exerciseName: name.exerciseName,
    muscles: name.muscles,
    unresolvedToken: name.unresolvedToken,
  };
}

export async function scanNote(
  api: ApiClient,
  text: string,
  previous: ScannedEntry[],
): Promise<ScannedEntry[]> {
  const prevByText = new Map(previous.map((e) => [e.rawText, e]));
  const result: ScannedEntry[] = [];

  // Resolve each distinct name prefix once per scan.
  const nameCache = new Map<string, NameResolution | null>();
  // The last successfully-resolved exercise, for ⁃ continuation lines.
  let lastName: NameResolution | null = null;

  let lineStart = 0;
  const lines = text.split('\n');
  for (let li = 0; li < lines.length; li += 1) {
    const line = lines[li];
    const { namePart, groups } = parseSetGroups(line);

    if (groups.length > 0) {
      let name: NameResolution | null;
      if (namePart === '') {
        // Continuation line — inherit the previous line's exercise.
        name = lastName;
      } else if (nameCache.has(namePart)) {
        name = nameCache.get(namePart) ?? null;
      } else {
        try {
          const parsed = await parseQuickEntryLine(api, namePart);
          name =
            parsed.status === 'resolved' || parsed.status === 'needs-confirm' ? parsed : null;
        } catch {
          name = null; // offline / LLM down — leave this line's groups unhighlighted
        }
        nameCache.set(namePart, name);
        if (name) lastName = name;
      }

      if (name) {
        for (const group of groups) {
          const reuse = prevByText.get(group.token);
          result.push(buildEntry(group, lineStart, name, result.length, reuse?.id));
        }
      }
    }

    lineStart += line.length + 1; // +1 for the '\n' consumed by split
  }

  return result;
}
