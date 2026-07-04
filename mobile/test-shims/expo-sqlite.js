/**
 * Test-only shim for `expo-sqlite`.
 *
 * expo-sqlite is a native module with no Node-compatible implementation and
 * jest-expo does not mock its SQL behavior (it only registers `.db` as a
 * known asset file extension for the bundler). Under plain jest-expo,
 * `SQLite.openDatabaseAsync` etc. are undefined, so any repo test would have
 * to hand-roll fake return values instead of exercising real SQL.
 *
 * This shim backs the small subset of the expo-sqlite async API our code
 * uses (execAsync, runAsync, getAllAsync, getFirstAsync,
 * withTransactionAsync, openDatabaseAsync) with better-sqlite3, an
 * in-process native SQLite binding for Node. It runs real SQL — joins,
 * upserts, WHERE clauses, transactions — so tests can catch actual bugs in
 * the repo layer's queries.
 *
 * It is wired in ONLY for Jest via `moduleNameMapper` in jest.config.js;
 * production code continues to import the real `expo-sqlite`.
 */
const Database = require('better-sqlite3');

// Keyed by database name so repeated `openDatabaseAsync('strongnotes.db')`
// calls (e.g. after `resetDbForTests()`) reconnect to the same underlying
// data, mirroring how the real module reopens the same persisted file.
const registry = new Map();

class SQLiteDatabase {
  constructor(nativeDb) {
    this.nativeDb = nativeDb;
  }

  async execAsync(source) {
    this.nativeDb.exec(source);
  }

  async runAsync(source, params = []) {
    const info = this.nativeDb.prepare(source).run(...params);
    return { lastInsertRowId: info.lastInsertRowid, changes: info.changes };
  }

  async getAllAsync(source, params = []) {
    return this.nativeDb.prepare(source).all(...params);
  }

  async getFirstAsync(source, params = []) {
    const row = this.nativeDb.prepare(source).get(...params);
    return row === undefined ? null : row;
  }

  async withTransactionAsync(fn) {
    this.nativeDb.exec('BEGIN');
    try {
      await fn();
      this.nativeDb.exec('COMMIT');
    } catch (err) {
      this.nativeDb.exec('ROLLBACK');
      throw err;
    }
  }
}

async function openDatabaseAsync(name) {
  if (!registry.has(name)) {
    // better-sqlite3 doesn't support WAL mode for in-memory databases;
    // that's fine, our migration's PRAGMA is a production-only optimization.
    registry.set(name, new Database(':memory:'));
  }
  return new SQLiteDatabase(registry.get(name));
}

// Test helper (not part of the real expo-sqlite API): fully wipes the
// in-memory registry so tests can start from a clean slate if ever needed.
function __resetAllForTests() {
  for (const db of registry.values()) {
    db.close();
  }
  registry.clear();
}

module.exports = { openDatabaseAsync, __resetAllForTests };
