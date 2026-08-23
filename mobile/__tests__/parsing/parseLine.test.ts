import { parseLineSegments } from '@/src/parsing/parseLine';

describe('parseLineSegments', () => {
  it('returns one segment at offset 0 for a normal line', () => {
    const segs = parseLineSegments('30kg bb rows 8x3');
    expect(segs).toHaveLength(1);
    expect(segs[0].offset).toBe(0);
    expect(segs[0].parsed.namePart).toBe('bb rows');
  });

  it('splits a parenthesised superset on + and applies the outer xN as sets to every part', () => {
    const line = 'SS: (5kg db OHSP x8 + shoulder rotation x8) x3';
    const segs = parseLineSegments(line);
    expect(segs).toHaveLength(2);
    expect(segs[0].parsed.namePart).toBe('db OHSP');
    expect(segs[0].parsed.groups[0]).toMatchObject({ weightKg: 5, reps: 8, sets: 3 });
    expect(segs[1].parsed.namePart).toBe('shoulder rotation');
    expect(segs[1].parsed.groups[0]).toMatchObject({ weightKg: null, reps: 8, sets: 3 });
    // Offsets map each segment's spans back into the original line.
    const g0 = segs[0].parsed.groups[0];
    const g1 = segs[1].parsed.groups[0];
    expect(line.slice(segs[0].offset + g0.start, segs[0].offset + g0.end)).toBe('5kg db OHSP x8');
    expect(line.slice(segs[1].offset + g1.start, segs[1].offset + g1.end)).toBe('x8');
    expect(line.slice(segs[1].offset + segs[1].parsed.namePartStart, segs[1].offset + segs[1].parsed.namePartStart + segs[1].parsed.namePart.length)).toBe('shoulder rotation');
  });

  it('splits a bare + superset without parens or prefix; no outer sets keeps each part own', () => {
    const segs = parseLineSegments('bench 60kg 8x3 + pull ups 10x3');
    expect(segs).toHaveLength(2);
    expect(segs[0].parsed.groups[0]).toMatchObject({ weightKg: 60, reps: 8, sets: 3 });
    expect(segs[1].parsed.groups[0]).toMatchObject({ weightKg: null, reps: 10, sets: 3 });
  });

  it('multiplies explicit per-part sets by the outer count', () => {
    const segs = parseLineSegments('(squat 8x2 + lunge x10) x3');
    expect(segs[0].parsed.groups[0].sets).toBe(6);
    expect(segs[1].parsed.groups[0].sets).toBe(3);
  });

  it('does not treat a + inside prose as a superset when no part has set tokens', () => {
    const segs = parseLineSegments('felt good + tired');
    expect(segs).toHaveLength(1);
    expect(segs[0].parsed.groups).toEqual([]);
  });

  it('keeps an added-weight + (`+20kg`) in the same segment instead of splitting a superset', () => {
    for (const line of ['Dips 8x3 +20kg', 'Dips 8x3 + 20kg', 'Pull ups BW+10kg 8x3']) {
      const segs = parseLineSegments(line);
      expect(segs).toHaveLength(1);
      expect(segs[0].offset).toBe(0);
      expect(segs[0].parsed.groups.length).toBeGreaterThan(0);
    }
  });

  it('still splits a superset whose second part follows an added-weight +', () => {
    const segs = parseLineSegments('Dips 8x3 +20kg + pull ups 10x3');
    expect(segs).toHaveLength(2);
    expect(segs[1].parsed.namePart).toBe('pull ups');
    expect(segs[1].parsed.groups[0]).toMatchObject({ reps: 10, sets: 3 });
  });

  it('handles a parenthesised superset followed by a trailing comment', () => {
    const plain = 'SS: (5kg db OHSP x8 + shoulder rotation x8) x3';
    const line = `${plain} rest 60s`;
    const segs = parseLineSegments(line);
    const expected = parseLineSegments(plain);
    expect(segs).toHaveLength(2);
    expect(segs[0].parsed.namePart).toBe('db OHSP');
    expect(segs[1].parsed.namePart).toBe('shoulder rotation');
    expect(segs[0].parsed.groups[0].sets).toBe(3);
    expect(segs[1].parsed.groups[0].sets).toBe(3);
    expect(segs).toEqual(expected);
    const g0 = segs[0].parsed.groups[0];
    const g1 = segs[1].parsed.groups[0];
    expect(line.slice(segs[0].offset + g0.start, segs[0].offset + g0.end)).toBe('5kg db OHSP x8');
    expect(line.slice(segs[1].offset + g1.start, segs[1].offset + g1.end)).toBe('x8');
  });

  it('splits a superset whose parts use the `8x` reps form', () => {
    const segs = parseLineSegments('SS: (5kg db OHSP 8x + shoulder rotation 8x) x3');
    expect(segs.map((s) => [s.parsed.namePart, s.parsed.groups[0]?.reps, s.parsed.groups[0]?.sets])).toEqual([
      ['db OHSP', 8, 3],
      ['shoulder rotation', 8, 3],
    ]);
  });
});
