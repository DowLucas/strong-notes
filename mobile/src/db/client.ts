import * as SQLite from 'expo-sqlite';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function migrate(db: SQLite.SQLiteDatabase) {
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS sessions (
      date TEXT PRIMARY KEY,
      notes TEXT,
      synced INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS set_entries (
      id TEXT PRIMARY KEY,
      session_date TEXT NOT NULL REFERENCES sessions(date),
      exercise_id TEXT,
      equipment TEXT,
      weight_kg REAL,
      reps INTEGER,
      sets INTEGER,
      raw_text TEXT NOT NULL,
      parsed_by TEXT NOT NULL,
      entry_order INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS abbreviations_cache (
      id TEXT PRIMARY KEY,
      token TEXT NOT NULL,
      exercise_id TEXT,
      modifier_type TEXT,
      modifier_value TEXT,
      source TEXT NOT NULL
    );
  `);
}

export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync('strongnotes.db');
      await migrate(db);
      return db;
    })();
  }
  return dbPromise;
}

// Note: the Jest test shim (test-shims/expo-sqlite.js) does not memoize
// databases by name -- every openDatabaseAsync() call returns a fresh
// in-memory database. So dropping our own memoized promise is enough to
// give each test a clean database; there's no shim-side registry to clear.
export function resetDbForTests() {
  dbPromise = null;
}
