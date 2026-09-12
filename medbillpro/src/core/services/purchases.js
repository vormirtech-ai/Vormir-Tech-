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
const { r2, r3, lineTotals, roundOff } = require('../util/money');
const { nowStamp, today } = require('../util/dates');

function create(actor, payload) {
  auth.requireRole(actor, ['admin', 'pharmacist']);
  const date = v.date(payload.date, 'Purchase date', { required: false, fallback: 'today' }) || today();
  const refNo = v.str(payload.ref_no, 'Supplier bill number', { max: 60 });
  const interState = v.bool(payload.inter_state);
  const notes = v.str(payload.notes, 'Notes', { max: 300 });
  const mode = v.oneOf(payload.payment_mode, 'Payment mode', ledger.MODES, 'Credit');
  assert(Array.isArray(payload.items) && payload.items.length > 0, 'Add at least one item to the purchase.');
  assert(payload.items.length <= 300, 'A single purchase can hold up to 300 lines.');

  return db.tx(() => {
    const conn = db.get();
    const supplierId = v.integer(payload.supplier_id, 'Supplier', { required: true, min: 1 });
    const supplier = parties.supplierById(supplierId);
    assert(supplier, 'Select a valid supplier.');

    if (refNo) {
      const dup = conn.prepare('SELECT no FROM purchases WHERE supplier_id = ? AND ref_no = ?').get(supplierId, refNo);
      assert(!dup, `Bill ${refNo} from ${supplier.name} is already entered as ${dup?.no}.`);
    }

    const lines = [];
    for (const [index, raw] of payload.items.entries()) {
      const at = `Line ${index + 1}`;
      const productId = v.integer(raw.product_id, `${at}: medicine`, { required: true, min: 1 });
      const product = conn.prepare('SELECT * FROM products WHERE id = ?').get(productId);
      assert(product, `${at}: that medicine no longer exists.`);
      const batchNo = v.str(raw.batch_no, `${at}: batch number`, { required: true, max: 40 }).toUpperCase();
      const expiry = v.expiry(raw.expiry, `${at}: expiry`);
      const mrp = v.number(raw.mrp, `${at}: MRP`, { required: true, min: 0, max: 1000000 });
      const qty = v.integer(raw.qty_units, `${at}: quantity`, { required: true, min: 1, max: 10000000 });
      const free = v.integer(raw.free_units, `${at}: free quantity`, { min: 0, max: 10000000, fallback: 0 });
      const rate = v.number(raw.rate_per_unit, `${at}: purchase rate`, { required: true, min: 0, max: 1000000 });
      const discPct = v.number(raw.disc_pct, `${at}: discount %`, { min: 0, max: 100 });
      const gstRate = v.number(raw.gst_rate ?? product.gst_rate, `${at}: GST %`, { min: 0, max: 28 });
      const t = lineTotals({ qty, rate, discPct, gstRate, interState });
      // Free goods dilute the landed cost per unit, which is what stock is valued at.
      const landed = r3(qty + free > 0 ? t.taxable / (qty + free) : 0);
      lines.push({
        product_id: productId,
        name: product.name,
        batch_no: batchNo,
        expiry,
        mrp: r2(mrp),
        qty_units: qty,
        free_units: free,
        rate_per_unit: r3(rate),
        disc_pct: discPct,
        gst_rate: gstRate,
        taxable: t.taxable,
        gst_amount: t.gstAmount,
        total: t.total,
        landed_cost: landed
      });
    }

    const subtotal = r2(lines.reduce((s, l) => s + l.taxable, 0));
    const gstAmount = r2(lines.reduce((s, l) => s + l.gst_amount, 0));
    const discount = r2(lines.reduce((s, l) => s + (l.qty_units * l.rate_per_unit * l.disc_pct / 100), 0));
    const gross = r2(subtotal + gstAmount);
    const rounded = roundOff(gross);
    const total = rounded.total;
    const paid = r2(v.number(payload.paid, 'Amount paid', { min: 0, max: 1e9, fallback: 0 }));
    assert(paid <= total + 0.01, 'Amount paid cannot be more than the bill total.');

    const no = settings.nextNumber('purchase', 'purchase_prefix');
    const info = conn.prepare(`INSERT INTO purchases
      (no, date, supplier_id, ref_no, inter_state, subtotal, discount, gst_amount, round_off, total, paid, notes, created_at, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(no, date, supplierId, refNo, interState, subtotal, discount, gstAmount, rounded.roundOff,
        total, paid, notes, nowStamp(), actor?.username ?? '');
    const purchaseId = Number(info.lastInsertRowid);

    const insertItem = conn.prepare(`INSERT INTO purchase_items
      (purchase_id, product_id, batch_id, name, batch_no, expiry, mrp, qty_units, free_units,
       rate_per_unit, disc_pct, gst_rate, taxable, gst_amount, total)
      VALUES (@purchase_id, @product_id, @batch_id, @name, @batch_no, @expiry, @mrp, @qty_units,
              @free_units, @rate_per_unit, @disc_pct, @gst_rate, @taxable, @gst_amount, @total)`);

    for (const line of lines) {
      const batchId = products.upsertBatch({
        productId: line.product_id,
        batchNo: line.batch_no,
        expiry: line.expiry,
        mrp: line.mrp,
        ratePerUnit: line.landed_cost
      });
      insertItem.run({ ...line, batch_id: batchId, purchase_id: purchaseId });
      products.moveStock(batchId, line.qty_units + line.free_units);
    }

    if (paid > 0) {
      const payMode = mode === 'Credit' ? 'Cash' : mode;
      const account = ledger.accountForMode(payMode);
      conn.prepare(`INSERT INTO payments
        (date, party_type, party_id, party_name, direction, amount, mode, account, ref_no, purchase_id, notes, created_at, created_by)
        VALUES (?, 'supplier', ?, ?, 'out', ?, ?, ?, ?, ?, 'Against purchase', ?, ?)`)
        .run(date, supplierId, supplier.name, paid, payMode, account, refNo || no, purchaseId,
          nowStamp(), actor?.username ?? '');
      ledger.post({
        date, account, direction: 'out', amount: paid, sourceType: 'purchase', sourceId: purchaseId,
        description: `Purchase ${no} — ${supplier.name}`
      });
    }

    audit.log(actor, 'purchase.create', 'purchase', purchaseId, { no, total, items: lines.length });
    return byId(purchaseId);
  });
}

function byId(id) {
  const conn = db.get();
  const purchase = conn.prepare(`SELECT p.*, s.name AS supplier_name, s.gstin AS supplier_gstin,
      s.phone AS supplier_phone, s.dl_no AS supplier_dl
    FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id WHERE p.id = ?`).get(Number(id));
  if (!purchase) return null;
  const items = conn.prepare('SELECT * FROM purchase_items WHERE purchase_id = ? ORDER BY id').all(purchase.id);
  return { ...purchase, items, balance: r2(purchase.total - purchase.paid), store: settings.storeProfile() };
}

function list({ from, to, supplierId = null, search = '', unpaidOnly = false, limit = 300 } = {}) {
  const where = [];
  const args = [];
  if (from) { where.push('p.date >= ?'); args.push(from); }
  if (to) { where.push('p.date <= ?'); args.push(to); }
  if (supplierId) { where.push('p.supplier_id = ?'); args.push(Number(supplierId)); }
  if (unpaidOnly) where.push('p.total - p.paid > 0.01');
  if (search) {
    where.push('(p.no LIKE ? OR p.ref_no LIKE ? OR s.name LIKE ?)');
    const q = `%${search}%`;
    args.push(q, q, q);
  }
  const rows = db.get().prepare(`SELECT p.*, s.name AS supplier_name,
      (SELECT COUNT(*) FROM purchase_items pi WHERE pi.purchase_id = p.id) AS line_count
    FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY p.date DESC, p.id DESC LIMIT ?`).all(...args, Math.min(Number(limit) || 300, 5000));
  const totals = rows.reduce((a, r) => ({
    count: a.count + 1,
    total: r2(a.total + r.total),
    paid: r2(a.paid + r.paid),
    due: r2(a.due + (r.total - r.paid)),
    gst: r2(a.gst + r.gst_amount)
  }), { count: 0, total: 0, paid: 0, due: 0, gst: 0 });
  return { rows, totals };
}

function remove(actor, { id, reason = '' }) {
  auth.requireRole(actor, ['admin']);
  const purchaseId = v.integer(id, 'Purchase', { required: true, min: 1 });
  return db.tx(() => {
    const conn = db.get();
    const purchase = conn.prepare('SELECT * FROM purchases WHERE id = ?').get(purchaseId);
    assert(purchase, 'That purchase no longer exists.');
    const returned = conn.prepare('SELECT COUNT(*) AS n FROM purchase_returns WHERE purchase_id = ?').get(purchaseId).n;
    assert(returned === 0, 'This purchase has a return against it. Delete the return first.');
    const items = conn.prepare('SELECT * FROM purchase_items WHERE purchase_id = ?').all(purchaseId);
    for (const it of items) {
      if (!it.batch_id) continue;
      const batch = conn.prepare('SELECT * FROM batches WHERE id = ?').get(it.batch_id);
      const back = it.qty_units + it.free_units;
      assert(batch && batch.qty_units >= back,
        `${it.name} batch ${it.batch_no} has already been sold. Cannot delete this purchase — raise a purchase return instead.`,
        'STOCK_CONSUMED');
      products.moveStock(it.batch_id, -back);
    }
    ledger.reverseSource('purchase', purchaseId);
    conn.prepare('DELETE FROM payments WHERE purchase_id = ?').run(purchaseId);
    conn.prepare('DELETE FROM purchase_items WHERE purchase_id = ?').run(purchaseId);
    conn.prepare('DELETE FROM purchases WHERE id = ?').run(purchaseId);
    audit.log(actor, 'purchase.delete', 'purchase', purchaseId, { no: purchase.no, reason });
    return { ok: true };
  });
}

/** Records a payment against a supplier bill. */
function pay(actor, { id, amount, mode = 'Cash', date = null }) {
  auth.requireRole(actor, ['admin', 'pharmacist']);
  const purchaseId = v.integer(id, 'Purchase', { required: true, min: 1 });
  const value = r2(v.number(amount, 'Amount', { required: true, min: 0.01, max: 1e9 }));
  const payMode = v.oneOf(mode, 'Payment mode', ledger.MODES.filter((m) => m !== 'Credit'), 'Cash');
  const when = v.date(date, 'Date', { required: false, fallback: 'today' }) || today();
  return db.tx(() => {
    const conn = db.get();
    const purchase = conn.prepare('SELECT * FROM purchases WHERE id = ?').get(purchaseId);
    assert(purchase, 'That purchase no longer exists.');
    const due = r2(purchase.total - purchase.paid);
    assert(due > 0, 'This purchase is already fully paid.');
    assert(value <= due + 0.01, `The outstanding amount on this bill is only ₹${due.toFixed(2)}.`);
    const supplier = parties.supplierById(purchase.supplier_id);
    conn.prepare('UPDATE purchases SET paid = ? WHERE id = ?').run(r2(purchase.paid + value), purchaseId);
    const account = ledger.accountForMode(payMode);
    conn.prepare(`INSERT INTO payments
      (date, party_type, party_id, party_name, direction, amount, mode, account, ref_no, purchase_id, notes, created_at, created_by)
      VALUES (?, 'supplier', ?, ?, 'out', ?, ?, ?, ?, ?, 'Bill payment', ?, ?)`)
      .run(when, purchase.supplier_id, supplier?.name ?? '', value, payMode, account,
        purchase.ref_no || purchase.no, purchaseId, nowStamp(), actor?.username ?? '');
    ledger.post({
      date: when, account, direction: 'out', amount: value, sourceType: 'purchase', sourceId: purchaseId,
      description: `Payment for purchase ${purchase.no}`
    });
    audit.log(actor, 'purchase.pay', 'purchase', purchaseId, { amount: value, mode: payMode });
    return byId(purchaseId);
  });
}

/** Last purchase price / MRP for a medicine, prefilled during purchase entry. */
function lastRate(productId) {
  return db.get().prepare(`SELECT pi.rate_per_unit, pi.mrp, pi.disc_pct, pi.gst_rate, p.date
    FROM purchase_items pi JOIN purchases p ON p.id = pi.purchase_id
    WHERE pi.product_id = ? ORDER BY p.date DESC, pi.id DESC LIMIT 1`).get(Number(productId)) ?? null;
}

module.exports = { create, byId, list, remove, pay, lastRate };
