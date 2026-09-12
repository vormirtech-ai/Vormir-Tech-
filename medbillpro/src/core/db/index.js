'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const migrations = require('./migrations');
const { nowStamp } = require('../util/dates');

const DEFAULT_SETTINGS = {
  setup_complete: '0',
  store_name: 'My Medical Store',
  store_tagline: 'Chemist & Druggist',
  store_address: '',
  store_city: '',
  store_state: 'Maharashtra',
  store_pincode: '',
  store_phone: '',
  store_email: '',
  store_gstin: '',
  store_dl_no: '',
  store_fssai: '',
  invoice_prefix: 'INV',
  purchase_prefix: 'PUR',
  sale_return_prefix: 'SR',
  purchase_return_prefix: 'PR',
  expiry_alert_days: '90',
  low_stock_enabled: '1',
  default_gst_rate: '12',
  price_includes_gst: '0',
  round_off_invoice: '1',
  print_format: 'a5',
  print_copies: '1',
  invoice_terms: 'Goods once sold will not be taken back without a valid reason. Subject to local jurisdiction.',
  invoice_footer: 'Get well soon — thank you for visiting!',
  rx_reminder_days: '25',
  whatsapp_template: 'Hello {name}, this is a friendly reminder from {store} that your medicines ({medicines}) are due for a refill. Reply to reserve your order.',
  theme: 'light',
  currency_symbol: '₹',
  backup_reminder_days: '7',
  last_backup_at: ''
};

let db = null;
let dbFile = null;

function applyPragmas(conn) {
  conn.pragma('journal_mode = WAL');
  conn.pragma('synchronous = FULL');
  conn.pragma('foreign_keys = ON');
  conn.pragma('busy_timeout = 5000');
}

function runMigrations(conn) {
  const current = conn.pragma('user_version', { simple: true });
  const pending = migrations.filter((m) => m.version > current).sort((a, b) => a.version - b.version);
  for (const m of pending) {
    const apply = conn.transaction(() => {
      m.up(conn);
      conn.pragma(`user_version = ${m.version}`);
    });
    apply();
  }
  return { from: current, to: conn.pragma('user_version', { simple: true }), applied: pending.length };
}

function seedDefaults(conn) {
  const insert = conn.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  const seed = conn.transaction(() => {
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) insert.run(key, value);
    for (const name of ['invoice', 'purchase', 'sale_return', 'purchase_return']) {
      conn.prepare('INSERT OR IGNORE INTO counters (name, value) VALUES (?, 0)').run(name);
    }
    const users = conn.prepare('SELECT COUNT(*) AS n FROM users').get().n;
    if (users === 0) {
      // First launch: create the initial Admin account. The setup wizard makes
      // the operator replace this password before the app can be used.
      const { hashPassword } = require('../services/auth');
      const { hash, salt } = hashPassword('admin123');
      conn.prepare(`INSERT INTO users (username, name, role, pass_hash, pass_salt, active, created_at)
                    VALUES ('admin', 'Administrator', 'admin', ?, ?, 1, ?)`).run(hash, salt, nowStamp());
    }
  });
  seed();
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
