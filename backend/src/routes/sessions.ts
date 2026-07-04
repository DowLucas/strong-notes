import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { ParsedBy } from '@prisma/client';
import { asyncHandler } from '../middleware/asyncHandler.js';

export const sessionsRouter = Router();

const entrySchema = z.object({
  exerciseId: z.string().optional(),
  equipment: z.string().optional(),
  weightKg: z.number().optional(),
  reps: z.number().int().optional(),
  sets: z.number().int().optional(),
  rawText: z.string().min(1),
  parsedBy: z.nativeEnum(ParsedBy),
  order: z.number().int(),
});

const putSchema = z.object({
  notes: z.string().optional(),
  entries: z.array(entrySchema),
});

sessionsRouter.get(
  '/sessions',
  asyncHandler(async (req, res) => {
    const from = new Date(String(req.query.from));
    const to = new Date(String(req.query.to));
    const sessions = await prisma.workoutSession.findMany({
      where: { userId: 'lucas', date: { gte: from, lte: to } },
      include: { entries: true },
      orderBy: { date: 'asc' },
    });
    res.status(200).json(sessions);
  }),
);

sessionsRouter.put(
  '/sessions/:date',
  asyncHandler(async (req, res) => {
    const parsed = putSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const date = new Date(`${req.params.date}T00:00:00.000Z`);

    const session = await prisma.$transaction(async (tx) => {
      const existing = await tx.workoutSession.upsert({
        where: { userId_date: { userId: 'lucas', date } },
        update: { notes: parsed.data.notes },
        create: { userId: 'lucas', date, notes: parsed.data.notes },
      });
      await tx.setEntry.deleteMany({ where: { sessionId: existing.id } });
      await tx.setEntry.createMany({
        data: parsed.data.entries.map((e) => ({ ...e, sessionId: existing.id })),
      });
      return tx.workoutSession.findUniqueOrThrow({
        where: { id: existing.id },
        include: { entries: true },
      });
    });

    res.status(200).json(session);
  }),
);
