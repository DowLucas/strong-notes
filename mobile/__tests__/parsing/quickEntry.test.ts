import { parseQuickEntryLine } from '../../src/parsing/quickEntry';
import { resolveLine } from '../../src/api/client';

jest.mock('../../src/api/client', () => ({
  resolveLine: jest.fn(),
}));

const mockResolveLine = resolveLine as jest.Mock;

describe('parseQuickEntryLine', () => {
  it('marks a fully dictionary-resolved line as resolved', async () => {
    mockResolveLine.mockResolvedValue({
      resolvedTokens: [{ token: 'BB', type: 'modifier', modifierType: 'equipment', modifierValue: 'barbell' }],
      unresolvedTokens: [],
    });

    const result = await parseQuickEntryLine('BB RDL 40kg 8x3');

    expect(result.status).toBe('resolved');
    expect(result.parsedBy).toBe('DICTIONARY');
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

  it('marks a line with unresolved tokens and no LLM guess as unresolved', async () => {
    mockResolveLine.mockResolvedValue({ resolvedTokens: [], unresolvedTokens: ['???'] });

    const result = await parseQuickEntryLine('???');

    expect(result.status).toBe('unresolved');
  });
});
