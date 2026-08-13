import { getDb } from './client';
import { getCachedAbbreviations } from './abbreviationsRepo';
import { upsertLocalSession, type LocalSetEntry } from './sessionsRepo';

// Dev/test-only seeding: populates the local SQLite with a few prior sessions
// across the past week so the Log editor's prior-stats hint can be exercised on
// a fresh install (sessions never sync down from the server).
//
// History is filed under the user's REAL confirmed exercise ids (read from the
// dictionary) so it matches what typing a token actually resolves to — and
// survives a dictionary sync, which repopulates the cache from the server and
// would drop any throwaway ids. Falls back to throwaway exercises only when the
// user hasn't confirmed anything yet.

type Group = { w: number | null; reps: number; sets: number };

// Set-groups in the MOST RECENT prior session; older sessions get a linear
// de-load so the history reads as progression.
const GROUPS: Group[] = [
  { w: 40, reps: 8, sets: 1 },
  { w: 50, reps: 8, sets: 4 },
];
const DAY_OFFSETS = [2, 4, 6]; // days before today (most recent first)
const DELOAD_PER_SESSION = 2.5; // kg per older session

// Only used when the dictionary has no confirmed exercises yet.
const FALLBACK = [
  { token: 'RDL', exerciseId: 'seed-ex-rdl' },
  { token: 'Bench', exerciseId: 'seed-ex-bench' },
  { token: 'Squat', exerciseId: 'seed-ex-squat' },
];

function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function groupToken(g: Group): string {
  const weight = g.w == null ? 'bar' : `${g.w}kg`;
  const setsPart = g.sets > 1 ? `x${g.sets}` : '';
  return `${weight}x${g.reps}${setsPart}`;
}

export async function seedPriorSessions(): Promise<{ sessions: number; tokens: string[] }> {
  const db = await getDb();

  // Prefer the user's real confirmed exercises, deduped by exercise id.
  const abbrs = await getCachedAbbreviations();
  const byId = new Map<string, string>();
  for (const a of abbrs) {
    if (a.exerciseId && !byId.has(a.exerciseId)) byId.set(a.exerciseId, a.token);
  }
  let targets = Array.from(byId, ([exerciseId, token]) => ({ exerciseId, token })).slice(0, 3);

  if (targets.length === 0) {
    for (const ex of FALLBACK) {
      await db.runAsync(
        `INSERT OR REPLACE INTO abbreviations_cache
           (id, token, exercise_id, modifier_type, modifier_value, source)
         VALUES (?, ?, ?, NULL, NULL, 'seed')`,
        [`seed-abbr-${ex.token}`, ex.token, ex.exerciseId],
      );
    }
    targets = FALLBACK.map((f) => ({ exerciseId: f.exerciseId, token: f.token }));
  }

  for (let i = 0; i < DAY_OFFSETS.length; i += 1) {
    const date = isoDaysAgo(DAY_OFFSETS[i]);
    const deload = i * DELOAD_PER_SESSION; // i === 0 → most recent → no de-load
    const entries: LocalSetEntry[] = [];
    const lines: string[] = [];
    let order = 0;

    for (const target of targets) {
      const lineTokens: string[] = [target.token];
      for (const g of GROUPS) {
        const group: Group = { w: g.w == null ? null : g.w - deload, reps: g.reps, sets: g.sets };
        lineTokens.push(groupToken(group));
        entries.push({
          id: `seed-${date}-${target.exerciseId}-${order}`,
          exerciseId: target.exerciseId,
          equipment: null,
          weightKg: group.w,
          reps: group.reps,
          sets: group.sets,
          rawText: groupToken(group),
          parsedBy: 'DICTIONARY',
          order,
          synced: 0,
          spanStart: null,
          spanEnd: null,
        });
        order += 1;
      }
      lines.push(lineTokens.join(' '));
    }

    // synced:1 so this dev/test data is never pushed to the backend.
    await upsertLocalSession({ date, notes: lines.join('\n'), synced: 1, entries });
  }

  return { sessions: DAY_OFFSETS.length, tokens: targets.map((t) => t.token) };
}
