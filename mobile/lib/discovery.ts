/**
 * Discovery handshake run on app launch / before sign-in.
 *
 * Fetches the server's `/.well-known/scaffold-instance` document and runs a
 * bidirectional protocol-compat check (see `protocol.ts`). The result is a
 * discriminated union — the function never throws; the caller maps the
 * failure reason to an i18n string.
 */
import { checkProtocolCompat } from './protocol';
import type { InstanceInfo } from './api';

export const DISCOVERY_TIMEOUT_MS = 5000;

export type DiscoveryFailureReason =
  | 'unreachable'
  | 'incompatible_server'
  | 'server_too_old'
  | 'server_too_new'
  | 'app_too_old'
  | 'app_too_new';

export type DiscoveryResult =
  | { ok: true; instance: InstanceInfo }
  | { ok: false; reason: DiscoveryFailureReason };

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Parse the raw well-known JSON into a typed InstanceInfo, or null. */
export function parseInstanceInfo(raw: unknown): InstanceInfo | null {
  if (!isObject(raw)) return null;
  const { name, version, instance_mode, protocol, features } = raw;
  if (typeof name !== 'string') return null;
  if (typeof version !== 'string') return null;
  if (instance_mode !== 'hosted' && instance_mode !== 'selfhost') return null;
  if (!isObject(protocol)) return null;
  if (typeof protocol.min !== 'number' || typeof protocol.max !== 'number') return null;
  const featuresTyped: Record<string, boolean> = {};
  if (isObject(features)) {
    for (const [k, v] of Object.entries(features)) {
      if (typeof v === 'boolean') featuresTyped[k] = v;
    }
  }
  return {
    name,
    version,
    instance_mode,
    protocol: { min: protocol.min, max: protocol.max },
    features: featuresTyped,
  };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const handle = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(handle);
        resolve(v);
      },
      (err) => {
        clearTimeout(handle);
        reject(err);
      },
    );
  });
}

/** Fetch + parse the well-known document for a base URL. Rejects on error. */
export async function fetchInstanceInfo(baseUrl: string): Promise<InstanceInfo> {
  const base = baseUrl.replace(/\/+$/, '');
  const res = await fetch(`${base}/.well-known/scaffold-instance`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const parsed = parseInstanceInfo(await res.json());
  if (!parsed) throw new Error('incompatible_server');
  return parsed;
}

/**
 * Run the full discovery handshake against a base URL: reachability + schema
 * + bidirectional protocol-compat. Never throws.
 */
export async function runDiscoveryHandshake(
  baseUrl: string,
  timeoutMs = DISCOVERY_TIMEOUT_MS,
): Promise<DiscoveryResult> {
  let instance: InstanceInfo;
  try {
    instance = await withTimeout(fetchInstanceInfo(baseUrl), timeoutMs);
  } catch (err) {
    if (err instanceof Error && err.message === 'incompatible_server') {
      return { ok: false, reason: 'incompatible_server' };
    }
    return { ok: false, reason: 'unreachable' };
  }

  const compat = checkProtocolCompat({
    serverProtocol: instance.protocol.max,
    serverMinApp: instance.protocol.min,
    serverMaxApp: instance.protocol.max,
  });
  if (!compat.ok) return { ok: false, reason: compat.reason };

  return { ok: true, instance };
}
