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
  // True for the exercise-name-only highlight added on a multi-group line
  // (see below) — it doesn't represent a real logged set (weightKg/reps/sets
  // are null) and must be excluded when persisting/syncing entries.
  isNameOnly?: boolean;
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

// Fields shared by every entry resolved from the same name, regardless of
// whether it represents a real set-group or the name-only highlight.
function sharedFields(name: NameResolution, groupId: string) {
  return {
    exerciseId: name.exerciseId ?? null,
    equipment: name.equipment ?? null,
    parsedBy: name.parsedBy,
    synced: 0 as const,
    status: (name.status === 'needs-confirm' ? 'needs-confirm' : 'resolved') as
      | 'resolved'
      | 'needs-confirm',
    exerciseName: name.exerciseName,
    muscles: name.muscles,
    unresolvedToken: name.unresolvedToken,
    clarifyingQuestion: name.clarifyingQuestion,
    groupId,
  };
}

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
    ...sharedFields(name, groupId),
    weightKg: group.weightKg,
    reps: group.reps,
    sets: group.sets,
    rawText: group.token,
    order,
    spanStart: lineStart + spanStartInLine,
    spanEnd: lineStart + group.end,
  };
}

// The exercise name itself, highlighted as its own span on a multi-group
// line — where the name is shared across several set-groups, so it isn't
// merged into any single group's span the way a single-group line's is.
function buildNameOnlyEntry(
  namePart: string,
  namePartStart: number,
  lineStart: number,
  name: NameResolution,
  groupId: string,
  order: number,
  reuseId?: string,
): ScannedEntry {
  return {
    id: reuseId ?? makeId(),
    ...sharedFields(name, groupId),
    weightKg: null,
    reps: null,
    sets: null,
    rawText: namePart,
    order,
    spanStart: lineStart + namePartStart,
    spanEnd: lineStart + namePartStart + namePart.length,
    isNameOnly: true,
  };
}

export async function scanNote(
  api: ApiClient,
  text: string,
  previous: ScannedEntry[],
): Promise<ScannedEntry[]> {
  const prevByText = new Map(previous.map((e) => [e.rawText, e]));
  const result: ScannedEntry[] = [];
  // Entry ids are DB primary keys, so each previous id may be reused at most
  // once per scan — otherwise two identical set-group tokens on a line (e.g.
  // `40kgx8 40kgx8`) would both reuse it and collide. Fall back to a fresh id.
  const usedIds = new Set<string>();
  const claimReuseId = (entry: ScannedEntry | undefined): string | undefined => {
    if (!entry || usedIds.has(entry.id)) return undefined;
    usedIds.add(entry.id);
    return entry.id;
  };

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
        // highlight merges the name into that one group's span. A
        // multi-group line's name is shared across several sets, so it gets
        // its own separate highlight instead (this doesn't represent a real
        // logged set — see isNameOnly).
        const includeName = groups.length === 1 && namePart !== '';
        if (groups.length > 1 && namePart !== '') {
          const nameReuse = claimReuseId(prevByText.get(namePart));
          result.push(
            buildNameOnlyEntry(namePart, namePartStart, lineStart, name, groupId, result.length, nameReuse),
          );
        }
        for (const group of groups) {
          const reuseId = claimReuseId(prevByText.get(group.token));
          const spanStartInLine = includeName ? namePartStart : group.start;
          result.push(buildEntry(group, lineStart, spanStartInLine, name, groupId, result.length, reuseId));
        }
      }
    }

    lineStart += line.length + 1; // +1 for the '\n' consumed by split
  }

  return result;
}
