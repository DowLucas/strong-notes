import { getDb } from './client';
import type { Abbreviation } from '@/lib/api';

export async function cacheAbbreviations(abbreviations: Abbreviation[]): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync(`DELETE FROM abbreviations_cache`);
    for (const a of abbreviations) {
      await db.runAsync(
        `INSERT INTO abbreviations_cache (id, token, exercise_id, exercise_name, modifier_type, modifier_value, source)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [a.id, a.token, a.exerciseId ?? null, a.exerciseName ?? null, a.modifierType ?? null, a.modifierValue ?? null, a.source]
      );
    }
  });
}

/**
 * Add or replace individual cache rows (by token) without touching the rest —
 * used right after the user confirms an exercise so the next scan resolves
 * offline instead of round-tripping to the LLM again.
 */
export async function upsertCachedAbbreviations(abbreviations: Abbreviation[]): Promise<void> {
  if (abbreviations.length === 0) return;
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const a of abbreviations) {
      await db.runAsync(`DELETE FROM abbreviations_cache WHERE UPPER(token) = UPPER(?)`, [a.token]);
      await db.runAsync(
        `INSERT OR REPLACE INTO abbreviations_cache (id, token, exercise_id, exercise_name, modifier_type, modifier_value, source)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [a.id, a.token, a.exerciseId ?? null, a.exerciseName ?? null, a.modifierType ?? null, a.modifierValue ?? null, a.source],
      );
    }
  });
}

export async function getCachedAbbreviations(): Promise<Abbreviation[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{
    id: string;
    token: string;
    exercise_id: string | null;
    exercise_name: string | null;
    modifier_type: string | null;
    modifier_value: string | null;
    source: string;
  }>(`SELECT * FROM abbreviations_cache`);

  return rows.map((r) => ({
    id: r.id,
    token: r.token,
    exerciseId: r.exercise_id ?? undefined,
    exerciseName: r.exercise_name ?? undefined,
    modifierType: r.modifier_type ?? undefined,
    modifierValue: r.modifier_value ?? undefined,
    source: r.source,
    createdAt: '', // not needed for offline dictionary matching; cache doesn't round-trip this field
  }));
}
