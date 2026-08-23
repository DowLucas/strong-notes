import { getDb } from './client';
import type { ExerciseHistory } from '@/lib/priorHistory';

export type LocalSetEntry = {
  id: string;
  exerciseId: string | null;
  equipment: string | null;
  weightKg: number | null;
  reps: number | null;
  sets: number | null;
  rawText: string;
  parsedBy: 'DICTIONARY' | 'LLM';
  order: number;
  synced: 0 | 1;
  spanStart?: number | null;
  spanEnd?: number | null;
};

export type LocalSession = {
  date: string;
  notes: string | null;
  entries: LocalSetEntry[];
  synced: 0 | 1;
};

export async function upsertLocalSession(session: LocalSession): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO sessions (date, notes, synced) VALUES (?, ?, ?)
       ON CONFLICT(date) DO UPDATE SET notes = excluded.notes, synced = excluded.synced`,
      [session.date, session.notes, session.synced]
    );
    await db.runAsync(`DELETE FROM set_entries WHERE session_date = ?`, [session.date]);
    for (const entry of session.entries) {
      await db.runAsync(
        `INSERT INTO set_entries (id, session_date, exercise_id, equipment, weight_kg, reps, sets, raw_text, parsed_by, entry_order, span_start, span_end)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          entry.id,
          session.date,
          entry.exerciseId,
          entry.equipment,
          entry.weightKg,
          entry.reps,
          entry.sets,
          entry.rawText,
          entry.parsedBy,
          entry.order,
          entry.spanStart ?? null,
          entry.spanEnd ?? null,
        ]
      );
    }
  });
}

async function loadEntries(db: Awaited<ReturnType<typeof getDb>>, date: string): Promise<LocalSetEntry[]> {
  const rows = await db.getAllAsync<{
    id: string;
    exercise_id: string | null;
    equipment: string | null;
    weight_kg: number | null;
    reps: number | null;
    sets: number | null;
    raw_text: string;
    parsed_by: 'DICTIONARY' | 'LLM';
    entry_order: number;
    span_start: number | null;
    span_end: number | null;
  }>(`SELECT * FROM set_entries WHERE session_date = ? ORDER BY entry_order ASC`, [date]);

  return rows.map((r) => ({
    id: r.id,
    exerciseId: r.exercise_id,
    equipment: r.equipment,
    weightKg: r.weight_kg,
    reps: r.reps,
    sets: r.sets,
    rawText: r.raw_text,
    parsedBy: r.parsed_by,
    order: r.entry_order,
    synced: 0 as const,
    spanStart: r.span_start,
    spanEnd: r.span_end,
  }));
}

export async function getLocalSession(date: string): Promise<LocalSession | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ date: string; notes: string | null; synced: number }>(
    `SELECT * FROM sessions WHERE date = ?`,
    [date]
  );
  if (!row) return null;
  const entries = await loadEntries(db, date);
  return { date: row.date, notes: row.notes, synced: row.synced as 0 | 1, entries };
}

// Every session with its entries, newest first — powers the History tab.
export async function listAllLocalSessions(): Promise<LocalSession[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ date: string; notes: string | null; synced: number }>(
    `SELECT * FROM sessions ORDER BY date DESC`,
  );
  const sessions: LocalSession[] = [];
  for (const row of rows) {
    const entries = await loadEntries(db, row.date);
    sessions.push({ date: row.date, notes: row.notes, synced: row.synced as 0 | 1, entries });
  }
  return sessions;
}

export async function listUnsyncedSessions(): Promise<LocalSession[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ date: string; notes: string | null; synced: number }>(
    `SELECT * FROM sessions WHERE synced = 0`
  );
  const sessions: LocalSession[] = [];
  for (const row of rows) {
    const entries = await loadEntries(db, row.date);
    sessions.push({ date: row.date, notes: row.notes, synced: row.synced as 0 | 1, entries });
  }
  return sessions;
}

// The most recent session strictly before `beforeDate` that logged the given
// exercise, with all its set-groups — powers the Log editor's prior-stats hint.
// Returns null when the exercise has no prior history.
export async function getLastSessionForExercise(
  exerciseId: string,
  beforeDate: string,
): Promise<ExerciseHistory | null> {
  const db = await getDb();
  const dateRow = await db.getFirstAsync<{ session_date: string }>(
    `SELECT session_date FROM set_entries
     WHERE exercise_id = ? AND session_date < ?
     ORDER BY session_date DESC LIMIT 1`,
    [exerciseId, beforeDate],
  );
  if (!dateRow) return null;

  const rows = await db.getAllAsync<{
    weight_kg: number | null;
    reps: number | null;
    sets: number | null;
  }>(
    `SELECT weight_kg, reps, sets FROM set_entries
     WHERE exercise_id = ? AND session_date = ?
     ORDER BY entry_order ASC`,
    [exerciseId, dateRow.session_date],
  );

  return {
    date: dateRow.session_date,
    entries: rows.map((r) => ({ weightKg: r.weight_kg, reps: r.reps, sets: r.sets })),
  };
}

// The most recent `limit` sessions (each with all its set-groups) that logged
// the exercise, strictly before `beforeDate`, newest first. Powers Progression:
// the newest session is shown, the trend across them drives the recommendation.
export async function getRecentSessionsForExercise(
  exerciseId: string,
  beforeDate: string,
  limit: number,
): Promise<ExerciseHistory[]> {
  const db = await getDb();
  const dateRows = await db.getAllAsync<{ session_date: string }>(
    `SELECT DISTINCT session_date FROM set_entries
     WHERE exercise_id = ? AND session_date < ?
     ORDER BY session_date DESC LIMIT ?`,
    [exerciseId, beforeDate, limit],
  );

  const sessions: ExerciseHistory[] = [];
  for (const dr of dateRows) {
    const rows = await db.getAllAsync<{
      weight_kg: number | null;
      reps: number | null;
      sets: number | null;
    }>(
      `SELECT weight_kg, reps, sets FROM set_entries
       WHERE exercise_id = ? AND session_date = ?
       ORDER BY entry_order ASC`,
      [exerciseId, dr.session_date],
    );
    sessions.push({
      date: dr.session_date,
      entries: rows.map((r) => ({ weightKg: r.weight_kg, reps: r.reps, sets: r.sets })),
    });
  }
  return sessions;
}

export async function markSessionSynced(date: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(`UPDATE sessions SET synced = 1 WHERE date = ?`, [date]);
}
