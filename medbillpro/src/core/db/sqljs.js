'use strict';

/**
 * A better-sqlite3-shaped facade over sql.js (SQLite compiled to WebAssembly),
 * so every service in src/core runs unchanged in a browser.
 *
 * Only the surface the services actually use is implemented: prepare/run/get/
 * all, exec, pragma, transaction (with SAVEPOINT nesting) and export.
 */

function normaliseValue(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number' || typeof value === 'string') return value;
  if (value instanceof Uint8Array) return value;
  if (typeof value === 'bigint') return Number(value);
  return String(value);
}

/** better-sqlite3 takes named parameters as a plain object; sql.js wants @-keys. */
function bindParams(args) {
  if (args.length === 0) return undefined;
  if (args.length === 1 && args[0] !== null && typeof args[0] === 'object'
    && !Array.isArray(args[0]) && !(args[0] instanceof Uint8Array)) {
    const out = {};
    for (const [key, value] of Object.entries(args[0])) out[`@${key}`] = normaliseValue(value);
    return out;
  }
  return args.map(normaliseValue);
}

function createDatabase(SQL, bytes, { onWrite = null } = {}) {
  const raw = bytes && bytes.length ? new SQL.Database(bytes) : new SQL.Database();
  let depth = 0;
  let closed = false;
  let dirty = false;

  const markDirty = () => {
    dirty = true;
    if (depth === 0 && onWrite) onWrite();
  };

  function statement(sql) {
    const isWrite = !/^\s*(select|pragma|with)\b/i.test(sql);
    return {
      run(...args) {
        const stmt = raw.prepare(sql);
        try {
          const params = bindParams(args);
          if (params !== undefined) stmt.bind(params);
          stmt.step();
        } finally {
          stmt.free();
        }
        if (isWrite) markDirty();
        const changes = raw.getRowsModified();
        let lastInsertRowid = 0;
        const res = raw.exec('SELECT last_insert_rowid() AS id');
        if (res.length && res[0].values.length) lastInsertRowid = res[0].values[0][0];
        return { changes, lastInsertRowid };
      },
      get(...args) {
        const stmt = raw.prepare(sql);
        try {
          const params = bindParams(args);
          if (params !== undefined) stmt.bind(params);
          if (!stmt.step()) return undefined;
          return stmt.getAsObject();
        } finally {
          stmt.free();
        }
      },
      all(...args) {
        const stmt = raw.prepare(sql);
        const rows = [];
        try {
          const params = bindParams(args);
          if (params !== undefined) stmt.bind(params);
          while (stmt.step()) rows.push(stmt.getAsObject());
        } finally {
          stmt.free();
        }
        return rows;
      }
    };
  }

  const api = {
    get open() { return !closed; },

    prepare(sql) { return statement(sql); },

    exec(sql) {
      raw.exec(sql);
      markDirty();
      return api;
    },

    /**
     * `pragma('user_version', { simple: true })` reads; `pragma('user_version = 3')`
     * writes. Pragmas that only mean something to a file-backed database
     * (journal mode, checkpoints) are accepted and ignored.
     */
    pragma(source, { simple = false } = {}) {
      const text = String(source).trim();
      const IGNORED = /^(journal_mode|synchronous|busy_timeout|wal_checkpoint|locking_mode|temp_store)/i;
      if (IGNORED.test(text)) return simple ? null : [];
      if (text.includes('=')) {
        raw.exec(`PRAGMA ${text}`);
        markDirty();
        return simple ? null : [];
      }
      const result = raw.exec(`PRAGMA ${text}`);
      if (!result.length || !result[0].values.length) return simple ? null : [];
      if (simple) return result[0].values[0][0];
      return result[0].values.map((row) => Object.fromEntries(row.map((v, i) => [result[0].columns[i], v])));
    },

    /** Mirrors better-sqlite3: returns a function that runs `fn` in a transaction. */
    transaction(fn) {
      return (...args) => {
        const nested = depth > 0;
        const name = `sp_${depth}`;
        raw.exec(nested ? `SAVEPOINT ${name}` : 'BEGIN');
        depth += 1;
        try {
          const result = fn(...args);
          depth -= 1;
          raw.exec(nested ? `RELEASE ${name}` : 'COMMIT');
          if (depth === 0 && dirty && onWrite) onWrite();
          return result;
        } catch (err) {
          depth -= 1;
          try {
            raw.exec(nested ? `ROLLBACK TO ${name}` : 'ROLLBACK');
            if (nested) raw.exec(`RELEASE ${name}`);
          } catch { /* the statement that failed already unwound it */ }
          throw err;
        }
      };
    },

    /** The whole database as SQLite file bytes — this is what a backup is. */
    export() { return raw.export(); },

    close() {
      if (!closed) {
        raw.close();
        closed = true;
      }
    },

    get isDirty() { return dirty; },
    clearDirty() { dirty = false; }
  };

  return api;
}

module.exports = { createDatabase, bindParams, normaliseValue };
