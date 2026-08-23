// Line-level parsing: splits a superset line into its parts and hands each
// part to parseSetGroups, so the rest of the pipeline (scanNote) can treat
// every segment like its own line.
//
//   SS: (5kg db OHSP x8 + shoulder rotation x8) x3
//   bench 60kg 8x3 + pull ups 10x3
//
// Detection: an optional `SS:`/`superset:` prefix, an optional parenthesised
// group (which must contain a `+`) with an optional `xN` right after the `)`
// (sets for every part; anything after that is a trailing comment), and `+`
// between parts. A `+` only separates parts when BOTH sides name an exercise
// and parse to set groups — "felt good + tired" stays prose, and an added
// weight (`Dips 8x3 +20kg`, `Pull ups BW+10kg 8x3`) stays in its segment.
import { parseSetGroups, type ParsedWorkoutLine } from './parseSetGroups';

export type LineSegment = {
  /** Offset of this segment's text within the original line. */
  offset: number;
  parsed: ParsedWorkoutLine;
};

const PREFIX = /^\s*(?:ss|superset)\s*:\s*/i;
const OUTER_SETS = /^\s*x\s*(\d+)/i;
// Tokens that carry numbers/units rather than naming an exercise: `8x3`, `x8`,
// `20kg`, `8`, `bar`, `bw`, a lone `x`, a lone unit.
const NUMERIC_TOKEN = /^(?:@?\d+(?:[.,]\d+)*(?:kg|lb)?(?:x\d+(?:[.,]\d+)*(?:kg|lb)?)*|x(?:\d+(?:[.,]\d+)*(?:kg|lb)?(?:x\d+)*)?|bar|bw|kg|lb)$/i;

type Piece = { text: string; offset: number };
type ParenGroup = { inner: string; innerStart: number; outerSets: number | null };

function hasNameToken(text: string): boolean {
  return text.split(/\s+/).some((t) => t.length > 0 && !NUMERIC_TOKEN.test(t));
}

/** A piece counts as a superset part when it names an exercise and has set groups. */
function isExercisePart(text: string): boolean {
  return hasNameToken(text) && parseSetGroups(text).groups.length > 0;
}

/** First `(`…matching `)` containing a `+`, plus an optional `xN` right after it. */
function findParenGroup(text: string): ParenGroup | null {
  const open = text.indexOf('(');
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1;
    else if (text[i] === ')') {
      depth -= 1;
      if (depth > 0) continue;
      const inner = text.slice(open + 1, i);
      if (!inner.includes('+')) return null;
      const sets = text.slice(i + 1).match(OUTER_SETS);
      return { inner, innerStart: open + 1, outerSets: sets ? Number(sets[1]) : null };
    }
  }
  return null;
}

// Splits on every `+` that has an exercise part (name + set groups) on both
// sides; any other `+` (added weight, prose) stays inside the current piece.
function splitOnPlus(text: string, offset: number): Piece[] {
  const pieces: Piece[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== '+') continue;
    const next = text.indexOf('+', i + 1);
    const right = text.slice(i + 1, next < 0 ? text.length : next);
    if (!isExercisePart(text.slice(start, i)) || !isExercisePart(right)) continue;
    pieces.push({ text: text.slice(start, i), offset: offset + start });
    start = i + 1;
  }
  pieces.push({ text: text.slice(start), offset: offset + start });
  return pieces;
}

function withSets(parsed: ParsedWorkoutLine, outerSets: number | null): ParsedWorkoutLine {
  if (outerSets == null) return parsed;
  return { ...parsed, groups: parsed.groups.map((g) => ({ ...g, sets: g.sets * outerSets })) };
}

export function parseLineSegments(line: string): LineSegment[] {
  const single = (): LineSegment[] => [{ offset: 0, parsed: parseSetGroups(line) }];

  let body = line;
  let offset = 0;
  const prefix = body.match(PREFIX);
  if (prefix) {
    offset += prefix[0].length;
    body = body.slice(prefix[0].length);
  }

  let outerSets: number | null = null;
  const paren = findParenGroup(body);
  if (paren) {
    offset += paren.innerStart;
    body = paren.inner;
    outerSets = paren.outerSets;
  }

  if (!body.includes('+')) {
    // No superset — but a stripped prefix/parens still shifts the offsets.
    if (!prefix && !paren) return single();
    return [{ offset, parsed: withSets(parseSetGroups(body), outerSets) }];
  }

  const pieces = splitOnPlus(body, offset);
  if (pieces.length < 2 && !paren && !prefix) return single();
  return pieces.map((p) => ({ offset: p.offset, parsed: withSets(parseSetGroups(p.text), outerSets) }));
}
