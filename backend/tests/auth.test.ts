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

  it('fails closed (500) on protected routes when API_TOKEN is unset, rather than authenticating "Bearer undefined"', async () => {
    const original = process.env.API_TOKEN;
    delete process.env.API_TOKEN;
    try {
      const app = createApp();
      const res = await request(app).get('/abbreviations').set('Authorization', 'Bearer undefined');
      expect(res.status).toBe(500);
    } finally {
      process.env.API_TOKEN = original;
    }
  });
});
