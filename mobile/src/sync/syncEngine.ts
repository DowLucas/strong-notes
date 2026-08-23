import type { ApiClient } from '@/lib/api';
import { listUnsyncedSessions, markSessionSynced } from '../db/sessionsRepo';
import { cacheAbbreviations } from '../db/abbreviationsRepo';
import { classifySyncError, setSyncStatus } from './syncStatus';

export interface SyncResult {
  pushed: number;
  pulled: number;
  /** Sessions that could not be pushed this run (retried next time). */
  failed: number;
}

/**
 * Push every unsynced local session, then pull the abbreviation dictionary
 * into the local cache. Publishes its outcome to `syncStatus` (time, counts,
 * error) before resolving or rethrowing.
 */
export async function syncNow(api: ApiClient): Promise<SyncResult> {
  setSyncStatus({ running: true });
  try {
    const { result, pushError } = await run(api);
    const now = Date.now();
    // A session that failed to push is a failed sync from the user's point
    // of view even though the dictionary pull went through.
    setSyncStatus({
      running: false,
      lastRunAt: now,
      error: pushError ? classifySyncError(pushError) : null,
      pushed: result.pushed,
      pulled: result.pulled,
      ...(pushError ? {} : { lastSuccessAt: now }),
    });
    return result;
  } catch (err) {
    setSyncStatus({ running: false, lastRunAt: Date.now(), error: classifySyncError(err) });
    throw err;
  }
}

async function run(api: ApiClient): Promise<{ result: SyncResult; pushError: unknown }> {
  const unsynced = await listUnsyncedSessions();
  let pushed = 0;
  let failed = 0;
  let pushError: unknown = null;

  for (const session of unsynced) {
    try {
      await api.putSession(session.date, {
        notes: session.notes,
        entries: session.entries.map((e) => ({
          exerciseId: e.exerciseId ?? undefined,
          equipment: e.equipment ?? undefined,
          weightKg: e.weightKg ?? undefined,
          reps: e.reps ?? undefined,
          sets: e.sets ?? undefined,
          rawText: e.rawText,
          parsedBy: e.parsedBy,
          order: e.order,
        })),
      });
      await markSessionSynced(session.date);
      pushed += 1;
    } catch (err) {
      // Leave this session unsynced; the next syncNow() call retries it.
      failed += 1;
      pushError ??= err;
    }
  }

  const abbreviations = await api.listAbbreviations();
  await cacheAbbreviations(abbreviations);

  return { result: { pushed, failed, pulled: abbreviations.length }, pushError };
}
