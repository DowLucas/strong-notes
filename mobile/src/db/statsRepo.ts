// Read side for the Stats tab: flat rows of confirmed set entries with the
// exercise's cached name. No aggregation here — see lib/exerciseProgress.ts.
// A future "pull sessions" sync only needs to insert into sessions/set_entries
// for this to cover other devices.
import { getDb } from './client';
import type { StatsRow } from '@/lib/exerciseProgress';

type StatsRowRecord = {
  exercise_id: string;
  exercise_name: string | null;
  session_date: string;
  weight_kg: number | null;
  reps: number | null;
  sets: number | null;
  entry_order: number;
};

export async function listStatsRows(fromDate: string | null): Promise<StatsRow[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<StatsRowRecord>(
    `SELECT e.exercise_id, n.exercise_name, e.session_date, e.weight_kg, e.reps, e.sets, e.entry_order
     FROM set_entries e
     LEFT JOIN (
       SELECT exercise_id, MIN(exercise_name) AS exercise_name
       FROM abbreviations_cache
       WHERE exercise_id IS NOT NULL AND exercise_name IS NOT NULL
       GROUP BY exercise_id
     ) n ON n.exercise_id = e.exercise_id
     WHERE e.exercise_id IS NOT NULL
       AND (? IS NULL OR e.session_date >= ?)
     ORDER BY e.exercise_id ASC, e.session_date ASC, e.entry_order ASC`,
    [fromDate, fromDate],
  );
  return rows.map((r) => ({
    exerciseId: r.exercise_id,
    exerciseName: r.exercise_name,
    sessionDate: r.session_date,
    weightKg: r.weight_kg,
    reps: r.reps,
    sets: r.sets,
    entryOrder: r.entry_order,
  }));
}
