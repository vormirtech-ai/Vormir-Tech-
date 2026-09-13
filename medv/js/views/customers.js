import { el, mount } from '../dom.js';
import { icon } from '../icons.js';
import * as fmt from '../format.js';
import { call, shellApi, clipboard } from '../api.js';
import { store } from '../store.js';
import { card, dataTable, emptyState, badge, stat, searchBox, toast, modal, confirm, formModal, exportCsv, tabs } from '../ui.js';
import * as router from '../router.js';

const FIELDS = [
  { name: 'name', label: 'Patient / customer name', required: true, span: 2, autofocus: true },
  { name: 'phone', label: 'Phone' },
  { name: 'dob', label: 'Date of birth', type: 'date' },
  { name: 'address', label: 'Address', span: 'full' },
  { name: 'gstin', label: 'GSTIN (for business customers)' },
  { name: 'opening_balance', label: 'Opening balance ₹', type: 'number', step: '0.01', help: 'Amount they already owe you' },
  { name: 'notes', label: 'Notes (allergies, chronic conditions…)', type: 'textarea', span: 'full' },
  { name: 'active', label: 'Active', type: 'checkbox', span: 'full' }
];

export async function render({ query }) {
  const state = { search: query?.q || '', rows: [] };
  const host = el('div');

  async function load() {
    state.rows = await call('customers.list', { search: state.search, limit: 1000 });
    draw();
  }

  async function edit(row) {
    const saved = await formModal({
      title: row ? `Edit ${row.name}` : 'New patient',
      fields: FIELDS,
      values: row ? { ...row } : { active: 1, opening_balance: 0 },
      columns: 2,
      submitLabel: row ? 'Save changes' : 'Add patient',
      onSubmit: (v) => call('customers.save', { ...v, id: row?.id })
    });
    if (saved) { toast(row ? 'Patient updated.' : 'Patient added.', { type: 'ok' }); await load(); }
  }

  async function receipt(row) {
    const saved = await formModal({
      title: `Receipt from ${row.name}`,
      columns: 2,
      submitLabel: 'Record receipt',
      note: `Outstanding balance: ${fmt.money(row.balance)}`,
      fields: [
        { name: 'amount', label: 'Amount received', type: 'number', step: '0.01', required: true, autofocus: true, value: row.balance > 0 ? row.balance : '' },
        { name: 'mode', label: 'Mode', type: 'select', options: ['Cash', 'UPI', 'Card', 'Cheque', 'Bank Transfer'] },
        { name: 'date', label: 'Date', type: 'date', value: fmt.today() },
        { name: 'ref_no', label: 'Reference' },
        { name: 'notes', label: 'Notes', span: 'full' }
      ],
      onSubmit: (v) => call('payments.record', { ...v, party_type: 'customer', party_id: row.id, direction: 'in' })
    });
    if (saved) { toast('Receipt recorded.', { type: 'ok' }); await load(); }
  }

  async function history(row) {
    const data = await call('customers.history', { id: row.id });
    let tab = 'bills';
    const body = el('div');
    modal({ title: `${row.name} — history`, size: 'wide', body });

    function drawHistory() {
      mount(body,
        el('div.grid.cols-3.mb-16',
          stat({ label: 'Bills', value: String(data.sales.length), iconName: 'list', accent: 'blue' }),
          stat({ label: 'Balance', value: fmt.money(data.customer.balance), iconName: 'money', accent: data.customer.balance > 0 ? 'orange' : 'green' }),
          stat({ label: 'Lifetime value', value: fmt.money(data.sales.reduce((s, r) => s + r.total, 0)), iconName: 'trending', accent: 'purple' })),
        el('div.row.mb-16',
          tabs({
            items: [{ key: 'bills', label: 'Bills' }, { key: 'payments', label: 'Receipts' }, { key: 'items', label: 'Medicines bought' }],
            active: tab,
            pill: true,
            onChange: (k) => { tab = k; drawHistory(); }
          }),
          el('div.spacer'),
          data.customer.phone
            ? el('button.btn.sm', {
              onclick: () => {
                const message = `Hello ${data.customer.name}, this is ${store.settings.store_name}. `
                  + `${data.customer.balance > 0 ? `Your pending balance is ${fmt.money(data.customer.balance)}. ` : ''}Thank you.`;
                shellApi.openExternal(`https://wa.me/91${String(data.customer.phone).replace(/\D/g, '').slice(-10)}?text=${encodeURIComponent(message)}`);
              }
            }, icon('chat'), 'WhatsApp')
            : null),
        tab === 'bills'
          ? dataTable({
            rows: data.sales,
            compact: true,
            onRowClick: (s) => router.navigate(`#/sales/${s.id}`),
            columns: [
              { key: 'no', label: 'Bill', render: (s) => el('b', s.no) },
              { key: 'date', label: 'Date', render: (s) => fmt.date(s.date) },
              { key: 'doctor_name', label: 'Doctor', render: (s) => s.doctor_name || '—' },
              { key: 'payment_mode', label: 'Mode', render: (s) => badge(s.payment_mode, s.payment_mode === 'Credit' ? 'warn' : '') },
              { key: 'total', label: 'Total', align: 'num', render: (s) => fmt.money(s.total) },
              { key: 'due', label: 'Balance', align: 'num', render: (s) => (s.total - s.paid > 0.01 ? el('span.warn-text', fmt.money(s.total - s.paid)) : '—') }
            ],
            empty: emptyState({ title: 'No bills yet', iconName: 'billing' })
          })
          : tab === 'payments'
            ? dataTable({
              rows: data.payments,
              compact: true,
              columns: [
                { key: 'date', label: 'Date', render: (p) => fmt.date(p.date) },
                { key: 'direction', label: 'Type', render: (p) => badge(p.direction === 'in' ? 'received' : 'refund', p.direction === 'in' ? 'ok' : 'warn') },
                { key: 'mode', label: 'Mode' },
                { key: 'ref_no', label: 'Reference', render: (p) => p.ref_no || '—' },
                { key: 'amount', label: 'Amount', align: 'num', render: (p) => fmt.money(p.amount) }
              ],
              empty: emptyState({ title: 'No receipts recorded', iconName: 'wallet' })
            })
            : dataTable({
              rows: data.items,
              compact: true,
              columns: [
                { key: 'name', label: 'Medicine' },
                { key: 'units', label: 'Units bought', align: 'num' },
                { key: 'last_date', label: 'Last bought', render: (i) => fmt.date(i.last_date) }
              ],
              empty: emptyState({ title: 'Nothing bought yet', iconName: 'pill' })
            }));
    }
    drawHistory();
  }

  function draw() {
    const totalDue = state.rows.reduce((s, r) => s + Math.max(0, r.balance), 0);
    mount(host,
      el('div.grid.cols-3.mb-16',
        stat({ label: 'Patients', value: String(state.rows.length), iconName: 'users', accent: 'blue' }),
        stat({ label: 'Total receivable', value: fmt.money(totalDue), iconName: 'money', accent: totalDue > 0 ? 'orange' : 'green' }),
        stat({ label: 'With a balance', value: String(state.rows.filter((r) => r.balance > 0.01).length), iconName: 'alert', accent: 'purple' })),
      el('div.row.mb-16',
        searchBox({ placeholder: 'Search by name or phone…', value: state.search, autofocus: true, onInput: (v) => { state.search = v; load(); } }),
        el('div.spacer'),
        el('button.btn', {
          onclick: () => exportCsv([
            ['Name', 'Phone', 'Address', 'GSTIN', 'Bills', 'Last visit', 'Balance'],
            ...state.rows.map((r) => [r.name, r.phone, r.address, r.gstin, r.bill_count, r.last_visit || '', r.balance])
          ], 'patients.csv')
        }, icon('download'), 'Export'),
        el('button.btn.primary', { onclick: () => edit(null) }, icon('plus'), 'New patient')),
      card({
        title: 'Patients & customers',
        flush: true,
        body: dataTable({
          rows: state.rows,
          onRowClick: history,
          columns: [
            { key: 'name', label: 'Name', render: (r) => el('div', el('b', r.name), el('div.fs-12.muted', [r.phone, r.address].filter(Boolean).join(' · ') || '—')) },
            { key: 'bill_count', label: 'Bills', align: 'num' },
            { key: 'last_visit', label: 'Last visit', render: (r) => (r.last_visit ? el('div', fmt.date(r.last_visit), el('div.fs-12.muted', fmt.relativeDays(r.last_visit))) : '—') },
            { key: 'gstin', label: 'GSTIN', render: (r) => r.gstin || '—' },
            {
              key: 'balance', label: 'Balance', align: 'num',
              render: (r) => (r.balance > 0.01
                ? el('span.warn-text', el('b', fmt.money(r.balance)))
                : (r.balance < -0.01 ? el('span.ok-text', `${fmt.money(-r.balance)} advance`) : el('span.muted', '—')))
            },
            {
              key: 'actions', label: '', align: 'center',
              render: (r) => el('div.row.tight', { style: { flexWrap: 'nowrap' } },
                r.balance > 0.01 ? el('button.btn.sm.teal', { onclick: () => receipt(r) }, icon('wallet'), 'Receipt') : null,
                el('button.icon-btn', { title: 'Edit', onclick: () => edit(r) }, icon('edit')))
            }
          ],
          empty: emptyState({
            iconName: 'users',
            title: 'No patients yet',
            message: 'Patients are added automatically while billing, or add one here.',
            action: el('button.btn.primary', { onclick: () => edit(null) }, 'New patient')
          })
        })
      }));
  }

  await load();
  return host;
}
