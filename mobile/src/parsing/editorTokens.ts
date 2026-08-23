// Pure text helpers backing the workout editor's keyboard accessory bar:
// autocomplete of the caret's current word, caret-aware text insertion, and
// locating a needs-confirm highlight on the caret's line. Kept free of React
// so they're unit-testable in isolation.

export type Selection = { start: number; end: number };

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(n, hi));
}

// The whitespace-delimited word the caret sits inside or immediately after —
// what dictionary autocomplete completes. Returns an empty word (and start ===
// end) when the caret is at a whitespace boundary, i.e. nothing to complete.
export function currentWordAt(
  text: string,
  caret: number,
): { word: string; start: number; end: number } {
  const c = clamp(caret, 0, text.length);
  let start = c;
  while (start > 0 && !/\s/.test(text[start - 1])) start -= 1;
  let end = c;
  while (end < text.length && !/\s/.test(text[end])) end += 1;
  return { word: text.slice(start, end), start, end };
}

// Case-insensitive prefix matches among known dictionary tokens, dropping an
// exact match (already complete) and duplicates, capped at `limit`.
export function suggestTokens(tokens: string[], word: string, limit = 5): string[] {
  const w = word.trim().toUpperCase();
  if (w.length === 0) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tokens) {
    const up = t.toUpperCase();
    if (up === w || !up.startsWith(w) || seen.has(up)) continue;
    seen.add(up);
    out.push(t);
    if (out.length >= limit) break;
  }
  return out;
}

// Splice `insert` into text over the current selection, returning the new text
// and the caret offset just after the inserted string.
export function insertAtCaret(
  text: string,
  sel: Selection,
  insert: string,
): { text: string; caret: number } {
  const start = clamp(sel.start, 0, text.length);
  const end = clamp(sel.end, start, text.length);
  return { text: text.slice(0, start) + insert + text.slice(end), caret: start + insert.length };
}

// Replace the word spanning [start, end) with `replacement`, adding a trailing
// space only when one isn't already there (so completing a word mid-line
// doesn't double the space). The caret lands just after the inserted text.
export function applyCompletion(
  text: string,
  start: number,
  end: number,
  replacement: string,
): { text: string; caret: number } {
  const followedBySpace = end < text.length && /\s/.test(text[end]);
  const insert = followedBySpace ? replacement : `${replacement} `;
  return { text: text.slice(0, start) + insert + text.slice(end), caret: start + insert.length };
}

function lineOf(text: string, offset: number): number {
  let line = 0;
  const stop = clamp(offset, 0, text.length);
  for (let i = 0; i < stop; i += 1) if (text[i] === '\n') line += 1;
  return line;
}

// All spans that begin on the same line as the caret — used to find the active
// line's exercise for the prior-stats hint.
export function spansOnCaretLine<T extends { start: number }>(
  text: string,
  spans: T[],
  caret: number,
): T[] {
  const caretLine = lineOf(text, caret);
  return spans.filter((s) => lineOf(text, s.start) === caretLine);
}

// The first needs-confirm span on the same line as the caret — used to surface
// an inline "Confirm" chip so the user needn't hunt for the underlined tap
// target. Returns null when the caret's line has no unresolved highlight.
export function needsConfirmSpanOnLine<T extends { start: number; status: string }>(
  text: string,
  spans: T[],
  caret: number,
): T | null {
  const caretLine = lineOf(text, caret);
  for (const s of spans) {
    if (s.status === 'needs-confirm' && lineOf(text, s.start) === caretLine) return s;
  }
  return null;
}

// The span the keyboard bar should act on for the caret's line: an
// unconfirmed one first (confirming is the primary action), otherwise a
// confirmed one (details), otherwise null.
export function spanOnLine<T extends { start: number; status: string }>(
  text: string,
  spans: T[],
  caret: number,
): T | null {
  const pending = needsConfirmSpanOnLine(text, spans, caret);
  if (pending) return pending;
  const caretLine = lineOf(text, caret);
  for (const s of spans) {
    if (s.status === 'resolved' && lineOf(text, s.start) === caretLine) return s;
  }
  return null;
}

