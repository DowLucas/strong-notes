import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/server.js';
import { prisma } from '../src/db.js';
import { AbbreviationSource } from '@prisma/client';

beforeAll(() => {
  process.env.API_TOKEN = 'test-token';
});

afterEach(async () => {
  await prisma.abbreviation.deleteMany({ where: { token: { startsWith: 'ZZ' } } });
});

describe('/abbreviations', () => {
  it('creates and lists a user-added abbreviation', async () => {
    const app = createApp();
    const auth = { Authorization: 'Bearer test-token' };

    const createRes = await request(app).post('/abbreviations').set(auth).send({
      token: 'ZZTEST',
      modifierType: 'equipment',
      modifierValue: 'kettlebell',
    });
    expect(createRes.status).toBe(201);
    expect(createRes.body.source).toBe('USER_ADDED');

    const listRes = await request(app).get('/abbreviations').set(auth);
    expect(listRes.body.some((a: { token: string }) => a.token === 'ZZTEST')).toBe(true);
  });

  it('returns the existing abbreviation when POSTing the same token twice', async () => {
    const app = createApp();
    const auth = { Authorization: 'Bearer test-token' };

    const first = await request(app).post('/abbreviations').set(auth).send({
      token: 'ZZDUPE',
      modifierType: 'equipment',
      modifierValue: 'band',
    });
    expect(first.status).toBe(201);

    const second = await request(app).post('/abbreviations').set(auth).send({
      token: 'ZZDUPE',
      modifierType: 'equipment',
      modifierValue: 'chains',
    });
    expect(second.status).toBe(201);

    expect(second.body.id).toBe(first.body.id);

    const rows = await prisma.abbreviation.findMany({ where: { userId: 'lucas', token: 'ZZDUPE' } });
    expect(rows).toHaveLength(1);
  });

  it('confirms a pending llm-suggested abbreviation', async () => {
    const pending = await prisma.abbreviation.create({
      data: { userId: 'lucas', token: 'ZZPEND', modifierType: 'equipment', modifierValue: 'sled', source: AbbreviationSource.LLM_SUGGESTED_PENDING_CONFIRM },
    });
    const app = createApp();
    const res = await request(app)
      .patch(`/abbreviations/${pending.id}/confirm`)
      .set('Authorization', 'Bearer test-token');
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('USER_ADDED');
  });
});
