import { prisma } from '../db.js';

export type DictionaryResolution = {
  resolvedTokens: {
    token: string;
    type: 'exercise' | 'modifier';
    exerciseId?: string;
    modifierType?: string;
    modifierValue?: string;
  }[];
  unresolvedTokens: string[];
};

const NUMERIC_TOKEN = /^\d+(\.\d+)?(kg|lb)?$|^\d+x\d+$/i;

export async function resolveLineWithDictionary(line: string, userId: string): Promise<DictionaryResolution> {
  const tokens = line.trim().split(/\s+/);
  const wordTokens = tokens.filter((t) => !NUMERIC_TOKEN.test(t));

  const abbreviations = await prisma.abbreviation.findMany({
    where: { userId, token: { in: wordTokens.map((t) => t.toUpperCase()) } },
  });
  const byToken = new Map(abbreviations.map((a) => [a.token, a]));

  const resolvedTokens: DictionaryResolution['resolvedTokens'] = [];
  const unresolvedTokens: string[] = [];

  for (const token of wordTokens) {
    const match = byToken.get(token.toUpperCase());
    if (!match) {
      unresolvedTokens.push(token);
      continue;
    }
    if (match.exerciseId) {
      resolvedTokens.push({ token, type: 'exercise', exerciseId: match.exerciseId });
    } else {
      resolvedTokens.push({
        token,
        type: 'modifier',
        modifierType: match.modifierType ?? undefined,
        modifierValue: match.modifierValue ?? undefined,
      });
    }
  }

  return { resolvedTokens, unresolvedTokens };
}
