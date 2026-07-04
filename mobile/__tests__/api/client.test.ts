import { resolveLine, putSession, getGoalProgress, buildEmphasisOverrides, ApiError } from '../../src/api/client';
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

  it('throws an ApiError carrying the status code on a non-ok response', async () => {
    expect.assertions(2);
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });

    try {
      await putSession('2026-07-04', { entries: [] });
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(404);
    }
  });

  it('builds the query string for getGoalProgress', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => [] });

    await getGoalProgress('2026-07-06');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/goals/active/progress?weekStart=2026-07-06'),
      expect.any(Object)
    );
  });

  describe('buildEmphasisOverrides', () => {
    it('raises min and max above the type default for an identified muscle', () => {
      const overrides = buildEmphasisOverrides('STRENGTH', ['GLUTES']);

      expect(overrides).toEqual([{ muscle: 'GLUTES', min: 8, max: 12 }]);
      // Sanity check against a plain STRENGTH goal's default GLUTES range (min 4, max 8).
      expect(overrides[0].min).toBeGreaterThan(4);
      expect(overrides[0].max).toBeGreaterThan(8);
    });

    it('returns one override per identified muscle and nothing for muscles not identified', () => {
      const overrides = buildEmphasisOverrides('HYPERTROPHY', ['CHEST', 'BACK']);

      expect(overrides).toHaveLength(2);
      expect(overrides.find((o) => o.muscle === 'CHEST')).toEqual({ muscle: 'CHEST', min: 14, max: 22 });
      expect(overrides.find((o) => o.muscle === 'BACK')).toEqual({ muscle: 'BACK', min: 14, max: 20 });
      expect(overrides.find((o) => o.muscle === 'QUADS')).toBeUndefined();
    });

    it('returns an empty array when no muscles are identified', () => {
      expect(buildEmphasisOverrides('ENDURANCE', [])).toEqual([]);
    });
  });
});
