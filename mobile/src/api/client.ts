import { API_BASE_URL } from '../config';
import { getApiToken } from '../auth/token';
import type {
  ResolveLineResponse,
  GoalGuess,
  Abbreviation,
  SetEntryInput,
  SessionResponse,
  GoalProgress,
  GoalType,
  MuscleGroup,
} from './types';

// Thrown by request() instead of a plain Error so callers can distinguish
// e.g. a 404 "not found yet" response (expected, not a real failure) from a
// genuine server/network failure.
export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = await getApiToken();
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers ?? {}),
    },
  });
  if (!res.ok) {
    throw new ApiError(`Strong Notes API request to ${path} failed with status ${res.status}`, res.status);
  }
  return res.json() as Promise<T>;
}

// Mirrors backend/src/science/volumeTable.ts's default per-muscle set-range
// targets for each GoalType. The mobile client doesn't have access to the
// backend's volume table directly, so this is a hand-maintained approximation
// used only to compute a sensible "emphasis" bump for free-text goals that
// call out specific muscles (e.g. "I want a bigger booty" -> GLUTES). If the
// backend's defaults change, update this table to match.
export const VOLUME_DEFAULTS: Record<GoalType, Record<MuscleGroup, { min: number; max: number }>> = {
  HYPERTROPHY: {
    GLUTES: { min: 12, max: 20 },
    QUADS: { min: 10, max: 18 },
    HAMSTRINGS: { min: 8, max: 16 },
    CHEST: { min: 10, max: 18 },
    BACK: { min: 10, max: 16 },
    SHOULDERS: { min: 8, max: 16 },
    ARMS: { min: 6, max: 14 },
    CORE: { min: 6, max: 12 },
    CALVES: { min: 8, max: 16 },
  },
  STRENGTH: {
    GLUTES: { min: 4, max: 8 },
    QUADS: { min: 4, max: 8 },
    HAMSTRINGS: { min: 3, max: 6 },
    CHEST: { min: 3, max: 6 },
    BACK: { min: 4, max: 8 },
    SHOULDERS: { min: 3, max: 6 },
    ARMS: { min: 2, max: 5 },
    CORE: { min: 3, max: 6 },
    CALVES: { min: 3, max: 6 },
  },
  ENDURANCE: {
    GLUTES: { min: 8, max: 14 },
    QUADS: { min: 8, max: 14 },
    HAMSTRINGS: { min: 6, max: 12 },
    CHEST: { min: 6, max: 12 },
    BACK: { min: 6, max: 12 },
    SHOULDERS: { min: 6, max: 12 },
    ARMS: { min: 5, max: 10 },
    CORE: { min: 8, max: 14 },
    CALVES: { min: 8, max: 14 },
  },
  // Backend's CUSTOM goal type starts from the hypertrophy defaults.
  CUSTOM: {
    GLUTES: { min: 12, max: 20 },
    QUADS: { min: 10, max: 18 },
    HAMSTRINGS: { min: 8, max: 16 },
    CHEST: { min: 10, max: 18 },
    BACK: { min: 10, max: 16 },
    SHOULDERS: { min: 8, max: 16 },
    ARMS: { min: 6, max: 14 },
    CORE: { min: 6, max: 12 },
    CALVES: { min: 8, max: 16 },
  },
};

// Flat additive bump applied to both ends of a muscle's default set-range
// when a free-text goal specifically calls that muscle out. A fixed
// absolute bump was chosen over a percentage bump for simplicity and to
// avoid rounding ambiguity — the important behavioral property is just that
// emphasized muscles end up with strictly higher targets than the type's
// plain defaults.
const EMPHASIS_BUMP_SETS = 4;

export function buildEmphasisOverrides(
  type: GoalType,
  muscles: MuscleGroup[]
): { muscle: MuscleGroup; min: number; max: number }[] {
  return muscles.map((muscle) => {
    const base = VOLUME_DEFAULTS[type][muscle];
    return { muscle, min: base.min + EMPHASIS_BUMP_SETS, max: base.max + EMPHASIS_BUMP_SETS };
  });
}

export function resolveLine(line: string): Promise<ResolveLineResponse> {
  return request('/resolve/line', { method: 'POST', body: JSON.stringify({ line }) });
}

export function resolveGoal(text: string): Promise<GoalGuess> {
  return request('/resolve/goal', { method: 'POST', body: JSON.stringify({ text }) });
}

export function listAbbreviations(): Promise<Abbreviation[]> {
  return request('/abbreviations');
}

export function createAbbreviation(input: {
  token: string;
  exerciseId?: string;
  modifierType?: string;
  modifierValue?: string;
}): Promise<Abbreviation> {
  return request('/abbreviations', { method: 'POST', body: JSON.stringify(input) });
}

export function confirmAbbreviation(id: string): Promise<Abbreviation> {
  return request(`/abbreviations/${id}/confirm`, { method: 'PATCH' });
}

export function createExercise(input: {
  name: string;
  muscles: MuscleGroup[];
}): Promise<{ id: string; name: string; muscleMap: unknown[] }> {
  return request('/exercises', { method: 'POST', body: JSON.stringify(input) });
}

export function putSession(
  date: string,
  body: { notes?: string | null; entries: SetEntryInput[] }
): Promise<SessionResponse> {
  return request(`/sessions/${date}`, { method: 'PUT', body: JSON.stringify(body) });
}

export function getSessions(from: string, to: string): Promise<SessionResponse[]> {
  return request(`/sessions?from=${from}&to=${to}`);
}

export function createGoal(input: {
  type: GoalType;
  description?: string;
  overrides?: { muscle: MuscleGroup; min: number; max: number }[];
}): Promise<unknown> {
  return request('/goals', { method: 'POST', body: JSON.stringify(input) });
}

export function getGoalProgress(weekStart: string): Promise<GoalProgress[]> {
  return request(`/goals/active/progress?weekStart=${weekStart}`);
}
