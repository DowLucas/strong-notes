import { GoalType, MuscleGroup } from '@prisma/client';

type Range = { min: number; max: number };
type MuscleRanges = Record<MuscleGroup, Range>;

const HYPERTROPHY: MuscleRanges = {
  GLUTES: { min: 12, max: 20 },
  QUADS: { min: 10, max: 18 },
  HAMSTRINGS: { min: 8, max: 16 },
  CHEST: { min: 10, max: 18 },
  BACK: { min: 10, max: 16 },
  SHOULDERS: { min: 8, max: 16 },
  ARMS: { min: 6, max: 14 },
  CORE: { min: 6, max: 12 },
  CALVES: { min: 8, max: 16 },
};

const STRENGTH: MuscleRanges = {
  GLUTES: { min: 4, max: 8 },
  QUADS: { min: 4, max: 8 },
  HAMSTRINGS: { min: 3, max: 6 },
  CHEST: { min: 3, max: 6 },
  BACK: { min: 4, max: 8 },
  SHOULDERS: { min: 3, max: 6 },
  ARMS: { min: 2, max: 5 },
  CORE: { min: 3, max: 6 },
  CALVES: { min: 3, max: 6 },
};

const ENDURANCE: MuscleRanges = {
  GLUTES: { min: 8, max: 14 },
  QUADS: { min: 8, max: 14 },
  HAMSTRINGS: { min: 6, max: 12 },
  CHEST: { min: 6, max: 12 },
  BACK: { min: 6, max: 12 },
  SHOULDERS: { min: 6, max: 12 },
  ARMS: { min: 5, max: 10 },
  CORE: { min: 8, max: 14 },
  CALVES: { min: 8, max: 14 },
};

// CUSTOM starts from hypertrophy defaults; the user overrides per-muscle via the Goals route.
const CUSTOM: MuscleRanges = HYPERTROPHY;

const TABLE: Record<GoalType, MuscleRanges> = {
  HYPERTROPHY,
  STRENGTH,
  ENDURANCE,
  CUSTOM,
};

export function getVolumeTargets(goalType: GoalType): MuscleRanges {
  return TABLE[goalType];
}
