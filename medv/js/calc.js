/**
 * Mirrors src/core/util/money.js so the billing screen shows exactly the
 * figures the database will store. The main process stays authoritative —
 * after saving, totals are re-read from the saved document.
 */
export function r2(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.sign(v) * Math.round(Math.abs(v) * 100 + Number.EPSILON * 100) / 100;
}

export function r3(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.sign(v) * Math.round(Math.abs(v) * 1000 + Number.EPSILON * 1000) / 1000;
}

export function splitGst(taxable, rate, interState = false) {
  const tax = r2((Number(taxable) || 0) * (Number(rate) || 0) / 100);
  if (interState) return { cgst: 0, sgst: 0, igst: tax, total: tax };
  const cgst = r2(tax / 2);
  return { cgst, sgst: r2(tax - cgst), igst: 0, total: r2(cgst + r2(tax - cgst)) };
}

export function lineTotals({ qty, rate, discPct = 0, gstRate = 0, interState = false, gstInclusive = false }) {
  const gross = r2((Number(qty) || 0) * (Number(rate) || 0));
  const disc = r2(gross * (Number(discPct) || 0) / 100);
  let taxable = r2(gross - disc);
  if (gstInclusive) taxable = r2(taxable * 100 / (100 + (Number(gstRate) || 0)));
  const gst = splitGst(taxable, gstRate, interState);
  return { gross, discount: disc, taxable, ...gst, gstAmount: gst.total, total: r2(taxable + gst.total) };
}

export function roundOff(total) {
  const t = r2(total);
  const rounded = Math.round(t);
  return { total: rounded, roundOff: r2(rounded - t) };
}

/** Spreads a bill-level discount across lines, exactly as the server does. */
export function applyBillDiscount(lines, billDiscount, interState) {
  const discount = r2(billDiscount);
  const base = r2(lines.reduce((s, l) => s + l.taxable, 0));
  if (discount <= 0 || base <= 0) return lines;
  let allocated = 0;
  return lines.map((line, i) => {
    const share = i === lines.length - 1 ? r2(discount - allocated) : r2(discount * line.taxable / base);
    allocated = r2(allocated + share);
    const taxable = r2(line.taxable - share);
    const gst = splitGst(taxable, line.gst_rate, interState);
    return { ...line, taxable, ...gst, gstAmount: gst.total, total: r2(taxable + gst.total) };
  });
}
