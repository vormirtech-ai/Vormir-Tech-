'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const db = require('../db');
const paths = require('../paths');
const audit = require('./audit');
const auth = require('./auth');
const settings = require('./settings');
const { assert, fail } = require('../util/errors');
const { nowStamp, today } = require('../util/dates');

function stamp() {
  return nowStamp().replace(/[: ]/g, '-');
}

function suggestedName() {
  return `MedBillPro_Backup_${today()}.db`;
}

/**
 * Writes a consistent copy of the live database using SQLite's online backup
 * API, so a backup can be taken while the shop is billing.
 */
async function create(actor, { targetPath = null } = {}) {
  auth.requireRole(actor, ['admin', 'pharmacist']);
  const target = targetPath || path.join(paths.backupDir(), `MedBillPro_Backup_${stamp()}.db`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  assert(!fs.existsSync(target) || fs.statSync(target).isFile(), 'The backup target is not a file.');
  await db.get().backup(target);
  const size = fs.statSync(target).size;
  settings.put('last_backup_at', nowStamp());
  audit.log(actor, 'backup.create', 'backup', null, { target, size });
  return { path: target, size, at: nowStamp() };
}

/** Rolling copy kept inside the app data folder; the newest 10 are retained. */
async function auto(reason = 'auto') {
  const target = path.join(paths.backupDir(), `auto_${stamp()}.db`);
  await db.get().backup(target);
  const files = fs.readdirSync(paths.backupDir())
    .filter((f) => f.startsWith('auto_') && f.endsWith('.db'))
    .sort()
    .reverse();
  for (const old of files.slice(10)) {
    try { fs.unlinkSync(path.join(paths.backupDir(), old)); } catch { /* ignore */ }
  }
  settings.put('last_backup_at', nowStamp());
  audit.log({ username: 'system' }, 'backup.auto', 'backup', null, { target, reason });
  return { path: target, size: fs.statSync(target).size };
}

function list() {
  const dir = paths.backupDir();
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.db'))
    .map((f) => {
      const full = path.join(dir, f);
      const st = fs.statSync(full);
      return { name: f, path: full, size: st.size, modified: st.mtime.toISOString(), kind: f.startsWith('auto_') ? 'auto' : 'manual' };
    })
    .sort((a, b) => b.modified.localeCompare(a.modified));
}

/** Reads a candidate file and reports whether it is one of our databases. */
function inspect({ sourcePath }) {
  assert(sourcePath && fs.existsSync(sourcePath), 'That backup file could not be found.');
  const st = fs.statSync(sourcePath);
  assert(st.isFile() && st.size > 0, 'That backup file is empty.');
  let probe;
  try {
    probe = new Database(sourcePath, { readonly: true, fileMustExist: true });
    const tables = probe.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
    const required = ['settings', 'products', 'batches', 'sales', 'sale_items'];
    const missing = required.filter((t) => !tables.includes(t));
    assert(missing.length === 0, `That file is not a MedV backup (missing: ${missing.join(', ')}).`);
    const version = probe.pragma('user_version', { simple: true });
    const counts = {
      products: probe.prepare('SELECT COUNT(*) AS n FROM products').get().n,
      sales: probe.prepare('SELECT COUNT(*) AS n FROM sales').get().n,
      customers: probe.prepare('SELECT COUNT(*) AS n FROM customers').get().n
    };
    const storeName = probe.prepare("SELECT value FROM settings WHERE key = 'store_name'").get()?.value ?? '';
    const lastSale = probe.prepare('SELECT MAX(date) AS d FROM sales').get().d;
    return { path: sourcePath, size: st.size, modified: st.mtime.toISOString(), version, counts, storeName, lastSale };
  } catch (err) {
    if (err.expected) throw err;
    fail('That file could not be opened as a database. It may be damaged or not a backup file.', 'BAD_BACKUP');
  } finally {
    try { probe?.close(); } catch { /* ignore */ }
  }
  return null;
}

/**
 * Replaces the live database with a backup. The current data is always copied
 * aside first, so a restore can itself be undone.
 */
async function restore(actor, { sourcePath, confirm = false }) {
  auth.requireRole(actor, ['admin']);
  const info = inspect({ sourcePath });
  assert(confirm === true, 'Restoring replaces all current data. Please confirm to continue.', 'CONFIRM_REQUIRED');

  const safety = path.join(paths.backupDir(), `before_restore_${stamp()}.db`);
  await db.get().backup(safety);
  audit.log(actor, 'backup.restore.start', 'backup', null, { sourcePath, safety });

  const live = paths.dbFile();
  db.close();
  try {
    fs.copyFileSync(sourcePath, live);
    for (const suffix of ['-wal', '-shm']) {
      const sidecar = `${live}${suffix}`;
      if (fs.existsSync(sidecar)) fs.unlinkSync(sidecar);
    }
  } catch (err) {
    // Put the shop back exactly as it was before giving up.
    try { fs.copyFileSync(safety, live); } catch { /* ignore */ }
    db.open(live);
    fail(`The restore could not be completed (${err.message}). Your existing data has been kept.`, 'RESTORE_FAILED');
  }
  const opened = db.open(live);
  audit.log(actor, 'backup.restore.done', 'backup', null, { sourcePath, safety, opened });
  return { ok: true, restoredFrom: sourcePath, safetyCopy: safety, info, db: opened };
}

function status() {
  const backups = list();
  const last = settings.get('last_backup_at');
  const dbPath = paths.dbFile();
  const size = fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0;
  const days = Number(settings.get('backup_reminder_days', '7')) || 7;
  const overdue = !last || (Date.now() - Date.parse(last.replace(' ', 'T'))) > days * 86400000;
  return { paths: paths.paths(), dbSize: size, lastBackupAt: last, backups: backups.slice(0, 20), count: backups.length, overdue };
}

/** Wipes transactions but keeps masters — used by "clear test data". */
function clearTransactions(actor, { confirm = false, keepMasters = true }) {
  auth.requireRole(actor, ['admin']);
  assert(confirm === true, 'Please confirm before clearing data.', 'CONFIRM_REQUIRED');
  return db.tx(() => {
    const conn = db.get();
    // Children before parents — foreign keys stay enforced throughout.
    const tables = ['payments', 'doctor_commissions', 'rx_reminders', 'stock_adjustments',
      'sale_return_items', 'sale_returns', 'purchase_return_items', 'purchase_returns',
      'sale_items', 'sales', 'purchase_items', 'purchases', 'expenses', 'ledger'];
    for (const t of tables) conn.prepare(`DELETE FROM ${t}`).run();
    conn.prepare('UPDATE batches SET qty_units = 0').run();
    if (!keepMasters) {
      for (const t of ['batches', 'products', 'customers', 'doctors', 'suppliers']) conn.prepare(`DELETE FROM ${t}`).run();
    }
    conn.prepare('UPDATE counters SET value = 0').run();
    audit.log(actor, 'data.clear', 'database', null, { keepMasters });
    return { ok: true };
  });
}

module.exports = { create, auto, list, inspect, restore, status, clearTransactions, suggestedName };
