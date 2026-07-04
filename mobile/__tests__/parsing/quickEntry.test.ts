import { parseQuickEntryLine } from '@/src/parsing/quickEntry';
import { cacheAbbreviations } from '@/src/db/abbreviationsRepo';
import { resetDbForTests } from '@/src/db/client';
import type { ApiClient } from '@/lib/api';

function fakeApi(overrides: Partial<ApiClient> = {}): ApiClient {
  return { resolveLine: jest.fn(), ...overrides } as unknown as ApiClient;
}

beforeEach(() => {
  resetDbForTests();
});

describe('parseQuickEntryLine', () => {
  it('resolves locally from the cached dictionary without calling the network', async () => {
    await cacheAbbreviations([
      { id: '1', token: 'RDL', exerciseId: 'ex-1', source: 'BUILT_IN', createdAt: '' },
    ]);
    const resolveLine = jest.fn();
    const api = fakeApi({ resolveLine });

    const result = await parseQuickEntryLine(api, 'RDL 40kg 8x3');

    expect(resolveLine).not.toHaveBeenCalled();
    expect(result.status).toBe('resolved');
    expect(result.exerciseId).toBe('ex-1');
    expect(result.weightKg).toBe(40);
    expect(result.reps).toBe(8);
    expect(result.sets).toBe(3);
    expect(result.parsedBy).toBe('DICTIONARY');
  });

  it('falls back to the network when the local cache misses, extracting exerciseId from resolvedTokens', async () => {
    const api = fakeApi({
      resolveLine: jest.fn().mockResolvedValue({
        resolvedTokens: [{ token: 'HT', type: 'exercise', exerciseId: 'ex-2' }],
        unresolvedTokens: [],
      }),
    });

    const result = await parseQuickEntryLine(api, 'HT 50kg 10x3');

    expect(result.status).toBe('resolved');
    expect(result.exerciseId).toBe('ex-2');
    expect(result.parsedBy).toBe('DICTIONARY');
  });

  it('marks an LLM-guessed line as needs-confirm with the unresolved token and muscles carried through', async () => {
    const api = fakeApi({
      resolveLine: jest.fn().mockResolvedValue({
        resolvedTokens: [],
        unresolvedTokens: ['CRABWALK'],
        llmGuess: { exerciseName: 'Crab Walk', equipment: null, weightKg: null, reps: 8, sets: 2, muscles: ['GLUTES', 'CORE'] },
      }),
    });

    const result = await parseQuickEntryLine(api, 'CRABWALK 8x2');

    expect(result.status).toBe('needs-confirm');
    expect(result.exerciseName).toBe('Crab Walk');
    expect(result.unresolvedToken).toBe('CRABWALK');
    expect(result.muscles).toEqual(['GLUTES', 'CORE']);
    expect(result.parsedBy).toBe('LLM');
  });
});
