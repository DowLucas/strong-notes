import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/server.js';
import { prisma } from '../src/db.js';
import * as llm from '../src/llm/provider.js';
import { ExerciseCategory, MuscleGroup, MuscleRole } from '@prisma/client';

beforeAll(() => {
  process.env.API_TOKEN = 'test-token';
});

afterAll(async () => {
  await prisma.setEntry.deleteMany({ where: { session: { date: new Date('2026-08-10T00:00:00.000Z') } } });
  await prisma.workoutSession.deleteMany({ where: { date: new Date('2026-08-10T00:00:00.000Z') } });
  await prisma.goalTarget.deleteMany({ where: { goal: { userId: 'lucas' } } });
  await prisma.goal.deleteMany({ where: { userId: 'lucas' } });
  await prisma.abbreviation.deleteMany({ where: { token: 'CRABWALK' } });
  await prisma.muscleMapEntry.deleteMany({ where: { exercise: { name: 'Test Cable Crab Walk' } } });
  await prisma.exercise.deleteMany({ where: { name: 'Test Cable Crab Walk' } });
});

describe('end-to-end pipeline', () => {
  it('resolves an unknown token via LLM, confirms it as an abbreviation, syncs a session, and shows up in goal progress', async () => {
    const app = createApp();
    const auth = { Authorization: 'Bearer test-token' };

    // (a) mock the LLM provider to resolve the unknown token
    vi.spyOn(llm, 'getLlmProvider').mockReturnValue({
      resolveLine: vi.fn().mockResolvedValue({
        exerciseName: 'Test Cable Crab Walk',
        equipment: 'cable',
        weightKg: undefined,
        reps: 8,
        sets: 2,
      }),
      resolveGoal: vi.fn(),
    });

    // (b) POST /resolve/line with a line containing the unknown token, confirming LLM fallback fires
    const resolveRes = await request(app)
      .post('/resolve/line')
      .set(auth)
      .send({ line: 'CRABWALK 8x2' });
    expect(resolveRes.status).toBe(200);
    expect(resolveRes.body.unresolvedTokens).toContain('CRABWALK');
    expect(resolveRes.body.llmGuess.exerciseName).toBe('Test Cable Crab Walk');

    // create the exercise the LLM resolved to, with a muscle mapping so progress can be computed
    const exercise = await prisma.exercise.create({
      data: {
        name: 'Test Cable Crab Walk',
        category: ExerciseCategory.ISOLATION,
        muscleMap: { create: [{ muscle: MuscleGroup.GLUTES, role: MuscleRole.PRIMARY, weight: 1 }] },
      },
    });

    // (c) create the abbreviation via POST /abbreviations, simulating the client saving the LLM-resolved shorthand
    const abbrevRes = await request(app)
      .post('/abbreviations')
      .set(auth)
      .send({ token: 'CRABWALK', exerciseId: exercise.id });
    expect(abbrevRes.status).toBe(201);

    // (d) set an active goal
    const goalRes = await request(app).post('/goals').set(auth).send({ type: 'HYPERTROPHY' });
    expect(goalRes.status).toBe(201);

    // (e) sync a session via PUT /sessions/:date using an entry that references the exercise
    const putRes = await request(app)
      .put('/sessions/2026-08-10')
      .set(auth)
      .send({
        entries: [
          {
            exerciseId: exercise.id,
            equipment: 'cable',
            reps: 8,
            sets: 2,
            rawText: 'CRABWALK 8x2',
            parsedBy: 'LLM',
            order: 0,
          },
        ],
      });
    expect(putRes.status).toBe(200);
    expect(putRes.body.entries).toHaveLength(1);

    // (f) fetch GET /goals/active/progress and assert the exercise's sets show up against the right muscle group
    const progressRes = await request(app)
      .get('/goals/active/progress?weekStart=2026-08-10')
      .set(auth);
    expect(progressRes.status).toBe(200);
    const glutes = progressRes.body.find((p: { muscle: string }) => p.muscle === 'GLUTES');
    expect(glutes.actualSets).toBe(2);
  });
});
