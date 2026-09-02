// Keeps highlight offsets attached to their words between scans. A scan
// returns spans as offsets into the note *as it was when the scan started*;
// until the next scan lands, every keystroke would otherwise slide those
// highlights onto the wrong characters. A keystroke, paste or chip insert is
// one contiguous edit, so the previous and next text pin it down exactly.

type Spanned = { spanStart?: number | null; spanEnd?: number | null };

/**
 * The single contiguous region that differs: `prev[start, prevEnd)` became
 * `next[start, nextEnd)`. Unchanged text yields an empty edit at the end.
 */
export function diffRegion(prev: string, next: string): { start: number; prevEnd: number; nextEnd: number } {
  const max = Math.min(prev.length, next.length);
  let start = 0;
  while (start < max && prev[start] === next[start]) start += 1;
  let suffix = 0;
  while (suffix < max - start && prev[prev.length - 1 - suffix] === next[next.length - 1 - suffix]) suffix += 1;
  return { start, prevEnd: prev.length - suffix, nextEnd: next.length - suffix };
}

/**
 * Moves each item's span from `prev`-text offsets to `next`-text offsets.
 * Spans before the edit stay, spans after it shift, a span the edit sits
 * inside grows or shrinks with it, and a span the edit straddles loses its
 * offsets (nulled) until the next scan re-derives it. A span never extends
 * onto text typed right after it — the parser hasn't seen that text yet.
 * Returns the same array when no span moved.
 */
export function shiftSpans<T extends Spanned>(items: T[], prev: string, next: string): T[] {
  if (prev === next) return items;
  const { start, prevEnd, nextEnd } = diffRegion(prev, next);
  const delta = nextEnd - prevEnd;
  let changed = false;
  const shifted = items.map((item) => {
    const s = item.spanStart;
    const e = item.spanEnd;
    if (s == null || e == null || e <= start) return item;
    changed = true;
    if (s >= prevEnd) return { ...item, spanStart: s + delta, spanEnd: e + delta };
    if (s <= start && prevEnd <= e && e + delta > s) return { ...item, spanEnd: e + delta };
    return { ...item, spanStart: null, spanEnd: null };
  });
  return changed ? shifted : items;
}
