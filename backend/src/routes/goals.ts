import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { GoalType, MuscleGroup } from '@prisma/client';
import { getVolumeTargets } from '../science/volumeTable.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

export const goalsRouter = Router();

const progressQuerySchema = z.object({
  weekStart: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((v) => !isNaN(Date.parse(v)), { message: 'Invalid date' }),
});

const createSchema = z.object({
  type: z.nativeEnum(GoalType),
  description: z.string().optional(),
  overrides: z
    .array(z.object({ muscle: z.nativeEnum(MuscleGroup), min: z.number().int(), max: z.number().int() }))
    .optional(),
});

goalsRouter.post(
  '/goals',
  asyncHandler(async (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const defaults = getVolumeTargets(parsed.data.type);
    const overridesByMuscle = new Map((parsed.data.overrides ?? []).map((o) => [o.muscle, o]));

    const goal = await prisma.$transaction(async (tx) => {
      await tx.goal.updateMany({ where: { userId: 'lucas', isActive: true }, data: { isActive: false } });
      return tx.goal.create({
        data: {
          userId: 'lucas',
          type: parsed.data.type,
          description: parsed.data.description,
          isActive: true,
          targets: {
            create: Object.values(MuscleGroup).map((muscle) => {
              const override = overridesByMuscle.get(muscle);
              const range = override ?? defaults[muscle];
              return {
                muscle,
                minSetsPerWeek: override ? override.min : range.min,
                maxSetsPerWeek: override ? override.max : range.max,
              };
            }),
          },
        },
        include: { targets: true },
      });
    });

    res.status(201).json(goal);
  }),
);

goalsRouter.get(
  '/goals/active',
  asyncHandler(async (_req, res) => {
    const goal = await prisma.goal.findFirst({ where: { userId: 'lucas', isActive: true }, include: { targets: true } });
    if (!goal) return res.status(404).json({ error: 'no active goal' });
    res.status(200).json(goal);
  }),
);

goalsRouter.get(
  '/goals/active/progress',
  asyncHandler(async (req, res) => {
    const parsedQuery = progressQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) return res.status(400).json({ error: parsedQuery.error.flatten() });

    const goal = await prisma.goal.findFirst({ where: { userId: 'lucas', isActive: true }, include: { targets: true } });
    if (!goal) return res.status(404).json({ error: 'no active goal' });

    const weekStart = new Date(`${parsedQuery.data.weekStart}T00:00:00.000Z`);
    const weekEnd = new Date(weekStart);
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);

    const sessions = await prisma.workoutSession.findMany({
      where: { userId: 'lucas', date: { gte: weekStart, lt: weekEnd } },
      include: { entries: { include: { exercise: { include: { muscleMap: true } } } } },
    });

    const actualByMuscle = new Map<MuscleGroup, number>();
    for (const session of sessions) {
      for (const entry of session.entries) {
        if (!entry.exercise || !entry.sets) continue;
        for (const mapping of entry.exercise.muscleMap) {
          actualByMuscle.set(mapping.muscle, (actualByMuscle.get(mapping.muscle) ?? 0) + entry.sets);
        }
      }
    }

    const progress = goal.targets.map((target) => ({
      muscle: target.muscle,
      targetMin: target.minSetsPerWeek,
      targetMax: target.maxSetsPerWeek,
      actualSets: actualByMuscle.get(target.muscle) ?? 0,
    }));

    res.status(200).json(progress);
  }),
);
