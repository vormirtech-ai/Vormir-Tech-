import { escapeHtml } from './dom.js';
import * as fmt from './format.js';
import { printer } from './api.js';
import { toast } from './ui.js';

let cssCache = null;

async function documentCss() {
  if (cssCache) return cssCache;
  const files = ['css/tokens.css', 'css/print.css'];
  const parts = await Promise.all(files.map(async (f) => {
    try { return await (await fetch(f)).text(); } catch { return ''; }
  }));
  cssCache = `${parts.join('\n')}\nbody{margin:0;background:#fff}`;
  return cssCache;
}

/** Wraps printable markup in a standalone HTML document. */
export async function buildDoc(inner, format = 'a5') {
  const css = await documentCss();
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css}
    @page { size: ${format === 'thermal' ? '80mm auto' : format.toUpperCase()}; margin: ${format === 'thermal' ? '2mm' : '6mm'}; }
    body { display: flex; justify-content: center; }
  </style></head><body>${inner}</body></html>`;
}

export async function printMarkup(inner, format = 'a5') {
  const html = await buildDoc(inner, format);
  const result = await printer.html({ html, format });
  if (result && result.success === false && result.reason && result.reason !== 'cancelled') {
    toast(`Printing failed: ${result.reason}`, { type: 'error' });
  }
  return result;
}

export async function savePdf(inner, format = 'a5', defaultName = 'document.pdf') {
  const html = await buildDoc(inner, format);
  const saved = await printer.pdf({ html, format, defaultName });
  if (saved) toast(`Saved ${saved}`, { type: 'ok' });
  return saved;
}

/** Renders printable markup into the hidden #print-area for browser printing. */
export function previewNode(inner) {
  const node = document.createElement('div');
  node.innerHTML = inner;
  return node;
}

function storeBlock(store) {
  const lines = [
    [store.address, store.city, store.pincode].filter(Boolean).join(', '),
    store.state ? `${store.state}` : '',
    store.phone ? `Ph: ${escapeHtml(store.phone)}` : '',
    store.gstin ? `GSTIN: ${escapeHtml(store.gstin)}` : '',
    store.dl_no ? `D.L. No: ${escapeHtml(store.dl_no)}` : '',
    store.fssai ? `FSSAI: ${escapeHtml(store.fssai)}` : ''
  ].filter(Boolean);
  return `<div>
    <div class="store-name">${escapeHtml(store.name || 'Medical Store')}</div>
    ${store.tagline ? `<div class="store-meta">${escapeHtml(store.tagline)}</div>` : ''}
    <div class="store-meta">${lines.map(escapeHtml).join('<br>')}</div>
  </div>`;
}

function amountWords(total) {
  const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven',
    'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const two = (n) => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`);
  const value = Math.abs(Math.round(Number(total) * 100) / 100);
  let rupees = Math.floor(value);
  const paise = Math.round((value - rupees) * 100);
  if (!rupees && !paise) return 'Zero Rupees Only';
  const chunks = [];
  for (const [div, label] of [[10000000, 'Crore'], [100000, 'Lakh'], [1000, 'Thousand'], [100, 'Hundred']]) {
    const q = Math.floor(rupees / div);
    if (q) { chunks.push(`${two(q)} ${label}`); rupees -= q * div; }
  }
  if (rupees) chunks.push(two(rupees));
  return `${chunks.join(' ')} Rupees${paise ? ` and ${two(paise)} Paise` : ''} Only`.replace(/\s+/g, ' ');
}

/** Tax invoice for a sale. */
export function invoiceMarkup(sale, { format = 'a5', copyLabel = 'Tax Invoice' } = {}) {
  const store = sale.store || {};
  const interState = Boolean(sale.inter_state);
  const rows = sale.items.map((it, i) => `<tr>
      <td>${i + 1}</td>
      <td>${escapeHtml(it.name)}${it.hsn ? `<br><span style="font-size:8.5px;color:#666">HSN ${escapeHtml(it.hsn)}</span>` : ''}</td>
      <td>${escapeHtml(it.batch_no)}</td>
      <td>${fmt.expiry(it.expiry)}</td>
      <td class="num">${it.qty_units}</td>
      <td class="num">${fmt.money(it.mrp, { symbol: false })}</td>
      <td class="num">${Number(it.rate_per_unit).toFixed(2)}</td>
      ${it.disc_pct ? `<td class="num">${Number(it.disc_pct).toFixed(1)}%</td>` : '<td class="num">—</td>'}
      <td class="num">${Number(it.gst_rate).toFixed(0)}%</td>
      <td class="num">${fmt.money(it.total, { symbol: false })}</td>
    </tr>`).join('');

  const gstRows = (sale.gst_summary || []).map((g) => `<tr>
      <td>${Number(g.rate).toFixed(0)}%</td>
      <td class="num">${fmt.money(g.taxable, { symbol: false })}</td>
      ${interState
    ? `<td class="num">${fmt.money(g.igst, { symbol: false })}</td>`
    : `<td class="num">${fmt.money(g.cgst, { symbol: false })}</td><td class="num">${fmt.money(g.sgst, { symbol: false })}</td>`}
    </tr>`).join('');

  return `<div class="doc ${format}">
    <div class="doc-head">
      ${storeBlock(store)}
      <div class="doc-type">
        <b>${escapeHtml(copyLabel)}</b>
        No: <b style="display:inline">${escapeHtml(sale.no)}</b><br>
        Date: ${fmt.date(sale.date)}<br>
        ${sale.rx_no ? `Rx: ${escapeHtml(sale.rx_no)}<br>` : ''}
        Payment: ${escapeHtml(sale.payment_mode)}
      </div>
    </div>
    <div class="doc-parties">
      <div><b>Patient:</b> ${escapeHtml(sale.customer_name || sale.patient_name || 'Walk-in customer')}
        ${sale.customer_phone || sale.patient_phone ? `<br>Ph: ${escapeHtml(sale.customer_phone || sale.patient_phone)}` : ''}
        ${sale.customer_address ? `<br>${escapeHtml(sale.customer_address)}` : ''}
        ${sale.customer_gstin ? `<br>GSTIN: ${escapeHtml(sale.customer_gstin)}` : ''}</div>
      <div style="text-align:right">${sale.doctor_name ? `<b>Doctor:</b> ${escapeHtml(sale.doctor_name)}${sale.doctor_reg ? `<br>Reg: ${escapeHtml(sale.doctor_reg)}` : ''}` : ''}
        ${sale.created_by ? `<br>Billed by: ${escapeHtml(sale.created_by)}` : ''}</div>
    </div>
    <table class="doc-items">
      <thead><tr>
        <th>#</th><th>Medicine</th><th>Batch</th><th>Exp</th>
        <th class="num">Qty</th><th class="num">MRP</th><th class="num">Rate</th>
        <th class="num">Disc</th><th class="num">GST</th><th class="num">Amount</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="doc-summary">
      <div>
        ${gstRows ? `<table class="doc-gst">
          <thead><tr><th>Rate</th><th>Taxable</th>${interState ? '<th>IGST</th>' : '<th>CGST</th><th>SGST</th>'}</tr></thead>
          <tbody>${gstRows}</tbody></table>` : ''}
        <div class="doc-words">${amountWords(sale.total)}</div>
      </div>
      <table>
        <tr><td>Taxable value</td><td class="num">${fmt.money(sale.subtotal, { symbol: false })}</td></tr>
        ${sale.discount ? `<tr><td>Discount</td><td class="num">- ${fmt.money(sale.discount, { symbol: false })}</td></tr>` : ''}
        <tr><td>GST</td><td class="num">${fmt.money(sale.gst_amount, { symbol: false })}</td></tr>
        ${sale.round_off ? `<tr><td>Round off</td><td class="num">${fmt.money(sale.round_off, { symbol: false })}</td></tr>` : ''}
        <tr class="grand"><td>Total</td><td class="num">${fmt.money(sale.total)}</td></tr>
        <tr><td>Paid (${escapeHtml(sale.payment_mode)})</td><td class="num">${fmt.money(sale.paid, { symbol: false })}</td></tr>
        ${sale.total - sale.paid > 0.009 ? `<tr><td><b>Balance due</b></td><td class="num"><b>${fmt.money(sale.total - sale.paid, { symbol: false })}</b></td></tr>` : ''}
      </table>
    </div>
    <div class="doc-foot">
      <div style="max-width:60%">${escapeHtml(store.terms || '')}</div>
      <div class="sign">For ${escapeHtml(store.name || '')}<div class="line">Authorised signatory</div></div>
    </div>
    ${store.footer ? `<div class="doc-note">${escapeHtml(store.footer)}</div>` : ''}
  </div>`;
}

/** Goods-received note for a purchase. */
export function purchaseMarkup(purchase, { format = 'a4' } = {}) {
  const store = purchase.store || {};
  const rows = purchase.items.map((it, i) => `<tr>
      <td>${i + 1}</td><td>${escapeHtml(it.name)}</td><td>${escapeHtml(it.batch_no)}</td>
      <td>${fmt.expiry(it.expiry)}</td><td class="num">${it.qty_units}</td><td class="num">${it.free_units || '—'}</td>
      <td class="num">${Number(it.rate_per_unit).toFixed(3)}</td><td class="num">${fmt.money(it.mrp, { symbol: false })}</td>
      <td class="num">${Number(it.gst_rate).toFixed(0)}%</td><td class="num">${fmt.money(it.total, { symbol: false })}</td>
    </tr>`).join('');
  return `<div class="doc ${format}">
    <div class="doc-head">${storeBlock(store)}
      <div class="doc-type"><b>Purchase entry</b>
        No: <b style="display:inline">${escapeHtml(purchase.no)}</b><br>
        Date: ${fmt.date(purchase.date)}<br>
        ${purchase.ref_no ? `Supplier bill: ${escapeHtml(purchase.ref_no)}` : ''}</div>
    </div>
    <div class="doc-parties"><div><b>Supplier:</b> ${escapeHtml(purchase.supplier_name || '—')}
      ${purchase.supplier_gstin ? `<br>GSTIN: ${escapeHtml(purchase.supplier_gstin)}` : ''}
      ${purchase.supplier_dl ? `<br>D.L.: ${escapeHtml(purchase.supplier_dl)}` : ''}</div></div>
    <table class="doc-items"><thead><tr>
      <th>#</th><th>Medicine</th><th>Batch</th><th>Exp</th><th class="num">Qty</th><th class="num">Free</th>
      <th class="num">Rate</th><th class="num">MRP</th><th class="num">GST</th><th class="num">Amount</th>
    </tr></thead><tbody>${rows}</tbody></table>
    <div class="doc-summary"><div class="doc-words">${amountWords(purchase.total)}</div>
      <table>
        <tr><td>Taxable value</td><td class="num">${fmt.money(purchase.subtotal, { symbol: false })}</td></tr>
        <tr><td>GST</td><td class="num">${fmt.money(purchase.gst_amount, { symbol: false })}</td></tr>
        <tr class="grand"><td>Total</td><td class="num">${fmt.money(purchase.total)}</td></tr>
        <tr><td>Paid</td><td class="num">${fmt.money(purchase.paid, { symbol: false })}</td></tr>
      </table></div>
  </div>`;
}

/** Credit note for a sales return. */
export function saleReturnMarkup(ret, { format = 'a5' } = {}) {
  const store = ret.store || {};
  const rows = ret.items.map((it, i) => `<tr>
      <td>${i + 1}</td><td>${escapeHtml(it.name)}</td><td>${escapeHtml(it.batch_no || '')}</td>
      <td class="num">${it.qty_units}</td><td class="num">${Number(it.rate_per_unit).toFixed(2)}</td>
      <td class="num">${Number(it.gst_rate).toFixed(0)}%</td><td class="num">${fmt.money(it.total, { symbol: false })}</td>
    </tr>`).join('');
  return `<div class="doc ${format}">
    <div class="doc-head">${storeBlock(store)}
      <div class="doc-type"><b>Credit note</b>
        No: <b style="display:inline">${escapeHtml(ret.no)}</b><br>Date: ${fmt.date(ret.date)}<br>
        ${ret.sale_no ? `Against bill: ${escapeHtml(ret.sale_no)}` : ''}</div></div>
    <div class="doc-parties"><div><b>Patient:</b> ${escapeHtml(ret.customer_name || 'Walk-in customer')}</div>
      <div style="text-align:right">Refund: ${escapeHtml(ret.refund_mode)}</div></div>
    <table class="doc-items"><thead><tr><th>#</th><th>Medicine</th><th>Batch</th>
      <th class="num">Qty</th><th class="num">Rate</th><th class="num">GST</th><th class="num">Amount</th>
    </tr></thead><tbody>${rows}</tbody></table>
    <div class="doc-summary"><div class="doc-words">${amountWords(ret.total)}</div>
      <table>
        <tr><td>Taxable value</td><td class="num">${fmt.money(ret.subtotal, { symbol: false })}</td></tr>
        <tr><td>GST</td><td class="num">${fmt.money(ret.gst_amount, { symbol: false })}</td></tr>
        <tr class="grand"><td>Refund total</td><td class="num">${fmt.money(ret.total)}</td></tr>
      </table></div>
    ${ret.notes ? `<div class="doc-note">Reason: ${escapeHtml(ret.notes)}</div>` : ''}
  </div>`;
}

/** Generic tabular report printout. */
export function reportMarkup({ title, subtitle, store = {}, columns, rows, totals = null, format = 'a4', notes = [] }) {
  const head = columns.map((c) => `<th class="${c.align === 'num' ? 'num' : ''}">${escapeHtml(c.label)}</th>`).join('');
  const body = rows.map((row) => `<tr>${columns.map((c) => `<td class="${c.align === 'num' ? 'num' : ''}">${escapeHtml(c.value(row))}</td>`).join('')}</tr>`).join('');
  const foot = totals ? `<tfoot><tr>${totals.map((t, i) => `<td class="${columns[i]?.align === 'num' ? 'num' : ''}"><b>${escapeHtml(t ?? '')}</b></td>`).join('')}</tr></tfoot>` : '';
  return `<div class="doc ${format}">
    <div class="doc-head">${storeBlock(store)}
      <div class="doc-type"><b>${escapeHtml(title)}</b>${subtitle ? `<br>${escapeHtml(subtitle)}` : ''}
      <br>Printed: ${fmt.date(fmt.today())}</div></div>
    <table class="doc-items"><thead><tr>${head}</tr></thead><tbody>${body}</tbody>${foot}</table>
    ${notes.length ? `<div class="doc-note">${notes.map(escapeHtml).join(' · ')}</div>` : ''}
  </div>`;
}
