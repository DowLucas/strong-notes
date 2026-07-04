import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { AbbreviationSource } from '@prisma/client';
import { asyncHandler } from '../middleware/asyncHandler.js';

export const abbreviationsRouter = Router();

const createSchema = z.object({
  token: z.string().min(1),
  exerciseId: z.string().optional(),
  modifierType: z.string().optional(),
  modifierValue: z.string().optional(),
});

abbreviationsRouter.get(
  '/abbreviations',
  asyncHandler(async (_req, res) => {
    const list = await prisma.abbreviation.findMany({ where: { userId: 'lucas' } });
    res.status(200).json(list);
  }),
);

abbreviationsRouter.post(
  '/abbreviations',
  asyncHandler(async (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const existing = await prisma.abbreviation.findUnique({
      where: { userId_token: { userId: 'lucas', token: parsed.data.token } },
    });
    if (existing) return res.status(201).json(existing);

    const created = await prisma.abbreviation.create({
      data: { userId: 'lucas', source: AbbreviationSource.USER_ADDED, ...parsed.data },
    });
    res.status(201).json(created);
  }),
);

abbreviationsRouter.patch(
  '/abbreviations/:id/confirm',
  asyncHandler(async (req, res) => {
    const updated = await prisma.abbreviation.update({
      where: { id: req.params.id },
      data: { source: AbbreviationSource.USER_ADDED },
    });
    res.status(200).json(updated);
  }),
);
