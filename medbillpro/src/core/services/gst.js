'use strict';

const db = require('../db');
const settings = require('./settings');
const { r2 } = require('../util/money');
const { today, monthStart, monthEnd, financialYear } = require('../util/dates');

function range({ from, to, month } = {}) {
  if (month) return { from: `${month}-01`, to: monthEnd(`${month}-01`) };
  return { from: from || monthStart(today()), to: to || monthEnd(today()) };
}

function emptyRate(rate) {
  return { rate, taxable: 0, cgst: 0, sgst: 0, igst: 0, total: 0, invoices: 0 };
}

function addRate(bucket, row) {
  bucket.taxable = r2(bucket.taxable + row.taxable);
  bucket.cgst = r2(bucket.cgst + row.cgst);
  bucket.sgst = r2(bucket.sgst + row.sgst);
  bucket.igst = r2(bucket.igst + (row.igst || 0));
  bucket.total = r2(bucket.taxable + bucket.cgst + bucket.sgst + bucket.igst);
  return bucket;
}

/** GSTR-1 — outward supplies (sales), split B2B / B2C with an HSN summary. */
function gstr1(params = {}) {
  const { from, to } = range(params);
  const conn = db.get();
  const lines = conn.prepare(`SELECT si.*, s.no, s.date, s.inter_state, s.customer_id,
      c.name AS customer_name, c.gstin AS customer_gstin
    FROM sale_items si JOIN sales s ON s.id = si.sale_id
    LEFT JOIN customers c ON c.id = s.customer_id
    WHERE s.date >= ? AND s.date <= ? ORDER BY s.date, s.id`).all(from, to);

  const returns = conn.prepare(`SELECT ri.*, r.no, r.date FROM sale_return_items ri
    JOIN sale_returns r ON r.id = ri.return_id WHERE r.date >= ? AND r.date <= ?`).all(from, to);

  const b2bMap = new Map();
  const b2cRates = new Map();
  const hsnMap = new Map();
  const invoiceSet = new Set();

  for (const l of lines) {
    invoiceSet.add(l.no);
    const rateKey = String(l.gst_rate);
    if (l.customer_gstin) {
      const key = `${l.customer_gstin}|${l.no}`;
      const entry = b2bMap.get(key) || {
        gstin: l.customer_gstin, customer: l.customer_name, invoice: l.no, date: l.date,
        inter_state: !!l.inter_state, taxable: 0, cgst: 0, sgst: 0, igst: 0, total: 0, rates: new Set()
      };
      entry.rates.add(l.gst_rate);
      addRate(entry, l);
      b2bMap.set(key, entry);
    } else {
      const bucket = b2cRates.get(rateKey) || emptyRate(l.gst_rate);
      addRate(bucket, l);
      b2cRates.set(rateKey, bucket);
    }
    const hsnKey = `${l.hsn || '-'}|${l.gst_rate}`;
    const hsn = hsnMap.get(hsnKey) || { hsn: l.hsn || '-', rate: l.gst_rate, qty: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0, total: 0 };
    hsn.qty += l.qty_units;
    addRate(hsn, l);
    hsnMap.set(hsnKey, hsn);
  }

  const creditNotes = new Map();
  for (const r of returns) {
    const key = String(r.gst_rate);
    const bucket = creditNotes.get(key) || emptyRate(r.gst_rate);
    const half = r2(r.gst_amount / 2);
    addRate(bucket, { taxable: r.taxable, cgst: half, sgst: r2(r.gst_amount - half), igst: 0 });
    creditNotes.set(key, bucket);
  }

  const b2b = [...b2bMap.values()].map((e) => ({ ...e, rates: [...e.rates].sort((a, b) => a - b) }));
  const b2c = [...b2cRates.values()].sort((a, b) => a.rate - b.rate);
  const cn = [...creditNotes.values()].sort((a, b) => a.rate - b.rate);
  const totals = [...b2b, ...b2c].reduce((a, r) => addRate(a, r), emptyRate('all'));
  const cnTotals = cn.reduce((a, r) => addRate(a, r), emptyRate('all'));

  return {
    period: { from, to },
    store: settings.storeProfile(),
    invoiceCount: invoiceSet.size,
    b2b,
    b2c,
    creditNotes: cn,
    hsn: [...hsnMap.values()].sort((a, b) => b.taxable - a.taxable),
    totals,
    creditNoteTotals: cnTotals,
    net: {
      taxable: r2(totals.taxable - cnTotals.taxable),
      cgst: r2(totals.cgst - cnTotals.cgst),
      sgst: r2(totals.sgst - cnTotals.sgst),
      igst: r2(totals.igst - cnTotals.igst),
      total: r2(totals.total - cnTotals.total)
    }
  };
}

/** GSTR-2 — inward supplies (purchases) grouped by supplier, with ITC. */
function gstr2(params = {}) {
  const { from, to } = range(params);
  const conn = db.get();
  const rows = conn.prepare(`SELECT p.id, p.no, p.ref_no, p.date, p.inter_state, p.subtotal, p.gst_amount, p.total,
      s.name AS supplier_name, s.gstin AS supplier_gstin
    FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id
    WHERE p.date >= ? AND p.date <= ? ORDER BY p.date, p.id`).all(from, to);

  const byRate = new Map();
  const rateRows = conn.prepare(`SELECT pi.gst_rate, SUM(pi.taxable) AS taxable, SUM(pi.gst_amount) AS gst
    FROM purchase_items pi JOIN purchases p ON p.id = pi.purchase_id
    WHERE p.date >= ? AND p.date <= ? GROUP BY pi.gst_rate`).all(from, to);
  for (const r of rateRows) {
    const half = r2(r.gst / 2);
    byRate.set(String(r.gst_rate), addRate(emptyRate(r.gst_rate), { taxable: r.taxable, cgst: half, sgst: r2(r.gst - half), igst: 0 }));
  }

  const debitNotes = conn.prepare(`SELECT ri.gst_rate, SUM(ri.taxable) AS taxable, SUM(ri.gst_amount) AS gst
    FROM purchase_return_items ri JOIN purchase_returns r ON r.id = ri.return_id
    WHERE r.date >= ? AND r.date <= ? GROUP BY ri.gst_rate`).all(from, to);

  const totals = rows.reduce((a, r) => ({
    taxable: r2(a.taxable + r.subtotal),
    gst: r2(a.gst + r.gst_amount),
    total: r2(a.total + r.total)
  }), { taxable: 0, gst: 0, total: 0 });
  const dnTotals = debitNotes.reduce((a, r) => ({ taxable: r2(a.taxable + r.taxable), gst: r2(a.gst + r.gst) }), { taxable: 0, gst: 0 });

  const withoutGstin = rows.filter((r) => !r.supplier_gstin);
  return {
    period: { from, to },
    store: settings.storeProfile(),
    rows,
    byRate: [...byRate.values()].sort((a, b) => a.rate - b.rate),
    debitNotes,
    totals,
    debitNoteTotals: dnTotals,
    itc: { available: r2(totals.gst - dnTotals.gst) },
    warnings: withoutGstin.length
      ? [`${withoutGstin.length} purchase bill(s) have a supplier without a GSTIN — input credit cannot be claimed on these.`]
      : []
  };
}

/** GSTR-3B — the monthly summary and net tax payable. */
function gstr3b(params = {}) {
  const out = gstr1(params);
  const inward = gstr2(params);
  const payable = {
    cgst: r2(out.net.cgst - r2(inward.itc.available / 2)),
    sgst: r2(out.net.sgst - r2(inward.itc.available / 2)),
    igst: r2(out.net.igst)
  };
  return {
    period: out.period,
    store: out.store,
    outward: out.net,
    outwardByRate: out.b2c.concat(out.b2b.map((b) => ({ rate: b.rates.join(','), ...b }))),
    inward: { taxable: inward.totals.taxable, gst: inward.totals.gst, itc: inward.itc.available },
    payable: { ...payable, total: r2(Math.max(0, payable.cgst) + Math.max(0, payable.sgst) + Math.max(0, payable.igst)) },
    warnings: inward.warnings
  };
}

/**
 * Reconciliation — recomputes tax from the saved line items and compares it
 * with the document totals, so data-entry slips surface before filing.
 */
function reconcile(params = {}) {
  const { from, to } = range(params);
  const conn = db.get();
  const sales = conn.prepare(`SELECT s.id, s.no, s.date, s.subtotal, s.gst_amount, s.total,
      ROUND(COALESCE(SUM(si.taxable),0),2) AS line_taxable,
      ROUND(COALESCE(SUM(si.cgst + si.sgst + si.igst),0),2) AS line_gst
    FROM sales s LEFT JOIN sale_items si ON si.sale_id = s.id
    WHERE s.date >= ? AND s.date <= ? GROUP BY s.id`).all(from, to);
  const purchases = conn.prepare(`SELECT p.id, p.no, p.ref_no, p.date, p.subtotal, p.gst_amount,
      ROUND(COALESCE(SUM(pi.taxable),0),2) AS line_taxable,
      ROUND(COALESCE(SUM(pi.gst_amount),0),2) AS line_gst
    FROM purchases p LEFT JOIN purchase_items pi ON pi.purchase_id = p.id
    WHERE p.date >= ? AND p.date <= ? GROUP BY p.id`).all(from, to);

  const flag = (rows, label) => rows
    .filter((r) => Math.abs(r.subtotal - r.line_taxable) > 0.05 || Math.abs(r.gst_amount - r.line_gst) > 0.05)
    .map((r) => ({
      type: label,
      no: r.no,
      date: r.date,
      taxable_diff: r2(r.subtotal - r.line_taxable),
      gst_diff: r2(r.gst_amount - r.line_gst)
    }));

  const missingGstin = conn.prepare(`SELECT COUNT(*) AS n FROM purchases p
    LEFT JOIN suppliers s ON s.id = p.supplier_id
    WHERE p.date >= ? AND p.date <= ? AND (s.gstin IS NULL OR s.gstin = '')`).get(from, to).n;
  const b2bWithoutGstin = conn.prepare(`SELECT COUNT(*) AS n FROM sales s
    JOIN customers c ON c.id = s.customer_id
    WHERE s.date >= ? AND s.date <= ? AND s.total > 250000 AND (c.gstin IS NULL OR c.gstin = '')`).get(from, to).n;

  const mismatches = [...flag(sales, 'Sale'), ...flag(purchases, 'Purchase')];
  return {
    period: { from, to },
    checked: { sales: sales.length, purchases: purchases.length },
    mismatches,
    notes: [
      missingGstin ? `${missingGstin} purchase bill(s) in this period have no supplier GSTIN.` : null,
      b2bWithoutGstin ? `${b2bWithoutGstin} high-value bill(s) have a customer without a GSTIN.` : null,
      mismatches.length === 0 ? 'All documents in this period reconcile with their line items.' : null
    ].filter(Boolean),
    clean: mismatches.length === 0
  };
}

function financialYearRange(dateIso = today()) {
  return financialYear(dateIso);
}

module.exports = { gstr1, gstr2, gstr3b, reconcile, range, financialYearRange };
