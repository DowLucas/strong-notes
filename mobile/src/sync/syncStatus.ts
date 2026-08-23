import { useSyncExternalStore } from 'react';

export type SyncErrorKind = 'network' | 'generic';

export interface SyncStatus {
  /** True while a `syncNow` run is in flight. */
  running: boolean;
  /** Epoch ms of the last completed run (success or failure); null before the first. */
  lastRunAt: number | null;
  /** Epoch ms of the last *successful* run. */
  lastSuccessAt: number | null;
  /** Counts from the last successful run. */
  pushed: number;
  pulled: number;
  /** Why the last run failed; null when it succeeded. */
  error: SyncErrorKind | null;
}

/**
 * Tiny module-level store for the sync engine's last result, so any screen
 * (the You tab's "Sync" row) can show "Last synced 2 min ago" without owning
 * the engine. `syncEngine.ts` writes; everyone else reads via
 * `useSyncStatus()` / `subscribeSyncStatus()`.
 */
const INITIAL: SyncStatus = {
  running: false,
  lastRunAt: null,
  lastSuccessAt: null,
  pushed: 0,
  pulled: 0,
  error: null,
};

let status: SyncStatus = INITIAL;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function getSyncStatus(): SyncStatus {
  return status;
}

export function subscribeSyncStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Replace part of the status and notify subscribers. */
export function setSyncStatus(patch: Partial<SyncStatus>): void {
  status = { ...status, ...patch };
  emit();
}

/** Classify a thrown sync error for display. `TypeError` is fetch's "no network". */
export function classifySyncError(err: unknown): SyncErrorKind {
  return err instanceof TypeError ? 'network' : 'generic';
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(subscribeSyncStatus, getSyncStatus, getSyncStatus);
}

/** Test-only: back to the pristine state. */
export function __resetSyncStatusForTests(): void {
  status = INITIAL;
  emit();
}
