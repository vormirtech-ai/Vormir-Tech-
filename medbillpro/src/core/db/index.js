'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { DEFAULT_SETTINGS } = require('./defaults');
const { runMigrations, seedDefaults } = require('./bootstrap');

let db = null;
let dbFile = null;

function applyPragmas(conn) {
  conn.pragma('journal_mode = WAL');
  conn.pragma('synchronous = FULL');
  conn.pragma('foreign_keys = ON');
  conn.pragma('busy_timeout = 5000');
}

/** Opens (creating if needed) the local SQLite database and brings it up to date. */
function open(file) {
  if (db) close();
  dbFile = file;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new Database(file);
  applyPragmas(db);
  const migration = runMigrations(db);
  seedDefaults(db);
  return { file, ...migration };
}

function get() {
  if (!db) throw new Error('Database is not open. Call db.open(file) first.');
  return db;
}

function file() {
  return dbFile;
}

function close() {
  if (db) {
    try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch { /* ignore */ }
    db.close();
  }
  db = null;
}

/** Runs `fn` inside a single transaction — everything commits, or nothing does. */
function tx(fn) {
  const conn = get();
  const wrapped = conn.transaction(fn);
  return wrapped();
}

function isOpen() {
  return Boolean(db && db.open);
}

module.exports = { open, get, close, file, tx, isOpen, DEFAULT_SETTINGS };
