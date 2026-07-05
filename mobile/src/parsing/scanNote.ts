// src/parsing/scanNote.ts
import type { ApiClient, ClarifyingQuestion, MuscleGroup } from '@/lib/api';
import type { LocalSetEntry } from '../db/sessionsRepo';
import { parseSetGroups, type SetGroup } from './parseSetGroups';
import { parseQuickEntryLine, type ParsedLine } from './quickEntry';

export type ScannedEntry = LocalSetEntry & {
  status: 'resolved' | 'needs-confirm';
  exerciseName?: string;
  muscles?: MuscleGroup[];
  unresolvedToken?: string;
  clarifyingQuestion?: ClarifyingQuestion;
  // Shared by every set-group resolved from the same exercise name on one
  // line (and its ⁃ continuation lines) — lets the UI show one popover per
  // exercise instead of one per highlighted number.
  groupId: string;
};

let idCounter = 0;
function makeId(): string {
  idCounter += 1;
  return `entry-${Date.now()}-${idCounter}`;
}

// The subset of a resolved name we carry onto each of its set-groups.
type NameResolution = Pick<
  ParsedLine,
  | 'status'
  | 'exerciseId'
  | 'equipment'
  | 'parsedBy'
  | 'exerciseName'
  | 'muscles'
  | 'unresolvedToken'
  | 'clarifyingQuestion'
>;

function buildEntry(
  group: SetGroup,
  lineStart: number,
  spanStartInLine: number,
  name: NameResolution,
  groupId: string,
  order: number,
  reuseId?: string,
): ScannedEntry {
  return {
    id: reuseId ?? makeId(),
    exerciseId: name.exerciseId ?? null,
    equipment: name.equipment ?? null,
    weightKg: group.weightKg,
    reps: group.reps,
    sets: group.sets,
    rawText: group.token,
    parsedBy: name.parsedBy,
    order,
    synced: 0,
    spanStart: lineStart + spanStartInLine,
    spanEnd: lineStart + group.end,
    status: name.status === 'needs-confirm' ? 'needs-confirm' : 'resolved',
    exerciseName: name.exerciseName,
    muscles: name.muscles,
    unresolvedToken: name.unresolvedToken,
    clarifyingQuestion: name.clarifyingQuestion,
    groupId,
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
  // One groupId per resolved-name object (shared by ⁃ continuation lines,
  // since those reuse the exact same NameResolution reference as `lastName`).
  const groupIdsByName = new Map<NameResolution, string>();

  let lineStart = 0;
  const lines = text.split('\n');
  for (let li = 0; li < lines.length; li += 1) {
    const line = lines[li];
    const { namePart, namePartStart, groups } = parseSetGroups(line);

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
        let groupId = groupIdsByName.get(name);
        if (!groupId) {
          // Prefer inheriting a stable groupId from a matching previous
          // entry (so the popover the user has open doesn't go stale across
          // a re-scan) over minting a fresh one.
          const firstReuse = groups.map((g) => prevByText.get(g.token)).find((e) => e != null);
          groupId = firstReuse?.groupId ?? makeId();
          groupIdsByName.set(name, groupId);
        }

        // A single-group named line has nothing to disambiguate, so its
        // highlight includes the name — unlike a multi-group packed line,
        // where the name is shared across sets and only each group's own
        // numbers are highlighted (see NotesEditor for the rendering side).
        const includeName = groups.length === 1 && namePart !== '';
        for (const group of groups) {
          const reuse = prevByText.get(group.token);
          const spanStartInLine = includeName ? namePartStart : group.start;
          result.push(buildEntry(group, lineStart, spanStartInLine, name, groupId, result.length, reuse?.id));
        }
      }
    }

    lineStart += line.length + 1; // +1 for the '\n' consumed by split
  }

  return result;
}
