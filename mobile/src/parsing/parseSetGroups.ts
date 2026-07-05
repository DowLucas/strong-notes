export type SetGroup = {
  weightKg: number | null;
  reps: number | null;
  sets: number;
  token: string;
  start: number;
  end: number;
};

export type ParsedWorkoutLine = {
  namePart: string;
  groups: SetGroup[];
};

// A line is "packed" when a weight-with-unit (or `bar`) is glued directly to an
// `x` chain, e.g. `40kgx8` or `barx12`. That signals the packed grammar where a
// bare `A x B` token means weight×reps rather than reps×sets.
const PACKED_LINE = /(?:\d+(?:\.\d+)?(?:kg|lb)|bar)x\d/i;

// A packed group token: <weight>[unit] x <reps> [x <sets>], where <weight> is a
// number or `bar`.
const PACKED_GROUP = /^(bar|\d+(?:\.\d+)?)(?:kg|lb)?x(\d+)(?:x(\d+))?$/i;

// Clean-notation tokens (used only for non-packed lines).
const WEIGHT_ONLY = /^(\d+(?:\.\d+)?)(?:kg|lb)$/i;
const REPS_SETS = /^(\d+)x(\d+)$/i;

// Leading list bullets to strip from a name/continuation prefix.
const LEADING_BULLET = /^[\s\-•⁃]+/;

type Token = { text: string; start: number; end: number };

function tokenize(line: string): Token[] {
  const tokens: Token[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    tokens.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  }
  return tokens;
}

function nameBefore(line: string, firstGroupStart: number): string {
  return line.slice(0, firstGroupStart).replace(LEADING_BULLET, '').trim();
}

function parsePackedToken(t: Token): SetGroup | null {
  const m = t.text.match(PACKED_GROUP);
  if (!m) return null;
  const weightKg = /^bar$/i.test(m[1]) ? null : Number(m[1]);
  return {
    weightKg,
    reps: Number(m[2]),
    sets: m[3] ? Number(m[3]) : 1,
    token: t.text,
    start: t.start,
    end: t.end,
  };
}

function parsePacked(line: string, tokens: Token[]): ParsedWorkoutLine {
  const groups: SetGroup[] = [];
  for (const t of tokens) {
    const g = parsePackedToken(t);
    if (g) groups.push(g);
  }
  if (groups.length === 0) return { namePart: '', groups: [] };
  return { namePart: nameBefore(line, groups[0].start), groups };
}

function parseClean(line: string, tokens: Token[]): ParsedWorkoutLine {
  let weight: number | null = null;
  let repsSets: Token | null = null;
  let weightToken: Token | null = null;

  for (const t of tokens) {
    const rs = t.text.match(REPS_SETS);
    if (rs) {
      repsSets = t;
      continue;
    }
    const w = t.text.match(WEIGHT_ONLY);
    if (w) {
      weight = Number(w[1]);
      weightToken = t;
    }
  }

  if (!repsSets && !weightToken) return { namePart: '', groups: [] };

  const first = [repsSets, weightToken]
    .filter((t): t is Token => t != null)
    .sort((a, b) => a.start - b.start)[0];
  const last = [repsSets, weightToken]
    .filter((t): t is Token => t != null)
    .sort((a, b) => a.end - b.end)
    .slice(-1)[0];

  const rsMatch = repsSets?.text.match(REPS_SETS);
  const group: SetGroup = {
    weightKg: weight,
    reps: rsMatch ? Number(rsMatch[1]) : null,
    sets: rsMatch ? Number(rsMatch[2]) : 1,
    token: line.slice(first.start, last.end),
    start: first.start,
    end: last.end,
  };
  return { namePart: nameBefore(line, first.start), groups: [group] };
}

export function parseSetGroups(line: string): ParsedWorkoutLine {
  const tokens = tokenize(line);
  if (tokens.length === 0) return { namePart: '', groups: [] };
  return PACKED_LINE.test(line) ? parsePacked(line, tokens) : parseClean(line, tokens);
}
