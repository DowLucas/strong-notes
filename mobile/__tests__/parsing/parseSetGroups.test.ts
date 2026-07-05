import { parseSetGroups } from '@/src/parsing/parseSetGroups';

describe('parseSetGroups — packed notation', () => {
  it('parses a single packed weight×reps×sets token', () => {
    const r = parseSetGroups('BB RDL 40kgx8x2');
    expect(r.namePart).toBe('BB RDL');
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0]).toMatchObject({ weightKg: 40, reps: 8, sets: 2, token: '40kgx8x2' });
  });

  it('defaults sets to 1 when there is no x<sets> part', () => {
    const r = parseSetGroups('BB RDL 40kgx8');
    expect(r.groups[0]).toMatchObject({ weightKg: 40, reps: 8, sets: 1 });
  });

  it('emits one group per packed token, sharing the name', () => {
    const r = parseSetGroups('BB RDL 40kgx8 50kgx8x4 40kgx8x3');
    expect(r.namePart).toBe('BB RDL');
    expect(r.groups.map((g) => [g.weightKg, g.reps, g.sets])).toEqual([
      [40, 8, 1],
      [50, 8, 4],
      [40, 8, 3],
    ]);
  });

  it('treats `bar` as an unknown (null) load', () => {
    const r = parseSetGroups('BB P Sq barx12x2');
    expect(r.namePart).toBe('BB P Sq');
    expect(r.groups[0]).toMatchObject({ weightKg: null, reps: 12, sets: 2 });
  });

  it('handles decimal weights', () => {
    const r = parseSetGroups('C row 23.5kgx6x2');
    expect(r.groups[0]).toMatchObject({ weightKg: 23.5, reps: 6, sets: 2 });
  });

  it('reads a bare A×B token as weight×reps inside a packed line', () => {
    // "43x4" follows a unit-bearing packed token, so the line is PACKED.
    const r = parseSetGroups('40kgx6x2 43x4');
    expect(r.groups.map((g) => [g.weightKg, g.reps, g.sets])).toEqual([
      [40, 6, 2],
      [43, 4, 1],
    ]);
  });

  it('records correct character offsets for each group token', () => {
    const line = 'BB RDL 40kgx8 50kgx8x4';
    const r = parseSetGroups(line);
    expect(line.slice(r.groups[0].start, r.groups[0].end)).toBe('40kgx8');
    expect(line.slice(r.groups[1].start, r.groups[1].end)).toBe('50kgx8x4');
  });

  it('records the character offset where the trimmed namePart begins', () => {
    const line = '  BB RDL 40kgx8x2';
    const r = parseSetGroups(line);
    expect(line.slice(r.namePartStart, r.namePartStart + r.namePart.length)).toBe('BB RDL');
  });
});

describe('parseSetGroups — continuation lines', () => {
  it('reports an empty namePart for a bulleted continuation line', () => {
    const r = parseSetGroups('    ⁃    50kgx8 60kgx6 70kgx4');
    expect(r.namePart).toBe('');
    expect(r.groups.map((g) => [g.weightKg, g.reps, g.sets])).toEqual([
      [50, 8, 1],
      [60, 6, 1],
      [70, 4, 1],
    ]);
  });
});

describe('parseSetGroups — clean/prose notation (unchanged behavior)', () => {
  it('reads a standalone weight + bare reps×sets as one group', () => {
    const r = parseSetGroups('RDL 40kg 8x3');
    expect(r.namePart).toBe('RDL');
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0]).toMatchObject({ weightKg: 40, reps: 8, sets: 3 });
  });

  it('extracts the name run before the numbers in a prose line', () => {
    const r = parseSetGroups('did Bench Press 60kg 8x3');
    expect(r.namePart).toBe('did Bench Press');
    expect(r.groups[0]).toMatchObject({ weightKg: 60, reps: 8, sets: 3 });
  });

  it('returns no groups for a line with no set tokens', () => {
    expect(parseSetGroups('Felt tired, skipped legs today').groups).toEqual([]);
    expect(parseSetGroups('2022 03 03').groups).toEqual([]);
    expect(parseSetGroups('VECKA 9').groups).toEqual([]);
  });
});
