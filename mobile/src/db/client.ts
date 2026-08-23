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
      entry_order INTEGER NOT NULL,
      span_start INTEGER,
      span_end INTEGER
    );
    CREATE TABLE IF NOT EXISTS abbreviations_cache (
      id TEXT PRIMARY KEY,
      token TEXT NOT NULL,
      exercise_id TEXT,
      exercise_name TEXT,
      modifier_type TEXT,
      modifier_value TEXT,
      source TEXT NOT NULL
    );
  `);

  // Backfill columns for databases created before span tracking existed.
  // CREATE TABLE IF NOT EXISTS won't alter an existing table, so add
  // explicitly and ignore the "duplicate column" case.
  await addColumnIfMissing(db, 'set_entries', 'span_start', 'INTEGER');
  await addColumnIfMissing(db, 'set_entries', 'span_end', 'INTEGER');
  // Exercise names joined the dictionary cache so the Log editor can title a
  // dictionary-resolved group's popover offline.
  await addColumnIfMissing(db, 'abbreviations_cache', 'exercise_name', 'TEXT');
}

async function addColumnIfMissing(
  db: SQLite.SQLiteDatabase,
  table: string,
  column: string,
  type: string,
): Promise<void> {
  const cols = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
  if (!cols.some((c) => c.name === column)) {
    await db.runAsync(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

// All write transactions go through one queue. expo-sqlite's
// withTransactionAsync cannot overlap on a single connection ("cannot start a
// transaction within a transaction"), and several writers run concurrently in
// the app: the editor's debounced save, the auto-sync's cache refresh, confirm.
let writeChain: Promise<unknown> = Promise.resolve();

export function withWriteTransaction<T>(task: (db: SQLite.SQLiteDatabase) => Promise<T>): Promise<T> {
  const run = writeChain.then(async () => {
    const db = await getDb();
    let result!: T;
    await db.withTransactionAsync(async () => {
      result = await task(db);
    });
    return result;
  });
  writeChain = run.catch(() => undefined);
  return run;
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
  writeChain = Promise.resolve();
  dbPromise = null;
}
