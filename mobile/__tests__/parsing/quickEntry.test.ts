import { parseQuickEntryLine } from '../../src/parsing/quickEntry';
import { resolveLine } from '../../src/api/client';
import { resetDbForTests } from '../../src/db/client';
import { cacheAbbreviations } from '../../src/db/abbreviationsRepo';

jest.mock('../../src/api/client', () => ({
  resolveLine: jest.fn(),
}));

const mockResolveLine = resolveLine as jest.Mock;

describe('parseQuickEntryLine', () => {
  beforeEach(() => {
    resetDbForTests();
    mockResolveLine.mockReset();
  });

  it('resolves fully offline from the cached dictionary without calling the network, carrying exerciseId/equipment/weight/reps/sets', async () => {
    await cacheAbbreviations([
      { id: '1', token: 'BB', modifierType: 'equipment', modifierValue: 'barbell', source: 'BUILT_IN' },
      { id: '2', token: 'RDL', exerciseId: 'ex-1', source: 'BUILT_IN' },
    ]);

    const result = await parseQuickEntryLine('BB RDL 40kg 8x3');

    expect(result.status).toBe('resolved');
    expect(result.parsedBy).toBe('DICTIONARY');
    expect(mockResolveLine).not.toHaveBeenCalled();
    expect(result.exerciseId).toBe('ex-1');
    expect(result.equipment).toBe('barbell');
    expect(result.weightKg).toBe(40);
    expect(result.reps).toBe(8);
    expect(result.sets).toBe(3);
  });

  it('falls back to the network when a token is not in the local cache, carrying exerciseId/equipment/weight/reps/sets from resolvedTokens', async () => {
    await cacheAbbreviations([{ id: '1', token: 'BB', modifierType: 'equipment', modifierValue: 'barbell', source: 'BUILT_IN' }]);
    mockResolveLine.mockResolvedValue({
      resolvedTokens: [
        { token: 'BB', type: 'modifier', modifierType: 'equipment', modifierValue: 'barbell' },
        { token: 'RDL', type: 'exercise', exerciseId: 'ex-1' },
      ],
      unresolvedTokens: [],
    });

    const result = await parseQuickEntryLine('BB RDL 40kg 8x3');

    expect(mockResolveLine).toHaveBeenCalledWith('BB RDL 40kg 8x3');
    expect(result.status).toBe('resolved');
    expect(result.parsedBy).toBe('DICTIONARY');
    expect(result.exerciseId).toBe('ex-1');
    expect(result.equipment).toBe('barbell');
    expect(result.weightKg).toBe(40);
    expect(result.reps).toBe(8);
    expect(result.sets).toBe(3);
  });

  it('marks a line with unresolved tokens and no LLM guess as unresolved (cache miss falls back to network)', async () => {
    mockResolveLine.mockResolvedValue({ resolvedTokens: [], unresolvedTokens: ['???'] });

    const result = await parseQuickEntryLine('???');

    expect(mockResolveLine).toHaveBeenCalled();
    expect(result.status).toBe('unresolved');
  });

  it('marks an LLM-guessed line as needs-confirm, preferring the LLM-provided weight/reps/sets', async () => {
    mockResolveLine.mockResolvedValue({
      resolvedTokens: [],
      unresolvedTokens: ['CRABWALK'],
      llmGuess: { exerciseName: 'Cable Crab Walk', equipment: undefined, weightKg: 99, reps: 8, sets: 2 },
    });

    const result = await parseQuickEntryLine('CRABWALK 8x2');

    expect(result.status).toBe('needs-confirm');
    expect(result.exerciseName).toBe('Cable Crab Walk');
    expect(result.parsedBy).toBe('LLM');
    // The LLM's own guess (99) wins over the client-side regex parse of the
    // raw text, even though "8x2" would otherwise parse reps/sets itself.
    expect(result.weightKg).toBe(99);
    expect(result.reps).toBe(8);
    expect(result.sets).toBe(2);
  });

  it('carries the unresolved token and LLM muscle guess through on a needs-confirm result', async () => {
    mockResolveLine.mockResolvedValue({
      resolvedTokens: [],
      unresolvedTokens: ['CRABWALK'],
      llmGuess: { exerciseName: 'Cable Crab Walk', equipment: undefined, weightKg: 99, reps: 8, sets: 2, muscles: ['GLUTES', 'CORE'] },
    });

    const result = await parseQuickEntryLine('CRABWALK 8x2');

    expect(result.status).toBe('needs-confirm');
    expect(result.unresolvedToken).toBe('CRABWALK');
    expect(result.muscles).toEqual(['GLUTES', 'CORE']);
  });

  it('falls back to client-side numeric parsing when the LLM guess omits weight/reps/sets', async () => {
    mockResolveLine.mockResolvedValue({
      resolvedTokens: [],
      unresolvedTokens: ['CRABWALK'],
      llmGuess: { exerciseName: 'Cable Crab Walk', equipment: undefined, weightKg: undefined, reps: undefined, sets: undefined },
    });

    const result = await parseQuickEntryLine('CRABWALK 20kg 8x2');

    expect(result.status).toBe('needs-confirm');
    expect(result.weightKg).toBe(20);
    expect(result.reps).toBe(8);
    expect(result.sets).toBe(2);
  });
});
