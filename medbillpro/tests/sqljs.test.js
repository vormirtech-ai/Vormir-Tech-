'use strict';

/**
 * Runs the real schema and the real services against the sql.js adapter — the
 * data layer the browser build uses — so the web edition is covered by the
 * same kind of test as the desktop one.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const initSqlJs = require('../vendor/sql-wasm.js');
const { createDatabase } = require('../src/core/db/sqljs');
const { runMigrations, seedDefaults } = require('../src/core/db/bootstrap');
const { DEFAULT_SETTINGS } = require('../src/core/db/defaults');

let conn = null;

// Swap the database module for one backed by sql.js before any service loads.
const dbModulePath = require.resolve('../src/core/db');
const webDbModule = {
  open: () => ({ file: 'memory' }),
  get: () => conn,
  close: () => { if (conn) conn.close(); conn = null; },
  file: () => 'memory',
  tx: (fn) => conn.transaction(fn)(),
  isOpen: () => Boolean(conn && conn.open),
  DEFAULT_SETTINGS
};
require.cache[dbModulePath] = {
  id: dbModulePath, filename: dbModulePath, loaded: true, children: [], paths: [], exports: webDbModule
};

const api = require('../src/core/api');
const { today, addMonths } = require('../src/core/util/dates');

test('the browser data layer runs the whole billing flow', async () => {
  const SQL = await initSqlJs({ locateFile: () => path.join(__dirname, '..', 'vendor', 'sql-wasm.wasm') });
  conn = createDatabase(SQL, null);
  conn.pragma('foreign_keys = ON');
  const migration = runMigrations(conn);
  seedDefaults(conn);
  assert.equal(migration.applied > 0, true);
  assert.equal(conn.pragma('user_version', { simple: true }), 1);

  const call = (channel, payload) => api.handle(channel, payload);
  const exp = (months) => addMonths(today(), months).slice(0, 7);

  // setup + sign in
  await call('setup.complete', {
    store_name: 'Web Edition Medicals',
    store_state: 'Maharashtra',
    invoice_prefix: 'WEB',
    admin_password: 'browser@2026'
  });
  const login = await call('auth.login', { username: 'admin', password: 'browser@2026' });
  assert.equal(login.user.role, 'admin');

  // master data + stock through a purchase
  const product = await call('products.save', {
    name: 'Amoxycillin 500mg Capsule', pack_size: 10, gst_rate: 12, reorder_level: 20
  });
  const supplier = await call('suppliers.save', { name: 'Web Distributors' });
  const purchase = await call('purchases.create', {
    supplier_id: supplier.id,
    ref_no: 'WD-77',
    payment_mode: 'Credit',
    items: [{
      product_id: product.id, batch_no: 'AMX1', expiry: exp(20), mrp: 96,
      qty_units: 100, free_units: 10, rate_per_unit: 7.15, disc_pct: 0, gst_rate: 12
    }]
  });
  assert.equal(purchase.items.length, 1);
  assert.equal((await call('products.get', { id: product.id })).stock_units, 110);

  // a bill, with stock and cash moving
  const batch = (await call('batches.list', { product_id: product.id }))[0];
  const sale = await call('sales.create', {
    payment_mode: 'Cash',
    items: [{ product_id: product.id, batch_id: batch.id, qty_units: 15, rate_per_unit: 9.6, gst_rate: 12 }]
  });
  assert.equal(sale.no, 'WEB-0001');
  assert.equal(sale.subtotal, 144);
  assert.equal(sale.gst_amount, 17.28);
  assert.equal(sale.total, 161);
  assert.equal((await call('products.get', { id: product.id })).stock_units, 95);
  assert.equal((await call('accounts.balances')).cash, 161);

  // a failure inside a transaction must leave nothing behind
  await assert.rejects(
    () => call('sales.create', {
      payment_mode: 'Cash',
      items: [
        { product_id: product.id, batch_id: batch.id, qty_units: 1, rate_per_unit: 9.6, gst_rate: 12 },
        { product_id: product.id, batch_id: batch.id, qty_units: 99999, rate_per_unit: 9.6, gst_rate: 12 }
      ]
    }),
    /Not enough stock/
  );
  assert.equal((await call('products.get', { id: product.id })).stock_units, 95);
  assert.equal((await call('sales.list', {})).rows.length, 1);
  assert.equal((await call('accounts.balances')).cash, 161);

  // GST and reports read back correctly
  const gstr1 = await call('gst.gstr1', { from: today(), to: today() });
  assert.equal(gstr1.totals.taxable, 144);
  const recon = await call('gst.reconcile', { from: today(), to: today() });
  assert.equal(recon.clean, true);

  // the exported bytes are a real SQLite file
  const bytes = conn.export();
  assert.equal(Buffer.from(bytes.subarray(0, 15)).toString(), 'SQLite format 3');
  assert.ok(bytes.length > 20000);

  // and re-opening those bytes gives the same data back
  const reopened = createDatabase(SQL, bytes);
  assert.equal(reopened.prepare('SELECT COUNT(*) AS n FROM sales').get().n, 1);
  assert.equal(reopened.prepare('SELECT value FROM settings WHERE key = ?').get('store_name').value, 'Web Edition Medicals');
  reopened.close();
});

test.after(() => { if (conn) conn.close(); });
