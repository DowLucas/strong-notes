import { PrismaClient, ExerciseCategory, MuscleGroup, MuscleRole, AbbreviationSource } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const rdl = await prisma.exercise.upsert({
    where: { name: 'Romanian Deadlift' },
    update: {},
    create: {
      name: 'Romanian Deadlift',
      category: ExerciseCategory.COMPOUND,
      muscleMap: {
        create: [
          { muscle: MuscleGroup.HAMSTRINGS, role: MuscleRole.PRIMARY, weight: 0.7 },
          { muscle: MuscleGroup.GLUTES, role: MuscleRole.SECONDARY, weight: 0.5 },
          { muscle: MuscleGroup.BACK, role: MuscleRole.SECONDARY, weight: 0.3 },
        ],
      },
    },
  });

  const hipThrust = await prisma.exercise.upsert({
    where: { name: 'Hip Thrust' },
    update: {},
    create: {
      name: 'Hip Thrust',
      category: ExerciseCategory.COMPOUND,
      muscleMap: {
        create: [
          { muscle: MuscleGroup.GLUTES, role: MuscleRole.PRIMARY, weight: 0.9 },
          { muscle: MuscleGroup.HAMSTRINGS, role: MuscleRole.SECONDARY, weight: 0.3 },
        ],
      },
    },
  });

  await prisma.abbreviation.upsert({
    where: { userId_token: { userId: 'lucas', token: 'RDL' } },
    update: {},
    create: { userId: 'lucas', token: 'RDL', exerciseId: rdl.id, source: AbbreviationSource.BUILT_IN },
  });

  await prisma.abbreviation.upsert({
    where: { userId_token: { userId: 'lucas', token: 'HT' } },
    update: {},
    create: { userId: 'lucas', token: 'HT', exerciseId: hipThrust.id, source: AbbreviationSource.BUILT_IN },
  });

  await prisma.abbreviation.upsert({
    where: { userId_token: { userId: 'lucas', token: 'BB' } },
    update: {},
    create: { userId: 'lucas', token: 'BB', modifierType: 'equipment', modifierValue: 'barbell', source: AbbreviationSource.BUILT_IN },
  });
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
