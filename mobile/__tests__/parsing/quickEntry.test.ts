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

  it('resolves fully offline from the cached dictionary without calling the network', async () => {
    await cacheAbbreviations([
      { id: '1', token: 'BB', modifierType: 'equipment', modifierValue: 'barbell', source: 'BUILT_IN' },
      { id: '2', token: 'RDL', exerciseId: 'ex-1', source: 'BUILT_IN' },
    ]);

    const result = await parseQuickEntryLine('BB RDL 40kg 8x3');

    expect(result.status).toBe('resolved');
    expect(result.parsedBy).toBe('DICTIONARY');
    expect(mockResolveLine).not.toHaveBeenCalled();
  });

  it('falls back to the network when a token is not in the local cache', async () => {
    await cacheAbbreviations([{ id: '1', token: 'BB', modifierType: 'equipment', modifierValue: 'barbell', source: 'BUILT_IN' }]);
    mockResolveLine.mockResolvedValue({
      resolvedTokens: [{ token: 'BB', type: 'modifier', modifierType: 'equipment', modifierValue: 'barbell' }],
      unresolvedTokens: [],
    });

    const result = await parseQuickEntryLine('BB RDL 40kg 8x3');

    expect(mockResolveLine).toHaveBeenCalledWith('BB RDL 40kg 8x3');
    expect(result.status).toBe('resolved');
    expect(result.parsedBy).toBe('DICTIONARY');
  });

  it('marks a line with unresolved tokens and no LLM guess as unresolved (cache miss falls back to network)', async () => {
    mockResolveLine.mockResolvedValue({ resolvedTokens: [], unresolvedTokens: ['???'] });

    const result = await parseQuickEntryLine('???');

    expect(mockResolveLine).toHaveBeenCalled();
    expect(result.status).toBe('unresolved');
  });

  it('marks an LLM-guessed line as needs-confirm', async () => {
    mockResolveLine.mockResolvedValue({
      resolvedTokens: [],
      unresolvedTokens: ['CRABWALK'],
      llmGuess: { exerciseName: 'Cable Crab Walk', equipment: undefined, weightKg: undefined, reps: 8, sets: 2 },
    });

    const result = await parseQuickEntryLine('CRABWALK 8x2');

    expect(result.status).toBe('needs-confirm');
    expect(result.exerciseName).toBe('Cable Crab Walk');
    expect(result.parsedBy).toBe('LLM');
  });
});
