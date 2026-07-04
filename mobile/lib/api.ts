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

export type GetToken = () => Promise<string | null>;

export interface ApiClient {
  requestMagicLink(email: string): Promise<MagicLinkResponse>;
  verify(token: string): Promise<TokenResponse>;
  getMe(): Promise<User>;
  updateMe(patch: UpdateMeInput): Promise<User>;
  deleteMe(): Promise<void>;
  logout(): Promise<void>;
  uploadAvatar(imageBase64: string, mimeType: AvatarMimeType): Promise<AvatarUploadResponse>;
  deleteAvatar(): Promise<void>;
  getInstanceInfo(): Promise<InstanceInfo>;
  /** Build an authenticated `<Image source>` for the user's server avatar. */
  avatarImageSource(user: User | null, token: string | null): { uri: string; headers?: Record<string, string> } | null;
}

/**
 * Create a client bound to one server. `getToken` supplies the bearer token
 * lazily on each request (or null for unauthenticated calls).
 */
export function createClient(baseUrl: string, getToken: GetToken): ApiClient {
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
