import { el, mount } from '../dom.js';
import { icon } from '../icons.js';
import * as fmt from '../format.js';
import { call } from '../api.js';
import { card, dataTable, emptyState, badge, stat, tabs, exportCsv, toast } from '../ui.js';
import { reportMarkup, printMarkup } from '../print.js';

const TABS = [
  { key: 'gstr1', label: 'GSTR-1 (outward)' },
  { key: 'gstr2', label: 'GSTR-2 (inward)' },
  { key: 'gstr3b', label: 'GSTR-3B summary' },
  { key: 'reconcile', label: 'Reconciliation' }
];

function monthOptions() {
  const out = [];
  const now = new Date();
  for (let i = 0; i < 18; i += 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    out.push({ value, label: d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }) });
  }
  return out;
}

export async function render({ query }) {
  let tab = query?.tab || 'gstr1';
  let month = fmt.today().slice(0, 7);
  const host = el('div');
  const panel = el('div');

  async function gstr1Panel() {
    const data = await call('gst.gstr1', { month });
    return el('div.col', { style: { gap: '16px' } },
      el('div.grid.cols-4',
        stat({ label: 'Invoices', value: String(data.invoiceCount), iconName: 'list', accent: 'blue' }),
        stat({ label: 'Taxable value', value: fmt.money(data.net.taxable), iconName: 'trending', accent: 'purple' }),
        stat({ label: 'CGST + SGST', value: fmt.money(data.net.cgst + data.net.sgst), iconName: 'gst', accent: 'green' }),
        stat({ label: 'Credit notes', value: fmt.money(data.creditNoteTotals.total), sub: 'Sales returns in this period', iconName: 'returns', accent: 'orange' })),
      card({
        title: 'B2C — supplies to consumers, rate-wise',
        subtitle: 'Table 7 of GSTR-1',
        actions: el('div.row.tight',
          el('button.btn.sm', {
            onclick: () => exportCsv([
              ['Rate', 'Taxable value', 'CGST', 'SGST', 'IGST'],
              ...data.b2c.map((r) => [r.rate, r.taxable, r.cgst, r.sgst, r.igst])
            ], `gstr1-b2c-${month}.csv`)
          }, icon('download'), 'Export'),
          el('button.btn.sm', { onclick: () => printGstr1(data) }, icon('print'), 'Print')),
        flush: true,
        body: dataTable({
          rows: data.b2c,
          columns: [
            { key: 'rate', label: 'GST rate', render: (r) => `${r.rate}%` },
            { key: 'taxable', label: 'Taxable value', align: 'num', render: (r) => fmt.money(r.taxable) },
            { key: 'cgst', label: 'CGST', align: 'num', render: (r) => fmt.money(r.cgst) },
            { key: 'sgst', label: 'SGST', align: 'num', render: (r) => fmt.money(r.sgst) },
            { key: 'igst', label: 'IGST', align: 'num', render: (r) => fmt.money(r.igst) },
            { key: 'total', label: 'Invoice value', align: 'num', render: (r) => el('b', fmt.money(r.total)) }
          ],
          empty: emptyState({ title: 'No consumer sales in this month', iconName: 'gst' })
        })
      }),
      card({
        title: 'B2B — invoice-wise, registered customers',
        subtitle: 'Table 4 of GSTR-1',
        actions: el('button.btn.sm', {
          onclick: () => exportCsv([
            ['GSTIN', 'Customer', 'Invoice', 'Date', 'Taxable', 'CGST', 'SGST', 'IGST', 'Invoice value'],
            ...data.b2b.map((r) => [r.gstin, r.customer, r.invoice, r.date, r.taxable, r.cgst, r.sgst, r.igst, r.total])
          ], `gstr1-b2b-${month}.csv`)
        }, icon('download'), 'Export'),
        flush: true,
        body: dataTable({
          rows: data.b2b,
          columns: [
            { key: 'gstin', label: 'GSTIN', render: (r) => el('span.mono', r.gstin) },
            { key: 'customer', label: 'Customer' },
            { key: 'invoice', label: 'Invoice', render: (r) => el('div', el('b', r.invoice), el('div.fs-12.muted', fmt.date(r.date))) },
            { key: 'rates', label: 'Rates', render: (r) => r.rates.map((x) => `${x}%`).join(', ') },
            { key: 'taxable', label: 'Taxable', align: 'num', render: (r) => fmt.money(r.taxable) },
            { key: 'tax', label: 'Tax', align: 'num', render: (r) => fmt.money(r.cgst + r.sgst + r.igst) },
            { key: 'total', label: 'Invoice value', align: 'num', render: (r) => el('b', fmt.money(r.total)) }
          ],
          empty: emptyState({ title: 'No B2B invoices', message: 'Bills are B2B once the customer has a GSTIN saved.', iconName: 'users' })
        })
      }),
      card({
        title: 'HSN summary',
        subtitle: 'Table 12 of GSTR-1',
        actions: el('button.btn.sm', {
          onclick: () => exportCsv([
            ['HSN', 'Rate', 'Quantity', 'Taxable value', 'CGST', 'SGST', 'IGST'],
            ...data.hsn.map((r) => [r.hsn, r.rate, r.qty, r.taxable, r.cgst, r.sgst, r.igst])
          ], `gstr1-hsn-${month}.csv`)
        }, icon('download'), 'Export'),
        flush: true,
        body: dataTable({
          rows: data.hsn,
          columns: [
            { key: 'hsn', label: 'HSN', render: (r) => el('span.mono', r.hsn) },
            { key: 'rate', label: 'Rate', align: 'num', render: (r) => `${r.rate}%` },
            { key: 'qty', label: 'Quantity', align: 'num', render: (r) => fmt.number(r.qty) },
            { key: 'taxable', label: 'Taxable value', align: 'num', render: (r) => fmt.money(r.taxable) },
            { key: 'cgst', label: 'CGST', align: 'num', render: (r) => fmt.money(r.cgst) },
            { key: 'sgst', label: 'SGST', align: 'num', render: (r) => fmt.money(r.sgst) }
          ],
          footer: ['Total', '', '', fmt.money(data.totals.taxable), fmt.money(data.totals.cgst), fmt.money(data.totals.sgst)],
          empty: emptyState({ title: 'Nothing to summarise', iconName: 'gst' })
        })
      }));
  }

  async function printGstr1(data) {
    await printMarkup(reportMarkup({
      title: 'GSTR-1 summary',
      subtitle: `${fmt.date(data.period.from)} to ${fmt.date(data.period.to)}`,
      store: data.store,
      columns: [
        { label: 'Rate', value: (r) => `${r.rate}%` },
        { label: 'Taxable', value: (r) => fmt.money(r.taxable, { symbol: false }), align: 'num' },
        { label: 'CGST', value: (r) => fmt.money(r.cgst, { symbol: false }), align: 'num' },
        { label: 'SGST', value: (r) => fmt.money(r.sgst, { symbol: false }), align: 'num' },
        { label: 'IGST', value: (r) => fmt.money(r.igst, { symbol: false }), align: 'num' }
      ],
      rows: data.b2c,
      totals: ['Total', fmt.money(data.net.taxable, { symbol: false }), fmt.money(data.net.cgst, { symbol: false }), fmt.money(data.net.sgst, { symbol: false }), fmt.money(data.net.igst, { symbol: false })],
      notes: [`Invoices: ${data.invoiceCount}`, `Credit notes: ${fmt.money(data.creditNoteTotals.total)}`],
      format: 'a4'
    }), 'a4');
  }

  async function gstr2Panel() {
    const data = await call('gst.gstr2', { month });
    return el('div.col', { style: { gap: '16px' } },
      el('div.grid.cols-4',
        stat({ label: 'Purchase bills', value: String(data.rows.length), iconName: 'truck', accent: 'blue' }),
        stat({ label: 'Taxable value', value: fmt.money(data.totals.taxable), iconName: 'package', accent: 'purple' }),
        stat({ label: 'Input GST', value: fmt.money(data.totals.gst), iconName: 'gst', accent: 'green' }),
        stat({ label: 'ITC available', value: fmt.money(data.itc.available), sub: 'After debit notes', iconName: 'download', accent: 'orange' })),
      data.warnings.length
        ? el('div.note.warn', icon('alert'), el('div', ...data.warnings.map((w) => el('div', w))))
        : null,
      card({
        title: 'Inward supplies — bill-wise',
        actions: el('button.btn.sm', {
          onclick: () => exportCsv([
            ['Supplier GSTIN', 'Supplier', 'Entry', 'Supplier bill', 'Date', 'Taxable', 'GST', 'Total'],
            ...data.rows.map((r) => [r.supplier_gstin, r.supplier_name, r.no, r.ref_no, r.date, r.subtotal, r.gst_amount, r.total])
          ], `gstr2-${month}.csv`)
        }, icon('download'), 'Export'),
        flush: true,
        body: dataTable({
          rows: data.rows,
          rowClass: (r) => (r.supplier_gstin ? '' : 'row-warn'),
          columns: [
            { key: 'supplier_gstin', label: 'GSTIN', render: (r) => (r.supplier_gstin ? el('span.mono', r.supplier_gstin) : badge('missing', 'warn')) },
            { key: 'supplier_name', label: 'Supplier' },
            { key: 'ref_no', label: 'Bill', render: (r) => el('div', el('b', r.ref_no || r.no), el('div.fs-12.muted', fmt.date(r.date))) },
            { key: 'subtotal', label: 'Taxable', align: 'num', render: (r) => fmt.money(r.subtotal) },
            { key: 'gst_amount', label: 'GST', align: 'num', render: (r) => fmt.money(r.gst_amount) },
            { key: 'total', label: 'Total', align: 'num', render: (r) => el('b', fmt.money(r.total)) }
          ],
          footer: ['Total', '', '', fmt.money(data.totals.taxable), fmt.money(data.totals.gst), fmt.money(data.totals.total)],
          empty: emptyState({ title: 'No purchases in this month', iconName: 'truck' })
        })
      }),
      card({
        title: 'Rate-wise input tax',
        flush: true,
        body: dataTable({
          rows: data.byRate,
          columns: [
            { key: 'rate', label: 'Rate', render: (r) => `${r.rate}%` },
            { key: 'taxable', label: 'Taxable value', align: 'num', render: (r) => fmt.money(r.taxable) },
            { key: 'cgst', label: 'CGST', align: 'num', render: (r) => fmt.money(r.cgst) },
            { key: 'sgst', label: 'SGST', align: 'num', render: (r) => fmt.money(r.sgst) }
          ],
          empty: emptyState({ title: 'Nothing to show', iconName: 'gst' })
        })
      }));
  }

  async function gstr3bPanel() {
    const data = await call('gst.gstr3b', { month });
    return el('div.col', { style: { gap: '16px' } },
      el('div.grid.cols-4',
        stat({ label: 'Outward taxable value', value: fmt.money(data.outward.taxable), iconName: 'trending', accent: 'blue' }),
        stat({ label: 'Output tax', value: fmt.money(data.outward.cgst + data.outward.sgst + data.outward.igst), iconName: 'gst', accent: 'purple' }),
        stat({ label: 'Input tax credit', value: fmt.money(data.inward.itc), iconName: 'download', accent: 'green' }),
        stat({ label: 'Net payable', value: fmt.money(data.payable.total), iconName: 'money', accent: data.payable.total > 0 ? 'orange' : 'green' })),
      el('div.grid.cols-2',
        card({
          title: '3.1 Outward supplies',
          body: el('dl.kv',
            el('dt', 'Taxable value'), el('dd', fmt.money(data.outward.taxable)),
            el('dt', 'CGST'), el('dd', fmt.money(data.outward.cgst)),
            el('dt', 'SGST / UTGST'), el('dd', fmt.money(data.outward.sgst)),
            el('dt', 'IGST'), el('dd', fmt.money(data.outward.igst)),
            el('dt', el('b', 'Total output tax')), el('dd', el('b', fmt.money(data.outward.cgst + data.outward.sgst + data.outward.igst))))
        }),
        card({
          title: '4. Eligible ITC',
          body: el('dl.kv',
            el('dt', 'Inward taxable value'), el('dd', fmt.money(data.inward.taxable)),
            el('dt', 'Input GST in books'), el('dd', fmt.money(data.inward.gst)),
            el('dt', el('b', 'ITC available')), el('dd', el('b', fmt.money(data.inward.itc))))
        })),
      card({
        title: '5. Tax payable after ITC',
        body: el('div',
          el('dl.kv',
            el('dt', 'CGST payable'), el('dd', fmt.money(Math.max(0, data.payable.cgst))),
            el('dt', 'SGST payable'), el('dd', fmt.money(Math.max(0, data.payable.sgst))),
            el('dt', 'IGST payable'), el('dd', fmt.money(Math.max(0, data.payable.igst))),
            el('dt', el('b', 'Total payable')), el('dd', el('b', fmt.money(data.payable.total)))),
          el('div.note.mt-16', icon('info'), el('div',
            'These figures come from the bills saved on this computer. Always confirm against the portal before filing — '
            + 'MedV never connects to the GST portal on its own.')))
      }));
  }

  async function reconcilePanel() {
    const data = await call('gst.reconcile', { month });
    return el('div.col', { style: { gap: '16px' } },
      el('div.grid.cols-3',
        stat({ label: 'Documents checked', value: String(data.checked.sales + data.checked.purchases), sub: `${data.checked.sales} sales · ${data.checked.purchases} purchases`, iconName: 'list', accent: 'blue' }),
        stat({ label: 'Mismatches', value: String(data.mismatches.length), iconName: data.clean ? 'check' : 'alert', accent: data.clean ? 'green' : 'red' }),
        stat({ label: 'Status', value: data.clean ? 'Clean' : 'Needs review', iconName: 'shield', accent: data.clean ? 'green' : 'orange' })),
      data.notes.length
        ? el('div.note' + (data.clean ? '.ok' : '.warn'), icon(data.clean ? 'check' : 'alert'),
          el('div', ...data.notes.map((n) => el('div', n))))
        : null,
      card({
        title: 'Documents whose totals differ from their line items',
        subtitle: 'A mismatch usually means a bill was edited directly in the database',
        flush: true,
        body: dataTable({
          rows: data.mismatches,
          rowClass: () => 'row-danger',
          columns: [
            { key: 'type', label: 'Type' },
            { key: 'no', label: 'Document', render: (r) => el('b', r.no) },
            { key: 'date', label: 'Date', render: (r) => fmt.date(r.date) },
            { key: 'taxable_diff', label: 'Taxable difference', align: 'num', render: (r) => fmt.money(r.taxable_diff) },
            { key: 'gst_diff', label: 'GST difference', align: 'num', render: (r) => fmt.money(r.gst_diff) }
          ],
          empty: emptyState({ title: 'Everything reconciles', message: 'Every document matches the sum of its line items.', iconName: 'check' })
        })
      }));
  }

  async function draw() {
    const monthSelect = el('select', { style: { width: '190px' } },
      ...monthOptions().map((o) => el('option', { value: o.value, selected: o.value === month }, o.label)));
    monthSelect.addEventListener('change', () => { month = monthSelect.value; draw(); });

    mount(host,
      el('div.row.mb-16',
        tabs({ items: TABS, active: tab, onChange: (k) => { tab = k; draw(); } })),
      el('div.row.mb-16', el('span.fs-13.muted', 'Return period'), monthSelect),
      panel);
    mount(panel, el('div.skeleton', { style: { height: '140px' } }));
    const builders = { gstr1: gstr1Panel, gstr2: gstr2Panel, gstr3b: gstr3bPanel, reconcile: reconcilePanel };
    mount(panel, await builders[tab]());
  }

  await draw();
  return host;
}
