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

export function resetDbForTests() {
  dbPromise = null;
  // Under Jest, `expo-sqlite` resolves to test-shims/expo-sqlite.js (see
  // jest.config.js's moduleNameMapper), which keeps its in-memory databases
  // in a registry keyed by filename so repeated openDatabaseAsync() calls
  // reconnect to the same data - mirroring a real persisted file. That means
  // nulling `dbPromise` alone doesn't actually clear stored rows between
  // tests; without this, one test's data can leak into another's. The real
  // expo-sqlite module has no such export, so this is a no-op in production.
  const maybeShim = SQLite as unknown as { __resetAllForTests?: () => void };
  maybeShim.__resetAllForTests?.();
}
