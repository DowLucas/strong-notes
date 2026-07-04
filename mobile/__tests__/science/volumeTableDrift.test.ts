// Guards against mobile/src/api/client.ts's hand-maintained VOLUME_DEFAULTS
// drifting out of sync with the backend's source of truth,
// backend/src/science/volumeTable.ts. This imports the backend module
// directly (a cross-package relative import within the monorepo) so any
// change to the backend's ranges fails this test immediately, instead of
// relying on someone remembering to update the mobile copy by hand.
//
// Note: we deliberately don't import GoalType/MuscleGroup from
// `@prisma/client` here. Those Prisma-generated enums live in
// backend/node_modules, which Node module resolution *does* find when
// backend/src/science/volumeTable.ts itself imports '@prisma/client' (it
// walks up from that file's own directory into backend/node_modules). But a
// test file living under mobile/__tests__ has no such ancestor path to
// backend/node_modules, so importing '@prisma/client' directly from here
// fails to resolve. Using the string literal values instead (which are
// exactly the enum's runtime values) sidesteps that without needing any new
// shared dependency.
import { getVolumeTargets } from '../../../backend/src/science/volumeTable';
import { VOLUME_DEFAULTS } from '../../src/api/client';
import type { GoalType, MuscleGroup } from '../../src/api/types';

const GOAL_TYPES: GoalType[] = ['HYPERTROPHY', 'STRENGTH', 'ENDURANCE', 'CUSTOM'];
const MUSCLE_GROUPS: MuscleGroup[] = [
  'GLUTES',
  'QUADS',
  'HAMSTRINGS',
  'CHEST',
  'BACK',
  'SHOULDERS',
  'ARMS',
  'CORE',
  'CALVES',
];

describe('VOLUME_DEFAULTS stays in sync with backend volumeTable', () => {
  it.each(GOAL_TYPES)('matches backend getVolumeTargets(%s) for every muscle group', (goalType) => {
    const backendRanges = getVolumeTargets(goalType as any);

    for (const muscle of MUSCLE_GROUPS) {
      expect(VOLUME_DEFAULTS[goalType][muscle]).toEqual(backendRanges[muscle as keyof typeof backendRanges]);
    }
  });
});
