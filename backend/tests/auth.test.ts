import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/server.js';

beforeAll(() => {
  process.env.API_TOKEN = 'test-token';
});

describe('auth middleware', () => {
  it('rejects requests without a bearer token', async () => {
    const app = createApp();
    const res = await request(app).get('/abbreviations');
    expect(res.status).toBe(401);
  });

  it('rejects requests with the wrong token', async () => {
    const app = createApp();
    const res = await request(app).get('/abbreviations').set('Authorization', 'Bearer wrong');
    expect(res.status).toBe(401);
  });

  it('allows /health without a token', async () => {
    const app = createApp();
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
  });
});
