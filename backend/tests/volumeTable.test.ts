import { describe, it, expect } from 'vitest';
import { GoalType, MuscleGroup } from '@prisma/client';
import { getVolumeTargets } from '../src/science/volumeTable.js';

describe('getVolumeTargets', () => {
  it('returns hypertrophy ranges for glutes', () => {
    const targets = getVolumeTargets(GoalType.HYPERTROPHY);
    expect(targets[MuscleGroup.GLUTES]).toEqual({ min: 12, max: 20 });
  });

  it('returns strength ranges that are lower volume than hypertrophy', () => {
    const strength = getVolumeTargets(GoalType.STRENGTH);
    const hypertrophy = getVolumeTargets(GoalType.HYPERTROPHY);
    expect(strength[MuscleGroup.QUADS].max).toBeLessThan(hypertrophy[MuscleGroup.QUADS].max);
  });

  it('covers every muscle group for every goal type', () => {
    for (const goalType of Object.values(GoalType)) {
      const targets = getVolumeTargets(goalType);
      for (const muscle of Object.values(MuscleGroup)) {
        expect(targets[muscle]).toBeDefined();
      }
    }
  });
});
