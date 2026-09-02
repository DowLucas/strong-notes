import { diffRegion, shiftSpans } from '@/src/parsing/spanShift';

type S = { id: string; spanStart?: number | null; spanEnd?: number | null };
const span = (id: string, spanStart: number | null, spanEnd: number | null): S => ({ id, spanStart, spanEnd });

describe('diffRegion', () => {
  it('finds a single insertion', () => {
    expect(diffRegion('RDL 8x3', 'RDL 40kg 8x3')).toEqual({ start: 4, prevEnd: 4, nextEnd: 9 });
  });
  it('finds a single deletion', () => {
    expect(diffRegion('RDL 40kg 8x3', 'RDL 8x3')).toEqual({ start: 4, prevEnd: 9, nextEnd: 4 });
  });
  it('finds a replacement', () => {
    expect(diffRegion('Bench 60kg', 'Bench 65kg')).toEqual({ start: 7, prevEnd: 8, nextEnd: 8 });
  });
  it('treats an unchanged text as an empty edit at the end', () => {
    expect(diffRegion('abc', 'abc')).toEqual({ start: 3, prevEnd: 3, nextEnd: 3 });
  });
  it('handles repeated characters (ambiguous position) consistently', () => {
    expect(diffRegion('8x3', '8x33')).toEqual({ start: 3, prevEnd: 3, nextEnd: 4 });
  });
});

describe('shiftSpans', () => {
  //            0123456789012345678
  const prev = 'Bench 60kg 8x3\nRDL';
  const bench = span('bench', 0, 14);
  const rdl = span('rdl', 15, 18);

  it('returns the same array when the text did not change', () => {
    const items = [bench, rdl];
    expect(shiftSpans(items, prev, prev)).toBe(items);
  });

  it('shifts spans after an insertion and leaves earlier ones alone', () => {
    // Insert "BB " at the start of the RDL line.
    const next = 'Bench 60kg 8x3\nBB RDL';
    expect(shiftSpans([bench, rdl], prev, next)).toEqual([bench, span('rdl', 18, 21)]);
  });

  it('shifts spans after a deletion', () => {
    // Delete "60kg " from the bench line → everything after moves left by 5.
    const next = 'Bench 8x3\nRDL';
    expect(shiftSpans([rdl], prev, next)).toEqual([span('rdl', 10, 13)]);
  });

  it('grows a span when typing inside it and shrinks it when deleting inside it', () => {
    expect(shiftSpans([bench], prev, 'Bench 60kg 8x30\nRDL'.replace('8x30', '8x3'))).toEqual([bench]);
    // Insert "0" between "6" and "0kg".
    expect(shiftSpans([bench], prev, 'Bench 600kg 8x3\nRDL')).toEqual([span('bench', 0, 15)]);
    // Backspace the final "3".
    expect(shiftSpans([bench], prev, 'Bench 60kg 8x\nRDL')).toEqual([span('bench', 0, 13)]);
  });

  it('does not extend a span onto text typed right after it', () => {
    // The parser has not seen the new character yet, so it stays plain.
    expect(shiftSpans([rdl], prev, 'Bench 60kg 8x3\nRDLs')).toEqual([rdl]);
  });

  it('shifts a span that starts exactly where text is inserted', () => {
    expect(shiftSpans([rdl], prev, 'Bench 60kg 8x3\n  ⁃ RDL')).toEqual([span('rdl', 19, 22)]);
  });

  it('drops the highlight (nulls the offsets) when an edit crosses a span boundary', () => {
    // Delete "3\nR" — the edit straddles the bench span's end and the RDL span's start.
    const next = 'Bench 60kg 8xDL';
    expect(shiftSpans([bench, rdl], prev, next)).toEqual([span('bench', null, null), span('rdl', null, null)]);
  });

  it('drops a span whose text is deleted entirely', () => {
    expect(shiftSpans([rdl], prev, 'Bench 60kg 8x3\n')).toEqual([span('rdl', null, null)]);
  });

  it('passes through items without offsets', () => {
    const nameOnly = span('n', null, null);
    expect(shiftSpans([nameOnly], prev, prev + 'x')).toEqual([nameOnly]);
  });
});

describe('shiftSpans identity', () => {
  const prev = 'Bench 60kg 8x3\nRDL';
  const rdl = { id: 'rdl', spanStart: 15, spanEnd: 18 };

  it('returns the same array when an equal-length edit leaves every offset alone', () => {
    // Typing over a selection, or a keyboard replacing a word with one of the
    // same length, moves nothing. Cloning the entries anyway re-renders the
    // editor and re-runs every entry-keyed effect on each keystroke.
    const items = [rdl];
    expect(shiftSpans(items, prev, 'Bench 65kg 8x3\nRDL')).toBe(items);
  });

  it('still shifts when the length actually changes', () => {
    const items = [rdl];
    expect(shiftSpans(items, prev, 'Bench 605kg 8x3\nRDL')).not.toBe(items);
  });
});
