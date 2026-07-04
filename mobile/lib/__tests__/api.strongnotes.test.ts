jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { apiBaseUrl: 'http://localhost:8080' } } },
}));

import { createClient } from '../api';
import { PROTOCOL_HEADER, APP_PROTOCOL_VERSION } from '../protocol';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? 'application/json' : null) },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe('ApiClient Strong Notes methods', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  it('resolveLine posts the line and returns the parsed response', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(jsonResponse({ resolvedTokens: [], unresolvedTokens: [] }));
    const client = createClient('http://localhost:8080', async () => 'test-token');

    const result = await client.resolveLine('BB RDL 40kg 8x3');

    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/resolve/line',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ line: 'BB RDL 40kg 8x3' }),
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
          [PROTOCOL_HEADER]: String(APP_PROTOCOL_VERSION),
        }),
      }),
    );
    expect(result).toEqual({ resolvedTokens: [], unresolvedTokens: [] });
  });

  it('getGoalProgress builds the query string', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(jsonResponse([]));
    const client = createClient('http://localhost:8080', async () => 'test-token');

    await client.getGoalProgress('2026-07-06');

    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/goals/active/progress?weekStart=2026-07-06',
      expect.any(Object),
    );
  });

  it('putSession PUTs to the date-scoped path', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(jsonResponse({ id: 's1', date: '2026-07-06', notes: null, entries: [] }));
    const client = createClient('http://localhost:8080', async () => 'test-token');

    const result = await client.putSession('2026-07-06', { entries: [] });

    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/sessions/2026-07-06',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ entries: [] }) }),
    );
    expect(result.id).toBe('s1');
  });
});
