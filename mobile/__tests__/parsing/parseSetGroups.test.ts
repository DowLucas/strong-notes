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

describe('parseSetGroups — flexible weight position', () => {
  it('reads the unit-tagged weight when it comes AFTER the reps', () => {
    const r = parseSetGroups('RDL 8x2kg');
    expect(r.namePart).toBe('RDL');
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0]).toMatchObject({ weightKg: 2, reps: 8, sets: 1, token: '8x2kg' });
  });

  it('reads weight-second with a full weight (`8x40kg`)', () => {
    const r = parseSetGroups('RDL 8x40kg');
    expect(r.groups[0]).toMatchObject({ weightKg: 40, reps: 8, sets: 1 });
  });

  it('reads a weight in the middle of the chain (`8x40kgx3`)', () => {
    const r = parseSetGroups('RDL 8x40kgx3');
    expect(r.groups[0]).toMatchObject({ weightKg: 40, reps: 8, sets: 3 });
  });

  it('still treats a unit-less `8x3` as reps×sets (clean), not weight', () => {
    const r = parseSetGroups('Squats 8x3');
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0]).toMatchObject({ weightKg: null, reps: 8, sets: 3 });
  });

  it('rejects a token with two weights as ambiguous', () => {
    // `40kgx50kg` has two unit-tagged parts → not a valid group.
    expect(parseSetGroups('RDL 40kgx50kg').groups).toEqual([]);
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

  it('emits one group per bare reps×sets token (bodyweight multi-group)', () => {
    const r = parseSetGroups('Squats 3x10 2x10');
    expect(r.namePart).toBe('Squats');
    expect(r.groups.map((g) => [g.weightKg, g.reps, g.sets])).toEqual([
      [null, 3, 10],
      [null, 2, 10],
    ]);
  });

  it('records a distinct token/span for each clean multi-group', () => {
    const line = 'Squats 3x10 2x10';
    const r = parseSetGroups(line);
    expect(r.groups.map((g) => g.token)).toEqual(['3x10', '2x10']);
    expect(line.slice(r.groups[0].start, r.groups[0].end)).toBe('3x10');
    expect(line.slice(r.groups[1].start, r.groups[1].end)).toBe('2x10');
  });

  it('attaches the nearest preceding weight to each clean multi-group', () => {
    const r = parseSetGroups('Bench 60kg 8x3 65kg 6x2');
    expect(r.namePart).toBe('Bench');
    expect(r.groups.map((g) => [g.weightKg, g.reps, g.sets])).toEqual([
      [60, 8, 3],
      [65, 6, 2],
    ]);
  });

  it('returns no groups for a line with no set tokens', () => {
    expect(parseSetGroups('Felt tired, skipped legs today').groups).toEqual([]);
    expect(parseSetGroups('2022 03 03').groups).toEqual([]);
    expect(parseSetGroups('VECKA 9').groups).toEqual([]);
  });
});

describe('parseSetGroups — weight before name', () => {
  it('attaches a leading weight to the first group and names the words between', () => {
    const line = '30kg bb deadlifts 8x3';
    const r = parseSetGroups(line);
    expect(r.namePart).toBe('bb deadlifts');
    expect(line.slice(r.namePartStart, r.namePartStart + r.namePart.length)).toBe('bb deadlifts');
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0]).toMatchObject({ weightKg: 30, reps: 8, sets: 3 });
    // The group span runs from the leading weight through the reps token.
    expect(line.slice(r.groups[0].start, r.groups[0].end)).toBe('30kg bb deadlifts 8x3');
  });

  it('only gives the leading weight to the first group when a later one has its own', () => {
    const r = parseSetGroups('30kg bb deadlifts 8x3 35kg 6x2');
    expect(r.namePart).toBe('bb deadlifts');
    expect(r.groups.map((g) => [g.weightKg, g.reps, g.sets])).toEqual([
      [30, 8, 3],
      [35, 6, 2],
    ]);
    expect(r.groups[1].token).toBe('35kg 6x2');
  });

  it('handles a bullet before the leading weight', () => {
    const line = '- 30kg bb deadlifts 8x3';
    const r = parseSetGroups(line);
    expect(r.namePart).toBe('bb deadlifts');
    expect(r.groups[0]).toMatchObject({ weightKg: 30, reps: 8, sets: 3 });
  });

  it('carries a weight forward to later weightless groups', () => {
    const r = parseSetGroups('Bench 60kg 8x3 6x2');
    expect(r.groups.map((g) => [g.weightKg, g.reps, g.sets])).toEqual([
      [60, 8, 3],
      [60, 6, 2],
    ]);
  });
});

describe('parseSetGroups — spaces around x and units', () => {
  it('reads `8 x 3` as reps×sets', () => {
    const line = 'Squats 8 x 3';
    const r = parseSetGroups(line);
    expect(r.namePart).toBe('Squats');
    expect(r.groups[0]).toMatchObject({ weightKg: null, reps: 8, sets: 3 });
    expect(line.slice(r.groups[0].start, r.groups[0].end)).toBe('8 x 3');
  });

  it('reads `30 kg` as a weight', () => {
    const line = 'RDL 30 kg 8x3';
    const r = parseSetGroups(line);
    expect(r.namePart).toBe('RDL');
    expect(r.groups[0]).toMatchObject({ weightKg: 30, reps: 8, sets: 3 });
    expect(line.slice(r.groups[0].start, r.groups[0].end)).toBe('30 kg 8x3');
  });

  it('reads a spaced packed chain `30kg x 8 x 3`', () => {
    const line = 'BB RDL 30kg x 8 x 3';
    const r = parseSetGroups(line);
    expect(r.namePart).toBe('BB RDL');
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0]).toMatchObject({ weightKg: 30, reps: 8, sets: 3, token: '30kg x 8 x 3' });
  });

  it('reads a spaced `bar x 12`', () => {
    const r = parseSetGroups('BB P Sq bar x 12');
    expect(r.namePart).toBe('BB P Sq');
    expect(r.groups[0]).toMatchObject({ weightKg: null, reps: 12, sets: 1 });
  });

  it('reads mixed spacing `8 x40kg x3`', () => {
    const r = parseSetGroups('RDL 8 x40kg x3');
    expect(r.groups[0]).toMatchObject({ weightKg: 40, reps: 8, sets: 3 });
  });

  it('does not glue an `x` word that is part of prose', () => {
    expect(parseSetGroups('Felt x tired today').groups).toEqual([]);
  });
});

describe('parseSetGroups — @ weight marker', () => {
  it('reads `8x3 @30kg` with the weight after the reps', () => {
    const line = 'bb deadlifts 8x3 @30kg';
    const r = parseSetGroups(line);
    expect(r.namePart).toBe('bb deadlifts');
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0]).toMatchObject({ weightKg: 30, reps: 8, sets: 3 });
    expect(line.slice(r.groups[0].start, r.groups[0].end)).toBe('8x3 @30kg');
  });

  it('reads `3x8 @ 30 kg` with spaces everywhere', () => {
    const r = parseSetGroups('bb deadlifts 3x8 @ 30 kg');
    expect(r.groups[0]).toMatchObject({ weightKg: 30, reps: 3, sets: 8 });
  });

  it('attaches each following @weight to the nearest preceding group', () => {
    const r = parseSetGroups('Bench 8x3 @60kg 6x2 @65kg');
    expect(r.groups.map((g) => [g.weightKg, g.reps, g.sets])).toEqual([
      [60, 8, 3],
      [65, 6, 2],
    ]);
  });

  it('reads `@30kg` before the reps too', () => {
    const r = parseSetGroups('bb deadlifts @30kg 8x3');
    expect(r.groups[0]).toMatchObject({ weightKg: 30, reps: 8, sets: 3 });
  });
});

describe('parseSetGroups — comma rep lists', () => {
  it('expands `30kg 8,8,6` into one group per rep count', () => {
    const line = 'bb deadlifts 30kg 8,8,6';
    const r = parseSetGroups(line);
    expect(r.namePart).toBe('bb deadlifts');
    expect(r.groups.map((g) => [g.weightKg, g.reps, g.sets])).toEqual([
      [30, 8, 1],
      [30, 8, 1],
      [30, 6, 1],
    ]);
    expect(r.groups.map((g) => line.slice(g.start, g.end))).toEqual(['30kg 8', '8', '6']);
  });

  it('accepts spaces after the commas', () => {
    const r = parseSetGroups('bb deadlifts 30kg 8, 8, 6');
    expect(r.groups.map((g) => g.reps)).toEqual([8, 8, 6]);
    expect(r.groups.every((g) => g.weightKg === 30)).toBe(true);
  });

  it('expands a bodyweight rep list', () => {
    const r = parseSetGroups('Pull ups 10,8,6');
    expect(r.namePart).toBe('Pull ups');
    expect(r.groups.map((g) => [g.weightKg, g.reps, g.sets])).toEqual([
      [null, 10, 1],
      [null, 8, 1],
      [null, 6, 1],
    ]);
  });

  it('expands a packed `30kgx8,8,6`', () => {
    const line = 'bb deadlifts 30kgx8,8,6';
    const r = parseSetGroups(line);
    expect(r.groups.map((g) => [g.weightKg, g.reps, g.sets])).toEqual([
      [30, 8, 1],
      [30, 8, 1],
      [30, 6, 1],
    ]);
    expect(r.groups.map((g) => line.slice(g.start, g.end))).toEqual(['30kgx8', '8', '6']);
  });

  it('ignores comma lists that are not plain rep counts', () => {
    expect(parseSetGroups('Weights were 30,5kg').groups).toEqual([]);
  });

  it('accepts spaces after the commas in a packed list', () => {
    const r = parseSetGroups('bb deadlifts 30kgx8, 8, 6');
    expect(r.groups.map((g) => [g.weightKg, g.reps, g.sets])).toEqual([
      [30, 8, 1],
      [30, 8, 1],
      [30, 6, 1],
    ]);
  });

  it('expands a bare rep list after a weight with no name', () => {
    const r = parseSetGroups('30kg 8,8,6');
    expect(r.groups.map((g) => [g.weightKg, g.reps, g.sets])).toEqual([
      [30, 8, 1],
      [30, 8, 1],
      [30, 6, 1],
    ]);
  });

  it('accepts a bodyweight rep list directly followed by an @weight', () => {
    const r = parseSetGroups('Pull ups 10,8 @20kg');
    expect(r.groups.map((g) => [g.weightKg, g.reps, g.sets])).toEqual([
      [20, 10, 1],
      [20, 8, 1],
    ]);
  });

  it('does not turn arbitrary number lists into sets', () => {
    expect(parseSetGroups('2022, 03, 03').groups).toEqual([]);
    expect(parseSetGroups('Ran 5, 10 km').groups).toEqual([]);
    expect(parseSetGroups('Vecka 9, 10').groups).toEqual([]);
    // Accepted trade-off: a weightless two-entry list is too ambiguous to log.
    expect(parseSetGroups('Pull ups 10, 8').groups).toEqual([]);
  });
});

describe('parseSetGroups — commas between reps×sets tokens', () => {
  it('does not glue `8x3,` onto the next weight', () => {
    const line = 'Bench 60kg 8x3, 65kg 6x2';
    const r = parseSetGroups(line);
    expect(r.namePart).toBe('Bench');
    expect(r.groups.map((g) => [g.weightKg, g.reps, g.sets])).toEqual([
      [60, 8, 3],
      [65, 6, 2],
    ]);
    expect(r.groups.map((g) => g.token)).toEqual(['60kg 8x3', '65kg 6x2']);
  });

  it('splits comma-joined reps×sets tokens and carries the weight forward', () => {
    const r = parseSetGroups('Bench 60kg 8x3,6x2');
    expect(r.groups.map((g) => [g.weightKg, g.reps, g.sets])).toEqual([
      [60, 8, 3],
      [60, 6, 2],
    ]);
    expect(r.groups.map((g) => g.token)).toEqual(['60kg 8x3', '6x2']);
  });
});

describe('parseSetGroups — trailing @weight after a carried-forward weight', () => {
  it('gives a directly following @weight to its reps token over the carried-forward one', () => {
    const line = 'Bench 60kg 8x3 6x2 @65kg';
    const r = parseSetGroups(line);
    expect(r.groups.map((g) => [g.weightKg, g.reps, g.sets])).toEqual([
      [60, 8, 3],
      [65, 6, 2],
    ]);
    expect(r.groups[1].token).toBe('6x2 @65kg');
  });
});

describe('parseSetGroups — weight-only lines', () => {
  it('names a leading-weight line with no reps after the weight (not a continuation)', () => {
    const line = '20kg bb bänkpress';
    const r = parseSetGroups(line);
    expect(r.namePart).toBe('bb bänkpress');
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0]).toMatchObject({ weightKg: 20, reps: null, sets: 1 });
    expect(line.slice(r.groups[0].start, r.groups[0].end)).toBe('20kg bb bänkpress');
  });

  it('still treats a bare weight on a bullet line as a continuation', () => {
    const r = parseSetGroups('  ⁃ 50kg');
    expect(r.namePart).toBe('');
    expect(r.groups[0]).toMatchObject({ weightKg: 50, reps: null });
  });

  it('keeps name-first weight-only lines as before', () => {
    const r = parseSetGroups('RDL 40kg');
    expect(r.namePart).toBe('RDL');
    expect(r.groups[0]).toMatchObject({ weightKg: 40, reps: null });
  });
});

describe('parseSetGroups — bare reps token (`x8`)', () => {
  it('reads `x8` as 8 reps of one set', () => {
    const line = 'shoulder rotation x8';
    const r = parseSetGroups(line);
    expect(r.namePart).toBe('shoulder rotation');
    expect(r.groups[0]).toMatchObject({ weightKg: null, reps: 8, sets: 1 });
    expect(line.slice(r.groups[0].start, r.groups[0].end)).toBe('x8');
  });

  it('reads a leading weight + bare reps (`5kg db OHSP x8`)', () => {
    const line = '5kg db OHSP x8';
    const r = parseSetGroups(line);
    expect(r.namePart).toBe('db OHSP');
    expect(r.groups[0]).toMatchObject({ weightKg: 5, reps: 8, sets: 1 });
    expect(line.slice(r.groups[0].start, r.groups[0].end)).toBe('5kg db OHSP x8');
  });
});
