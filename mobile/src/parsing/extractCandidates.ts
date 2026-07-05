// src/parsing/extractCandidates.ts

export type Candidate = { text: string; start: number; end: number };

// A token is a numeric anchor if it is a reps×sets pattern (8x3) or a weight
// with an explicit unit (40kg / 40lb / 40.5kg). Bare numbers are deliberately
// excluded so prose like "fix 3 things" doesn't create false candidates.
const ANCHOR_TOKEN = /^(?:\d+x\d+|\d+(?:\.\d+)?(?:kg|lb))$/i;

// Clauses are runs of text between sentence separators: period, comma, newline.
const CLAUSE = /[^.,\n]+/g;

export function extractCandidates(text: string): Candidate[] {
  const candidates: Candidate[] = [];
  let match: RegExpExecArray | null;
  while ((match = CLAUSE.exec(text)) !== null) {
    const rawClause = match[0];
    const leadingWs = rawClause.length - rawClause.trimStart().length;
    const trimmed = rawClause.trim();
    if (trimmed.length === 0) continue;

    const hasAnchor = trimmed.split(/\s+/).some((token) => ANCHOR_TOKEN.test(token));
    if (!hasAnchor) continue;

    const start = match.index + leadingWs;
    candidates.push({ text: trimmed, start, end: start + trimmed.length });
  }
  return candidates;
}
