// Jest shim for expo-sqlite, backed by better-sqlite3 (a native Node module).
//
// expo-sqlite's native binding only works in the app's real runtime, so under
// jest we swap it for better-sqlite3, which exposes a close-enough surface for
// unit tests of code that talks to a SQLite database. Wired up via
// jest.config.js moduleNameMapper. Only the subset of the expo-sqlite API
// actually used by this app is implemented; extend as needed.
const BetterSqlite3 = require('better-sqlite3');

function normalizeParams(params) {
  if (params === undefined) return [];
  if (Array.isArray(params)) return params;
  if (params && typeof params === 'object') return params;
  return [params];
}

class SQLiteDatabase {
  constructor(databaseName) {
    this.databaseName = databaseName;
    this.nativeDatabase = new BetterSqlite3(':memory:');
  }

  execSync(source) {
    this.nativeDatabase.exec(source);
  }

  async execAsync(source) {
    this.execSync(source);
  }

  runSync(source, params) {
    const info = this.nativeDatabase.prepare(source).run(normalizeParams(params));
    return { lastInsertRowId: info.lastInsertRowid, changes: info.changes };
  }

  async runAsync(source, params) {
    return this.runSync(source, params);
  }

  getFirstSync(source, params) {
    return this.nativeDatabase.prepare(source).get(normalizeParams(params)) ?? null;
  }

  async getFirstAsync(source, params) {
    return this.getFirstSync(source, params);
  }

  getAllSync(source, params) {
    return this.nativeDatabase.prepare(source).all(normalizeParams(params));
  }

  async getAllAsync(source, params) {
    return this.getAllSync(source, params);
  }

  *getEachSync(source, params) {
    for (const row of this.nativeDatabase.prepare(source).iterate(normalizeParams(params))) {
      yield row;
    }
  }

  async *getEachAsync(source, params) {
    for (const row of this.getEachSync(source, params)) {
      yield row;
    }
  }

  withTransactionSync(task) {
    this.nativeDatabase.transaction(task)();
  }

  async withTransactionAsync(task) {
    // Mirror the native behaviour: a transaction cannot start while another
    // one is open on the same connection.
    if (this._inTransaction) throw new Error('cannot start a transaction within a transaction');
    this._inTransaction = true;
    try {
      await task();
    } finally {
      this._inTransaction = false;
    }
  }

  async withExclusiveTransactionAsync(task) {
    await task(this);
  }

  isInTransactionSync() {
    return this.nativeDatabase.inTransaction;
  }

  async isInTransactionAsync() {
    return this.isInTransactionSync();
  }

  closeSync() {
    this.nativeDatabase.close();
  }

  async closeAsync() {
    this.closeSync();
  }
}

function openDatabaseSync(databaseName) {
  return new SQLiteDatabase(databaseName);
}

async function openDatabaseAsync(databaseName) {
  return openDatabaseSync(databaseName);
}

function deleteDatabaseSync() {}
async function deleteDatabaseAsync() {}

module.exports = {
  SQLiteDatabase,
  openDatabaseSync,
  openDatabaseAsync,
  deleteDatabaseSync,
  deleteDatabaseAsync,
  defaultDatabaseDirectory: '',
  bundledExtensions: {},
  addDatabaseChangeListener: () => ({ remove: () => {} }),
};
