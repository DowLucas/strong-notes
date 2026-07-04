import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/server.js';
import { prisma } from '../src/db.js';

beforeAll(() => {
  process.env.API_TOKEN = 'test-token';
});

afterEach(async () => {
  await prisma.muscleMapEntry.deleteMany({ where: { exercise: { name: { startsWith: 'Test ' } } } });
  await prisma.exercise.deleteMany({ where: { name: { startsWith: 'Test ' } } });
});

describe('POST /exercises', () => {
  it('creates a new exercise with the correct muscleMap', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/exercises')
      .set('Authorization', 'Bearer test-token')
      .send({ name: 'Test Crab Walk', muscles: ['GLUTES', 'CORE'] });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Test Crab Walk');

    const row = await prisma.exercise.findUnique({
      where: { name: 'Test Crab Walk' },
      include: { muscleMap: true },
    });
    expect(row).not.toBeNull();
    expect(row!.muscleMap).toHaveLength(2);
    const muscles = row!.muscleMap.map((m) => m.muscle).sort();
    expect(muscles).toEqual(['CORE', 'GLUTES']);
    for (const entry of row!.muscleMap) {
      expect(entry.role).toBe('PRIMARY');
      expect(entry.weight).toBe(1);
    }
  });

  it('returns the existing exercise when POSTing the same name twice', async () => {
    const app = createApp();
    const auth = { Authorization: 'Bearer test-token' };

    const first = await request(app)
      .post('/exercises')
      .set(auth)
      .send({ name: 'Test Duplicate Exercise', muscles: ['BACK'] });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post('/exercises')
      .set(auth)
      .send({ name: 'Test Duplicate Exercise', muscles: ['CHEST'] });
    expect(second.status).toBe(201);

    expect(second.body.id).toBe(first.body.id);

    const rows = await prisma.exercise.findMany({ where: { name: 'Test Duplicate Exercise' } });
    expect(rows).toHaveLength(1);
  });

  it('rejects an empty muscles array with 400', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/exercises')
      .set('Authorization', 'Bearer test-token')
      .send({ name: 'Test No Muscles', muscles: [] });
    expect(res.status).toBe(400);
  });

  it('rejects an empty name with 400', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/exercises')
      .set('Authorization', 'Bearer test-token')
      .send({ name: '', muscles: ['CORE'] });
    expect(res.status).toBe(400);
  });
});
