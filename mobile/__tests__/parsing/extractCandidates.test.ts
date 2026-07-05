// __tests__/parsing/extractCandidates.test.ts
import { extractCandidates } from '@/src/parsing/extractCandidates';

describe('extractCandidates', () => {
  it('extracts a single clause containing a set, with correct offsets', () => {
    const text = 'Felt strong today, did Bench Press 60kg 8x3, work on grip';
    const found = extractCandidates(text);
    expect(found).toHaveLength(1);
    expect(found[0].text).toBe('did Bench Press 60kg 8x3');
    expect(text.slice(found[0].start, found[0].end)).toBe('did Bench Press 60kg 8x3');
  });

  it('extracts multiple clauses across separators and newlines', () => {
    const text = 'RDL 40kg 8x3\nDB Curl 12kg 10x3';
    const found = extractCandidates(text);
    expect(found.map((c) => c.text)).toEqual(['RDL 40kg 8x3', 'DB Curl 12kg 10x3']);
  });

  it('returns nothing for prose with no numeric anchor', () => {
    expect(extractCandidates('Felt tired, skipped the gym today.')).toEqual([]);
  });

  it('ignores bare numbers with no unit or reps pattern', () => {
    // "3 things" has a bare number but no weight-unit or NxN anchor.
    expect(extractCandidates('Need to fix 3 things about my form')).toEqual([]);
  });
});
