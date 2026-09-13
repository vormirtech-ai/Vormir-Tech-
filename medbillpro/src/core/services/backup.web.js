'use strict';

const db = require('../db');
const audit = require('./audit');
const auth = require('./auth');
const settings = require('./settings');
const paths = require('../paths');
const { assert, fail } = require('../util/errors');
const { nowStamp, today } = require('../util/dates');
const { createDatabase } = require('../db/sqljs');

/**
 * Backup and restore for the web build. A backup is the real SQLite file —
 * the same bytes the desktop build writes — so the two can swap databases.
 *
 * `targetPath` / `sourcePath` are handled by the page's bridge, which turns
 * them into a download and a file picker; the service itself only deals in bytes.
 */
const pending = { downloads: new Map(), uploads: new Map() };

function suggestedName() {
  return `MedBillPro_Backup_${today()}.db`;
}

/** Produces the backup bytes and hands them to the bridge to save. */
async function create(actor, { targetPath = null } = {}) {
  auth.requireRole(actor, ['admin', 'pharmacist']);
  await db.persist();
  const bytes = db.exportBytes();
  const name = targetPath || suggestedName();
  pending.downloads.set(name, bytes);
  settings.put('last_backup_at', nowStamp());
  audit.log(actor, 'backup.create', 'backup', null, { name, size: bytes.length });
  return { path: name, name, size: bytes.length, at: nowStamp(), download: true };
}

/** Keeps a few automatic copies inside browser storage. */
async function auto(reason = 'auto') {
  const snap = await db.addSnapshot(reason);
  settings.put('last_backup_at', nowStamp());
  return { path: snap.name, size: snap.size };
}

async function list() {
  const snaps = await db.snapshots();
  return snaps.map((s) => ({
    name: s.name,
    path: `snapshot:${s.name}`,
    size: s.size,
    modified: s.at,
    kind: 'auto'
  }));
}

function bytesFor(sourcePath) {
  if (typeof sourcePath === 'string' && sourcePath.startsWith('snapshot:')) return null; // resolved in restore()
  const uploaded = pending.uploads.get(sourcePath);
  assert(uploaded, 'Choose a backup file first.');
  return uploaded;
}

/** Reads a candidate file and reports whether it is one of our databases. */
async function inspect({ sourcePath, bytes = null }) {
  let data = bytes;
  if (!data) {
    if (typeof sourcePath === 'string' && sourcePath.startsWith('snapshot:')) {
      const snaps = await db.snapshots();
      const found = snaps.find((s) => `snapshot:${s.name}` === sourcePath);
      assert(found, 'That automatic backup is no longer stored.');
      data = found.bytes;
    } else {
      data = bytesFor(sourcePath);
    }
  }
  let probe = null;
  try {
    probe = createDatabase(db.getSQL(), new Uint8Array(data));
    const tables = probe.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
    const required = ['settings', 'products', 'batches', 'sales', 'sale_items'];
    const missing = required.filter((t) => !tables.includes(t));
    assert(missing.length === 0, `That file is not a MedV backup (missing: ${missing.join(', ')}).`);
    const counts = {
      products: probe.prepare('SELECT COUNT(*) AS n FROM products').get().n,
      sales: probe.prepare('SELECT COUNT(*) AS n FROM sales').get().n,
      customers: probe.prepare('SELECT COUNT(*) AS n FROM customers').get().n
    };
    const storeName = probe.prepare("SELECT value FROM settings WHERE key = 'store_name'").get()?.value ?? '';
    const lastSale = probe.prepare('SELECT MAX(date) AS d FROM sales').get().d;
    return {
      path: sourcePath,
      size: data.length,
      modified: new Date().toISOString(),
      version: probe.pragma('user_version', { simple: true }),
      counts,
      storeName,
      lastSale
    };
  } catch (err) {
    if (err.expected) throw err;
    fail('That file could not be opened as a database. It may be damaged or not a backup file.', 'BAD_BACKUP');
  } finally {
    try { probe?.close(); } catch { /* ignore */ }
  }
  return null;
}

/** Replaces the live database, keeping a copy of the present one first. */
async function restore(actor, { sourcePath, bytes = null, confirm = false }) {
  auth.requireRole(actor, ['admin']);
  let data = bytes;
  if (!data) {
    if (typeof sourcePath === 'string' && sourcePath.startsWith('snapshot:')) {
      const snaps = await db.snapshots();
      const found = snaps.find((s) => `snapshot:${s.name}` === sourcePath);
      assert(found, 'That automatic backup is no longer stored.');
      data = found.bytes;
    } else {
      data = bytesFor(sourcePath);
    }
  }
  const info = await inspect({ sourcePath, bytes: data });
  assert(confirm === true, 'Restoring replaces all current data. Please confirm to continue.', 'CONFIRM_REQUIRED');

  const safety = await db.addSnapshot('before-restore');
  audit.log(actor, 'backup.restore.start', 'backup', null, { sourcePath, safety: safety.name });
  const migration = await db.replaceWith(data);
  audit.log(actor, 'backup.restore.done', 'backup', null, { sourcePath, safety: safety.name });
  return { ok: true, restoredFrom: sourcePath, safetyCopy: `snapshot:${safety.name}`, info, db: migration };
}

async function status() {
  const size = db.isOpen() ? db.exportBytes().length : 0;
  const last = settings.get('last_backup_at');
  const days = Number(settings.get('backup_reminder_days', '7')) || 7;
  const overdue = !last || (Date.now() - Date.parse(last.replace(' ', 'T'))) > days * 86400000;
  const stored = await list();
  const space = await db.idb.estimate();
  return {
    paths: paths.paths(),
    dbSize: size,
    lastBackupAt: last,
    backups: stored,
    count: stored.length,
    overdue,
    browser: true,
    storage: space
  };
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

module.exports = { create, auto, list, inspect, restore, status, clearTransactions, suggestedName, pending };
