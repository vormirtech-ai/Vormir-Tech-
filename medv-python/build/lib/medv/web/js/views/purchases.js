import { el, mount } from '../dom.js';
import { icon } from '../icons.js';
import * as fmt from '../format.js';
import { call } from '../api.js';
import { is } from '../store.js';
import { card, dataTable, emptyState, badge, stat, searchBox, dateRange, exportCsv, toast, modal, confirm, formModal } from '../ui.js';
import { purchaseMarkup, printMarkup } from '../print.js';
import * as router from '../router.js';

export async function render({ query }) {
  const state = { from: fmt.monthStart(), to: fmt.today(), search: query?.q || '', unpaidOnly: query?.unpaid === '1', rows: [], totals: {} };
  const host = el('div');

  async function load() {
    const data = await call('purchases.list', { ...state, limit: 1000 });
    state.rows = data.rows;
    state.totals = data.totals;
    draw();
  }

  async function openPurchase(row) {
    const purchase = await call('purchases.get', { id: row.id });
    const body = el('div');
    const handle = modal({ title: `Purchase ${purchase.no}`, size: 'wide', body });

    function drawBody() {
      mount(body,
        el('div.row.between.mb-16',
          el('div',
            el('b', purchase.supplier_name || '—'),
            el('div.fs-12.muted', [purchase.ref_no ? `Bill ${purchase.ref_no}` : null, fmt.dateLong(purchase.date), purchase.supplier_gstin].filter(Boolean).join(' · '))),
          el('div.right',
            el('div.fs-18', el('b', fmt.money(purchase.total))),
            purchase.balance > 0.009 ? el('div.fs-12.warn-text', `Balance ${fmt.money(purchase.balance)}`) : el('div.fs-12.ok-text', 'Fully paid'))),
        dataTable({
          rows: purchase.items,
          compact: true,
          columns: [
            { key: 'name', label: 'Medicine', render: (r) => el('b', r.name) },
            { key: 'batch_no', label: 'Batch' },
            { key: 'expiry', label: 'Expiry', render: (r) => fmt.expiry(r.expiry) },
            { key: 'qty_units', label: 'Qty', align: 'num' },
            { key: 'free_units', label: 'Free', align: 'num', render: (r) => String(r.free_units || '—') },
            { key: 'rate_per_unit', label: 'Rate/unit', align: 'num', render: (r) => fmt.money(r.rate_per_unit) },
            { key: 'mrp', label: 'MRP', align: 'num', render: (r) => fmt.money(r.mrp) },
            { key: 'gst_rate', label: 'GST', align: 'num', render: (r) => `${r.gst_rate}%` },
            { key: 'total', label: 'Amount', align: 'num', render: (r) => fmt.money(r.total) }
          ],
          footer: ['Total', '', '', '', '', '', '', fmt.money(purchase.gst_amount), fmt.money(purchase.total)]
        }),
        el('div.row.mt-16',
          purchase.balance > 0.009
            ? el('button.btn.teal', {
              onclick: async () => {
                const saved = await formModal({
                  title: `Pay ${purchase.supplier_name}`,
                  columns: 2,
                  submitLabel: 'Record payment',
                  note: `Balance ${fmt.money(purchase.balance)}`,
                  fields: [
                    { name: 'amount', label: 'Amount', type: 'number', step: '0.01', required: true, value: purchase.balance, autofocus: true },
                    { name: 'mode', label: 'Mode', type: 'select', options: ['Cash', 'UPI', 'Cheque', 'Bank Transfer', 'Card'] },
                    { name: 'date', label: 'Date', type: 'date', value: fmt.today() }
                  ],
                  onSubmit: (v) => call('purchases.pay', { ...v, id: purchase.id })
                });
                if (saved) {
                  Object.assign(purchase, saved);
                  toast('Payment recorded.', { type: 'ok' });
                  drawBody();
                  load();
                }
              }
            }, icon('wallet'), 'Record payment')
            : null,
          el('div.spacer'),
          el('button.btn', { onclick: () => printMarkup(purchaseMarkup(purchase, { format: 'a4' }), 'a4') }, icon('print'), 'Print'),
          is('admin')
            ? el('button.btn.danger', {
              onclick: async () => {
                const ok = await confirm({
                  title: `Delete purchase ${purchase.no}?`,
                  message: 'Stock from this bill is taken back out and the payable is reversed.',
                  detail: 'If any of the stock has already been sold, delete is refused — raise a purchase return instead.',
                  danger: true,
                  confirmLabel: 'Delete purchase'
                });
                if (!ok) return;
                try {
                  await call('purchases.remove', { id: purchase.id });
                  toast('Purchase deleted.', { type: 'ok' });
                  handle.close();
                  load();
                } catch { /* handled */ }
              }
            }, icon('trash'), 'Delete')
            : null));
    }
    drawBody();
  }

  function draw() {
    mount(host,
      el('div.grid.cols-4.mb-16',
        stat({ label: 'Purchase bills', value: String(state.totals.count || 0), iconName: 'truck', accent: 'blue' }),
        stat({ label: 'Purchase value', value: fmt.money(state.totals.total), iconName: 'package', accent: 'purple' }),
        stat({ label: 'Paid', value: fmt.money(state.totals.paid), iconName: 'wallet', accent: 'green' }),
        stat({ label: 'Payable', value: fmt.money(state.totals.due), iconName: 'money', accent: state.totals.due > 0 ? 'orange' : 'green' })),
      el('div.row.mb-16',
        dateRange({ from: state.from, to: state.to, onChange: (r) => { Object.assign(state, r); load(); } }),
        el('div.spacer'),
        searchBox({ placeholder: 'Bill no or supplier…', value: state.search, width: '240px', onInput: (v) => { state.search = v; load(); } }),
        el('button.btn', {
          onclick: () => exportCsv([
            ['Purchase', 'Date', 'Supplier', 'Supplier bill', 'Taxable', 'GST', 'Total', 'Paid', 'Balance'],
            ...state.rows.map((r) => [r.no, r.date, r.supplier_name, r.ref_no, r.subtotal, r.gst_amount, r.total, r.paid, (r.total - r.paid).toFixed(2)])
          ], `purchases-${state.from}-to-${state.to}.csv`)
        }, icon('download'), 'Export'),
        el('button.btn.primary', { onclick: () => router.navigate('#/purchases/new') }, icon('plus'), 'New purchase (F4)')),
      card({
        title: 'Purchases',
        subtitle: `${fmt.date(state.from)} — ${fmt.date(state.to)}`,
        flush: true,
        body: dataTable({
          rows: state.rows,
          onRowClick: openPurchase,
          rowClass: (r) => (r.total - r.paid > 0.01 ? 'row-warn' : ''),
          columns: [
            { key: 'no', label: 'Entry', render: (r) => el('div', el('b', r.no), el('div.fs-12.muted', fmt.date(r.date))) },
            { key: 'supplier_name', label: 'Supplier', render: (r) => el('div', r.supplier_name || '—', r.ref_no ? el('div.fs-12.muted', `Bill ${r.ref_no}`) : null) },
            { key: 'line_count', label: 'Items', align: 'num' },
            { key: 'subtotal', label: 'Taxable', align: 'num', render: (r) => fmt.money(r.subtotal) },
            { key: 'gst_amount', label: 'GST', align: 'num', render: (r) => fmt.money(r.gst_amount) },
            { key: 'total', label: 'Total', align: 'num', render: (r) => el('b', fmt.money(r.total)) },
            { key: 'paid', label: 'Paid', align: 'num', render: (r) => fmt.money(r.paid) },
            {
              key: 'balance', label: 'Balance', align: 'num',
              render: (r) => (r.total - r.paid > 0.01 ? el('span.warn-text', fmt.money(r.total - r.paid)) : el('span.muted', '—'))
            }
          ],
          footer: ['Total', '', '', fmt.money(state.totals.total - state.totals.gst), fmt.money(state.totals.gst), fmt.money(state.totals.total), fmt.money(state.totals.paid), fmt.money(state.totals.due)],
          empty: emptyState({
            iconName: 'truck',
            title: 'No purchases in this period',
            message: 'Enter a supplier bill to bring stock in.',
            action: el('button.btn.primary', { onclick: () => router.navigate('#/purchases/new') }, 'New purchase')
          })
        })
      }));
  }

  await load();
  return host;
}
