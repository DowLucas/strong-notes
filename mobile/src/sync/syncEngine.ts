import { putSession, listAbbreviations } from '../api/client';
import { listUnsyncedSessions, markSessionSynced } from '../db/sessionsRepo';
import { cacheAbbreviations } from '../db/abbreviationsRepo';

export async function syncNow(): Promise<{ pushed: number; pulled: number }> {
  const unsynced = await listUnsyncedSessions();
  let pushed = 0;

  for (const session of unsynced) {
    try {
      await putSession(session.date, {
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
    } catch {
      // Leave this session unsynced; the next syncNow() call retries it.
    }
  }

  const abbreviations = await listAbbreviations();
  await cacheAbbreviations(abbreviations);

  return { pushed, pulled: abbreviations.length };
}
