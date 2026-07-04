import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/server.js';
import { prisma } from '../src/db.js';

beforeAll(() => {
  process.env.API_TOKEN = 'test-token';
});

afterEach(async () => {
  const date = new Date('2026-07-01T00:00:00.000Z');
  const sessions = await prisma.workoutSession.findMany({ where: { date }, select: { id: true } });
  const sessionIds = sessions.map((s) => s.id);
  await prisma.setEntry.deleteMany({ where: { sessionId: { in: sessionIds } } });
  await prisma.workoutSession.deleteMany({ where: { date } });
});

describe('/sessions', () => {
  it('upserts a session with entries and lists it back', async () => {
    const app = createApp();
    const auth = { Authorization: 'Bearer test-token' };

    const putRes = await request(app)
      .put('/sessions/2026-07-01')
      .set(auth)
      .send({
        notes: 'leg day',
        entries: [
          { rawText: 'BB RDL 40kg 8x3', parsedBy: 'DICTIONARY', order: 0 },
        ],
      });
    expect(putRes.status).toBe(200);
    expect(putRes.body.entries).toHaveLength(1);

    const listRes = await request(app)
      .get('/sessions?from=2026-07-01&to=2026-07-01')
      .set(auth);
    expect(listRes.body).toHaveLength(1);
    expect(listRes.body[0].notes).toBe('leg day');
  });

  it('replaces entries on repeat sync of the same date', async () => {
    const app = createApp();
    const auth = { Authorization: 'Bearer test-token' };

    await request(app).put('/sessions/2026-07-01').set(auth).send({
      entries: [{ rawText: 'first', parsedBy: 'DICTIONARY', order: 0 }],
    });
    const secondPut = await request(app).put('/sessions/2026-07-01').set(auth).send({
      entries: [{ rawText: 'second', parsedBy: 'DICTIONARY', order: 0 }],
    });
    expect(secondPut.body.entries).toHaveLength(1);
    expect(secondPut.body.entries[0].rawText).toBe('second');
  });
});
