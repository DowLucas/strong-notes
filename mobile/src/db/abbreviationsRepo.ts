import { getDb } from './client';
import type { Abbreviation } from '../api/types';

export async function cacheAbbreviations(abbreviations: Abbreviation[]): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync(`DELETE FROM abbreviations_cache`);
    for (const a of abbreviations) {
      await db.runAsync(
        `INSERT INTO abbreviations_cache (id, token, exercise_id, modifier_type, modifier_value, source)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [a.id, a.token, a.exerciseId ?? null, a.modifierType ?? null, a.modifierValue ?? null, a.source]
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
    modifier_type: string | null;
    modifier_value: string | null;
    source: string;
  }>(`SELECT * FROM abbreviations_cache`);

  return rows.map((r) => ({
    id: r.id,
    token: r.token,
    exerciseId: r.exercise_id ?? undefined,
    modifierType: r.modifier_type ?? undefined,
    modifierValue: r.modifier_value ?? undefined,
    source: r.source,
  }));
}
