// src/parsing/scanNote.ts
import type { ApiClient, ClarifyingQuestion, MuscleGroup } from '@/lib/api';
import type { LocalSetEntry } from '../db/sessionsRepo';
import type { SetGroup } from './parseSetGroups';
import { parseLineSegments } from './parseLine';
import { parseQuickEntryLine, type ParsedLine } from './quickEntry';

export type ScannedEntry = LocalSetEntry & {
  status: 'resolved' | 'needs-confirm';
  exerciseName?: string;
  muscles?: MuscleGroup[];
  unresolvedToken?: string;
  exerciseTokens?: string[];
  equipmentToken?: string;
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
  | 'exerciseTokens'
  | 'equipmentToken'
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
      'resolved' | 'needs-confirm',
    exerciseName: name.exerciseName,
    muscles: name.muscles,
    unresolvedToken: name.unresolvedToken,
    exerciseTokens: name.exerciseTokens,
    equipmentToken: name.equipmentToken,
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

type ExerciseIdentity = { exerciseId?: string | null; exerciseName?: string };

// Whether two resolutions name the same exercise. 'unknown' when neither
// side carries enough to tell (no shared id or name) — treated as reusable,
// since we only refuse reuse for a *known* different exercise.
function compareIdentity(a: ExerciseIdentity, b: ExerciseIdentity): 'same' | 'different' | 'unknown' {
  if (a.exerciseId && b.exerciseId) return a.exerciseId === b.exerciseId ? 'same' : 'different';
  if (a.exerciseName && b.exerciseName) return a.exerciseName === b.exerciseName ? 'same' : 'different';
  return 'unknown';
}

export async function scanNote(
  api: ApiClient,
  text: string,
  previous: ScannedEntry[],
): Promise<ScannedEntry[]> {
  const prevByText = new Map<string, ScannedEntry[]>();
  for (const entry of previous) {
    const list = prevByText.get(entry.rawText);
    if (list) list.push(entry);
    else prevByText.set(entry.rawText, [entry]);
  }
  const result: ScannedEntry[] = [];
  // Entry ids are DB primary keys, so each previous id may be reused at most
  // once per scan — otherwise two identical set-group tokens on a line (e.g.
  // `40kgx8 40kgx8`) would both reuse it and collide. Fall back to a fresh id.
  const usedIds = new Set<string>();
  // The previous entry to inherit from for `token` under `name`: one for the
  // same exercise, else one whose exercise can't be told apart — never one
  // for a known different exercise, or two distinct exercises sharing a token
  // (`(a x8 + b x8) x3`, `bench 8x3` / `rows 8x3`) would merge into one group.
  const findPrev = (token: string, name: NameResolution): ScannedEntry | undefined => {
    const candidates = (prevByText.get(token) ?? []).filter((e) => !usedIds.has(e.id));
    return (
      candidates.find((e) => compareIdentity(e, name) === 'same') ??
      candidates.find((e) => compareIdentity(e, name) === 'unknown')
    );
  };
  const claimReuseId = (entry: ScannedEntry | undefined): string | undefined => {
    if (!entry) return undefined;
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
  // A groupId is what the UI acts on (confirm binds every entry sharing it),
  // so it must never be inherited by two different names in one scan.
  const usedGroupIds = new Set<string>();

  let lineStart = 0;
  const lines = text.split('\n');
  for (let li = 0; li < lines.length; li += 1) {
    const line = lines[li];
    // A superset line yields one segment per part; a plain line, one segment.
    // Each segment is handled like its own line, offset within `line`.
    for (const segment of parseLineSegments(line)) {
      const { namePart, namePartStart, groups } = segment.parsed;
      const segmentStart = lineStart + segment.offset;

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
            const inherited = [namePart, ...groups.map((g) => g.token)]
              .map((token) => findPrev(token, name)?.groupId)
              .find((id) => id != null && !usedGroupIds.has(id));
            groupId = inherited ?? makeId();
            groupIdsByName.set(name, groupId);
            usedGroupIds.add(groupId);
          }

          // A single-group named line has nothing to disambiguate, so its
          // highlight merges the name into that one group's span. A
          // multi-group line's name is shared across several sets, so it gets
          // its own separate highlight instead (this doesn't represent a real
          // logged set — see isNameOnly) — unless a leading weight already
          // pulled the name inside a group span (`30kg dl 8x3 35kg 6x2`, `30kg 8x2 dl`).
          const nameInsideAGroup = groups.some(
          (g) => g.start <= namePartStart && namePartStart + namePart.length <= g.end,
        );
          const includeName = groups.length === 1 && namePart !== '';
          if (groups.length > 1 && namePart !== '' && !nameInsideAGroup) {
            const nameReuse = claimReuseId(findPrev(namePart, name));
            result.push(
              buildNameOnlyEntry(
                namePart,
                namePartStart,
                segmentStart,
                name,
                groupId,
                result.length,
                nameReuse,
              ),
            );
          }
          for (const group of groups) {
            const reuseId = claimReuseId(findPrev(group.token, name));
            const spanStartInLine = includeName
              ? Math.min(namePartStart, group.start)
              : group.start;
            result.push(
              buildEntry(
                group,
                segmentStart,
                spanStartInLine,
                name,
                groupId,
                result.length,
                reuseId,
              ),
            );
          }
        }
      }
    }

    lineStart += line.length + 1; // +1 for the '\n' consumed by split
  }

  return result;
}
