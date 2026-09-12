import { el, mount } from '../dom.js';
import { icon } from '../icons.js';
import * as fmt from '../format.js';
import { call } from '../api.js';
import { card, dataTable, emptyState, badge, stat, searchBox, toast, modal, formModal, exportCsv, tabs } from '../ui.js';
import * as router from '../router.js';

const FIELDS = [
  { name: 'name', label: 'Supplier / distributor name', required: true, span: 2, autofocus: true },
  { name: 'phone', label: 'Phone' },
  { name: 'email', label: 'Email' },
  { name: 'gstin', label: 'GSTIN' },
  { name: 'dl_no', label: 'Drug licence number' },
  { name: 'address', label: 'Address', span: 'full' },
  { name: 'opening_balance', label: 'Opening payable ₹', type: 'number', step: '0.01' },
  { name: 'active', label: 'Active', type: 'checkbox' }
];

export async function render() {
  const state = { search: '', rows: [] };
  const host = el('div');

  async function load() {
    state.rows = await call('suppliers.list', { search: state.search });
    draw();
  }

  async function edit(row) {
    const saved = await formModal({
      title: row ? `Edit ${row.name}` : 'New supplier',
      fields: FIELDS,
      values: row ? { ...row } : { active: 1, opening_balance: 0 },
      columns: 2,
      submitLabel: row ? 'Save changes' : 'Add supplier',
      onSubmit: (v) => call('suppliers.save', { ...v, id: row?.id })
    });
    if (saved) { toast(row ? 'Supplier updated.' : 'Supplier added.', { type: 'ok' }); await load(); }
  }

  async function pay(row) {
    const saved = await formModal({
      title: `Pay ${row.name}`,
      columns: 2,
      submitLabel: 'Record payment',
      note: `Outstanding payable: ${fmt.money(row.balance)}`,
      fields: [
        { name: 'amount', label: 'Amount paid', type: 'number', step: '0.01', required: true, autofocus: true, value: row.balance > 0 ? row.balance : '' },
        { name: 'mode', label: 'Mode', type: 'select', options: ['Cash', 'UPI', 'Cheque', 'Bank Transfer', 'Card'] },
        { name: 'date', label: 'Date', type: 'date', value: fmt.today() },
        { name: 'ref_no', label: 'Reference / cheque no' },
        { name: 'notes', label: 'Notes', span: 'full' }
      ],
      onSubmit: (v) => call('payments.record', { ...v, party_type: 'supplier', party_id: row.id, direction: 'out' })
    });
    if (saved) { toast('Payment recorded.', { type: 'ok' }); await load(); }
  }

  async function history(row) {
    const data = await call('suppliers.history', { id: row.id });
    let tab = 'purchases';
    const body = el('div');
    modal({ title: `${row.name} — account`, size: 'wide', body });

    function drawHistory() {
      mount(body,
        el('div.grid.cols-3.mb-16',
          stat({ label: 'Purchase bills', value: String(data.purchases.length), iconName: 'truck', accent: 'blue' }),
          stat({ label: 'Payable', value: fmt.money(data.supplier.balance), iconName: 'money', accent: data.supplier.balance > 0 ? 'orange' : 'green' }),
          stat({ label: 'Purchased value', value: fmt.money(data.purchases.reduce((s, p) => s + p.total, 0)), iconName: 'package', accent: 'purple' })),
        el('div.row.mb-16',
          tabs({
            items: [{ key: 'purchases', label: 'Purchases' }, { key: 'payments', label: 'Payments' }],
            active: tab,
            pill: true,
            onChange: (k) => { tab = k; drawHistory(); }
          }),
          el('div.spacer'),
          el('button.btn.sm.teal', { onclick: () => pay(data.supplier) }, icon('wallet'), 'Record payment')),
        tab === 'purchases'
          ? dataTable({
            rows: data.purchases,
            compact: true,
            columns: [
              { key: 'no', label: 'Entry', render: (p) => el('b', p.no) },
              { key: 'date', label: 'Date', render: (p) => fmt.date(p.date) },
              { key: 'ref_no', label: 'Supplier bill', render: (p) => p.ref_no || '—' },
              { key: 'total', label: 'Total', align: 'num', render: (p) => fmt.money(p.total) },
              { key: 'paid', label: 'Paid', align: 'num', render: (p) => fmt.money(p.paid) },
              { key: 'due', label: 'Balance', align: 'num', render: (p) => (p.total - p.paid > 0.01 ? el('span.warn-text', fmt.money(p.total - p.paid)) : '—') }
            ],
            empty: emptyState({ title: 'No purchases from this supplier', iconName: 'truck' })
          })
          : dataTable({
            rows: data.payments,
            compact: true,
            columns: [
              { key: 'date', label: 'Date', render: (p) => fmt.date(p.date) },
              { key: 'mode', label: 'Mode' },
              { key: 'ref_no', label: 'Reference', render: (p) => p.ref_no || '—' },
              { key: 'notes', label: 'Notes', render: (p) => p.notes || '—' },
              { key: 'amount', label: 'Amount', align: 'num', render: (p) => fmt.money(p.amount) }
            ],
            empty: emptyState({ title: 'No payments recorded', iconName: 'wallet' })
          }));
    }
    drawHistory();
  }

  function draw() {
    const payable = state.rows.reduce((s, r) => s + Math.max(0, r.balance), 0);
    mount(host,
      el('div.grid.cols-3.mb-16',
        stat({ label: 'Suppliers', value: String(state.rows.length), iconName: 'supplier', accent: 'blue' }),
        stat({ label: 'Total payable', value: fmt.money(payable), iconName: 'money', accent: payable > 0 ? 'orange' : 'green' }),
        stat({ label: 'With a balance', value: String(state.rows.filter((r) => r.balance > 0.01).length), iconName: 'alert', accent: 'purple' })),
      el('div.row.mb-16',
        searchBox({ placeholder: 'Search supplier…', value: state.search, autofocus: true, onInput: (v) => { state.search = v; load(); } }),
        el('div.spacer'),
        el('button.btn', {
          onclick: () => exportCsv([
            ['Name', 'Phone', 'GSTIN', 'Drug licence', 'Bills', 'Last purchase', 'Payable'],
            ...state.rows.map((r) => [r.name, r.phone, r.gstin, r.dl_no, r.bill_count, r.last_purchase || '', r.balance])
          ], 'suppliers.csv')
        }, icon('download'), 'Export'),
        el('button.btn', { onclick: () => router.navigate('#/purchases/new') }, icon('truck'), 'Purchase entry'),
        el('button.btn.primary', { onclick: () => edit(null) }, icon('plus'), 'New supplier')),
      card({
        title: 'Suppliers & distributors',
        flush: true,
        body: dataTable({
          rows: state.rows,
          onRowClick: history,
          columns: [
            { key: 'name', label: 'Supplier', render: (r) => el('div', el('b', r.name), el('div.fs-12.muted', [r.phone, r.address].filter(Boolean).join(' · ') || '—')) },
            { key: 'gstin', label: 'GSTIN', render: (r) => r.gstin || el('span.muted', 'not set') },
            { key: 'dl_no', label: 'Drug licence', render: (r) => r.dl_no || '—' },
            { key: 'bill_count', label: 'Bills', align: 'num' },
            { key: 'last_purchase', label: 'Last purchase', render: (r) => (r.last_purchase ? fmt.date(r.last_purchase) : '—') },
            {
              key: 'balance', label: 'Payable', align: 'num',
              render: (r) => (r.balance > 0.01 ? el('span.warn-text', el('b', fmt.money(r.balance))) : el('span.muted', '—'))
            },
            {
              key: 'actions', label: '', align: 'center',
              render: (r) => el('div.row.tight', { style: { flexWrap: 'nowrap' } },
                r.balance > 0.01 ? el('button.btn.sm.teal', { onclick: () => pay(r) }, icon('wallet'), 'Pay') : null,
                el('button.icon-btn', { title: 'Edit', onclick: () => edit(r) }, icon('edit')))
            }
          ],
          empty: emptyState({
            iconName: 'supplier',
            title: 'No suppliers yet',
            message: 'Add your distributors so purchase bills and payables are tracked.',
            action: el('button.btn.primary', { onclick: () => edit(null) }, 'New supplier')
          })
        })
      }));
  }

  await load();
  return host;
}
