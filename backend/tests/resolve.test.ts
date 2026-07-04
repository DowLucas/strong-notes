import { describe, it, expect, vi, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/server.js';
import * as llm from '../src/llm/provider.js';

beforeAll(() => {
  process.env.API_TOKEN = 'test-token';
});

describe('POST /resolve/line', () => {
  it('returns dictionary-only result when all tokens resolve', async () => {
    vi.spyOn(llm, 'getLlmProvider').mockReturnValue({
      resolveLine: vi.fn(),
      resolveGoal: vi.fn(),
    });
    const app = createApp();
    const res = await request(app)
      .post('/resolve/line')
      .set('Authorization', 'Bearer test-token')
      .send({ line: 'BB 40kg 8x3' });
    expect(res.status).toBe(200);
    expect(res.body.unresolvedTokens).toEqual([]);
    expect(res.body.llmGuess).toBeUndefined();
  });

  it('falls back to the LLM for unresolved tokens', async () => {
    vi.spyOn(llm, 'getLlmProvider').mockReturnValue({
      resolveLine: vi.fn().mockResolvedValue({ exerciseName: 'Cable Crab Walk', equipment: null, weightKg: null, reps: 8, sets: 2 }),
      resolveGoal: vi.fn(),
    });
    const app = createApp();
    const res = await request(app)
      .post('/resolve/line')
      .set('Authorization', 'Bearer test-token')
      .send({ line: 'CRABWALK 8x2' });
    expect(res.status).toBe(200);
    expect(res.body.llmGuess.exerciseName).toBe('Cable Crab Walk');
  });
});

describe('error handling', () => {
  it('returns a clean 500 JSON response (not a crash) when the LLM fallback rejects', async () => {
    vi.spyOn(llm, 'getLlmProvider').mockReturnValue({
      resolveLine: vi.fn().mockRejectedValue(new Error('LLM backend is having a bad day')),
      resolveGoal: vi.fn(),
    });
    const app = createApp();
    const res = await request(app)
      .post('/resolve/line')
      .set('Authorization', 'Bearer test-token')
      .send({ line: 'CRABWALK 8x2' });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'internal error' });
  });

  it('returns a clean 500 JSON response when /resolve/goal rejects', async () => {
    vi.spyOn(llm, 'getLlmProvider').mockReturnValue({
      resolveLine: vi.fn(),
      resolveGoal: vi.fn().mockRejectedValue(new Error('network failure')),
    });
    const app = createApp();
    const res = await request(app)
      .post('/resolve/goal')
      .set('Authorization', 'Bearer test-token')
      .send({ text: 'I want a bigger booty' });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'internal error' });
  });
});

describe('POST /resolve/goal', () => {
  it('translates free text into a structured goal guess', async () => {
    vi.spyOn(llm, 'getLlmProvider').mockReturnValue({
      resolveLine: vi.fn(),
      resolveGoal: vi.fn().mockResolvedValue({ type: 'HYPERTROPHY', muscles: ['GLUTES', 'HAMSTRINGS'] }),
    });
    const app = createApp();
    const res = await request(app)
      .post('/resolve/goal')
      .set('Authorization', 'Bearer test-token')
      .send({ text: 'I want a bigger booty' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ type: 'HYPERTROPHY', muscles: ['GLUTES', 'HAMSTRINGS'] });
  });
});
