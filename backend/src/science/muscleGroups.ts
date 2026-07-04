import { MuscleGroup } from '@prisma/client';

export const MUSCLE_GROUPS: { value: MuscleGroup; label: string }[] = [
  { value: MuscleGroup.GLUTES, label: 'Glutes' },
  { value: MuscleGroup.QUADS, label: 'Quads' },
  { value: MuscleGroup.HAMSTRINGS, label: 'Hamstrings' },
  { value: MuscleGroup.CHEST, label: 'Chest' },
  { value: MuscleGroup.BACK, label: 'Back' },
  { value: MuscleGroup.SHOULDERS, label: 'Shoulders' },
  { value: MuscleGroup.ARMS, label: 'Arms' },
  { value: MuscleGroup.CORE, label: 'Core' },
  { value: MuscleGroup.CALVES, label: 'Calves' },
];
