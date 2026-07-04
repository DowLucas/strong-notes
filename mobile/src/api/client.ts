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
    throw new Error(`Strong Notes API request to ${path} failed with status ${res.status}`);
  }
  return res.json() as Promise<T>;
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
