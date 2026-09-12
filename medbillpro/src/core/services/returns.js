'use strict';

const db = require('../db');
const audit = require('./audit');
const auth = require('./auth');
const settings = require('./settings');
const ledger = require('./ledger');
const parties = require('./parties');
const products = require('./products');
const v = require('../util/validate');
const { assert } = require('../util/errors');
const { r2, r3, splitGst } = require('../util/money');
const { nowStamp, today } = require('../util/dates');

// --------------------------------------------------------- sales returns

/** Lines of a bill with the quantity still available to return. */
function returnableSale({ id = null, no = null }) {
  const conn = db.get();
  const sale = id
    ? conn.prepare('SELECT * FROM sales WHERE id = ?').get(Number(id))
    : conn.prepare('SELECT * FROM sales WHERE no = ?').get(String(no));
  assert(sale, 'That bill could not be found.');
  const items = conn.prepare(`SELECT si.*, p.pack_size, p.pack_label, p.unit_label
    FROM sale_items si LEFT JOIN products p ON p.id = si.product_id
    WHERE si.sale_id = ? ORDER BY si.id`).all(sale.id);
  const customer = sale.customer_id ? parties.customerById(sale.customer_id) : null;
  return {
    sale,
    customer,
    items: items.map((it) => ({ ...it, returnable_units: it.qty_units - it.returned_units }))
  };
}

function createSaleReturn(actor, payload) {
  auth.requireRole(actor, ['admin', 'pharmacist']);
  const date = v.date(payload.date, 'Return date', { required: false, fallback: 'today' }) || today();
  const refundMode = v.oneOf(payload.refund_mode, 'Refund mode', ['Cash', 'UPI', 'Bank Transfer', 'Adjust in balance'], 'Cash');
  const notes = v.str(payload.notes, 'Reason / notes', { max: 300 });
  assert(Array.isArray(payload.items) && payload.items.length > 0, 'Select at least one item to return.');

  return db.tx(() => {
    const conn = db.get();
    const saleId = v.integer(payload.sale_id, 'Bill', { required: true, min: 1 });
    const sale = conn.prepare('SELECT * FROM sales WHERE id = ?').get(saleId);
    assert(sale, 'That bill no longer exists.');

    const lines = [];
    for (const [index, raw] of payload.items.entries()) {
      const at = `Line ${index + 1}`;
      const saleItemId = v.integer(raw.sale_item_id, `${at}: bill line`, { required: true, min: 1 });
      const item = conn.prepare('SELECT * FROM sale_items WHERE id = ? AND sale_id = ?').get(saleItemId, saleId);
      assert(item, `${at}: that line is not part of bill ${sale.no}.`);
      const qty = v.integer(raw.qty_units, `${at}: quantity`, { required: true, min: 1, max: 10000000 });
      const available = item.qty_units - item.returned_units;
      assert(qty <= available, `${at}: only ${available} of ${item.name} can still be returned.`);
      const restock = raw.restock === undefined ? 1 : v.bool(raw.restock);
      // Return value mirrors the original line, including the discount given.
      const perUnitTaxable = r3(item.qty_units > 0 ? item.taxable / item.qty_units : 0);
      const taxable = r2(perUnitTaxable * qty);
      const gst = splitGst(taxable, item.gst_rate, !!sale.inter_state);
      lines.push({
        sale_item_id: saleItemId,
        product_id: item.product_id,
        batch_id: item.batch_id,
        name: item.name,
        batch_no: item.batch_no,
        expiry: item.expiry,
        qty_units: qty,
        rate_per_unit: item.rate_per_unit,
        gst_rate: item.gst_rate,
        taxable,
        gst_amount: gst.total,
        total: r2(taxable + gst.total),
        restock
      });
    }

    const subtotal = r2(lines.reduce((s, l) => s + l.taxable, 0));
    const gstAmount = r2(lines.reduce((s, l) => s + l.gst_amount, 0));
    const total = r2(subtotal + gstAmount);
    assert(total > 0, 'The return value works out to zero — nothing to record.');

    const no = settings.nextNumber('sale_return', 'sale_return_prefix');
    const info = conn.prepare(`INSERT INTO sale_returns
      (no, date, sale_id, customer_id, subtotal, gst_amount, total, refund_mode, notes, created_at, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(no, date, saleId, sale.customer_id, subtotal, gstAmount, total, refundMode, notes,
        nowStamp(), actor?.username ?? '');
    const returnId = Number(info.lastInsertRowid);

    const insertItem = conn.prepare(`INSERT INTO sale_return_items
      (return_id, sale_item_id, product_id, batch_id, name, batch_no, expiry, qty_units,
       rate_per_unit, gst_rate, taxable, gst_amount, total, restock)
      VALUES (@return_id, @sale_item_id, @product_id, @batch_id, @name, @batch_no, @expiry, @qty_units,
              @rate_per_unit, @gst_rate, @taxable, @gst_amount, @total, @restock)`);
    for (const line of lines) {
      insertItem.run({ ...line, return_id: returnId });
      conn.prepare('UPDATE sale_items SET returned_units = returned_units + ? WHERE id = ?')
        .run(line.qty_units, line.sale_item_id);
      if (line.restock && line.batch_id) products.moveStock(line.batch_id, line.qty_units);
    }

    if (refundMode !== 'Adjust in balance') {
      const account = ledger.accountForMode(refundMode);
      conn.prepare(`INSERT INTO payments
        (date, party_type, party_id, party_name, direction, amount, mode, account, ref_no, sale_id, notes, created_at, created_by)
        VALUES (?, 'customer', ?, ?, 'out', ?, ?, ?, ?, ?, 'Sales return refund', ?, ?)`)
        .run(date, sale.customer_id, sale.patient_name || '', total, refundMode, account, no, saleId,
          nowStamp(), actor?.username ?? '');
      ledger.post({
        date, account, direction: 'out', amount: total, sourceType: 'sale_return', sourceId: returnId,
        description: `Refund on return ${no} (bill ${sale.no})`
      });
    }

    audit.log(actor, 'sale_return.create', 'sale_return', returnId, { no, total });
    return saleReturnById(returnId);
  });
}

function saleReturnById(id) {
  const conn = db.get();
  const row = conn.prepare(`SELECT r.*, s.no AS sale_no, c.name AS customer_name, c.phone AS customer_phone
    FROM sale_returns r LEFT JOIN sales s ON s.id = r.sale_id
    LEFT JOIN customers c ON c.id = r.customer_id WHERE r.id = ?`).get(Number(id));
  if (!row) return null;
  return {
    ...row,
    items: conn.prepare('SELECT * FROM sale_return_items WHERE return_id = ? ORDER BY id').all(row.id),
    store: settings.storeProfile()
  };
}

function listSaleReturns({ from, to, search = '', limit = 300 } = {}) {
  const where = [];
  const args = [];
  if (from) { where.push('r.date >= ?'); args.push(from); }
  if (to) { where.push('r.date <= ?'); args.push(to); }
  if (search) { where.push('(r.no LIKE ? OR s.no LIKE ? OR c.name LIKE ?)'); args.push(`%${search}%`, `%${search}%`, `%${search}%`); }
  const rows = db.get().prepare(`SELECT r.*, s.no AS sale_no, c.name AS customer_name
    FROM sale_returns r LEFT JOIN sales s ON s.id = r.sale_id LEFT JOIN customers c ON c.id = r.customer_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY r.date DESC, r.id DESC LIMIT ?`).all(...args, Math.min(Number(limit) || 300, 5000));
  return { rows, totals: { count: rows.length, total: r2(rows.reduce((s, r) => s + r.total, 0)) } };
}

function removeSaleReturn(actor, { id }) {
  auth.requireRole(actor, ['admin']);
  const rid = v.integer(id, 'Return', { required: true, min: 1 });
  return db.tx(() => {
    const conn = db.get();
    const row = conn.prepare('SELECT * FROM sale_returns WHERE id = ?').get(rid);
    assert(row, 'That return no longer exists.');
    const items = conn.prepare('SELECT * FROM sale_return_items WHERE return_id = ?').all(rid);
    for (const it of items) {
      if (it.restock && it.batch_id) products.moveStock(it.batch_id, -it.qty_units, { allowNegative: true });
      if (it.sale_item_id) {
        conn.prepare('UPDATE sale_items SET returned_units = MAX(0, returned_units - ?) WHERE id = ?')
          .run(it.qty_units, it.sale_item_id);
      }
    }
    ledger.reverseSource('sale_return', rid);
    conn.prepare("DELETE FROM payments WHERE sale_id = ? AND notes = 'Sales return refund' AND ref_no = ?")
      .run(row.sale_id, row.no);
    conn.prepare('DELETE FROM sale_return_items WHERE return_id = ?').run(rid);
    conn.prepare('DELETE FROM sale_returns WHERE id = ?').run(rid);
    audit.log(actor, 'sale_return.delete', 'sale_return', rid, row);
    return { ok: true };
  });
}

// ------------------------------------------------------ purchase returns

function createPurchaseReturn(actor, payload) {
  auth.requireRole(actor, ['admin', 'pharmacist']);
  const date = v.date(payload.date, 'Return date', { required: false, fallback: 'today' }) || today();
  const reason = v.str(payload.reason, 'Reason', { max: 120 });
  const notes = v.str(payload.notes, 'Notes', { max: 300 });
  assert(Array.isArray(payload.items) && payload.items.length > 0, 'Select at least one item to return.');

  return db.tx(() => {
    const conn = db.get();
    const supplierId = v.integer(payload.supplier_id, 'Supplier', { required: true, min: 1 });
    const supplier = parties.supplierById(supplierId);
    assert(supplier, 'Select a valid supplier.');
    const purchaseId = payload.purchase_id ? v.integer(payload.purchase_id, 'Purchase', { min: 1 }) : null;

    const lines = [];
    for (const [index, raw] of payload.items.entries()) {
      const at = `Line ${index + 1}`;
      const batchId = v.integer(raw.batch_id, `${at}: batch`, { required: true, min: 1 });
      const batch = conn.prepare('SELECT b.*, p.name, p.gst_rate FROM batches b JOIN products p ON p.id = b.product_id WHERE b.id = ?').get(batchId);
      assert(batch, `${at}: that batch no longer exists.`);
      const qty = v.integer(raw.qty_units, `${at}: quantity`, { required: true, min: 1, max: 10000000 });
      assert(qty <= batch.qty_units, `${at}: only ${batch.qty_units} units of ${batch.name} (batch ${batch.batch_no}) are in stock.`);
      const rate = v.number(raw.rate_per_unit ?? batch.rate_per_unit, `${at}: rate`, { min: 0, max: 1000000 });
      const gstRate = v.number(raw.gst_rate ?? batch.gst_rate, `${at}: GST %`, { min: 0, max: 28 });
      const taxable = r2(rate * qty);
      const gst = splitGst(taxable, gstRate, false);
      lines.push({
        product_id: batch.product_id,
        batch_id: batchId,
        name: batch.name,
        batch_no: batch.batch_no,
        expiry: batch.expiry,
        qty_units: qty,
        rate_per_unit: r3(rate),
        gst_rate: gstRate,
        taxable,
        gst_amount: gst.total,
        total: r2(taxable + gst.total)
      });
    }

    const subtotal = r2(lines.reduce((s, l) => s + l.taxable, 0));
    const gstAmount = r2(lines.reduce((s, l) => s + l.gst_amount, 0));
    const total = r2(subtotal + gstAmount);
    const no = settings.nextNumber('purchase_return', 'purchase_return_prefix');
    const info = conn.prepare(`INSERT INTO purchase_returns
      (no, date, purchase_id, supplier_id, subtotal, gst_amount, total, reason, notes, created_at, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(no, date, purchaseId, supplierId, subtotal, gstAmount, total, reason, notes,
        nowStamp(), actor?.username ?? '');
    const returnId = Number(info.lastInsertRowid);
    const insertItem = conn.prepare(`INSERT INTO purchase_return_items
      (return_id, product_id, batch_id, name, batch_no, expiry, qty_units, rate_per_unit, gst_rate, taxable, gst_amount, total)
      VALUES (@return_id, @product_id, @batch_id, @name, @batch_no, @expiry, @qty_units, @rate_per_unit,
              @gst_rate, @taxable, @gst_amount, @total)`);
    for (const line of lines) {
      insertItem.run({ ...line, return_id: returnId });
      products.moveStock(line.batch_id, -line.qty_units);
    }
    audit.log(actor, 'purchase_return.create', 'purchase_return', returnId, { no, total });
    return purchaseReturnById(returnId);
  });
}

function purchaseReturnById(id) {
  const conn = db.get();
  const row = conn.prepare(`SELECT r.*, s.name AS supplier_name, p.no AS purchase_no
    FROM purchase_returns r LEFT JOIN suppliers s ON s.id = r.supplier_id
    LEFT JOIN purchases p ON p.id = r.purchase_id WHERE r.id = ?`).get(Number(id));
  if (!row) return null;
  return {
    ...row,
    items: conn.prepare('SELECT * FROM purchase_return_items WHERE return_id = ? ORDER BY id').all(row.id),
    store: settings.storeProfile()
  };
}

function listPurchaseReturns({ from, to, limit = 300 } = {}) {
  const where = [];
  const args = [];
  if (from) { where.push('r.date >= ?'); args.push(from); }
  if (to) { where.push('r.date <= ?'); args.push(to); }
  const rows = db.get().prepare(`SELECT r.*, s.name AS supplier_name, p.no AS purchase_no
    FROM purchase_returns r LEFT JOIN suppliers s ON s.id = r.supplier_id
    LEFT JOIN purchases p ON p.id = r.purchase_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY r.date DESC, r.id DESC LIMIT ?`).all(...args, Math.min(Number(limit) || 300, 5000));
  return { rows, totals: { count: rows.length, total: r2(rows.reduce((s, r) => s + r.total, 0)) } };
}

function removePurchaseReturn(actor, { id }) {
  auth.requireRole(actor, ['admin']);
  const rid = v.integer(id, 'Return', { required: true, min: 1 });
  return db.tx(() => {
    const conn = db.get();
    const row = conn.prepare('SELECT * FROM purchase_returns WHERE id = ?').get(rid);
    assert(row, 'That return no longer exists.');
    for (const it of conn.prepare('SELECT * FROM purchase_return_items WHERE return_id = ?').all(rid)) {
      if (it.batch_id) products.moveStock(it.batch_id, it.qty_units);
    }
    conn.prepare('DELETE FROM purchase_return_items WHERE return_id = ?').run(rid);
    conn.prepare('DELETE FROM purchase_returns WHERE id = ?').run(rid);
    audit.log(actor, 'purchase_return.delete', 'purchase_return', rid, row);
    return { ok: true };
  });
}

module.exports = {
  returnableSale, createSaleReturn, saleReturnById, listSaleReturns, removeSaleReturn,
  createPurchaseReturn, purchaseReturnById, listPurchaseReturns, removePurchaseReturn
};
