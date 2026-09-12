'use strict';

const db = require('../db');
const audit = require('./audit');
const auth = require('./auth');
const settings = require('./settings');
const v = require('../util/validate');
const { assert } = require('../util/errors');
const { r2, r3, int } = require('../util/money');
const { nowStamp, today, addDays, expiryEndDate } = require('../util/dates');

const CATEGORIES = ['Medicine', 'Tablet', 'Syrup', 'Injection', 'Ointment', 'Drops', 'Surgical', 'Cosmetic', 'General', 'Other'];
const SCHEDULES = ['General', 'Schedule H', 'Schedule H1', 'Schedule X', 'OTC', 'Narcotic'];

const STOCK_SELECT = `
  SELECT p.*,
         COALESCE(s.qty_units, 0)  AS stock_units,
         COALESCE(s.batch_count, 0) AS batch_count,
         s.min_expiry,
         s.mrp AS last_mrp,
         s.rate AS last_rate
  FROM products p
  LEFT JOIN (
    SELECT b.product_id,
           SUM(b.qty_units) AS qty_units,
           COUNT(*)         AS batch_count,
           MIN(b.expiry)    AS min_expiry,
           MAX(b.mrp)       AS mrp,
           MAX(b.rate_per_unit) AS rate
    FROM batches b
    WHERE b.qty_units > 0
    GROUP BY b.product_id
  ) s ON s.product_id = p.id`;

function decorate(row) {
  if (!row) return row;
  const pack = Math.max(1, int(row.pack_size, 1));
  const units = int(row.stock_units, 0);
  return {
    ...row,
    active: !!row.active,
    allow_loose: !!row.allow_loose,
    pack_size: pack,
    stock_units: units,
    stock_packs: Math.floor(units / pack),
    stock_loose: units % pack,
    stock_label: pack > 1
      ? `${Math.floor(units / pack)} ${row.pack_label}${units % pack ? ` + ${units % pack} ${row.unit_label}` : ''}`
      : `${units} ${row.unit_label}`,
    low_stock: row.reorder_level > 0 && units <= row.reorder_level
  };
}

function list({ search = '', category = '', onlyActive = true, lowStock = false, limit = 500 } = {}) {
  const where = [];
  const args = [];
  if (onlyActive) where.push('p.active = 1');
  if (search) {
    where.push('(p.name LIKE ? OR p.generic LIKE ? OR p.manufacturer LIKE ?)');
    const q = `%${search}%`;
    args.push(q, q, q);
  }
  if (category) { where.push('p.category = ?'); args.push(category); }
  let sql = `${STOCK_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY p.name LIMIT ?`;
  let rows = db.get().prepare(sql).all(...args, Math.min(Number(limit) || 500, 5000)).map(decorate);
  if (lowStock) rows = rows.filter((r) => r.low_stock || r.stock_units === 0);
  return rows;
}

function byId(id) {
  return decorate(db.get().prepare(`${STOCK_SELECT} WHERE p.id = ?`).get(Number(id)));
}

/** Fast type-ahead used by the billing screen. Batches come along for the ride. */
function search({ q = '', limit = 12, inStockOnly = false } = {}) {
  const term = String(q).trim();
  if (!term) return [];
  const like = `${term}%`;
  const contains = `%${term}%`;
  const rows = db.get().prepare(`${STOCK_SELECT}
    WHERE p.active = 1 AND (p.name LIKE ? OR p.generic LIKE ? OR p.name LIKE ? OR p.generic LIKE ?)
    ORDER BY CASE WHEN p.name LIKE ? THEN 0 ELSE 1 END, p.name
    LIMIT ?`).all(like, like, contains, contains, like, Math.min(Number(limit) || 12, 50)).map(decorate);
  const filtered = inStockOnly ? rows.filter((r) => r.stock_units > 0) : rows;
  return filtered.map((r) => ({ ...r, batches: batchesFor(r.id, { onlyInStock: true }) }));
}

function save(actor, payload) {
  auth.requireRole(actor, ['admin', 'pharmacist']);
  const id = payload.id ? v.integer(payload.id, 'Product', { min: 1 }) : null;
  const data = {
    name: v.str(payload.name, 'Medicine name', { required: true, max: 120 }),
    generic: v.str(payload.generic, 'Salt / generic name', { max: 160 }),
    manufacturer: v.str(payload.manufacturer, 'Manufacturer', { max: 120 }),
    category: v.oneOf(payload.category, 'Category', CATEGORIES, 'Medicine'),
    hsn: v.str(payload.hsn, 'HSN code', { max: 12 }),
    gst_rate: v.number(payload.gst_rate, 'GST %', { min: 0, max: 28, fallback: settings.num('default_gst_rate', 12) }),
    pack_size: v.integer(payload.pack_size, 'Units per pack', { min: 1, max: 10000, fallback: 1 }) || 1,
    pack_label: v.str(payload.pack_label, 'Pack label', { max: 20 }) || 'Strip',
    unit_label: v.str(payload.unit_label, 'Unit label', { max: 20 }) || 'Tablet',
    allow_loose: v.bool(payload.allow_loose ?? 1),
    rack: v.str(payload.rack, 'Rack', { max: 30 }),
    schedule_type: v.oneOf(payload.schedule_type, 'Drug schedule', SCHEDULES, 'General'),
    reorder_level: v.integer(payload.reorder_level, 'Reorder level', { min: 0, max: 1000000, fallback: 0 }),
    active: v.bool(payload.active ?? 1)
  };
  assert([0, 5, 12, 18, 28].includes(Number(data.gst_rate)), 'GST % must be 0, 5, 12, 18 or 28.');

  const dup = db.get().prepare('SELECT id FROM products WHERE lower(name) = lower(?) AND id <> ?')
    .get(data.name, id ?? 0);
  assert(!dup, `"${data.name}" already exists in the medicine master.`);

  if (id) {
    db.get().prepare(`UPDATE products SET name=@name, generic=@generic, manufacturer=@manufacturer,
      category=@category, hsn=@hsn, gst_rate=@gst_rate, pack_size=@pack_size, pack_label=@pack_label,
      unit_label=@unit_label, allow_loose=@allow_loose, rack=@rack, schedule_type=@schedule_type,
      reorder_level=@reorder_level, active=@active, updated_at=@updated_at WHERE id=@id`)
      .run({ ...data, id, updated_at: nowStamp() });
    audit.log(actor, 'product.update', 'product', id, data.name);
    return byId(id);
  }
  const info = db.get().prepare(`INSERT INTO products
    (name, generic, manufacturer, category, hsn, gst_rate, pack_size, pack_label, unit_label,
     allow_loose, rack, schedule_type, reorder_level, active, created_at, updated_at)
    VALUES (@name, @generic, @manufacturer, @category, @hsn, @gst_rate, @pack_size, @pack_label,
            @unit_label, @allow_loose, @rack, @schedule_type, @reorder_level, @active, @created_at, @created_at)`)
    .run({ ...data, created_at: nowStamp() });
  audit.log(actor, 'product.create', 'product', info.lastInsertRowid, data.name);
  return byId(info.lastInsertRowid);
}

function remove(actor, { id }) {
  auth.requireRole(actor, ['admin', 'pharmacist']);
  const pid = v.integer(id, 'Product', { required: true, min: 1 });
  const stock = db.get().prepare('SELECT COALESCE(SUM(qty_units),0) AS n FROM batches WHERE product_id = ?').get(pid).n;
  const sold = db.get().prepare('SELECT COUNT(*) AS n FROM sale_items WHERE product_id = ?').get(pid).n;
  if (stock > 0 || sold > 0) {
    db.get().prepare('UPDATE products SET active = 0, updated_at = ? WHERE id = ?').run(nowStamp(), pid);
    audit.log(actor, 'product.deactivate', 'product', pid);
    return { ok: true, deactivated: true };
  }
  db.get().prepare('DELETE FROM products WHERE id = ?').run(pid);
  audit.log(actor, 'product.delete', 'product', pid);
  return { ok: true, deleted: true };
}

// ---------------------------------------------------------------- batches

function batchesFor(productId, { onlyInStock = false } = {}) {
  const rows = db.get().prepare(`SELECT b.*, p.pack_size, p.pack_label, p.unit_label
    FROM batches b JOIN products p ON p.id = b.product_id
    WHERE b.product_id = ? ${onlyInStock ? 'AND b.qty_units > 0' : ''}
    ORDER BY b.expiry, b.batch_no`).all(Number(productId));
  const ref = today();
  return rows.map((b) => {
    const pack = Math.max(1, int(b.pack_size, 1));
    const end = expiryEndDate(b.expiry);
    return {
      ...b,
      pack_size: pack,
      qty_packs: Math.floor(b.qty_units / pack),
      qty_loose: b.qty_units % pack,
      expired: end ? end < ref : false,
      expiring_soon: end ? end >= ref && end <= addDays(ref, settings.num('expiry_alert_days', 90)) : false
    };
  });
}

function saveBatch(actor, payload) {
  auth.requireRole(actor, ['admin', 'pharmacist']);
  const productId = v.integer(payload.product_id, 'Medicine', { required: true, min: 1 });
  const product = db.get().prepare('SELECT * FROM products WHERE id = ?').get(productId);
  assert(product, 'Select a valid medicine first.');
  const batchNo = v.str(payload.batch_no, 'Batch number', { required: true, max: 40 }).toUpperCase();
  const expiry = v.expiry(payload.expiry, 'Expiry');
  const mrp = v.number(payload.mrp, 'MRP', { required: true, min: 0, max: 1000000 });
  const ratePerUnit = v.number(payload.rate_per_unit, 'Purchase rate per unit', { min: 0, max: 1000000 });
  const id = payload.id ? v.integer(payload.id, 'Batch', { min: 1 }) : null;
  const qtyUnits = v.integer(payload.qty_units, 'Quantity', { min: 0, max: 10000000, fallback: 0 });

  if (id) {
    const existing = db.get().prepare('SELECT * FROM batches WHERE id = ?').get(id);
    assert(existing, 'That batch no longer exists.');
    db.get().prepare(`UPDATE batches SET batch_no = ?, expiry = ?, mrp = ?, rate_per_unit = ? WHERE id = ?`)
      .run(batchNo, expiry, r2(mrp), r3(ratePerUnit), id);
    audit.log(actor, 'batch.update', 'batch', id, { product: product.name, batchNo });
    return batchesFor(productId).find((b) => b.id === id);
  }
  const info = db.get().prepare(`INSERT INTO batches (product_id, batch_no, expiry, mrp, rate_per_unit, qty_units, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(product_id, batch_no, expiry) DO UPDATE SET
      mrp = excluded.mrp, rate_per_unit = excluded.rate_per_unit, qty_units = batches.qty_units + excluded.qty_units`)
    .run(productId, batchNo, expiry, r2(mrp), r3(ratePerUnit), qtyUnits, nowStamp());
  audit.log(actor, 'batch.create', 'batch', info.lastInsertRowid, { product: product.name, batchNo, qtyUnits });
  return db.get().prepare('SELECT * FROM batches WHERE product_id = ? AND batch_no = ? AND expiry = ?')
    .get(productId, batchNo, expiry);
}

/**
 * Finds or creates the batch row for a purchase line. Used inside the
 * purchase transaction, so it never opens one of its own.
 */
function upsertBatch({ productId, batchNo, expiry, mrp, ratePerUnit }) {
  const conn = db.get();
  const existing = conn.prepare('SELECT * FROM batches WHERE product_id = ? AND batch_no = ? AND expiry = ?')
    .get(productId, batchNo, expiry);
  if (existing) {
    conn.prepare('UPDATE batches SET mrp = ?, rate_per_unit = ? WHERE id = ?')
      .run(r2(mrp), r3(ratePerUnit), existing.id);
    return existing.id;
  }
  const info = conn.prepare(`INSERT INTO batches (product_id, batch_no, expiry, mrp, rate_per_unit, qty_units, created_at)
    VALUES (?, ?, ?, ?, ?, 0, ?)`).run(productId, batchNo, expiry, r2(mrp), r3(ratePerUnit), nowStamp());
  return Number(info.lastInsertRowid);
}

/** Positive `delta` adds stock, negative removes it. Refuses to go below zero. */
function moveStock(batchId, delta, { allowNegative = false } = {}) {
  const conn = db.get();
  const batch = conn.prepare('SELECT b.*, p.name FROM batches b JOIN products p ON p.id = b.product_id WHERE b.id = ?').get(batchId);
  assert(batch, 'That batch no longer exists.');
  const next = int(batch.qty_units) + int(delta);
  assert(allowNegative || next >= 0,
    `Not enough stock for ${batch.name} (batch ${batch.batch_no}). Available: ${batch.qty_units}, needed: ${Math.abs(delta)}.`,
    'INSUFFICIENT_STOCK');
  conn.prepare('UPDATE batches SET qty_units = ? WHERE id = ?').run(next, batchId);
  return next;
}

function adjustStock(actor, payload) {
  auth.requireRole(actor, ['admin', 'pharmacist']);
  const batchId = v.integer(payload.batch_id, 'Batch', { required: true, min: 1 });
  const qty = v.integer(payload.qty_units, 'Quantity', { required: true, min: -10000000, max: 10000000 });
  assert(qty !== 0, 'Enter a quantity to add or remove.');
  const reason = v.str(payload.reason, 'Reason', { required: true, max: 160 });
  return db.tx(() => {
    const batch = db.get().prepare('SELECT * FROM batches WHERE id = ?').get(batchId);
    assert(batch, 'That batch no longer exists.');
    moveStock(batchId, qty);
    db.get().prepare(`INSERT INTO stock_adjustments (date, batch_id, product_id, qty_units, reason, created_at, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(today(), batchId, batch.product_id, qty, reason, nowStamp(), actor?.username ?? '');
    audit.log(actor, 'stock.adjust', 'batch', batchId, { qty, reason });
    return { ok: true, stock: byId(batch.product_id) };
  });
}

function deleteBatch(actor, { id }) {
  auth.requireRole(actor, ['admin', 'pharmacist']);
  const bid = v.integer(id, 'Batch', { required: true, min: 1 });
  const used = db.get().prepare(`SELECT
      (SELECT COUNT(*) FROM sale_items WHERE batch_id = ?) +
      (SELECT COUNT(*) FROM purchase_items WHERE batch_id = ?) AS n`).get(bid, bid).n;
  assert(used === 0, 'This batch appears on saved bills and cannot be deleted. Adjust its stock instead.');
  db.get().prepare('DELETE FROM batches WHERE id = ?').run(bid);
  audit.log(actor, 'batch.delete', 'batch', bid);
  return { ok: true };
}

/** First-expiry-first-out picking for the billing screen. */
function allocate(productId, unitsNeeded) {
  const batches = db.get().prepare(`SELECT * FROM batches WHERE product_id = ? AND qty_units > 0
    ORDER BY expiry, id`).all(Number(productId));
  const ref = today();
  const picks = [];
  let remaining = int(unitsNeeded);
  for (const b of batches) {
    if (remaining <= 0) break;
    const end = expiryEndDate(b.expiry);
    if (end && end < ref) continue; // never auto-pick expired stock
    const take = Math.min(remaining, b.qty_units);
    picks.push({ batch_id: b.id, batch_no: b.batch_no, expiry: b.expiry, mrp: b.mrp, rate_per_unit: b.rate_per_unit, qty_units: take });
    remaining -= take;
  }
  return { picks, shortfall: remaining };
}

function expiryReport({ withinDays = 90, includeExpired = true } = {}) {
  const limit = addDays(today(), Number(withinDays) || 90);
  const rows = db.get().prepare(`SELECT b.*, p.name, p.pack_size, p.pack_label, p.unit_label, p.manufacturer
    FROM batches b JOIN products p ON p.id = b.product_id
    WHERE b.qty_units > 0 ORDER BY b.expiry`).all();
  const ref = today();
  return rows
    .map((b) => {
      const end = expiryEndDate(b.expiry);
      return { ...b, end, value: r2(b.qty_units * b.rate_per_unit), expired: end < ref };
    })
    .filter((b) => (b.expired ? includeExpired : b.end <= limit));
}

function lowStockReport() {
  return list({ onlyActive: true, limit: 5000 })
    .filter((p) => p.stock_units === 0 || (p.reorder_level > 0 && p.stock_units <= p.reorder_level))
    .sort((a, b) => a.stock_units - b.stock_units);
}

module.exports = {
  CATEGORIES, SCHEDULES, list, byId, search, save, remove,
  batchesFor, saveBatch, upsertBatch, moveStock, adjustStock, deleteBatch,
  allocate, expiryReport, lowStockReport, decorate
};
