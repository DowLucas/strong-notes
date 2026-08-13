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
  /** Character offset within the line where the trimmed namePart begins. */
  namePartStart: number;
  groups: SetGroup[];
};

// A line is "packed" when a weight marker — a unit (kg/lb) or `bar` — sits in an
// `x` chain, on EITHER side of an x. This covers weight-first (`40kgx8`,
// `barx12`) and weight-anywhere (`8x2kg`, `8x40kgx3`). The presence of a marked
// weight is what distinguishes packed notation from a bare reps×sets `8x3`, and
// signals that a bare `A x B` token in the line means weight×reps.
const PACKED_LINE = /(?:\d+(?:\.\d+)?(?:kg|lb)|bar)x\d|x(?:\d+(?:\.\d+)?(?:kg|lb)|bar)/i;

// A single unit-tagged weight (`40kg`, `23.5kg`), a bare integer, or `bar`.
const WEIGHT_ONLY = /^(\d+(?:\.\d+)?)(?:kg|lb)$/i;
const BARE_NUM = /^\d+$/;
const BAR_TOKEN = /^bar$/i;
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

function nameBefore(line: string, firstGroupStart: number): { text: string; start: number } {
  // Stripping the leading bullet only removes characters from the front, so
  // `raw`'s content still ends exactly at firstGroupStart in the original
  // line — its own start there is firstGroupStart - raw.length. From that,
  // trimStart()'s remaining length tells us how much further in the trimmed
  // text actually begins.
  const raw = line.slice(0, firstGroupStart).replace(LEADING_BULLET, '');
  return { text: raw.trim(), start: firstGroupStart - raw.trimStart().length };
}

// Parses one packed group token, splitting on `x`. The unit-tagged part (or
// `bar`) is the weight wherever it sits; remaining bare numbers are reps then
// sets, in order — so `40kgx8`, `8x40kg`, and `8x2kg` all read weight+reps. A
// token with no weight marker at all (e.g. `43x4`) keeps the legacy packed
// meaning of weight×reps[×sets], first number first.
function parsePackedToken(t: Token): SetGroup | null {
  const parts = t.text.split(/x/i);
  if (parts.length < 2) return null;

  let weight: number | null | undefined;
  let weightCount = 0;
  const bares: number[] = [];

  for (const p of parts) {
    if (p === '') return null; // malformed, e.g. `x8` or `8xx3`
    if (BAR_TOKEN.test(p)) {
      weight = null;
      weightCount += 1;
    } else {
      const w = p.match(WEIGHT_ONLY);
      if (w) {
        weight = Number(w[1]);
        weightCount += 1;
      } else if (BARE_NUM.test(p)) {
        bares.push(Number(p));
      } else {
        return null; // unrecognized part
      }
    }
  }
  if (weightCount > 1) return null; // two weights → ambiguous

  if (weightCount === 1) {
    if (bares.length < 1 || bares.length > 2) return null;
    return {
      weightKg: weight === undefined ? null : weight,
      reps: bares[0],
      sets: bares.length === 2 ? bares[1] : 1,
      token: t.text,
      start: t.start,
      end: t.end,
    };
  }

  // No weight marker: legacy weight-first bare chain (`43x4` → 43kg × 4).
  if (bares.length < 2 || bares.length > 3) return null;
  return {
    weightKg: bares[0],
    reps: bares[1],
    sets: bares.length === 3 ? bares[2] : 1,
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
  if (groups.length === 0) return { namePart: '', namePartStart: 0, groups: [] };
  const name = nameBefore(line, groups[0].start);
  return { namePart: name.text, namePartStart: name.start, groups };
}

// A clean line with two or more bare reps×sets tokens (e.g. `Squats 3x10 2x10`
// or `Bench 60kg 8x3 65kg 6x2`) is multiple set-groups, mirroring how packed
// notation emits one group per token. Each reps×sets token becomes a group,
// carrying the nearest preceding weight token (or null when there's none), so a
// bodyweight line like `3x10 2x10` yields two weightless groups.
//
// The single-reps×sets case stays in parseClean, which — unlike this
// left-to-right walk — associates a weight regardless of order (so
// `Bench 8x3 50kg` still reads 50kg onto the one group).
function parseCleanMulti(line: string, tokens: Token[]): ParsedWorkoutLine {
  const groups: SetGroup[] = [];
  let pendingWeight: { value: number; token: Token } | null = null;

  for (const t of tokens) {
    const rs = t.text.match(REPS_SETS);
    if (rs) {
      const start = pendingWeight ? pendingWeight.token.start : t.start;
      groups.push({
        weightKg: pendingWeight ? pendingWeight.value : null,
        reps: Number(rs[1]),
        sets: Number(rs[2]),
        token: line.slice(start, t.end),
        start,
        end: t.end,
      });
      pendingWeight = null;
      continue;
    }
    const w = t.text.match(WEIGHT_ONLY);
    if (w) pendingWeight = { value: Number(w[1]), token: t };
  }

  const name = nameBefore(line, groups[0].start);
  return { namePart: name.text, namePartStart: name.start, groups };
}

function parseClean(line: string, tokens: Token[]): ParsedWorkoutLine {
  // Two or more reps×sets tokens means multiple set-groups; a single one keeps
  // the order-independent weight+reps behavior below.
  if (tokens.filter((t) => REPS_SETS.test(t.text)).length >= 2) {
    return parseCleanMulti(line, tokens);
  }

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

  if (!repsSets && !weightToken) return { namePart: '', namePartStart: 0, groups: [] };

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
  const name = nameBefore(line, first.start);
  return { namePart: name.text, namePartStart: name.start, groups: [group] };
}

export function parseSetGroups(line: string): ParsedWorkoutLine {
  const tokens = tokenize(line);
  if (tokens.length === 0) return { namePart: '', namePartStart: 0, groups: [] };
  return PACKED_LINE.test(line) ? parsePacked(line, tokens) : parseClean(line, tokens);
}
