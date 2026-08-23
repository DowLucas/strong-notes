/**
 * Single-server, single-account typed API client.
 *
 * `createClient(baseUrl, getToken)` returns an object of typed methods. The
 * client is pure with respect to storage and auth: it never reads SecureStore
 * itself — the caller injects the bearer token via the `getToken` callback
 * (so the same client works for the signed-in app and for unauthenticated
 * pre-sign-in calls). Every request carries the protocol header; non-2xx
 * responses throw a typed `ApiError`.
 *
 * The default base URL comes from the `apiBaseUrl` value in
 * `app.config.ts` -> `extra` (overridable per build with EXPO_PUBLIC_API_URL).
 */
import Constants from 'expo-constants';
import { APP_PROTOCOL_VERSION, PROTOCOL_HEADER } from './protocol';

/** Resolve the configured backend base URL (no trailing slash). */
export function defaultBaseUrl(): string {
  const extra = (Constants.expoConfig?.extra ?? {}) as { apiBaseUrl?: string };
  const url = extra.apiBaseUrl ?? 'http://localhost:8080';
  return url.replace(/\/+$/, '');
}

export class ApiError extends Error {
  /** Parsed JSON payload when the server returned `application/json`, else null. */
  public readonly body: unknown;

  constructor(public status: number, message: string, body?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.body = body ?? null;
  }
}

// --- Wire types ----------------------------------------------------------

export interface User {
  id: string;
  email: string;
  name: string;
  /** Server-relative avatar object URL (e.g. /api/me/avatar). */
  avatar_object_url?: string | null;
  /** ISO-8601 timestamp the avatar was last updated (cache-buster). */
  avatar_updated_at?: string | null;
}

export interface MagicLinkResponse {
  ok: boolean;
  /** Only set in DevMode — lets the app skip the email round-trip. */
  token?: string;
}

export interface TokenResponse {
  token: string;
  user: User;
}

/** Body for native Sign in with Apple (`POST /api/auth/apple/native`). */
export interface AppleNativeInput {
  /** Apple's identity JWT from `AppleAuthentication.signInAsync`. */
  identity_token: string;
  /**
   * The raw (unhashed) nonce the client generated. Apple embeds its SHA-256
   * in the JWT; the server re-hashes this value and compares.
   */
  nonce: string;
  /** Display name — Apple only returns it on the very first sign-in. */
  name?: string;
}

export interface UpdateMeInput {
  name?: string;
}

export type AvatarMimeType = 'image/jpeg' | 'image/png' | 'image/webp';

export interface AvatarUploadResponse {
  url: string;
  updated_at: string;
}

export interface InstanceInfo {
  name: string;
  version: string;
  instance_mode: 'hosted' | 'selfhost';
  protocol: { min: number; max: number };
  features: Record<string, boolean>;
}

// --- Strong Notes domain types ------------------------------------------

export type MuscleGroup = 'GLUTES' | 'QUADS' | 'HAMSTRINGS' | 'CHEST' | 'BACK' | 'SHOULDERS' | 'ARMS' | 'CORE' | 'CALVES';
export type GoalType = 'HYPERTROPHY' | 'STRENGTH' | 'ENDURANCE' | 'CUSTOM';
export type ParsedBy = 'DICTIONARY' | 'LLM';

export interface ResolvedToken {
  token: string;
  type: 'exercise' | 'modifier';
  exerciseId?: string;
  /** Human name of the exercise (only on `exercise` tokens). */
  exerciseName?: string;
  modifierType?: string;
  modifierValue?: string;
}

export interface ClarifyingQuestion {
  token: string;
  question: string;
  alternatives: string[];
}

export interface LlmGuess {
  exerciseName: string;
  equipment?: string | null;
  /** The raw input token the equipment was inferred from (e.g. "bb"). */
  equipmentToken?: string | null;
  weightKg?: number | null;
  reps?: number | null;
  sets?: number | null;
  muscles?: MuscleGroup[];
  clarifyingQuestion?: ClarifyingQuestion | null;
}

export interface ResolveLineResponse {
  /** May be null when nothing resolved (server encodes an empty slice as null). */
  resolvedTokens: ResolvedToken[] | null;
  unresolvedTokens: string[] | null;
  llmGuess?: LlmGuess;
}

export interface GoalGuess {
  type: GoalType;
  muscles: MuscleGroup[];
}

export interface Exercise {
  id: string;
  name: string;
  category: string;
  createdAt: string;
}

export interface Abbreviation {
  id: string;
  token: string;
  exerciseId?: string;
  /** Human name of the exercise the token maps to (absent for modifiers). */
  exerciseName?: string;
  modifierType?: string;
  modifierValue?: string;
  source: string;
  createdAt: string;
}

export interface SetEntryInput {
  exerciseId?: string;
  equipment?: string;
  weightKg?: number;
  reps?: number;
  sets?: number;
  rawText: string;
  parsedBy: ParsedBy;
  order: number;
}

export interface SetEntryResponse extends SetEntryInput {
  id: string;
}

export interface SessionResponse {
  id: string;
  date: string;
  notes: string | null;
  entries: SetEntryResponse[];
}

export interface GoalTarget {
  muscle: MuscleGroup;
  minSetsPerWeek: number;
  maxSetsPerWeek: number;
}

export interface GoalResponse {
  id: string;
  type: GoalType;
  description?: string | null;
  targets: GoalTarget[];
}

export interface GoalProgress {
  muscle: MuscleGroup;
  targetMin: number;
  targetMax: number;
  actualSets: number;
}

export type GetToken = () => Promise<string | null>;

export interface ApiClient {
  requestMagicLink(email: string): Promise<MagicLinkResponse>;
  verify(token: string): Promise<TokenResponse>;
  /** Exchange an Apple identity token for a session; same shape as `verify`. */
  appleNative(input: AppleNativeInput): Promise<TokenResponse>;
  getMe(): Promise<User>;
  updateMe(patch: UpdateMeInput): Promise<User>;
  deleteMe(): Promise<void>;
  logout(): Promise<void>;
  uploadAvatar(imageBase64: string, mimeType: AvatarMimeType): Promise<AvatarUploadResponse>;
  deleteAvatar(): Promise<void>;
  getInstanceInfo(): Promise<InstanceInfo>;
  resolveLine(line: string): Promise<ResolveLineResponse>;
  resolveGoal(text: string): Promise<GoalGuess>;
  createExercise(input: { name: string; muscles: MuscleGroup[] }): Promise<Exercise>;
  listAbbreviations(): Promise<Abbreviation[]>;
  createAbbreviation(input: { token: string; exerciseId?: string; modifierType?: string; modifierValue?: string }): Promise<Abbreviation>;
  confirmAbbreviation(id: string): Promise<Abbreviation>;
  putSession(date: string, body: { notes?: string | null; entries: SetEntryInput[] }): Promise<SessionResponse>;
  getSessions(from: string, to: string): Promise<SessionResponse[]>;
  createGoal(input: { type: GoalType; description?: string; overrides?: { muscle: MuscleGroup; min: number; max: number }[] }): Promise<GoalResponse>;
  getGoalProgress(weekStart: string): Promise<GoalProgress[]>;
  /** Build an authenticated `<Image source>` for the user's server avatar. */
  avatarImageSource(user: User | null, token: string | null): { uri: string; headers?: Record<string, string> } | null;
}

export interface ClientOptions {
  /**
   * Called when a request that carried a bearer token is rejected with 401 —
   * i.e. the session is expired or revoked. Unauthenticated 401s (a bad
   * magic-link token, say) don't trigger it. The `ApiError` is still thrown
   * to the caller afterwards.
   */
  onUnauthorized?: () => void;
}

/**
 * Create a client bound to one server. `getToken` supplies the bearer token
 * lazily on each request (or null for unauthenticated calls).
 */
export function createClient(baseUrl: string, getToken: GetToken, opts: ClientOptions = {}): ApiClient {
  const base = baseUrl.replace(/\/+$/, '');

  async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const token = await getToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      [PROTOCOL_HEADER]: String(APP_PROTOCOL_VERSION),
      ...((options.headers as Record<string, string>) ?? {}),
    };
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(`${base}${path}`, { ...options, headers });
    if (res.status === 401 && token) opts.onUnauthorized?.();
    return parse<T>(res);
  }

  async function parse<T>(res: Response): Promise<T> {
    const isJson = (res.headers.get('content-type') ?? '').includes('application/json');
    if (!res.ok) {
      let body: unknown = null;
      let message: string;
      if (isJson) {
        body = await res.json().catch(() => null);
        message =
          (body && typeof body === 'object' && 'error' in body
            ? String((body as { error: unknown }).error)
            : null) ?? `HTTP ${res.status}`;
      } else {
        message = (await res.text().catch(() => '')) || `HTTP ${res.status}`;
      }
      throw new ApiError(res.status, message, body);
    }
    if (!isJson) return undefined as T;
    return (await res.json()) as T;
  }

  return {
    requestMagicLink: (email) =>
      request<MagicLinkResponse>('/api/auth/magic-link', {
        method: 'POST',
        body: JSON.stringify({ email }),
      }),

    verify: (token) =>
      request<TokenResponse>('/api/auth/verify', {
        method: 'POST',
        body: JSON.stringify({ token }),
      }),

    appleNative: (input) =>
      request<TokenResponse>('/api/auth/apple/native', {
        method: 'POST',
        body: JSON.stringify(input),
      }),

    getMe: () => request<User>('/api/me'),

    updateMe: (patch) =>
      request<User>('/api/me', { method: 'PATCH', body: JSON.stringify(patch) }),

    deleteMe: () => request<void>('/api/me', { method: 'DELETE' }),

    logout: () => request<void>('/api/me/logout', { method: 'POST' }),

    uploadAvatar: (imageBase64, mimeType) =>
      request<AvatarUploadResponse>('/api/me/avatar', {
        method: 'POST',
        body: JSON.stringify({ image_base64: imageBase64, mime_type: mimeType }),
      }),

    deleteAvatar: () => request<void>('/api/me/avatar', { method: 'DELETE' }),

    getInstanceInfo: () =>
      request<InstanceInfo>('/.well-known/scaffold-instance'),

    resolveLine: (line) =>
      request<ResolveLineResponse>('/api/resolve/line', { method: 'POST', body: JSON.stringify({ line }) }),

    resolveGoal: (text) =>
      request<GoalGuess>('/api/resolve/goal', { method: 'POST', body: JSON.stringify({ text }) }),

    createExercise: (input) =>
      request<Exercise>('/api/exercises', { method: 'POST', body: JSON.stringify(input) }),

    listAbbreviations: () => request<Abbreviation[]>('/api/abbreviations'),

    createAbbreviation: (input) =>
      request<Abbreviation>('/api/abbreviations', { method: 'POST', body: JSON.stringify(input) }),

    confirmAbbreviation: (id) =>
      request<Abbreviation>(`/api/abbreviations/${id}/confirm`, { method: 'PATCH' }),

    putSession: (date, body) =>
      request<SessionResponse>(`/api/sessions/${date}`, { method: 'PUT', body: JSON.stringify(body) }),

    getSessions: (from, to) => request<SessionResponse[]>(`/api/sessions?from=${from}&to=${to}`),

    createGoal: (input) =>
      request<GoalResponse>('/api/goals', { method: 'POST', body: JSON.stringify(input) }),

    getGoalProgress: (weekStart) => request<GoalProgress[]>(`/api/goals/active/progress?weekStart=${weekStart}`),

    // Security: only server-relative avatar paths get the Authorization
    // header. An absolute URL would otherwise leak the bearer token to an
    // arbitrary host, so we return null and let the caller render initials.
    // The cache-buster (`?v=<updated_at>`) invalidates the RN image cache
    // after a fresh upload.
    avatarImageSource: (user, token) => {
      const path = user?.avatar_object_url;
      if (!path || !path.startsWith('/')) return null;
      const sep = path.includes('?') ? '&' : '?';
      const bust = user?.avatar_updated_at
        ? `${sep}v=${encodeURIComponent(user.avatar_updated_at)}`
        : '';
      const uri = `${base}${path}${bust}`;
      return token ? { uri, headers: { Authorization: `Bearer ${token}` } } : { uri };
    },
  };
}
