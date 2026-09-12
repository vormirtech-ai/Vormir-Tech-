'use strict';

/** Round to 2 decimals without binary-float drift (works on negatives too). */
function r2(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.sign(v) * Math.round(Math.abs(v) * 100 + Number.EPSILON * 100) / 100;
}

/** Round to 3 decimals — used for per-unit rates derived from pack rates. */
function r3(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.sign(v) * Math.round(Math.abs(v) * 1000 + Number.EPSILON * 1000) / 1000;
}

function num(n, fallback = 0) {
  const v = Number(n);
  return Number.isFinite(v) ? v : fallback;
}

function int(n, fallback = 0) {
  const v = Math.trunc(Number(n));
  return Number.isFinite(v) ? v : fallback;
}

/**
 * Split a GST-exclusive taxable value into CGST/SGST halves.
 * Intra-state supply is assumed (single-state medical store); IGST is
 * reported separately for inter-state invoices.
 */
function splitGst(taxable, rate, interState = false) {
  const tax = r2(num(taxable) * num(rate) / 100);
  if (interState) return { cgst: 0, sgst: 0, igst: tax, total: tax };
  const cgst = r2(tax / 2);
  const sgst = r2(tax - cgst);
  return { cgst, sgst, igst: 0, total: r2(cgst + sgst) };
}

/** Line maths shared by sales, purchases and returns. */
function lineTotals({ qty, rate, discPct = 0, gstRate = 0, interState = false, gstInclusive = false }) {
  const gross = r2(num(qty) * num(rate));
  const disc = r2(gross * num(discPct) / 100);
  let taxable = r2(gross - disc);
  if (gstInclusive) taxable = r2(taxable * 100 / (100 + num(gstRate)));
  const gst = splitGst(taxable, gstRate, interState);
  return {
    gross,
    discount: disc,
    taxable,
    cgst: gst.cgst,
    sgst: gst.sgst,
    igst: gst.igst,
    gstAmount: gst.total,
    total: r2(taxable + gst.total)
  };
}

/** Nearest-rupee round off, returns { total, roundOff }. */
function roundOff(total) {
  const t = r2(total);
  const rounded = Math.round(t);
  return { total: rounded, roundOff: r2(rounded - t) };
}

const INR = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function formatMoney(n) {
  return INR.format(r2(n));
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function twoDigit(n) {
  if (n < 20) return ONES[n];
  const t = TENS[Math.floor(n / 10)];
  const o = ONES[n % 10];
  return o ? `${t} ${o}` : t;
}

/** Indian-system amount in words, for invoice footers. */
function amountInWords(amount) {
  const value = r2(Math.abs(amount));
  let rupees = Math.floor(value);
  const paise = Math.round((value - rupees) * 100);
  if (rupees === 0 && paise === 0) return 'Zero Rupees Only';
  const parts = [];
  const units = [
    [10000000, 'Crore'],
    [100000, 'Lakh'],
    [1000, 'Thousand'],
    [100, 'Hundred']
  ];
  for (const [div, label] of units) {
    const q = Math.floor(rupees / div);
    if (q > 0) {
      parts.push(`${q > 99 ? amountInWords(q).replace(' Rupees Only', '') : twoDigit(q)} ${label}`);
      rupees -= q * div;
    }
  }
  if (rupees > 0) parts.push(twoDigit(rupees));
  let out = parts.join(' ').replace(/\s+/g, ' ').trim();
  out = `${out} Rupees`;
  if (paise > 0) out += ` and ${twoDigit(paise)} Paise`;
  return `${(amount < 0 ? 'Minus ' : '') + out} Only`;
}

module.exports = { r2, r3, num, int, splitGst, lineTotals, roundOff, formatMoney, amountInWords };
