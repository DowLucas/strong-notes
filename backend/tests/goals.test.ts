import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/server.js';
import { prisma } from '../src/db.js';
import { ExerciseCategory, MuscleGroup, MuscleRole, ParsedBy } from '@prisma/client';

beforeAll(() => {
  process.env.API_TOKEN = 'test-token';
});

afterEach(async () => {
  await prisma.goalTarget.deleteMany({ where: { goal: { userId: 'lucas' } } });
  await prisma.goal.deleteMany({ where: { userId: 'lucas' } });
  await prisma.setEntry.deleteMany({ where: { session: { date: new Date('2026-07-06T00:00:00.000Z') } } });
  await prisma.workoutSession.deleteMany({ where: { date: new Date('2026-07-06T00:00:00.000Z') } });
  await prisma.muscleMapEntry.deleteMany({ where: { exercise: { name: 'Test Hip Thrust' } } });
  await prisma.exercise.deleteMany({ where: { name: 'Test Hip Thrust' } });
});

describe('/goals', () => {
  it('creates an active hypertrophy goal with default glute targets', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/goals')
      .set('Authorization', 'Bearer test-token')
      .send({ type: 'HYPERTROPHY' });
    expect(res.status).toBe(201);
    const glutes = res.body.targets.find((t: { muscle: string }) => t.muscle === 'GLUTES');
    expect(glutes).toEqual(expect.objectContaining({ muscle: 'GLUTES', minSetsPerWeek: 12, maxSetsPerWeek: 20 }));
  });

  it('computes actual sets vs target for the active goal', async () => {
    const app = createApp();
    const auth = { Authorization: 'Bearer test-token' };
    await request(app).post('/goals').set(auth).send({ type: 'HYPERTROPHY' });

    const exercise = await prisma.exercise.create({
      data: {
        name: 'Test Hip Thrust',
        category: ExerciseCategory.COMPOUND,
        muscleMap: { create: [{ muscle: MuscleGroup.GLUTES, role: MuscleRole.PRIMARY, weight: 1 }] },
      },
    });
    await prisma.workoutSession.create({
      data: {
        userId: 'lucas',
        date: new Date('2026-07-06T00:00:00.000Z'),
        entries: { create: [{ exerciseId: exercise.id, sets: 4, rawText: 'HT 40kg 8x4', parsedBy: ParsedBy.DICTIONARY, order: 0 }] },
      },
    });

    const res = await request(app).get('/goals/active/progress?weekStart=2026-07-06').set(auth);
    expect(res.status).toBe(200);
    const glutes = res.body.find((p: { muscle: string }) => p.muscle === 'GLUTES');
    expect(glutes.actualSets).toBe(4);
  });

  it('rejects /goals/active/progress with missing or malformed weekStart', async () => {
    const app = createApp();
    const auth = { Authorization: 'Bearer test-token' };
    await request(app).post('/goals').set(auth).send({ type: 'HYPERTROPHY' });

    const missing = await request(app).get('/goals/active/progress').set(auth);
    expect(missing.status).toBe(400);
    expect(missing.body.error).toBeDefined();

    const malformed = await request(app)
      .get('/goals/active/progress?weekStart=07-06-2026')
      .set(auth);
    expect(malformed.status).toBe(400);
    expect(malformed.body.error).toBeDefined();
  });
});
