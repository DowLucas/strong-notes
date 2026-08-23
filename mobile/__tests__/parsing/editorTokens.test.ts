import {
  currentWordAt,
  suggestTokens,
  insertAtCaret,
  applyCompletion,
  needsConfirmSpanOnLine,
  spanOnLine,
  spansOnCaretLine,
} from '@/src/parsing/editorTokens';

describe('currentWordAt', () => {
  it('returns the word the caret sits inside', () => {
    // "Squa|ts 3x10" — caret at offset 4
    expect(currentWordAt('Squats 3x10', 4)).toEqual({ word: 'Squats', start: 0, end: 6 });
  });

  it('returns the word the caret sits immediately after', () => {
    // "Squats| 3x10" — caret at offset 6 (end of first word)
    expect(currentWordAt('Squats 3x10', 6)).toEqual({ word: 'Squats', start: 0, end: 6 });
  });

  it('returns an empty word at a whitespace boundary', () => {
    // "Squats |3x10" — caret at offset 7 (just after the space)
    expect(currentWordAt('Squats 3x10', 7)).toEqual({ word: '3x10', start: 7, end: 11 });
    expect(currentWordAt('Squats  3x10', 7).word).toBe('');
  });
});

describe('suggestTokens', () => {
  const dict = ['RDL', 'DB', 'BB', 'Bench', 'bar'];

  it('prefix-matches case-insensitively', () => {
    expect(suggestTokens(dict, 'b')).toEqual(['BB', 'Bench', 'bar']);
    expect(suggestTokens(dict, 'RD')).toEqual(['RDL']);
  });

  it('excludes an exact (complete) match and empty input', () => {
    expect(suggestTokens(dict, 'RDL')).toEqual([]);
    expect(suggestTokens(dict, '')).toEqual([]);
    expect(suggestTokens(dict, '   ')).toEqual([]);
  });

  it('caps the number of suggestions', () => {
    expect(suggestTokens(['ba', 'bb', 'bc', 'bd', 'be', 'bf'], 'b', 3)).toHaveLength(3);
  });
});

describe('insertAtCaret', () => {
  it('splices at a collapsed caret', () => {
    expect(insertAtCaret('40', { start: 2, end: 2 }, 'kg')).toEqual({ text: '40kg', caret: 4 });
  });

  it('replaces a selection range', () => {
    expect(insertAtCaret('40lb', { start: 2, end: 4 }, 'kg')).toEqual({ text: '40kg', caret: 4 });
  });
});

describe('applyCompletion', () => {
  it('replaces the word and appends a trailing space at end of text', () => {
    // Complete "RD" -> "RDL " in "Squats 3x10 RD"
    expect(applyCompletion('Squats 3x10 RD', 12, 14, 'RDL')).toEqual({
      text: 'Squats 3x10 RDL ',
      caret: 16,
    });
  });

  it('does not double the space when the word is already followed by one', () => {
    // Complete "RD" in "RD 40kgx8" — the existing space is reused
    expect(applyCompletion('RD 40kgx8', 0, 2, 'RDL')).toEqual({ text: 'RDL 40kgx8', caret: 3 });
  });
});

describe('needsConfirmSpanOnLine', () => {
  const spans = [
    { start: 0, end: 6, status: 'needs-confirm', entryId: 'a' }, // line 0
    { start: 12, end: 16, status: 'resolved', entryId: 'b' }, // line 1
  ];
  const text = 'Squats\nBench 60kg';

  it('finds a needs-confirm span on the caret line', () => {
    expect(needsConfirmSpanOnLine(text, spans, 3)?.entryId).toBe('a');
  });

  it('returns null when the caret line has no needs-confirm span', () => {
    expect(needsConfirmSpanOnLine(text, spans, 13)).toBeNull();
  });
});

describe('spansOnCaretLine', () => {
  // "rdl 40kgx8\nBench 60kgx8" — rdl on line 0 (start 0), Bench on line 1 (start 11).
  const text = 'rdl 40kgx8\nBench 60kgx8';
  const spans = [
    { start: 0, exerciseId: 'ex-rdl' },
    { start: 11, exerciseId: 'ex-bench' },
  ];

  it('returns only the spans on the caret line', () => {
    expect(spansOnCaretLine(text, spans, 3).map((s) => s.exerciseId)).toEqual(['ex-rdl']);
    expect(spansOnCaretLine(text, spans, 15).map((s) => s.exerciseId)).toEqual(['ex-bench']);
  });

  it('returns nothing when the caret line has no spans', () => {
    // Caret on an empty line 1.
    expect(spansOnCaretLine('rdl 40kgx8\n', [{ start: 0 }], 11)).toEqual([]);
  });
});

describe('spanOnLine', () => {
  const text = 'RDL 40kg 8x3\nBench 60kg 8x3';
  it('prefers a needs-confirm span on the caret line, else a resolved one, else null', () => {
    const spans = [
      { start: 0, status: 'resolved', entryId: 'a' },
      { start: 13, status: 'resolved', entryId: 'b' },
      { start: 19, status: 'needs-confirm', entryId: 'c' },
    ];
    expect(spanOnLine(text, spans, 2)?.entryId).toBe('a');
    expect(spanOnLine(text, spans, 15)?.entryId).toBe('c');
    expect(spanOnLine('plain', [], 0)).toBeNull();
  });
});

