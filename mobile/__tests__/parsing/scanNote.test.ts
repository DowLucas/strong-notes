// __tests__/parsing/scanNote.test.ts
import { scanNote, type ScannedEntry } from '@/src/parsing/scanNote';
import { resetDbForTests } from '@/src/db/client';
import { cacheAbbreviations } from '@/src/db/abbreviationsRepo';
import type { ApiClient } from '@/lib/api';

function fakeApi(overrides: Partial<ApiClient> = {}): ApiClient {
  return { resolveLine: jest.fn(), ...overrides } as unknown as ApiClient;
}

beforeEach(() => {
  resetDbForTests();
});

describe('scanNote', () => {
  it('produces a resolved entry with span offsets for a recognized clause', async () => {
    const api = fakeApi({
      resolveLine: jest.fn().mockResolvedValue({
        resolvedTokens: [{ token: 'RDL', type: 'exercise', exerciseId: 'ex-1' }],
        unresolvedTokens: [],
      }),
    });
    const text = 'Warmup, then RDL 40kg 8x3';
    const entries = await scanNote(api, text, []);

    expect(entries).toHaveLength(1);
    expect(entries[0].status).toBe('resolved');
    expect(entries[0].exerciseId).toBe('ex-1');
    // A line with exactly one set-group has nothing to disambiguate, so the
    // highlight includes the resolved name along with the group, not just
    // the numbers on their own.
    expect(text.slice(entries[0].spanStart!, entries[0].spanEnd!)).toBe(text);
  });

  it('includes the exercise name in the highlight for a single-group line', async () => {
    const api = fakeApi({
      resolveLine: jest.fn().mockResolvedValue({
        resolvedTokens: [{ token: 'Bench', type: 'exercise', exerciseId: 'ex-bench' }],
        unresolvedTokens: [],
      }),
    });
    const text = 'Bench 8x3 50kg';
    const entries = await scanNote(api, text, []);

    expect(entries).toHaveLength(1);
    expect(entries[0].exerciseId).toBe('ex-bench');
    expect(text.slice(entries[0].spanStart!, entries[0].spanEnd!)).toBe('Bench 8x3 50kg');
  });

  it('drops clauses that resolve to unresolved (no highlight)', async () => {
    const api = fakeApi({
      resolveLine: jest.fn().mockResolvedValue({ resolvedTokens: [], unresolvedTokens: ['ZZZ'] }),
    });
    const entries = await scanNote(api, 'ZZZ 40kg 8x3', []);
    expect(entries).toEqual([]);
  });

  it('reuses a prior resolution for an unchanged clause without calling the network again', async () => {
    await cacheAbbreviations([{ id: '1', token: 'RDL', exerciseId: 'ex-1', source: 'BUILT_IN', createdAt: '' }]);
    const resolveLine = jest.fn();
    const api = fakeApi({ resolveLine });

    const first = await scanNote(api, 'RDL 40kg 8x3', []); // resolves locally, no network
    const second = await scanNote(api, 'RDL 40kg 8x3', first);

    expect(resolveLine).not.toHaveBeenCalled();
    expect(second[0].id).toBe(first[0].id); // stable id across re-scan
  });

  it('skips a clause whose resolution throws (offline/LLM down) without rejecting the whole scan', async () => {
    const api = fakeApi({
      resolveLine: jest
        .fn()
        .mockResolvedValueOnce({
          resolvedTokens: [{ token: 'RDL', type: 'exercise', exerciseId: 'ex-1' }],
          unresolvedTokens: [],
        })
        .mockRejectedValueOnce(Object.assign(new Error('llm resolve failed'), { status: 500 })),
    });

    // First clause resolves; second clause's resolve() throws (500). The scan
    // must not reject — it keeps the good entry and simply omits the failed one.
    const entries = await scanNote(api, 'RDL 40kg 8x3, MysteryMove 20kg 5x5', []);

    expect(entries).toHaveLength(1);
    expect(entries[0].exerciseId).toBe('ex-1');
  });

  it('surfaces needs-confirm metadata for an LLM guess', async () => {
    const api = fakeApi({
      resolveLine: jest.fn().mockResolvedValue({
        resolvedTokens: [],
        unresolvedTokens: ['CRABWALK'],
        llmGuess: { exerciseName: 'Crab Walk', muscles: ['GLUTES', 'CORE'], reps: 8, sets: 2 },
      }),
    });
    const entries = await scanNote(api, 'CRABWALK 8x2', []);
    expect(entries[0].status).toBe('needs-confirm');
    expect(entries[0].exerciseName).toBe('Crab Walk');
    expect(entries[0].unresolvedToken).toBe('CRABWALK');
    expect(entries[0].muscles).toEqual(['GLUTES', 'CORE']);
  });

  it('emits a name span plus one entry per packed set-group, sharing the resolved exercise', async () => {
    const api = fakeApi({
      resolveLine: jest.fn().mockResolvedValue({
        resolvedTokens: [{ token: 'RDL', type: 'exercise', exerciseId: 'ex-1' }],
        unresolvedTokens: [],
      }),
    });
    const entries = await scanNote(api, 'BB RDL 40kgx8 50kgx8x4 40kgx8x3', []);

    // 1 name-only span ("BB RDL") + 3 set-groups.
    expect(entries).toHaveLength(4);
    expect(entries.every((e) => e.exerciseId === 'ex-1')).toBe(true);
    expect(entries[0].isNameOnly).toBe(true);
    expect(entries.slice(1).map((e) => [e.weightKg, e.reps, e.sets])).toEqual([
      [40, 8, 1],
      [50, 8, 4],
      [40, 8, 3],
    ]);
    // Name resolved once, not once per group.
    expect((api.resolveLine as jest.Mock).mock.calls).toHaveLength(1);
  });

  it('spans each group token individually within the line, after the name span', async () => {
    const api = fakeApi({
      resolveLine: jest.fn().mockResolvedValue({
        resolvedTokens: [{ token: 'RDL', type: 'exercise', exerciseId: 'ex-1' }],
        unresolvedTokens: [],
      }),
    });
    const text = 'BB RDL 40kgx8 50kgx8x4';
    const entries = await scanNote(api, text, []);
    expect(text.slice(entries[0].spanStart!, entries[0].spanEnd!)).toBe('BB RDL');
    expect(text.slice(entries[1].spanStart!, entries[1].spanEnd!)).toBe('40kgx8');
    expect(text.slice(entries[2].spanStart!, entries[2].spanEnd!)).toBe('50kgx8x4');
  });

  it('does not add a separate name span for a single-group line (already merged into its one span)', async () => {
    const api = fakeApi({
      resolveLine: jest.fn().mockResolvedValue({
        resolvedTokens: [{ token: 'Bench', type: 'exercise', exerciseId: 'ex-bench' }],
        unresolvedTokens: [],
      }),
    });
    const entries = await scanNote(api, 'Bench 8x3 50kg', []);
    expect(entries).toHaveLength(1);
    expect(entries[0].isNameOnly).toBeFalsy();
  });

  it('the name span shares groupId with its set-groups and is excluded from persistence', async () => {
    const api = fakeApi({
      resolveLine: jest.fn().mockResolvedValue({
        resolvedTokens: [{ token: 'RDL', type: 'exercise', exerciseId: 'ex-1' }],
        unresolvedTokens: [],
      }),
    });
    const entries = await scanNote(api, 'BB RDL 40kgx8 50kgx8x4', []);
    expect(entries[0].groupId).toBe(entries[1].groupId);
    expect(entries[0].weightKg).toBeNull();
    expect(entries[0].reps).toBeNull();
    expect(entries[0].sets).toBeNull();
  });

  it('inherits the exercise from the previous line into a ⁃ continuation line', async () => {
    const api = fakeApi({
      resolveLine: jest.fn().mockResolvedValue({
        resolvedTokens: [{ token: 'Squat', type: 'exercise', exerciseId: 'ex-sq' }],
        unresolvedTokens: [],
      }),
    });
    const text = 'BB Squat barx12x2\n    ⁃    50kgx8 60kgx6';
    const entries = await scanNote(api, text, []);

    // 2 groups on line 1 (barx12x2 -> 1 group) + 2 on the continuation = 3.
    expect(entries).toHaveLength(3);
    expect(entries.every((e) => e.exerciseId === 'ex-sq')).toBe(true);
    // The name is resolved once and reused for the continuation line.
    expect((api.resolveLine as jest.Mock).mock.calls).toHaveLength(1);
  });

  it('leaves a continuation line unhighlighted when no preceding exercise exists', async () => {
    const api = fakeApi({ resolveLine: jest.fn() });
    const entries = await scanNote(api, '    ⁃    50kgx8 60kgx6', []);
    expect(entries).toEqual([]);
    expect((api.resolveLine as jest.Mock).mock.calls).toHaveLength(0);
  });

  it('shares one groupId across every set-group on the same line', async () => {
    const api = fakeApi({
      resolveLine: jest.fn().mockResolvedValue({
        resolvedTokens: [{ token: 'RDL', type: 'exercise', exerciseId: 'ex-1' }],
        unresolvedTokens: [],
      }),
    });
    const entries = await scanNote(api, 'BB RDL 40kgx8 50kgx8x4 40kgx8x3', []);

    // 1 name-only span + 3 set-groups, all sharing one groupId.
    expect(entries).toHaveLength(4);
    expect(entries[0].groupId).toBeTruthy();
    expect(entries.every((e) => e.groupId === entries[0].groupId)).toBe(true);
  });

  it('shares the same groupId between a line and its ⁃ continuation', async () => {
    const api = fakeApi({
      resolveLine: jest.fn().mockResolvedValue({
        resolvedTokens: [{ token: 'Squat', type: 'exercise', exerciseId: 'ex-sq' }],
        unresolvedTokens: [],
      }),
    });
    const text = 'BB Squat barx12x2\n    ⁃    50kgx8 60kgx6';
    const entries = await scanNote(api, text, []);

    expect(entries).toHaveLength(3);
    expect(entries.every((e) => e.groupId === entries[0].groupId)).toBe(true);
  });

  it('gives different lines/exercises different groupIds', async () => {
    const api = fakeApi({
      resolveLine: jest
        .fn()
        .mockResolvedValueOnce({
          resolvedTokens: [{ token: 'RDL', type: 'exercise', exerciseId: 'ex-1' }],
          unresolvedTokens: [],
        })
        .mockResolvedValueOnce({
          resolvedTokens: [{ token: 'BP', type: 'exercise', exerciseId: 'ex-2' }],
          unresolvedTokens: [],
        }),
    });
    const entries = await scanNote(api, 'RDL 40kg 8x3\nBP 50kg 5x5', []);

    expect(entries).toHaveLength(2);
    expect(entries[0].groupId).not.toBe(entries[1].groupId);
  });

  it('keeps a stable groupId across a re-scan when the line is unchanged', async () => {
    const api = fakeApi({
      resolveLine: jest.fn().mockResolvedValue({
        resolvedTokens: [{ token: 'RDL', type: 'exercise', exerciseId: 'ex-1' }],
        unresolvedTokens: [],
      }),
    });
    const text = 'BB RDL 40kgx8 50kgx8x4';
    const first = await scanNote(api, text, []);
    const second = await scanNote(api, text, first);

    expect(second[0].groupId).toBe(first[0].groupId);
    expect(second[1].groupId).toBe(first[1].groupId);
  });

  it('propagates the clarifying question onto every entry sharing that resolved name', async () => {
    const api = fakeApi({
      resolveLine: jest.fn().mockResolvedValue({
        resolvedTokens: [],
        unresolvedTokens: ['As', 'Drip'],
        llmGuess: {
          exerciseName: 'Dip',
          muscles: ['CHEST', 'ARMS'],
          clarifyingQuestion: {
            token: 'As',
            question: 'What does "As" mean?',
            alternatives: ['Assisted', 'As many reps as possible'],
          },
        },
      }),
    });
    const entries = await scanNote(api, 'As Drip 8x3 50kg', []);

    expect(entries).toHaveLength(1);
    expect(entries[0].status).toBe('needs-confirm');
    expect(entries[0].clarifyingQuestion).toEqual({
      token: 'As',
      question: 'What does "As" mean?',
      alternatives: ['Assisted', 'As many reps as possible'],
    });
  });

  it('gives every entry a unique id even with repeated set-group tokens across a re-scan', async () => {
    const api = fakeApi({
      resolveLine: jest.fn().mockResolvedValue({
        resolvedTokens: [{ token: 'rdl', type: 'exercise', exerciseId: 'ex-1' }],
        unresolvedTokens: [],
      }),
    });
    const text = 'rdl 40kgx8 40kgx8'; // two identical tokens on one line
    const first = await scanNote(api, text, []);
    // Re-scan with the prior result as `previous` — the reuse path is where
    // duplicate tokens previously collided on one id (breaking the DB insert).
    const second = await scanNote(api, text, first);
    const ids = second.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
