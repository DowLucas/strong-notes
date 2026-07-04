import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../src/db.js';
import { resolveLineWithDictionary } from '../src/parsing/dictionaryResolver.js';
import { ExerciseCategory, AbbreviationSource } from '@prisma/client';

beforeAll(async () => {
  const exercise = await prisma.exercise.create({
    data: { name: 'Test Squat', category: ExerciseCategory.COMPOUND },
  });
  await prisma.abbreviation.create({
    data: { userId: 'lucas', token: 'TSQ', exerciseId: exercise.id, source: AbbreviationSource.USER_ADDED },
  });
  // NOTE: seed data (Task 2) already inserts a 'BB' abbreviation for userId 'lucas',
  // so the literal 'BB' token from the brief collides with the unique (userId, token)
  // constraint. Using 'BBX' here to avoid touching/deleting the real seeded fixture.
  await prisma.abbreviation.create({
    data: { userId: 'lucas', token: 'BBX', modifierType: 'equipment', modifierValue: 'barbell', source: AbbreviationSource.BUILT_IN },
  });
});

afterAll(async () => {
  await prisma.abbreviation.deleteMany({ where: { token: { in: ['TSQ', 'BBX'] } } });
  await prisma.exercise.deleteMany({ where: { name: 'Test Squat' } });
  await prisma.$disconnect();
});

describe('resolveLineWithDictionary', () => {
  it('resolves known tokens and flags unknown ones', async () => {
    const result = await resolveLineWithDictionary('TSQ BBX 40kg 8x3 WXYZ', 'lucas');
    expect(result.resolvedTokens.map((t) => t.token)).toEqual(['TSQ', 'BBX']);
    expect(result.unresolvedTokens).toContain('WXYZ');
  });
});
