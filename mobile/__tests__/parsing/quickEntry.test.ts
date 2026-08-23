import { parseQuickEntryLine, pickExercise } from '@/src/parsing/quickEntry';
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
      { id: '1', token: 'RDL', exerciseId: 'ex-1', exerciseName: 'Romanian Deadlift', source: 'BUILT_IN', createdAt: '' },
    ]);
    const resolveLine = jest.fn();
    const api = fakeApi({ resolveLine });

    const result = await parseQuickEntryLine(api, 'RDL 40kg 8x3');

    expect(resolveLine).not.toHaveBeenCalled();
    expect(result.status).toBe('resolved');
    expect(result.exerciseId).toBe('ex-1');
    expect(result.exerciseName).toBe('Romanian Deadlift');
    expect(result.weightKg).toBe(40);
    expect(result.reps).toBe(8);
    expect(result.sets).toBe(3);
    expect(result.parsedBy).toBe('DICTIONARY');
  });

  it('falls back to the network when the local cache misses, extracting exerciseId from resolvedTokens', async () => {
    const api = fakeApi({
      resolveLine: jest.fn().mockResolvedValue({
        resolvedTokens: [{ token: 'HT', type: 'exercise', exerciseId: 'ex-2', exerciseName: 'Hip Thrust' }],
        unresolvedTokens: [],
      }),
    });

    const result = await parseQuickEntryLine(api, 'HT 50kg 10x3');

    expect(result.status).toBe('resolved');
    expect(result.exerciseId).toBe('ex-2');
    expect(result.exerciseName).toBe('Hip Thrust');
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

  it('binds the exercise-name token, not the clarifying-question token, as unresolvedToken', async () => {
    // "As Drip 40kg 8x3": neither "As" nor "Drip" is in the dictionary, so
    // both are unresolved. The LLM identifies "Drip" as the exercise (Dip)
    // and flags "As" as the ambiguous leftover — unresolvedToken must bind
    // to "Drip" (the exercise), not just unresolvedTokens[0] ("As"), or
    // confirming would wrongly teach the dictionary that "As" means Dip.
    const api = fakeApi({
      resolveLine: jest.fn().mockResolvedValue({
        resolvedTokens: [],
        unresolvedTokens: ['As', 'Drip'],
        llmGuess: {
          exerciseName: 'Dip',
          equipment: null,
          weightKg: null,
          reps: null,
          sets: null,
          muscles: ['CHEST', 'ARMS'],
          clarifyingQuestion: {
            token: 'As',
            question: 'What does "As" mean?',
            alternatives: ['Assisted', 'As many reps as possible'],
          },
        },
      }),
    });

    const result = await parseQuickEntryLine(api, 'As Drip 40kg 8x3');

    expect(result.status).toBe('needs-confirm');
    expect(result.unresolvedToken).toBe('Drip');
    expect(result.clarifyingQuestion).toEqual({
      token: 'As',
      question: 'What does "As" mean?',
      alternatives: ['Assisted', 'As many reps as possible'],
    });
  });

  it('folds equipment into the name and binds the exercise token, not the equipment token', async () => {
    // "bb deadlifts 30kg 8x3": "bb" is barbell shorthand. The exercise-name
    // binding must go to "deadlifts"; "bb" is reported separately as the
    // equipment token so confirm can save it as an equipment modifier.
    const api = fakeApi({
      resolveLine: jest.fn().mockResolvedValue({
        resolvedTokens: [],
        unresolvedTokens: ['bb', 'deadlifts'],
        llmGuess: {
          exerciseName: 'Deadlift',
          equipment: 'Barbell',
          equipmentToken: 'bb',
          weightKg: 30,
          reps: 8,
          sets: 3,
          muscles: ['HAMSTRINGS', 'GLUTES', 'BACK'],
        },
      }),
    });

    const result = await parseQuickEntryLine(api, 'bb deadlifts 30kg 8x3');

    expect(result.status).toBe('needs-confirm');
    expect(result.exerciseName).toBe('Barbell Deadlift');
    expect(result.equipment).toBe('Barbell');
    expect(result.equipmentToken).toBe('bb');
    expect(result.unresolvedToken).toBe('deadlifts');
  });

  it('does not double-prefix when the LLM already put the equipment in the name', async () => {
    const api = fakeApi({
      resolveLine: jest.fn().mockResolvedValue({
        resolvedTokens: [],
        unresolvedTokens: ['db', 'press'],
        llmGuess: { exerciseName: 'Dumbbell Press', equipment: 'Dumbbell', equipmentToken: 'db', muscles: ['CHEST'] },
      }),
    });
    const result = await parseQuickEntryLine(api, 'db press 20kg 8x3');
    expect(result.exerciseName).toBe('Dumbbell Press');
    expect(result.unresolvedToken).toBe('press');
  });

  it('treats an empty LLM exerciseName as absent (no blank titles)', async () => {
    const api = fakeApi({
      resolveLine: jest.fn().mockResolvedValue({
        resolvedTokens: [],
        unresolvedTokens: ['bb', 'rows'],
        llmGuess: { exerciseName: '  ', equipment: 'Barbell', equipmentToken: 'bb', muscles: ['BACK'] },
      }),
    });
    const result = await parseQuickEntryLine(api, '30kg bb rows 8x3');
    expect(result.exerciseName).toBeUndefined();
    expect(result.status).toBe('needs-confirm');
  });

  it('reports every exercise-name token so confirm can bind all of them (multi-word names)', async () => {
    const api = fakeApi({
      resolveLine: jest.fn().mockResolvedValue({
        resolvedTokens: [],
        unresolvedTokens: ['cable', 'lat', 'close', 'pull', 'down'],
        llmGuess: { exerciseName: 'Close-Grip Lat Pulldown', equipment: 'Cable', equipmentToken: 'cable', muscles: ['BACK'] },
      }),
    });
    const result = await parseQuickEntryLine(api, '27.5kg cable lat close pull down 8x3');
    expect(result.exerciseTokens).toEqual(['lat', 'close', 'pull', 'down']);
    expect(result.unresolvedToken).toBe('lat');
  });

  it('keeps needs-confirm when only a clarifying-question token is left on a known exercise', async () => {
    const api = fakeApi({
      resolveLine: jest.fn().mockResolvedValue({
        resolvedTokens: [{ token: 'dip', type: 'exercise', exerciseId: 'ex-dip', exerciseName: 'Dip' }],
        unresolvedTokens: ['As'],
        llmGuess: {
          exerciseName: 'Dip',
          muscles: ['CHEST'],
          clarifyingQuestion: { token: 'As', question: 'What does "As" mean?', alternatives: ['Assisted', 'AMRAP'] },
        },
      }),
    });
    const result = await parseQuickEntryLine(api, 'As dip 8x3');
    expect(result.status).toBe('needs-confirm');
    expect(result.clarifyingQuestion?.token).toBe('As');
  });

  it('tolerates a null resolvedTokens from the server (Go nil slice) on the LLM path', async () => {
    const api = fakeApi({
      resolveLine: jest.fn().mockResolvedValue({
        resolvedTokens: null,
        unresolvedTokens: ['romanian', 'dl'],
        llmGuess: { exerciseName: 'Romanian Dl', equipment: null, muscles: [] },
      }),
    });
    const result = await parseQuickEntryLine(api, 'romanian dl');
    expect(result.status).toBe('needs-confirm');
    expect(result.exerciseName).toBe('Romanian Dl');
    expect(result.exerciseTokens).toEqual(['romanian', 'dl']);
  });

  it('keeps the questioned token as the exercise token when the question is about the exercise itself', async () => {
    const api = fakeApi({
      resolveLine: jest.fn().mockResolvedValue({
        resolvedTokens: [],
        unresolvedTokens: ['pc'],
        llmGuess: {
          exerciseName: 'Power Clean',
          muscles: ['BACK', 'QUADS'],
          clarifyingQuestion: { kind: 'exercise', token: 'pc', question: 'Did you mean…?', alternatives: ['Power Clean', 'Preacher Curl'] },
        },
      }),
    });
    const result = await parseQuickEntryLine(api, 'pc 60kg 3x3');
    expect(result.status).toBe('needs-confirm');
    expect(result.exerciseTokens).toEqual(['pc']);
    expect(result.unresolvedToken).toBe('pc');
    expect(result.clarifyingQuestion?.kind).toBe('exercise');
  });

  it('falls back to unresolvedTokens[0] when there is no clarifying question (unchanged behavior)', async () => {
    const api = fakeApi({
      resolveLine: jest.fn().mockResolvedValue({
        resolvedTokens: [],
        unresolvedTokens: ['CRABWALK'],
        llmGuess: { exerciseName: 'Crab Walk', equipment: null, weightKg: null, reps: 8, sets: 2, muscles: ['GLUTES', 'CORE'] },
      }),
    });

    const result = await parseQuickEntryLine(api, 'CRABWALK 8x2');

    expect(result.unresolvedToken).toBe('CRABWALK');
    expect(result.clarifyingQuestion).toBeUndefined();
  });

  describe('exercise choice when several tokens map to different exercises', () => {
    // Once confirm binds EVERY name token ("shoulder" AND "press" → Shoulder
    // Press), a later "bench press" line has "bench"→Bench Press and
    // "press"→Shoulder Press. The exercise backed by the most tokens wins;
    // on a tie the exercise whose token appears first on the line wins — so
    // the bench sets are never logged under Shoulder Press.
    const benchAndShoulder = [
      { id: '1', token: 'BENCH', exerciseId: 'ex-bench', exerciseName: 'Bench Press', source: 'USER_ADDED', createdAt: '' },
      { id: '2', token: 'PRESS', exerciseId: 'ex-shoulder', exerciseName: 'Shoulder Press', source: 'USER_ADDED', createdAt: '' },
      { id: '3', token: 'SHOULDER', exerciseId: 'ex-shoulder', exerciseName: 'Shoulder Press', source: 'USER_ADDED', createdAt: '' },
    ];

    it('local path: tie → the exercise whose token comes first on the line', async () => {
      await cacheAbbreviations(benchAndShoulder);
      const result = await parseQuickEntryLine(fakeApi(), 'bench press 60kg 8x3');
      expect(result.status).toBe('resolved');
      expect(result.exerciseId).toBe('ex-bench');
      expect(result.exerciseName).toBe('Bench Press');
    });

    it('local path: the exercise backed by more tokens beats a single-token one', async () => {
      await cacheAbbreviations(benchAndShoulder);
      const result = await parseQuickEntryLine(fakeApi(), 'shoulder press 20kg 8x3');
      expect(result.exerciseId).toBe('ex-shoulder');
      expect(result.exerciseName).toBe('Shoulder Press');
    });

    it('network path: tie → first token wins', async () => {
      const api = fakeApi({
        resolveLine: jest.fn().mockResolvedValue({
          resolvedTokens: [
            { token: 'bench', type: 'exercise', exerciseId: 'ex-bench', exerciseName: 'Bench Press' },
            { token: 'press', type: 'exercise', exerciseId: 'ex-shoulder', exerciseName: 'Shoulder Press' },
          ],
          unresolvedTokens: [],
        }),
      });
      const result = await parseQuickEntryLine(api, 'bench press 60kg 8x3');
      expect(result.status).toBe('resolved');
      expect(result.exerciseId).toBe('ex-bench');
      expect(result.exerciseName).toBe('Bench Press');
    });

    it('network path: most tokens wins even when the lone token comes first', async () => {
      const api = fakeApi({
        resolveLine: jest.fn().mockResolvedValue({
          resolvedTokens: [
            { token: 'press', type: 'exercise', exerciseId: 'ex-bench', exerciseName: 'Bench Press' },
            { token: 'shoulder', type: 'exercise', exerciseId: 'ex-shoulder', exerciseName: 'Shoulder Press' },
            { token: 'press', type: 'exercise', exerciseId: 'ex-shoulder', exerciseName: 'Shoulder Press' },
          ],
          unresolvedTokens: [],
        }),
      });
      const result = await parseQuickEntryLine(api, 'press shoulder press 20kg 8x3');
      expect(result.exerciseId).toBe('ex-shoulder');
    });

    it('pickExercise: returns undefined with no exercise tokens', () => {
      expect(pickExercise([])).toBeUndefined();
      expect(pickExercise([{ token: 'bb' }])).toBeUndefined();
    });
  });

  describe('equipment-only unresolved token on a dictionary-known exercise', () => {
    // Dictionary already knows "deadlifts"; user types "bb deadlifts 60kg 8x3".
    // Only "bb" is unresolved and the LLM identifies it as equipment — so
    // there is NO exercise-name token left to bind. The line must resolve
    // against the dictionary exercise instead of asking the user to confirm
    // (which would have bound "bb" as an alias of Deadlift).
    it('resolves using the dictionary exercise when every unresolved token is equipment', async () => {
      const api = fakeApi({
        resolveLine: jest.fn().mockResolvedValue({
          resolvedTokens: [{ token: 'deadlifts', type: 'exercise', exerciseId: 'ex-dl', exerciseName: 'Deadlift' }],
          unresolvedTokens: ['bb'],
          llmGuess: { exerciseName: 'Deadlift', equipment: 'Barbell', equipmentToken: 'BB', weightKg: 60, reps: 8, sets: 3, muscles: ['BACK'] },
        }),
      });
      const result = await parseQuickEntryLine(api, 'bb deadlifts 60kg 8x3');
      expect(result.status).toBe('resolved');
      expect(result.exerciseId).toBe('ex-dl');
      expect(result.exerciseName).toBe('Deadlift');
      expect(result.equipment).toBe('Barbell');
      expect(result.parsedBy).toBe('DICTIONARY');
      expect(result.weightKg).toBe(60);
      expect(result.reps).toBe(8);
      expect(result.sets).toBe(3);
      expect(result.exerciseTokens).toBeUndefined();
      expect(result.unresolvedToken).toBeUndefined();
    });

    it('keeps needs-confirm with no exercise tokens when the equipment token stands alone', async () => {
      const api = fakeApi({
        resolveLine: jest.fn().mockResolvedValue({
          resolvedTokens: [],
          unresolvedTokens: ['bb'],
          llmGuess: { exerciseName: 'Barbell', equipment: 'Barbell', equipmentToken: 'bb', muscles: [] },
        }),
      });
      const result = await parseQuickEntryLine(api, 'bb 60kg 8x3');
      expect(result.status).toBe('needs-confirm');
      expect(result.exerciseTokens).toEqual([]);
      expect(result.unresolvedToken).toBeUndefined();
      expect(result.equipmentToken).toBe('bb');
    });

    it('compares equipment/clarifying tokens case-insensitively when excluding them', async () => {
      const api = fakeApi({
        resolveLine: jest.fn().mockResolvedValue({
          resolvedTokens: [],
          unresolvedTokens: ['BB', 'rows'],
          llmGuess: { exerciseName: 'Row', equipment: 'Barbell', equipmentToken: 'bb', muscles: ['BACK'] },
        }),
      });
      const result = await parseQuickEntryLine(api, 'BB rows 60kg 8x3');
      expect(result.exerciseTokens).toEqual(['rows']);
      expect(result.unresolvedToken).toBe('rows');
    });
  });
});
