'use strict';

const db = require('../db');
const ledger = require('./ledger');
const products = require('./products');
const { r2 } = require('../util/money');
const { today, monthStart, addDays } = require('../util/dates');

function period({ from, to } = {}) {
  return { from: from || monthStart(today()), to: to || today() };
}

/** Day-wise sales register with GST and margin. */
function salesRegister(params = {}) {
  const { from, to } = period(params);
  const rows = db.get().prepare(`SELECT s.date,
      COUNT(*) AS bills,
      ROUND(SUM(s.subtotal),2) AS taxable,
      ROUND(SUM(s.gst_amount),2) AS gst,
      ROUND(SUM(s.discount),2) AS discount,
      ROUND(SUM(s.total),2) AS total,
      ROUND(SUM(s.paid),2) AS collected,
      ROUND(SUM(s.subtotal - s.cost_total),2) AS profit
    FROM sales s WHERE s.date >= ? AND s.date <= ? GROUP BY s.date ORDER BY s.date`).all(from, to);
  const totals = rows.reduce((a, r) => ({
    bills: a.bills + r.bills,
    taxable: r2(a.taxable + r.taxable),
    gst: r2(a.gst + r.gst),
    discount: r2(a.discount + r.discount),
    total: r2(a.total + r.total),
    collected: r2(a.collected + r.collected),
    profit: r2(a.profit + r.profit)
  }), { bills: 0, taxable: 0, gst: 0, discount: 0, total: 0, collected: 0, profit: 0 });
  return { period: { from, to }, rows, totals };
}

function purchaseRegister(params = {}) {
  const { from, to } = period(params);
  const rows = db.get().prepare(`SELECT p.date, COUNT(*) AS bills,
      ROUND(SUM(p.subtotal),2) AS taxable, ROUND(SUM(p.gst_amount),2) AS gst,
      ROUND(SUM(p.total),2) AS total, ROUND(SUM(p.paid),2) AS paid
    FROM purchases p WHERE p.date >= ? AND p.date <= ? GROUP BY p.date ORDER BY p.date`).all(from, to);
  const totals = rows.reduce((a, r) => ({
    bills: a.bills + r.bills, taxable: r2(a.taxable + r.taxable), gst: r2(a.gst + r.gst),
    total: r2(a.total + r.total), paid: r2(a.paid + r.paid)
  }), { bills: 0, taxable: 0, gst: 0, total: 0, paid: 0 });
  return { period: { from, to }, rows, totals };
}

/** Item-wise movement: sold quantity, sales value and gross margin. */
function itemMovement(params = {}) {
  const { from, to } = period(params);
  const rows = db.get().prepare(`SELECT si.product_id, si.name,
      SUM(si.qty_units) AS units,
      ROUND(SUM(si.taxable),2) AS taxable,
      ROUND(SUM(si.total),2) AS value,
      ROUND(SUM(si.taxable - si.qty_units * si.cost_per_unit),2) AS profit,
      COUNT(DISTINCT si.sale_id) AS bills
    FROM sale_items si JOIN sales s ON s.id = si.sale_id
    WHERE s.date >= ? AND s.date <= ?
    GROUP BY si.product_id, si.name ORDER BY value DESC LIMIT 500`).all(from, to);
  const stock = new Map(products.list({ limit: 5000 }).map((p) => [p.id, p]));
  return {
    period: { from, to },
    rows: rows.map((r) => ({
      ...r,
      stock_units: stock.get(r.product_id)?.stock_units ?? 0,
      stock_label: stock.get(r.product_id)?.stock_label ?? '—',
      margin_pct: r.taxable > 0 ? r2(r.profit * 100 / r.taxable) : 0
    })),
    totals: rows.reduce((a, r) => ({
      units: a.units + r.units, value: r2(a.value + r.value), profit: r2(a.profit + r.profit)
    }), { units: 0, value: 0, profit: 0 })
  };
}

/** Current stock valuation at cost and at MRP. */
function stockValuation() {
  const rows = db.get().prepare(`SELECT p.id, p.name, p.manufacturer, p.category, p.pack_size, p.pack_label,
      p.unit_label, p.rack, p.reorder_level,
      COALESCE(SUM(b.qty_units),0) AS units,
      ROUND(COALESCE(SUM(b.qty_units * b.rate_per_unit),0),2) AS cost_value,
      ROUND(COALESCE(SUM(b.qty_units * b.mrp / NULLIF(p.pack_size,0)),0),2) AS mrp_value,
      COUNT(b.id) AS batches
    FROM products p LEFT JOIN batches b ON b.product_id = p.id AND b.qty_units > 0
    WHERE p.active = 1 GROUP BY p.id ORDER BY cost_value DESC`).all();
  const totals = rows.reduce((a, r) => ({
    units: a.units + r.units, cost_value: r2(a.cost_value + r.cost_value), mrp_value: r2(a.mrp_value + r.mrp_value)
  }), { units: 0, cost_value: 0, mrp_value: 0 });
  return { rows, totals };
}

/** Cash book for a single day — receipts, payments and closing balance. */
function dayBook({ date = today() } = {}) {
  const conn = db.get();
  const opening = (() => {
    const r = conn.prepare(`SELECT
        COALESCE(SUM(CASE WHEN direction='in' THEN amount ELSE 0 END),0) AS credit,
        COALESCE(SUM(CASE WHEN direction='out' THEN amount ELSE 0 END),0) AS debit
      FROM ledger WHERE date < ?`).get(date);
    return r2(r.credit - r.debit);
  })();
  const rows = conn.prepare('SELECT * FROM ledger WHERE date = ? ORDER BY id').all(date);
  const inflow = r2(rows.filter((r) => r.direction === 'in').reduce((s, r) => s + r.amount, 0));
  const outflow = r2(rows.filter((r) => r.direction === 'out').reduce((s, r) => s + r.amount, 0));
  return {
    date,
    opening,
    rows,
    inflow,
    outflow,
    closing: r2(opening + inflow - outflow),
    balances: ledger.balances({ upto: date }),
    sales: conn.prepare(`SELECT no, patient_name, payment_mode, total, paid FROM sales WHERE date = ? ORDER BY id`).all(date),
    expenses: conn.prepare('SELECT category, payee, amount, account FROM expenses WHERE date = ? ORDER BY id').all(date)
  };
}

/** Profit & loss for a period, built from sales margin minus expenses. */
function profitLoss(params = {}) {
  const { from, to } = period(params);
  const conn = db.get();
  const sales = conn.prepare(`SELECT ROUND(COALESCE(SUM(subtotal),0),2) AS taxable,
      ROUND(COALESCE(SUM(cost_total),0),2) AS cost, ROUND(COALESCE(SUM(total),0),2) AS gross,
      COUNT(*) AS bills FROM sales WHERE date >= ? AND date <= ?`).get(from, to);
  const returns = conn.prepare(`SELECT ROUND(COALESCE(SUM(subtotal),0),2) AS taxable
    FROM sale_returns WHERE date >= ? AND date <= ?`).get(from, to);
  const expense = conn.prepare(`SELECT category, ROUND(SUM(amount),2) AS amount FROM expenses
    WHERE date >= ? AND date <= ? GROUP BY category ORDER BY amount DESC`).all(from, to);
  const expenseTotal = r2(expense.reduce((s, e) => s + e.amount, 0));
  const commissions = conn.prepare(`SELECT ROUND(COALESCE(SUM(amount),0),2) AS amount
    FROM doctor_commissions WHERE date >= ? AND date <= ?`).get(from, to).amount;
  const grossProfit = r2(sales.taxable - returns.taxable - sales.cost);
  return {
    period: { from, to },
    sales,
    returns,
    grossProfit,
    expenses: expense,
    expenseTotal,
    commissions,
    netProfit: r2(grossProfit - expenseTotal - commissions),
    marginPct: sales.taxable > 0 ? r2(grossProfit * 100 / sales.taxable) : 0
  };
}

/** Outstanding receivables and payables, oldest first. */
function outstanding() {
  const conn = db.get();
  const receivables = conn.prepare(`SELECT s.id, s.no, s.date, s.total, s.paid,
      ROUND(s.total - s.paid, 2) AS due, COALESCE(c.name, s.patient_name, 'Walk-in') AS party,
      c.phone, CAST(julianday('now') - julianday(s.date) AS INTEGER) AS age_days
    FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
    WHERE s.total - s.paid > 0.01 ORDER BY s.date`).all();
  const payables = conn.prepare(`SELECT p.id, p.no, p.ref_no, p.date, p.total, p.paid,
      ROUND(p.total - p.paid, 2) AS due, s.name AS party, s.phone,
      CAST(julianday('now') - julianday(p.date) AS INTEGER) AS age_days
    FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id
    WHERE p.total - p.paid > 0.01 ORDER BY p.date`).all();
  return {
    receivables,
    payables,
    totals: {
      receivable: r2(receivables.reduce((s, r) => s + r.due, 0)),
      payable: r2(payables.reduce((s, r) => s + r.due, 0))
    }
  };
}

/** Everything the dashboard needs, in one round trip. */
function dashboard({ date = today() } = {}) {
  const sales = require('./sales');
  const conn = db.get();
  const summary = sales.summary({ date });
  const expiry = products.expiryReport({ withinDays: 90 });
  const low = products.lowStockReport();
  const pendingRx = conn.prepare(`SELECT r.*, c.name AS customer_name, c.phone
    FROM rx_reminders r JOIN customers c ON c.id = r.customer_id
    WHERE r.status = 'pending' AND r.due_date <= ? ORDER BY r.due_date LIMIT 25`)
    .all(addDays(date, 3));
  const stock = stockValuation();
  const out = outstanding();
  const expensesToday = conn.prepare('SELECT ROUND(COALESCE(SUM(amount),0),2) AS total FROM expenses WHERE date = ?').get(date).total;
  return {
    ...summary,
    balances: ledger.balances(),
    expiring: expiry.filter((e) => !e.expired).slice(0, 20),
    expired: expiry.filter((e) => e.expired).slice(0, 20),
    expiringCount: expiry.filter((e) => !e.expired).length,
    expiredCount: expiry.filter((e) => e.expired).length,
    lowStock: low.slice(0, 20),
    lowStockCount: low.length,
    pendingRx,
    pendingRxCount: conn.prepare("SELECT COUNT(*) AS n FROM rx_reminders WHERE status = 'pending'").get().n,
    stockValue: stock.totals,
    outstanding: { ...summary.outstanding, ...out.totals },
    expensesToday,
    counts: {
      products: conn.prepare('SELECT COUNT(*) AS n FROM products WHERE active = 1').get().n,
      customers: conn.prepare('SELECT COUNT(*) AS n FROM customers WHERE active = 1').get().n,
      suppliers: conn.prepare('SELECT COUNT(*) AS n FROM suppliers WHERE active = 1').get().n,
      doctors: conn.prepare('SELECT COUNT(*) AS n FROM doctors WHERE active = 1').get().n
    }
  };
}

module.exports = {
  salesRegister, purchaseRegister, itemMovement, stockValuation,
  dayBook, profitLoss, outstanding, dashboard
};
