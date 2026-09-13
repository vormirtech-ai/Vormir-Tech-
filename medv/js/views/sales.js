import { el, mount } from '../dom.js';
import { icon } from '../icons.js';
import * as fmt from '../format.js';
import { call } from '../api.js';
import { store, is } from '../store.js';
import { card, dataTable, emptyState, badge, tabs, stat, searchBox, dateRange, exportCsv, toast, modal, confirm, formModal } from '../ui.js';
import { invoiceMarkup, printMarkup, savePdf, reportMarkup } from '../print.js';
import * as router from '../router.js';

/** Bill list, plus the single-bill view when a bill id is in the route. */
export async function render(ctx) {
  if (ctx.params?.id) return billDetail(Number(ctx.params.id));

  const state = {
    from: fmt.monthStart(),
    to: fmt.today(),
    search: ctx.query?.q || '',
    unpaidOnly: ctx.query?.unpaid === '1',
    rows: [],
    totals: {}
  };
  const host = el('div');

  async function load() {
    const data = await call('sales.list', { ...state, limit: 1000 });
    state.rows = data.rows;
    state.totals = data.totals;
    draw();
  }

  function draw() {
    mount(host,
      el('div.grid.cols-4.mb-16',
        stat({ label: 'Bills', value: String(state.totals.count || 0), iconName: 'list', accent: 'blue' }),
        stat({ label: 'Sales value', value: fmt.money(state.totals.total), iconName: 'trending', accent: 'green' }),
        stat({ label: 'Collected', value: fmt.money(state.totals.paid), sub: `Due ${fmt.money(state.totals.due)}`, iconName: 'wallet', accent: state.totals.due > 0 ? 'orange' : 'green' }),
        stat({ label: 'GST collected', value: fmt.money(state.totals.gst), sub: `Margin ${fmt.money(state.totals.profit)}`, iconName: 'gst', accent: 'purple' })),
      el('div.row.mb-16',
        dateRange({ from: state.from, to: state.to, onChange: (r) => { Object.assign(state, r); load(); } }),
        el('div.spacer'),
        searchBox({ placeholder: 'Bill no, patient or Rx…', value: state.search, width: '260px', onInput: (v) => { state.search = v; load(); } })),
      el('div.row.mb-16',
        el('label.check',
          (() => {
            const cb = el('input', { type: 'checkbox', checked: state.unpaidOnly });
            cb.addEventListener('change', () => { state.unpaidOnly = cb.checked; load(); });
            return cb;
          })(),
          el('span', 'Only bills with a balance')),
        el('div.spacer'),
        el('button.btn', {
          onclick: () => exportCsv([
            ['Bill', 'Date', 'Patient', 'Doctor', 'Mode', 'Taxable', 'GST', 'Total', 'Paid', 'Balance'],
            ...state.rows.map((r) => [r.no, r.date, r.customer_name || r.patient_name, r.doctor_name || '', r.payment_mode,
              r.subtotal, r.gst_amount, r.total, r.paid, (r.total - r.paid).toFixed(2)])
          ], `bills-${state.from}-to-${state.to}.csv`)
        }, icon('download'), 'Export'),
        el('button.btn.primary', { onclick: () => router.navigate('#/billing') }, icon('plus'), 'New bill (F2)')),
      card({
        title: 'Bills',
        subtitle: `${fmt.date(state.from)} — ${fmt.date(state.to)}`,
        flush: true,
        body: dataTable({
          rows: state.rows,
          onRowClick: (row) => router.navigate(`#/sales/${row.id}`),
          rowClass: (row) => (row.total - row.paid > 0.01 ? 'row-warn' : ''),
          columns: [
            { key: 'no', label: 'Bill', render: (r) => el('div', el('b', r.no), el('div.fs-12.muted', fmt.date(r.date))) },
            {
              key: 'patient', label: 'Patient',
              render: (r) => el('div', r.customer_name || r.patient_name || 'Walk-in',
                r.doctor_name ? el('div.fs-12.muted', `Dr. ref: ${r.doctor_name}`) : null)
            },
            { key: 'line_count', label: 'Items', align: 'num' },
            { key: 'payment_mode', label: 'Mode', render: (r) => badge(r.payment_mode, r.payment_mode === 'Credit' ? 'warn' : '') },
            { key: 'subtotal', label: 'Taxable', align: 'num', render: (r) => fmt.money(r.subtotal) },
            { key: 'gst_amount', label: 'GST', align: 'num', render: (r) => fmt.money(r.gst_amount) },
            { key: 'total', label: 'Total', align: 'num', render: (r) => el('b', fmt.money(r.total)) },
            {
              key: 'balance', label: 'Balance', align: 'num',
              render: (r) => (r.total - r.paid > 0.01 ? el('span.warn-text', fmt.money(r.total - r.paid)) : el('span.muted', '—'))
            },
            {
              key: 'actions', label: '', align: 'center',
              render: (r) => el('button.icon-btn', {
                title: 'Print invoice',
                onclick: async () => {
                  const sale = await call('sales.get', { id: r.id });
                  const format = store.settings.print_format || 'a5';
                  await printMarkup(invoiceMarkup(sale, { format }), format);
                }
              }, icon('print'))
            }
          ],
          footer: ['Total', '', '', '', fmt.money(state.totals.total - state.totals.gst), fmt.money(state.totals.gst), fmt.money(state.totals.total), fmt.money(state.totals.due), ''],
          empty: emptyState({
            iconName: 'billing',
            title: 'No bills in this period',
            message: 'Change the dates above, or raise a new bill.',
            action: el('button.btn.primary', { onclick: () => router.navigate('#/billing') }, 'New bill')
          })
        })
      }));
  }

  await load();
  return host;
}

async function billDetail(id) {
  const sale = await call('sales.get', { id });
  if (!sale) {
    return card({ body: emptyState({ title: 'That bill no longer exists', iconName: 'alert' }) });
  }
  const host = el('div');
  const format = store.settings.print_format || 'a5';

  async function reload() {
    const fresh = await call('sales.get', { id });
    Object.assign(sale, fresh);
    draw();
  }

  async function collect() {
    const saved = await formModal({
      title: `Collect against ${sale.no}`,
      columns: 2,
      submitLabel: 'Record receipt',
      note: `Balance on this bill: ${fmt.money(sale.balance)}`,
      fields: [
        { name: 'amount', label: 'Amount received', type: 'number', step: '0.01', required: true, autofocus: true, value: sale.balance },
        { name: 'mode', label: 'Mode', type: 'select', options: ['Cash', 'UPI', 'Card', 'Cheque', 'Bank Transfer'] },
        { name: 'date', label: 'Date', type: 'date', value: fmt.today() }
      ],
      onSubmit: (v) => call('sales.collect', { ...v, id })
    });
    if (saved) { toast('Receipt recorded.', { type: 'ok' }); await reload(); }
  }

  async function remove() {
    const ok = await confirm({
      title: `Delete bill ${sale.no}?`,
      message: 'The stock goes back to its batches and the payment entry is reversed. This cannot be undone.',
      detail: 'Prefer a sales return if the patient actually returned the medicines — that keeps the audit trail.',
      danger: true,
      confirmLabel: 'Delete bill'
    });
    if (!ok) return;
    await call('sales.remove', { id, reason: 'deleted from bill view' });
    toast('Bill deleted and stock restored.', { type: 'ok' });
    router.navigate('#/sales');
  }

  function draw() {
    const preview = el('div', { html: invoiceMarkup(sale, { format: 'a5' }) });
    preview.style.cssText = 'background:#fff;padding:14px;border-radius:12px;border:1px solid var(--border);overflow:auto';
    mount(host,
      el('div.row.mb-16',
        el('button.btn', { onclick: () => router.navigate('#/sales') }, icon('returns'), 'Back to bills'),
        el('div.spacer'),
        sale.balance > 0.009 ? el('button.btn.teal', { onclick: collect }, icon('wallet'), `Collect ${fmt.money(sale.balance)}`) : null,
        el('button.btn', { onclick: () => router.navigate(`#/returns?bill=${encodeURIComponent(sale.no)}`) }, icon('returns'), 'Sales return'),
        el('button.btn', { onclick: () => savePdf(invoiceMarkup(sale, { format }), format, `${sale.no}.pdf`) }, icon('download'), 'Save PDF'),
        el('button.btn.primary', { onclick: () => printMarkup(invoiceMarkup(sale, { format }), format) }, icon('print'), 'Print'),
        is('admin') ? el('button.btn.danger', { onclick: remove }, icon('trash'), 'Delete') : null),
      el('div.grid', { style: { gridTemplateColumns: 'minmax(0, 1fr) 340px' } },
        card({ title: `Bill ${sale.no}`, subtitle: fmt.dateLong(sale.date), body: preview }),
        el('div.col', { style: { gap: '16px' } },
          card({
            title: 'Summary',
            body: el('dl.kv',
              el('dt', 'Patient'), el('dd', sale.customer_name || sale.patient_name || 'Walk-in'),
              el('dt', 'Phone'), el('dd', sale.customer_phone || sale.patient_phone || '—'),
              el('dt', 'Doctor'), el('dd', sale.doctor_name || '—'),
              el('dt', 'Payment'), el('dd', sale.payment_mode),
              el('dt', 'Taxable'), el('dd', fmt.money(sale.subtotal)),
              el('dt', 'GST'), el('dd', fmt.money(sale.gst_amount)),
              el('dt', 'Total'), el('dd', fmt.money(sale.total)),
              el('dt', 'Paid'), el('dd', fmt.money(sale.paid)),
              el('dt', 'Balance'), el('dd', sale.balance > 0.009 ? el('span.warn-text', fmt.money(sale.balance)) : '—'),
              el('dt', 'Margin'), el('dd', fmt.money(sale.subtotal - sale.cost_total)),
              el('dt', 'Billed by'), el('dd', sale.created_by || '—'),
              el('dt', 'Saved at'), el('dd', fmt.stamp(sale.created_at)))
          }),
          card({
            title: 'GST break-up',
            flush: true,
            body: dataTable({
              compact: true,
              rows: sale.gst_summary,
              columns: [
                { key: 'rate', label: 'Rate', render: (g) => `${g.rate}%` },
                { key: 'taxable', label: 'Taxable', align: 'num', render: (g) => fmt.money(g.taxable) },
                { key: 'cgst', label: sale.inter_state ? 'IGST' : 'CGST', align: 'num', render: (g) => fmt.money(sale.inter_state ? g.igst : g.cgst) },
                ...(sale.inter_state ? [] : [{ key: 'sgst', label: 'SGST', align: 'num', render: (g) => fmt.money(g.sgst) }])
              ]
            })
          }))));
  }

  draw();
  return host;
}
