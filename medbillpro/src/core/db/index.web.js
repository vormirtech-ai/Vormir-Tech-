'use strict';

const idb = require('./idb');
const { createDatabase } = require('./sqljs');
const { DEFAULT_SETTINGS } = require('./defaults');
const { runMigrations, seedDefaults } = require('./bootstrap');

/**
 * The browser build's database module. Same surface as the desktop one, but the
 * SQLite file lives in this browser's own storage (IndexedDB) on this computer,
 * and is written back after every change.
 */
const DB_KEY = 'medbill.db';
const SNAPSHOT_KEY = 'auto-backups';

let db = null;
let SQLjs = null;
let saveTimer = null;
let saving = false;
let pendingSave = false;
const listeners = new Set();

function applyPragmas(conn) {
  conn.pragma('foreign_keys = ON');
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { persist().catch((err) => console.error('[medv] save failed', err)); }, 250);
}

/** Writes the current database back to browser storage. */
async function persist() {
  if (!db) return null;
  if (saving) { pendingSave = true; return null; }
  saving = true;
  try {
    const bytes = db.export();
    await idb.set(DB_KEY, bytes);
    db.clearDirty();
    for (const fn of listeners) {
      try { fn({ size: bytes.length }); } catch { /* ignore */ }
    }
    return bytes.length;
  } finally {
    saving = false;
    if (pendingSave) {
      pendingSave = false;
      scheduleSave();
    }
  }
}

function onPersist(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Loads sql.js, restores the saved database (or creates one), and migrates it. */
async function open({ SQL, wasmUrl } = {}) {
  SQLjs = SQL || SQLjs;
  if (!SQLjs) {
    // eslint-disable-next-line no-undef
    SQLjs = await initSqlJs({ locateFile: () => wasmUrl || 'vendor/sql-wasm.wasm' });
  }
  const saved = await idb.get(DB_KEY);
  const bytes = saved ? new Uint8Array(saved) : null;
  db = createDatabase(SQLjs, bytes, { onWrite: scheduleSave });
  applyPragmas(db);
  const migration = runMigrations(db);
  seedDefaults(db);
  await persist();
  await idb.requestPersistence();
  return { file: 'browser storage (IndexedDB)', fresh: !saved, ...migration };
}

function get() {
  if (!db) throw new Error('Database is not open yet.');
  return db;
}

function file() { return 'IndexedDB:medv/medbill.db'; }

function close() {
  if (db) db.close();
  db = null;
}

function tx(fn) {
  const conn = get();
  return conn.transaction(fn)();
}

function isOpen() { return Boolean(db && db.open); }

/** The loaded sql.js module, so other services can open a second database. */
function getSQL() { return SQLjs; }

function exportBytes() { return get().export(); }

/** Replaces the live database with the bytes of a backup file. */
async function replaceWith(bytes) {
  const incoming = new Uint8Array(bytes);
  const probe = createDatabase(SQLjs, incoming);
  probe.close();
  if (db) db.close();
  db = createDatabase(SQLjs, incoming, { onWrite: scheduleSave });
  applyPragmas(db);
  const migration = runMigrations(db);
  seedDefaults(db);
  await persist();
  return migration;
}

// ------------------------------------------------------- automatic snapshots
async function snapshots() {
  return (await idb.get(SNAPSHOT_KEY)) || [];
}

async function addSnapshot(label = 'auto') {
  const list = await snapshots();
  const bytes = exportBytes();
  list.unshift({ name: `auto_${new Date().toISOString().replace(/[:.]/g, '-')}.db`, at: new Date().toISOString(), kind: label, size: bytes.length, bytes });
  await idb.set(SNAPSHOT_KEY, list.slice(0, 5));
  return list[0];
}

async function removeSnapshots() {
  await idb.del(SNAPSHOT_KEY);
}

module.exports = {
  open, get, close, file, tx, isOpen, DEFAULT_SETTINGS,
  persist, onPersist, exportBytes, replaceWith, snapshots, addSnapshot, removeSnapshots, idb, getSQL
};
