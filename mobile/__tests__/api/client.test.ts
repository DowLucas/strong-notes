import { resolveLine, putSession, getGoalProgress } from '../../src/api/client';
import { getApiToken } from '../../src/auth/token';

jest.mock('../../src/auth/token', () => ({
  getApiToken: jest.fn(),
}));

const mockGetApiToken = getApiToken as jest.Mock;

describe('api client', () => {
  beforeEach(() => {
    mockGetApiToken.mockResolvedValue('test-token');
    global.fetch = jest.fn();
  });

  it('sends a bearer token and the request body on resolveLine', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ resolvedTokens: [], unresolvedTokens: [] }),
    });

    const result = await resolveLine('RDL BB 40kg 8x3');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/resolve/line'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
        body: JSON.stringify({ line: 'RDL BB 40kg 8x3' }),
      })
    );
    expect(result).toEqual({ resolvedTokens: [], unresolvedTokens: [] });
  });

  it('throws with the response status on a non-ok response', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });

    await expect(putSession('2026-07-04', { entries: [] })).rejects.toThrow('500');
  });

  it('builds the query string for getGoalProgress', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => [] });

    await getGoalProgress('2026-07-06');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/goals/active/progress?weekStart=2026-07-06'),
      expect.any(Object)
    );
  });
});
