'use strict';

const db = require('../db');
const audit = require('./audit');
const auth = require('./auth');
const { DEFAULT_SETTINGS } = require('../db');
const { assert } = require('../util/errors');
const v = require('../util/validate');

function all() {
  const rows = db.get().prepare('SELECT key, value FROM settings').all();
  const out = { ...DEFAULT_SETTINGS };
  for (const r of rows) out[r.key] = r.value;
  return out;
}

function get(key, fallback = '') {
  const row = db.get().prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : (DEFAULT_SETTINGS[key] ?? fallback);
}

function num(key, fallback = 0) {
  const n = Number(get(key, String(fallback)));
  return Number.isFinite(n) ? n : fallback;
}

function flag(key) {
  return get(key) === '1';
}

function put(key, value) {
  db.get().prepare(`INSERT INTO settings (key, value) VALUES (?, ?)
                    ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, String(value ?? ''));
}

const EDITABLE = new Set(Object.keys(DEFAULT_SETTINGS));

function save(actor, patch) {
  auth.requireRole(actor, ['admin', 'pharmacist']);
  assert(patch && typeof patch === 'object', 'Nothing to save.');
  if (patch.store_gstin) v.gstin(patch.store_gstin);
  if (patch.store_phone) v.phone(patch.store_phone, 'Phone');
  const write = db.tx(() => {
    let n = 0;
    for (const [key, value] of Object.entries(patch)) {
      if (!EDITABLE.has(key)) continue;
      put(key, value);
      n += 1;
    }
    return n;
  });
  audit.log(actor, 'settings.save', 'settings', null, Object.keys(patch).join(','));
  return { saved: write, settings: all() };
}

/** Store profile block reused by invoice headers and GST reports. */
function storeProfile() {
  const s = all();
  return {
    name: s.store_name,
    tagline: s.store_tagline,
    address: s.store_address,
    city: s.store_city,
    state: s.store_state,
    pincode: s.store_pincode,
    phone: s.store_phone,
    email: s.store_email,
    gstin: s.store_gstin,
    dl_no: s.store_dl_no,
    fssai: s.store_fssai,
    currency: s.currency_symbol,
    terms: s.invoice_terms,
    footer: s.invoice_footer,
    printFormat: s.print_format
  };
}

/** Document numbers are allocated inside the caller's transaction. */
function nextNumber(counterName, prefixKey) {
  const conn = db.get();
  conn.prepare('INSERT OR IGNORE INTO counters (name, value) VALUES (?, 0)').run(counterName);
  conn.prepare('UPDATE counters SET value = value + 1 WHERE name = ?').run(counterName);
  const value = conn.prepare('SELECT value FROM counters WHERE name = ?').get(counterName).value;
  const prefix = get(prefixKey, 'DOC');
  return `${prefix}-${String(value).padStart(4, '0')}`;
}

module.exports = { all, get, num, flag, put, save, storeProfile, nextNumber };
