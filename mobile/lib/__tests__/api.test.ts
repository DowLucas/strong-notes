jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { apiBaseUrl: 'http://localhost:8080' } } },
}));

import { createClient, ApiError } from '../api';
import { PROTOCOL_HEADER, APP_PROTOCOL_VERSION } from '../protocol';

const BASE = 'http://localhost:8080';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'content-type' ? 'application/json' : null,
    },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function textResponse(text: string, status = 500): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'text/plain' },
    json: async () => {
      throw new Error('not json');
    },
    text: async () => text,
  } as unknown as Response;
}

describe('createClient', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('sends the protocol header on every request', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: '1', email: 'a@b.c', name: 'A' }));
    const client = createClient(BASE, async () => 'tok');
    await client.getMe();

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers[PROTOCOL_HEADER]).toBe(String(APP_PROTOCOL_VERSION));
  });

  it('adds an Authorization header when a token is present', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: '1', email: 'a@b.c', name: 'A' }));
    const client = createClient(BASE, async () => 'secret-token');
    await client.getMe();

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer secret-token');
  });

  it('omits the Authorization header when there is no token', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
    const client = createClient(BASE, async () => null);
    await client.requestMagicLink('a@b.c');

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBeUndefined();
  });

  it('requestMagicLink POSTs to /api/auth/magic-link with the email', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
    const client = createClient(BASE, async () => null);
    await client.requestMagicLink('a@b.c');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE}/api/auth/magic-link`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ email: 'a@b.c' });
  });

  it('verify POSTs to /api/auth/verify and returns the token + user', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ token: 'jwt', user: { id: '1', email: 'a@b.c', name: 'A' } }),
    );
    const client = createClient(BASE, async () => null);
    const res = await client.verify('code');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE}/api/auth/verify`);
    expect(JSON.parse(init.body)).toEqual({ token: 'code' });
    expect(res.token).toBe('jwt');
    expect(res.user.email).toBe('a@b.c');
  });

  it('getInstanceInfo hits the well-known path without auth', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ mode: 'selfhost', version: '1.0.0', protocol: { min: 1, max: 1 } }),
    );
    const client = createClient(BASE, async () => 'tok');
    await client.getInstanceInfo();

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE}/.well-known/scaffold-instance`);
  });

  it('throws a typed ApiError on a non-2xx response', async () => {
    fetchMock.mockResolvedValueOnce(textResponse('boom', 500));
    const client = createClient(BASE, async () => 'tok');

    await expect(client.getMe()).rejects.toBeInstanceOf(ApiError);
    fetchMock.mockResolvedValueOnce(textResponse('nope', 401));
    await expect(client.getMe()).rejects.toMatchObject({ status: 401 });
  });

  it('puts the parsed JSON body on the ApiError', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'bad' }, 400));
    const client = createClient(BASE, async () => 'tok');

    await expect(client.getMe()).rejects.toMatchObject({
      status: 400,
      body: { error: 'bad' },
    });
  });
});
