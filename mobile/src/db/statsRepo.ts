// Read side for the Stats tab: flat rows of confirmed set entries with the
// exercise's cached name. No aggregation here — see lib/exerciseProgress.ts.
// A future "pull sessions" sync only needs to insert into sessions/set_entries
// for this to cover other devices.
import { getDb } from './client';
import type { StatsRow } from '@/lib/exerciseProgress';

type StatsRowRecord = {
  exercise_id: string;
  exercise_name: string | null;
  latest_raw_text: string | null;
  session_date: string;
  weight_kg: number | null;
  reps: number | null;
  sets: number | null;
  entry_order: number;
};

// One cached name per exercise id (the dictionary may map several tokens to the same exercise).
const EXERCISE_NAMES_SQL = `
  SELECT exercise_id, MIN(exercise_name) AS exercise_name
  FROM abbreviations_cache
  WHERE exercise_id IS NOT NULL AND exercise_name IS NOT NULL
  GROUP BY exercise_id`;

// The raw text of the newest entry per exercise — SQLite's bare-column rule
// makes `raw_text` come from the row holding the MAX.
const LATEST_RAW_TEXT_SQL = `
  SELECT exercise_id, raw_text, MAX(session_date || printf('%08d', entry_order)) AS latest_key
  FROM set_entries
  WHERE exercise_id IS NOT NULL
  GROUP BY exercise_id`;

export async function listStatsRows(fromDate: string | null): Promise<StatsRow[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<StatsRowRecord>(
    `SELECT e.exercise_id, n.exercise_name, l.raw_text AS latest_raw_text,
            e.session_date, e.weight_kg, e.reps, e.sets, e.entry_order
     FROM set_entries e
     LEFT JOIN (${EXERCISE_NAMES_SQL}) n ON n.exercise_id = e.exercise_id
     LEFT JOIN (${LATEST_RAW_TEXT_SQL}) l ON l.exercise_id = e.exercise_id
     WHERE e.exercise_id IS NOT NULL
       AND (? IS NULL OR e.session_date >= ?)
     ORDER BY e.exercise_id ASC, e.session_date ASC, e.entry_order ASC`,
    [fromDate, fromDate],
  );
  return rows.map((r) => ({
    exerciseId: r.exercise_id,
    exerciseName: r.exercise_name,
    latestRawText: r.latest_raw_text,
    sessionDate: r.session_date,
    weightKg: r.weight_kg,
    reps: r.reps,
    sets: r.sets,
    entryOrder: r.entry_order,
  }));
}

/** Cached display name per exercise id — the same join Stats uses, for screens that show raw entries. */
export async function listExerciseNames(): Promise<Record<string, string>> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ exercise_id: string; exercise_name: string }>(EXERCISE_NAMES_SQL);
  return Object.fromEntries(rows.map((r) => [r.exercise_id, r.exercise_name]));
}
