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
// A bare reps token (`x8` or `8x`) — reps with no set count (one set, or the superset
// line's outer count applies — see parseLine.ts).
const REPS_ONLY = /^(?:x(\d+)|(\d+)x)$/i;
// A comma-separated list of rep counts (`8,8,6`) — one set per entry.
const REP_LIST = /^\d+(?:,\d+)+$/;

// Leading list bullets to strip from a name/continuation prefix.
const LEADING_BULLET = /^[\s\-•⁃]+/;
const BULLET_TOKEN = /^[\-•⁃]+$/;

type Token = { text: string; start: number; end: number };

// ---------------------------------------------------------------------------
// Normalization
//
// Users write the same thing with varying whitespace and markers: `8 x 3`,
// `30 kg`, `30kg x 8 x 3`, `@30kg`, `8, 8, 6`. Rather than teaching every
// matcher about optional spaces, we first build a normalized copy of the line
// with those gaps removed (and `@` turned into a space), alongside a map from
// each normalized index back to its original index. All parsing runs on the
// normalized text; every offset that leaves this module is mapped back so
// highlights land on the user's actual characters.
// ---------------------------------------------------------------------------

type Normalized = { text: string; map: number[] };

const NUMBERISH_END = /(\d|kg|lb|bar)$/i;
const X_JOIN_END = /(\d|kg|lb|bar)x$/i;
const X_THEN_NUMBERISH = /^x\s*(\d|bar)/i;
const NUMBERISH_START = /^(\d|bar)/i;
const UNIT_START = /^(kg|lb)(?![a-z])/i;
// The kept text ends with a comma-terminated integer list — a bare `8,` /
// `8,8,`, or a packed `30kgx8,` — but NOT a reps×sets `8x3,` or a weight
// `60kg,`, whose comma separates groups rather than list entries.
const INT_LIST_THEN_COMMA = /(?:^|\s|(?:kg|lb|bar)x)\d+(?:,\d+)*,$/i;

function isGap(ch: string): boolean {
  return /\s|@/.test(ch);
}

/** True if the whitespace run between `kept` (normalized so far) and `rest` is a joinable gap. */
function gapIsJoinable(kept: string, rest: string): boolean {
  // `8 x 3`, `30kg x 8`, `bar x 12` — a gap before an x-chain continuation.
  if (NUMBERISH_END.test(kept) && X_THEN_NUMBERISH.test(rest)) return true;
  // `30kgx 8`, `8x 3` — a gap after an x that already attached to a number.
  if (X_JOIN_END.test(kept) && NUMBERISH_START.test(rest)) return true;
  // `30 kg`
  if (/\d$/.test(kept) && UNIT_START.test(rest)) return true;
  // `8, 8, 6` / `30kgx8, 8, 6` — but not `8x3, 65kg`.
  if (INT_LIST_THEN_COMMA.test(kept) && /^\d/.test(rest)) return true;
  return false;
}

function normalize(line: string): Normalized {
  let text = '';
  const map: number[] = [];
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (!isGap(ch)) {
      text += ch;
      map.push(i);
      i += 1;
      continue;
    }
    // Consume the whole run of whitespace / `@`.
    let j = i;
    while (j < line.length && isGap(line[j])) j += 1;
    if (!gapIsJoinable(text, line.slice(j))) {
      // Keep a single space standing in for the run (so tokens still split),
      // mapped to the run's first character.
      text += ' ';
      map.push(i);
    }
    i = j;
  }
  return { text, map };
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    tokens.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// Parsing (all offsets below are in normalized space)
// ---------------------------------------------------------------------------

type Span = { start: number; end: number };
/** A group before its token text / original offsets are resolved. */
type RawGroup = { weightKg: number | null; reps: number | null; sets: number } & Span;
type RawLine = { nameStart: number; nameEnd: number; groups: RawGroup[] };

const EMPTY: RawLine = { nameStart: 0, nameEnd: 0, groups: [] };

/** Split a rep-list token (`8,8,6`) into per-number spans. */
function repListParts(t: Token): Array<{ reps: number } & Span> {
  const out: Array<{ reps: number } & Span> = [];
  let pos = t.start;
  for (const part of t.text.split(',')) {
    out.push({ reps: Number(part), start: pos, end: pos + part.length });
    pos += part.length + 1;
  }
  return out;
}

// Parses one packed group token, splitting on `x`. The unit-tagged part (or
// `bar`) is the weight wherever it sits; remaining bare numbers are reps then
// sets, in order — so `40kgx8`, `8x40kg`, and `8x2kg` all read weight+reps. A
// token with no weight marker at all (e.g. `43x4`) keeps the legacy packed
// meaning of weight×reps[×sets], first number first. A rep list in place of
// the reps (`30kgx8,8,6`) yields one group per entry.
function parsePackedToken(t: Token): RawGroup[] {
  const parts = t.text.split(/x/i);
  if (parts.length < 2) return [];

  let weight: number | null | undefined;
  let weightCount = 0;
  const bares: number[] = [];
  let repList: Token | null = null;
  let pos = t.start;

  for (const p of parts) {
    if (p === '') return []; // malformed, e.g. `x8` or `8xx3`
    if (BAR_TOKEN.test(p)) {
      weight = null;
      weightCount += 1;
    } else if (REP_LIST.test(p)) {
      if (repList) return [];
      repList = { text: p, start: pos, end: pos + p.length };
    } else {
      const w = p.match(WEIGHT_ONLY);
      if (w) {
        weight = Number(w[1]);
        weightCount += 1;
      } else if (BARE_NUM.test(p)) {
        bares.push(Number(p));
      } else {
        return []; // unrecognized part
      }
    }
    pos += p.length + 1;
  }
  if (weightCount > 1) return []; // two weights → ambiguous

  if (repList) {
    // `30kgx8,8,6` — exactly one weight, no other bare numbers.
    if (weightCount !== 1 || bares.length > 0) return [];
    const weightKg = weight === undefined ? null : weight;
    return repListParts(repList).map((p, idx) => ({
      weightKg,
      reps: p.reps,
      sets: 1,
      start: idx === 0 ? t.start : p.start,
      end: p.end,
    }));
  }

  if (weightCount === 1) {
    if (bares.length < 1 || bares.length > 2) return [];
    return [
      {
        weightKg: weight === undefined ? null : weight,
        reps: bares[0],
        sets: bares.length === 2 ? bares[1] : 1,
        start: t.start,
        end: t.end,
      },
    ];
  }

  // No weight marker: legacy weight-first bare chain (`43x4` → 43kg × 4).
  if (bares.length < 2 || bares.length > 3) return [];
  return [
    {
      weightKg: bares[0],
      reps: bares[1],
      sets: bares.length === 3 ? bares[2] : 1,
      start: t.start,
      end: t.end,
    },
  ];
}

function parsePacked(tokens: Token[]): RawLine {
  const groups = tokens.flatMap(parsePackedToken);
  if (groups.length === 0) return EMPTY;
  return { nameStart: 0, nameEnd: groups[0].start, groups };
}

// In clean notation a comma may separate whole groups (`8x3, 6x2` or
// `8x3,6x2`). Drop a trailing comma from a token, and split a token made of
// comma-joined reps×sets parts into one token per part.
function splitCleanToken(t: Token): Token[] {
  const text = t.text.replace(/,+$/, '');
  if (text === '') return [t];
  const parts = text.split(',');
  if (parts.length > 1 && parts.every((p) => REPS_SETS.test(p))) {
    let pos = t.start;
    return parts.map((p) => {
      const tok = { text: p, start: pos, end: pos + p.length };
      pos += p.length + 1;
      return tok;
    });
  }
  return [{ text, start: t.start, end: t.start + text.length }];
}

// A comma list of numbers is only a rep list when the line gives it workout
// context; otherwise dates (`2022, 03, 03`), distances (`Ran 5, 10 km`) and
// headings (`Vecka 9, 10`) would turn into sets. Rule: the list counts when
//   (a) a weight token precedes it on the line (`30kg 8,8,6`), or directly
//       follows it (`Pull ups 10,8 @20kg`); or
//   (b) it has ≥3 entries, every entry is a plausible rep count (1–100), and
//       it is the last token on the line (`Pull ups 10,8,6`).
// Accepted trade-off: a weightless two-entry list (`Pull ups 10, 8`) is
// rejected — too ambiguous to tell from a date or a heading.
function isRepListInContext(toks: Token[], index: number, hasPrecedingWeight: boolean): boolean {
  const next = toks[index + 1];
  if (hasPrecedingWeight || (next && WEIGHT_ONLY.test(next.text))) return true;
  const entries = toks[index].text.split(',').map(Number);
  return entries.length >= 3 && entries.every((n) => n >= 1 && n <= 100) && index === toks.length - 1;
}

// Clean / prose notation: weights are standalone unit-tagged tokens (`30kg`),
// reps are bare `reps×sets` tokens (`8x3`) or comma rep lists (`8,8,6`).
//
// Each reps token takes the nearest preceding weight (a weight carries forward
// to later reps tokens until another weight replaces it), or — when nothing
// precedes it — the nearest following weight before the next reps token
// (`Bench 8x3 @50kg`). A weight written directly after a reps token belongs
// to it and wins over a carried-forward weight (`Bench 60kg 8x3 6x2 @65kg`)
// — unless that weight also sits directly before the next reps token, in
// which case it reads as that token's preceding weight (`Bench 60kg 8x3 65kg
// 6x2`). A weight may lead the line ahead of the exercise name (`30kg bb
// deadlifts 8x3`); it then belongs to the first group, whose span runs from
// that weight through the reps token, and the name is the text in between.
function parseClean(rawTokens: Token[]): RawLine {
  type Reps = { token: Token; index: number; sets: number; parts: Array<{ reps: number } & Span> };
  type Weight = { value: number; token: Token; index: number };
  const tokens = rawTokens.flatMap(splitCleanToken);
  const repsTokens: Reps[] = [];
  const weights: Weight[] = [];

  tokens.forEach((t, index) => {
    const rs = t.text.match(REPS_SETS);
    if (rs) {
      repsTokens.push({ token: t, index, sets: Number(rs[2]), parts: [{ reps: Number(rs[1]), start: t.start, end: t.end }] });
      return;
    }
    const ro = t.text.match(REPS_ONLY);
    if (ro) {
      repsTokens.push({ token: t, index, sets: 1, parts: [{ reps: Number(ro[1] ?? ro[2]), start: t.start, end: t.end }] });
      return;
    }
    if (REP_LIST.test(t.text) && isRepListInContext(tokens, index, weights.length > 0)) {
      repsTokens.push({ token: t, index, sets: 1, parts: repListParts(t) });
      return;
    }
    const w = t.text.match(WEIGHT_ONLY);
    if (w) weights.push({ value: Number(w[1]), token: t, index });
  });

  // A leading weight: the first non-bullet token, when it's a weight that
  // comes before the first reps token (or there are no reps at all).
  const firstWord = tokens.findIndex((t) => !BULLET_TOKEN.test(t.text));
  const leading =
    weights.find((w) => w.index === firstWord && (repsTokens.length === 0 || w.index < repsTokens[0].index)) ?? null;

  // Weight-only line: a single group with unknown reps. Name-first (`RDL
  // 40kg`) names the text before the weight; weight-first (`20kg bb
  // bänkpress`) names the text after it and the group spans the whole line.
  if (repsTokens.length === 0) {
    if (weights.length === 0) return EMPTY;
    const w = weights[0];
    const lastToken = tokens[tokens.length - 1];
    if (leading && lastToken.end > w.token.end) {
      return {
        nameStart: w.token.end,
        nameEnd: lastToken.end,
        groups: [{ weightKg: w.value, reps: null, sets: 1, start: w.token.start, end: lastToken.end }],
      };
    }
    return {
      nameStart: 0,
      nameEnd: w.token.start,
      groups: [{ weightKg: w.value, reps: null, sets: 1, start: w.token.start, end: w.token.end }],
    };
  }

  // A weight claimed by the group *before* it (`8x3 @60kg`) belongs to that
  // group alone and must not carry forward to the next reps token.
  const claimedAsFollowing = new Set<Weight>();

  const groups: RawGroup[] = [];
  repsTokens.forEach((r, i) => {
    const next = repsTokens[i + 1] ?? null;
    const nextIndex = next ? next.index : Infinity;
    const preceding =
      weights.filter((w) => w.index < r.index && !claimedAsFollowing.has(w)).slice(-1)[0] ?? null;
    let following: Weight | null = null;
    if (!preceding) {
      following = weights.find((w) => w.index > r.index && w.index < nextIndex) ?? null;
    } else {
      // A weight directly after this reps token wins over the carried-forward
      // one — unless it is also directly before the next reps token.
      const adjacent = weights.find((w) => w.index === r.index + 1) ?? null;
      if (adjacent && !(next && next.index === adjacent.index + 1)) following = adjacent;
    }
    if (following) claimedAsFollowing.add(following);
    const weight = following ?? preceding;

    const last = r.parts.length - 1;
    r.parts.forEach((p, idx) => {
      // The weight token joins the span only when it's adjacent to this reps
      // token (the immediately preceding/following token) or is the line's
      // leading weight (whose span runs through the name).
      const attachesBefore =
        idx === 0 && weight != null && (weight === leading || weight.index === r.index - 1);
      const attachesAfter = idx === last && following != null && following.index === r.index + 1;
      groups.push({
        weightKg: weight ? weight.value : null,
        reps: p.reps,
        sets: r.sets,
        start: attachesBefore ? weight!.token.start : p.start,
        end: attachesAfter ? following!.token.end : p.end,
      });
    });
  });

  // The name runs from after the leading weight (if any) up to the first
  // numeric token.
  const nameStart = leading ? leading.token.end : 0;
  const firstNumeric = Math.min(
    repsTokens[0].token.start,
    ...weights.filter((w) => w !== leading).map((w) => w.token.start),
  );
  return { nameStart, nameEnd: Math.max(nameStart, firstNumeric), groups };
}

// ---------------------------------------------------------------------------
// Public entry point: normalize → parse → map offsets back to the original.
// ---------------------------------------------------------------------------

export function parseSetGroups(line: string): ParsedWorkoutLine {
  const norm = normalize(line);
  const tokens = tokenize(norm.text);
  if (tokens.length === 0) return { namePart: '', namePartStart: 0, groups: [] };

  const packed = tokens.some((t) => PACKED_LINE.test(t.text));
  const raw = packed ? parsePacked(tokens) : parseClean(tokens);
  if (raw.groups.length === 0) return { namePart: '', namePartStart: 0, groups: [] };

  const toOrig = (s: Span): Span => ({ start: norm.map[s.start], end: norm.map[s.end - 1] + 1 });

  const groups: SetGroup[] = raw.groups.map((g) => {
    const span = toOrig(g);
    return { weightKg: g.weightKg, reps: g.reps, sets: g.sets, token: line.slice(span.start, span.end), ...span };
  });

  // Name: the original text between nameStart and nameEnd, minus any leading
  // bullet, trimmed — with namePartStart pointing at where that trimmed text
  // begins in the original line.
  let namePart = '';
  let namePartStart = 0;
  if (raw.nameEnd > raw.nameStart) {
    const region = toOrig({ start: raw.nameStart, end: raw.nameEnd });
    const rawName = line.slice(region.start, region.end).replace(LEADING_BULLET, '');
    namePart = rawName.trim();
    namePartStart = region.end - rawName.trimStart().length;
  }

  return { namePart, namePartStart, groups };
}
