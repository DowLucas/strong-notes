import { createClient, ApiError } from '@/lib/api';

function mockFetch(status: number, body: unknown = {}) {
  return jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
}

describe('createClient — onUnauthorized', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('fires onUnauthorized when an authenticated request gets a 401, and still throws', async () => {
    global.fetch = mockFetch(401, { error: 'token expired' }) as unknown as typeof fetch;
    const onUnauthorized = jest.fn();
    const api = createClient('http://x', async () => 'stale-token', { onUnauthorized });
    await expect(api.getMe()).rejects.toBeInstanceOf(ApiError);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('does not fire onUnauthorized for an unauthenticated request that 401s (e.g. bad magic link)', async () => {
    global.fetch = mockFetch(401, { error: 'invalid token' }) as unknown as typeof fetch;
    const onUnauthorized = jest.fn();
    const api = createClient('http://x', async () => null, { onUnauthorized });
    await expect(api.verify('bad')).rejects.toBeInstanceOf(ApiError);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('does not fire onUnauthorized for other error statuses', async () => {
    global.fetch = mockFetch(500, { error: 'boom' }) as unknown as typeof fetch;
    const onUnauthorized = jest.fn();
    const api = createClient('http://x', async () => 'token', { onUnauthorized });
    await expect(api.getMe()).rejects.toBeInstanceOf(ApiError);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });
});
