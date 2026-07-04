import { Router } from 'express';
import { z } from 'zod';
import { resolveLineWithDictionary } from '../parsing/dictionaryResolver.js';
import * as llmProvider from '../llm/provider.js';

export const resolveRouter = Router();

const lineSchema = z.object({ line: z.string().min(1) });
const goalSchema = z.object({ text: z.string().min(1) });

resolveRouter.post('/resolve/line', async (req, res) => {
  const parsed = lineSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const dictionaryResult = await resolveLineWithDictionary(parsed.data.line, 'lucas');
  if (dictionaryResult.unresolvedTokens.length === 0) {
    return res.status(200).json(dictionaryResult);
  }

  const llmGuess = await llmProvider.getLlmProvider().resolveLine(parsed.data.line, dictionaryResult.unresolvedTokens);
  return res.status(200).json({ ...dictionaryResult, llmGuess });
});

resolveRouter.post('/resolve/goal', async (req, res) => {
  const parsed = goalSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const guess = await llmProvider.getLlmProvider().resolveGoal(parsed.data.text);
  return res.status(200).json(guess);
});
