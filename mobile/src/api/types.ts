export type MuscleGroup = 'GLUTES' | 'QUADS' | 'HAMSTRINGS' | 'CHEST' | 'BACK' | 'SHOULDERS' | 'ARMS' | 'CORE' | 'CALVES';
export type GoalType = 'HYPERTROPHY' | 'STRENGTH' | 'ENDURANCE' | 'CUSTOM';
export type ParsedBy = 'DICTIONARY' | 'LLM';

export type ResolveLineResponse = {
  resolvedTokens: { token: string; type: 'exercise' | 'modifier'; exerciseId?: string; modifierType?: string; modifierValue?: string }[];
  unresolvedTokens: string[];
  llmGuess?: {
    exerciseName: string;
    equipment?: string;
    weightKg?: number;
    reps?: number;
    sets?: number;
    muscles?: MuscleGroup[];
  };
};

export type GoalGuess = { type: GoalType; muscles: MuscleGroup[] };

export type Abbreviation = {
  id: string;
  token: string;
  exerciseId?: string;
  modifierType?: string;
  modifierValue?: string;
  source: string;
};

export type SetEntryInput = {
  exerciseId?: string;
  equipment?: string;
  weightKg?: number;
  reps?: number;
  sets?: number;
  rawText: string;
  parsedBy: ParsedBy;
  order: number;
};

export type SessionResponse = {
  id: string;
  date: string;
  notes: string | null;
  entries: (SetEntryInput & { id: string })[];
};

export type GoalProgress = {
  muscle: MuscleGroup;
  targetMin: number;
  targetMax: number;
  actualSets: number;
};
