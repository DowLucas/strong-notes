import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { ExerciseCategory, MuscleGroup, MuscleRole } from '@prisma/client';
import { asyncHandler } from '../middleware/asyncHandler.js';

export const exercisesRouter = Router();

const createSchema = z.object({
  name: z.string().min(1),
  muscles: z.array(z.nativeEnum(MuscleGroup)),
});

exercisesRouter.post(
  '/exercises',
  asyncHandler(async (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const existing = await prisma.exercise.findUnique({
      where: { name: parsed.data.name },
      include: { muscleMap: true },
    });
    if (existing) return res.status(201).json(existing);

    const created = await prisma.exercise.create({
      data: {
        name: parsed.data.name,
        category: ExerciseCategory.COMPOUND,
        muscleMap: {
          create: parsed.data.muscles.map((muscle) => ({
            muscle,
            role: MuscleRole.PRIMARY,
            weight: 1,
          })),
        },
      },
      include: { muscleMap: true },
    });
    res.status(201).json(created);
  }),
);
