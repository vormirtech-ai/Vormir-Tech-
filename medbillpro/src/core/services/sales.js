'use strict';

const db = require('../db');
const audit = require('./audit');
const auth = require('./auth');
const settings = require('./settings');
const ledger = require('./ledger');
const parties = require('./parties');
const products = require('./products');
const v = require('../util/validate');
const { assert, fail } = require('../util/errors');
const { r2, r3, int, num, lineTotals, splitGst, roundOff } = require('../util/money');
const { nowStamp, today, isExpired, addDays } = require('../util/dates');

const PAYMENT_MODES = ['Cash', 'UPI', 'Card', 'Cheque', 'Bank Transfer', 'Credit'];

function prepareLines(rawItems, { interState, gstInclusive }) {
  assert(Array.isArray(rawItems) && rawItems.length > 0, 'Add at least one medicine to the bill.');
  assert(rawItems.length <= 200, 'A single bill can hold up to 200 lines.');
  const conn = db.get();
  const lines = [];
  for (const [index, raw] of rawItems.entries()) {
    const at = `Line ${index + 1}`;
    const productId = v.integer(raw.product_id, `${at}: medicine`, { required: true, min: 1 });
    const product = conn.prepare('SELECT * FROM products WHERE id = ?').get(productId);
    assert(product, `${at}: that medicine no longer exists.`);
    const batchId = v.integer(raw.batch_id, `${at}: batch`, { required: true, min: 1 });
    const batch = conn.prepare('SELECT * FROM batches WHERE id = ?').get(batchId);
    assert(batch, `${at}: select a batch for ${product.name}.`);
    assert(batch.product_id === productId, `${at}: that batch does not belong to ${product.name}.`);
    assert(!isExpired(batch.expiry), `${at}: batch ${batch.batch_no} of ${product.name} has expired (${batch.expiry}).`);
    const qty = v.integer(raw.qty_units, `${at}: quantity`, { required: true, min: 1, max: 1000000 });
    if (!product.allow_loose && product.pack_size > 1) {
      assert(qty % product.pack_size === 0,
        `${at}: ${product.name} cannot be sold loose — enter quantity in multiples of ${product.pack_size}.`);
    }
    const rate = v.number(raw.rate_per_unit, `${at}: rate`, { required: true, min: 0, max: 1000000 });
    const discPct = v.number(raw.disc_pct, `${at}: discount %`, { min: 0, max: 100 });
    const gstRate = v.number(raw.gst_rate ?? product.gst_rate, `${at}: GST %`, { min: 0, max: 28 });
    const t = lineTotals({ qty, rate, discPct, gstRate, interState, gstInclusive });
    lines.push({
      product_id: productId,
      batch_id: batchId,
      name: product.name,
      hsn: product.hsn,
      batch_no: batch.batch_no,
      expiry: batch.expiry,
      mrp: batch.mrp,
      qty_units: qty,
      rate_per_unit: r3(rate),
      disc_pct: discPct,
      gst_rate: gstRate,
      taxable: t.taxable,
      cgst: t.cgst,
      sgst: t.sgst,
      igst: t.igst,
      total: t.total,
      cost_per_unit: r3(batch.rate_per_unit),
      pack_size: product.pack_size,
      pack_label: product.pack_label,
      unit_label: product.unit_label
    });
  }
  return lines;
}

/**
 * Spreads a bill-level discount across lines in proportion to their taxable
 * value, then recomputes GST so the tax always matches the amount charged.
 */
function applyBillDiscount(lines, billDiscount, interState) {
  const discount = r2(billDiscount);
  const base = r2(lines.reduce((s, l) => s + l.taxable, 0));
  if (discount <= 0 || base <= 0) return { lines, applied: 0 };
  assert(discount <= base, 'The bill discount cannot be more than the bill value.');
  let allocated = 0;
  lines.forEach((line, i) => {
    const share = i === lines.length - 1
      ? r2(discount - allocated)
      : r2(discount * line.taxable / base);
    allocated = r2(allocated + share);
    const taxable = r2(line.taxable - share);
    const gst = splitGst(taxable, line.gst_rate, interState);
    line.bill_disc = share;
    line.taxable = taxable;
    line.cgst = gst.cgst;
    line.sgst = gst.sgst;
    line.igst = gst.igst;
    line.total = r2(taxable + gst.total);
  });
  return { lines, applied: discount };
}

function create(actor, payload) {
  auth.requireRole(actor, ['admin', 'pharmacist', 'cashier']);
  const date = v.date(payload.date, 'Bill date', { required: false, fallback: 'today' }) || today();
  const interState = v.bool(payload.inter_state);
  const gstInclusive = payload.price_includes_gst === undefined
    ? settings.flag('price_includes_gst')
    : Boolean(payload.price_includes_gst);
  const paymentMode = v.oneOf(payload.payment_mode, 'Payment mode', PAYMENT_MODES, 'Cash');
  const notes = v.str(payload.notes, 'Notes', { max: 300 });
  const patientName = v.str(payload.patient_name, 'Patient name', { max: 120 });
  const patientPhone = v.phone(payload.patient_phone, 'Patient phone');
  const rxNo = v.str(payload.rx_no, 'Prescription number', { max: 40 });
  const reminderDays = v.integer(payload.reminder_days, 'Refill reminder (days)', { min: 0, max: 365, fallback: 0 });

  return db.tx(() => {
    const conn = db.get();
    let customerId = payload.customer_id ? v.integer(payload.customer_id, 'Customer', { min: 1 }) : null;
    if (!customerId && payload.new_customer && String(payload.new_customer.name || '').trim()) {
      customerId = parties.saveCustomer(actor, payload.new_customer).id;
    }
    const customer = customerId ? parties.customerById(customerId) : null;
    assert(!customerId || customer, 'That customer no longer exists.');

    const doctorId = payload.doctor_id ? v.integer(payload.doctor_id, 'Doctor', { min: 1 }) : null;
    const doctor = doctorId ? conn.prepare('SELECT * FROM doctors WHERE id = ?').get(doctorId) : null;
    assert(!doctorId || doctor, 'That doctor no longer exists.');

    const lines = prepareLines(payload.items, { interState, gstInclusive });
    const billDiscount = r2(v.number(payload.bill_discount, 'Bill discount', { min: 0, max: 1e9 }));
    applyBillDiscount(lines, billDiscount, interState);

    const subtotal = r2(lines.reduce((s, l) => s + l.taxable, 0));
    const gstAmount = r2(lines.reduce((s, l) => s + l.cgst + l.sgst + l.igst, 0));
    const lineDiscount = r2(lines.reduce((s, l) => s + (l.qty_units * l.rate_per_unit * l.disc_pct / 100), 0));
    const gross = r2(subtotal + gstAmount);
    const rounded = settings.flag('round_off_invoice') ? roundOff(gross) : { total: gross, roundOff: 0 };
    const total = rounded.total;
    const costTotal = r2(lines.reduce((s, l) => s + l.qty_units * l.cost_per_unit, 0));

    let paid = r2(v.number(payload.paid, 'Amount paid', { min: 0, max: 1e9, fallback: paymentMode === 'Credit' ? 0 : total }));
    if (paymentMode === 'Credit') {
      assert(customerId, 'A credit bill needs a customer so the balance can be tracked.');
      paid = 0;
    }
    assert(paid <= total + 0.01, 'Amount paid cannot be more than the bill total.');
    if (paid < total) assert(customerId, 'A partly paid bill needs a customer so the balance can be tracked.');

    const no = settings.nextNumber('invoice', 'invoice_prefix');
    const info = conn.prepare(`INSERT INTO sales
      (no, date, customer_id, doctor_id, patient_name, patient_phone, rx_no, inter_state, subtotal,
       discount, gst_amount, round_off, total, paid, payment_mode, cost_total, notes, created_at, created_by)
      VALUES (@no, @date, @customer_id, @doctor_id, @patient_name, @patient_phone, @rx_no, @inter_state,
              @subtotal, @discount, @gst_amount, @round_off, @total, @paid, @payment_mode, @cost_total,
              @notes, @created_at, @created_by)`)
      .run({
        no,
        date,
        customer_id: customerId,
        doctor_id: doctorId,
        patient_name: patientName || customer?.name || '',
        patient_phone: patientPhone || customer?.phone || '',
        rx_no: rxNo,
        inter_state: interState,
        subtotal,
        discount: r2(lineDiscount + billDiscount),
        gst_amount: gstAmount,
        round_off: rounded.roundOff,
        total,
        paid,
        payment_mode: paymentMode,
        cost_total: costTotal,
        notes,
        created_at: nowStamp(),
        created_by: actor?.username ?? ''
      });
    const saleId = Number(info.lastInsertRowid);

    const insertItem = conn.prepare(`INSERT INTO sale_items
      (sale_id, product_id, batch_id, name, batch_no, expiry, hsn, mrp, qty_units, rate_per_unit,
       disc_pct, gst_rate, taxable, cgst, sgst, igst, total, cost_per_unit)
      VALUES (@sale_id, @product_id, @batch_id, @name, @batch_no, @expiry, @hsn, @mrp, @qty_units,
              @rate_per_unit, @disc_pct, @gst_rate, @taxable, @cgst, @sgst, @igst, @total, @cost_per_unit)`);
    for (const line of lines) {
      insertItem.run({ ...line, sale_id: saleId });
      products.moveStock(line.batch_id, -line.qty_units);
    }

    if (paid > 0) {
      const account = ledger.accountForMode(paymentMode);
      const payInfo = conn.prepare(`INSERT INTO payments
        (date, party_type, party_id, party_name, direction, amount, mode, account, ref_no, sale_id, notes, created_at, created_by)
        VALUES (?, 'customer', ?, ?, 'in', ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(date, customerId, customer?.name ?? (patientName || 'Walk-in'), paid, paymentMode, account,
          no, saleId, 'Against bill', nowStamp(), actor?.username ?? '');
      ledger.post({
        date, account, direction: 'in', amount: paid, sourceType: 'sale', sourceId: saleId,
        description: `Bill ${no}${customer ? ` — ${customer.name}` : ''}`
      });
      void payInfo;
    }

    if (doctor && doctor.commission_pct > 0) {
      const commission = r2(subtotal * doctor.commission_pct / 100);
      if (commission > 0) {
        conn.prepare(`INSERT INTO doctor_commissions (date, doctor_id, sale_id, base_amount, pct, amount, paid, created_at)
          VALUES (?, ?, ?, ?, ?, ?, 0, ?)`)
          .run(date, doctor.id, saleId, subtotal, doctor.commission_pct, commission, nowStamp());
      }
    }

    if (reminderDays > 0 && customerId) {
      conn.prepare(`INSERT INTO rx_reminders (customer_id, sale_id, due_date, medicines, note, status, created_at)
        VALUES (?, ?, ?, ?, ?, 'pending', ?)`)
        .run(customerId, saleId, addDays(date, reminderDays),
          lines.map((l) => l.name).slice(0, 6).join(', '), 'Refill reminder', nowStamp());
    }

    audit.log(actor, 'sale.create', 'sale', saleId, { no, total, items: lines.length });
    return byId(saleId);
  });
}

function byId(id) {
  const conn = db.get();
  const sale = conn.prepare(`SELECT s.*, c.name AS customer_name, c.phone AS customer_phone,
      c.address AS customer_address, c.gstin AS customer_gstin,
      d.name AS doctor_name, d.reg_no AS doctor_reg
    FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
    LEFT JOIN doctors d ON d.id = s.doctor_id WHERE s.id = ?`).get(Number(id));
  if (!sale) return null;
  const items = conn.prepare(`SELECT si.*, p.pack_size, p.pack_label, p.unit_label
    FROM sale_items si LEFT JOIN products p ON p.id = si.product_id
    WHERE si.sale_id = ? ORDER BY si.id`).all(sale.id);
  const gstSummary = {};
  for (const it of items) {
    const key = String(it.gst_rate);
    const g = gstSummary[key] || { rate: it.gst_rate, taxable: 0, cgst: 0, sgst: 0, igst: 0 };
    g.taxable = r2(g.taxable + it.taxable);
    g.cgst = r2(g.cgst + it.cgst);
    g.sgst = r2(g.sgst + it.sgst);
    g.igst = r2(g.igst + it.igst);
    gstSummary[key] = g;
  }
  return {
    ...sale,
    items,
    gst_summary: Object.values(gstSummary).sort((a, b) => a.rate - b.rate),
    balance: r2(sale.total - sale.paid),
    store: settings.storeProfile()
  };
}

function byNumber(no) {
  const row = db.get().prepare('SELECT id FROM sales WHERE no = ?').get(String(no));
  return row ? byId(row.id) : null;
}

function list({ from, to, customerId = null, search = '', paymentMode = '', unpaidOnly = false, limit = 300 } = {}) {
  const where = [];
  const args = [];
  if (from) { where.push('s.date >= ?'); args.push(from); }
  if (to) { where.push('s.date <= ?'); args.push(to); }
  if (customerId) { where.push('s.customer_id = ?'); args.push(Number(customerId)); }
  if (paymentMode) { where.push('s.payment_mode = ?'); args.push(paymentMode); }
  if (unpaidOnly) where.push('s.total - s.paid > 0.01');
  if (search) {
    where.push('(s.no LIKE ? OR s.patient_name LIKE ? OR c.name LIKE ? OR s.rx_no LIKE ?)');
    const q = `%${search}%`;
    args.push(q, q, q, q);
  }
  const rows = db.get().prepare(`SELECT s.*, c.name AS customer_name, d.name AS doctor_name,
      (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id = s.id) AS line_count
    FROM sales s LEFT JOIN customers c ON c.id = s.customer_id LEFT JOIN doctors d ON d.id = s.doctor_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY s.date DESC, s.id DESC LIMIT ?`).all(...args, Math.min(Number(limit) || 300, 5000));
  const totals = rows.reduce((a, r) => ({
    count: a.count + 1,
    total: r2(a.total + r.total),
    paid: r2(a.paid + r.paid),
    due: r2(a.due + (r.total - r.paid)),
    gst: r2(a.gst + r.gst_amount),
    profit: r2(a.profit + (r.subtotal - r.cost_total))
  }), { count: 0, total: 0, paid: 0, due: 0, gst: 0, profit: 0 });
  return { rows, totals };
}

/** Deleting a bill restores stock and removes its money trail, atomically. */
function remove(actor, { id, reason = '' }) {
  auth.requireRole(actor, ['admin']);
  const saleId = v.integer(id, 'Bill', { required: true, min: 1 });
  return db.tx(() => {
    const conn = db.get();
    const sale = conn.prepare('SELECT * FROM sales WHERE id = ?').get(saleId);
    assert(sale, 'That bill no longer exists.');
    const returned = conn.prepare('SELECT COUNT(*) AS n FROM sale_returns WHERE sale_id = ?').get(saleId).n;
    assert(returned === 0, 'This bill has a sales return against it. Delete the return first.');
    const items = conn.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(saleId);
    for (const it of items) {
      if (it.batch_id) products.moveStock(it.batch_id, it.qty_units, { allowNegative: true });
    }
    ledger.reverseSource('sale', saleId);
    conn.prepare('DELETE FROM payments WHERE sale_id = ?').run(saleId);
    conn.prepare('DELETE FROM doctor_commissions WHERE sale_id = ?').run(saleId);
    conn.prepare('DELETE FROM rx_reminders WHERE sale_id = ?').run(saleId);
    conn.prepare('DELETE FROM sale_items WHERE sale_id = ?').run(saleId);
    conn.prepare('DELETE FROM sales WHERE id = ?').run(saleId);
    audit.log(actor, 'sale.delete', 'sale', saleId, { no: sale.no, total: sale.total, reason });
    return { ok: true };
  });
}

/** Adds a receipt against an existing credit bill. */
function collect(actor, { id, amount, mode = 'Cash', date = null }) {
  auth.requireRole(actor, ['admin', 'pharmacist', 'cashier']);
  const saleId = v.integer(id, 'Bill', { required: true, min: 1 });
  const value = r2(v.number(amount, 'Amount', { required: true, min: 0.01, max: 1e9 }));
  const payMode = v.oneOf(mode, 'Payment mode', PAYMENT_MODES.filter((m) => m !== 'Credit'), 'Cash');
  const when = v.date(date, 'Date', { required: false, fallback: 'today' }) || today();
  return db.tx(() => {
    const conn = db.get();
    const sale = conn.prepare('SELECT * FROM sales WHERE id = ?').get(saleId);
    assert(sale, 'That bill no longer exists.');
    const due = r2(sale.total - sale.paid);
    assert(due > 0, 'This bill is already fully paid.');
    assert(value <= due + 0.01, `The outstanding amount on this bill is only ₹${due.toFixed(2)}.`);
    conn.prepare('UPDATE sales SET paid = ? WHERE id = ?').run(r2(sale.paid + value), saleId);
    const account = ledger.accountForMode(payMode);
    conn.prepare(`INSERT INTO payments
      (date, party_type, party_id, party_name, direction, amount, mode, account, ref_no, sale_id, notes, created_at, created_by)
      VALUES (?, 'customer', ?, ?, 'in', ?, ?, ?, ?, ?, 'Bill collection', ?, ?)`)
      .run(when, sale.customer_id, sale.patient_name || '', value, payMode, account, sale.no, saleId,
        nowStamp(), actor?.username ?? '');
    ledger.post({
      date: when, account, direction: 'in', amount: value, sourceType: 'sale', sourceId: saleId,
      description: `Collection against bill ${sale.no}`
    });
    audit.log(actor, 'sale.collect', 'sale', saleId, { amount: value, mode: payMode });
    return byId(saleId);
  });
}

/** Numbers behind the dashboard tiles. */
function summary({ date = today() } = {}) {
  const conn = db.get();
  const day = conn.prepare(`SELECT COUNT(*) AS bills, COALESCE(SUM(total),0) AS total,
      COALESCE(SUM(paid),0) AS paid, COALESCE(SUM(gst_amount),0) AS gst,
      COALESCE(SUM(subtotal - cost_total),0) AS profit
    FROM sales WHERE date = ?`).get(date);
  const month = conn.prepare(`SELECT COUNT(*) AS bills, COALESCE(SUM(total),0) AS total,
      COALESCE(SUM(subtotal - cost_total),0) AS profit
    FROM sales WHERE date >= ? AND date <= ?`).get(`${date.slice(0, 7)}-01`, date);
  const outstanding = conn.prepare(`SELECT COALESCE(SUM(total - paid),0) AS due, COUNT(*) AS bills
    FROM sales WHERE total - paid > 0.01`).get();
  const trend = conn.prepare(`SELECT date, COALESCE(SUM(total),0) AS total, COUNT(*) AS bills
    FROM sales WHERE date >= ? AND date <= ? GROUP BY date ORDER BY date`)
    .all(addDays(date, -13), date);
  const topItems = conn.prepare(`SELECT si.name, SUM(si.qty_units) AS units, ROUND(SUM(si.total),2) AS value
    FROM sale_items si JOIN sales s ON s.id = si.sale_id
    WHERE s.date >= ? AND s.date <= ? GROUP BY si.name ORDER BY value DESC LIMIT 8`)
    .all(addDays(date, -29), date);
  const paymentSplit = conn.prepare(`SELECT payment_mode, COALESCE(SUM(total),0) AS total
    FROM sales WHERE date = ? GROUP BY payment_mode`).all(date);
  return {
    date,
    day: { ...day, total: r2(day.total), paid: r2(day.paid), gst: r2(day.gst), profit: r2(day.profit) },
    month: { ...month, total: r2(month.total), profit: r2(month.profit) },
    outstanding: { due: r2(outstanding.due), bills: outstanding.bills },
    trend: trend.map((t) => ({ ...t, total: r2(t.total) })),
    topItems,
    paymentSplit
  };
}

module.exports = { PAYMENT_MODES, create, byId, byNumber, list, remove, collect, summary, prepareLines, applyBillDiscount };
