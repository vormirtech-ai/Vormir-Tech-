import { el, mount } from '../dom.js';
import { icon } from '../icons.js';
import * as fmt from '../format.js';
import { call } from '../api.js';
import { is } from '../store.js';
import { card, dataTable, emptyState, badge, stat, tabs, toast, confirm, formModal, dateRange, exportCsv } from '../ui.js';
import { partyPicker } from '../pickers.js';

export async function render({ query }) {
  let tab = query?.tab || 'ledger';
  const range = { from: fmt.monthStart(), to: fmt.today() };
  const host = el('div');
  let balances = { cash: 0, bank: 0, total: 0 };

  async function load() {
    balances = await call('accounts.balances');
    draw();
  }

  // ------------------------------------------------------------- receipts
  async function recordMoney(direction) {
    let party = null;
    const partyType = direction === 'in' ? 'customer' : 'supplier';
    const picker = partyPicker({ type: partyType, onPick: (p) => { party = p; } });
    const saved = await formModal({
      title: direction === 'in' ? 'Receipt from a patient' : 'Payment to a supplier',
      columns: 2,
      submitLabel: 'Save entry',
      fields: [
        { kind: 'node', span: 'full', node: el('div.field.required', el('label', direction === 'in' ? 'Patient' : 'Supplier'), picker) },
        { name: 'amount', label: 'Amount', type: 'number', step: '0.01', required: true },
        { name: 'mode', label: 'Mode', type: 'select', options: ['Cash', 'UPI', 'Card', 'Cheque', 'Bank Transfer'] },
        { name: 'date', label: 'Date', type: 'date', value: fmt.today() },
        { name: 'ref_no', label: 'Reference' },
        { name: 'notes', label: 'Notes', span: 'full' }
      ],
      onSubmit: async (v) => {
        if (!party) { toast(`Choose a ${partyType} first.`, { type: 'error' }); return false; }
        return call('payments.record', { ...v, party_type: partyType, party_id: party.id, direction });
      }
    });
    if (saved) { toast('Entry saved.', { type: 'ok' }); await load(); }
  }

  async function recordExpense(row) {
    const meta = await call('expenses.meta');
    const saved = await formModal({
      title: row ? 'Edit expense' : 'New expense',
      columns: 2,
      submitLabel: row ? 'Save changes' : 'Save expense',
      values: row ? { ...row } : { date: fmt.today(), account: 'cash', category: 'General' },
      fields: [
        { name: 'category', label: 'Category', type: 'select', options: meta.categories, required: true },
        { name: 'amount', label: 'Amount', type: 'number', step: '0.01', required: true, autofocus: true },
        { name: 'payee', label: 'Paid to' },
        { name: 'date', label: 'Date', type: 'date', required: true },
        { name: 'account', label: 'Paid from', type: 'select', options: [{ value: 'cash', label: 'Cash' }, { value: 'bank', label: 'Bank' }] },
        { name: 'notes', label: 'Notes', span: 'full' }
      ],
      onSubmit: (v) => call('expenses.save', { ...v, id: row?.id })
    });
    if (saved) { toast('Expense saved.', { type: 'ok' }); await load(); }
  }

  async function transfer() {
    const saved = await formModal({
      title: 'Move money between cash and bank',
      columns: 2,
      submitLabel: 'Record transfer',
      values: { from: 'cash', to: 'bank', date: fmt.today() },
      fields: [
        { name: 'amount', label: 'Amount', type: 'number', step: '0.01', required: true, autofocus: true },
        { name: 'date', label: 'Date', type: 'date' },
        { name: 'from', label: 'From', type: 'select', options: [{ value: 'cash', label: 'Cash' }, { value: 'bank', label: 'Bank' }] },
        { name: 'to', label: 'To', type: 'select', options: [{ value: 'bank', label: 'Bank' }, { value: 'cash', label: 'Cash' }] },
        { name: 'notes', label: 'Notes', span: 'full', placeholder: 'Cash deposited at branch' }
      ],
      onSubmit: (v) => call('accounts.transfer', v)
    });
    if (saved) { toast('Transfer recorded.', { type: 'ok' }); await load(); }
  }

  // ------------------------------------------------------------- rendering
  async function ledgerPanel() {
    const data = await call('accounts.entries', { ...range, limit: 1000 });
    return card({
      title: 'Cash & bank book',
      subtitle: `${fmt.date(range.from)} — ${fmt.date(range.to)}`,
      actions: el('div.row.tight',
        el('button.btn.sm', {
          onclick: () => exportCsv([
            ['Date', 'Account', 'In/Out', 'Amount', 'Source', 'Description'],
            ...data.rows.map((r) => [r.date, r.account, r.direction, r.amount, r.source_type, r.description])
          ], `cash-book-${range.from}.csv`)
        }, icon('download'), 'Export'),
        el('button.btn.sm', { onclick: transfer }, icon('bank'), 'Cash ⇄ bank')),
      flush: true,
      body: dataTable({
        rows: data.rows,
        columns: [
          { key: 'date', label: 'Date', render: (r) => fmt.date(r.date) },
          { key: 'description', label: 'Particulars', render: (r) => el('div', r.description || '—', el('div.fs-12.muted', r.source_type)) },
          { key: 'account', label: 'Account', render: (r) => badge(r.account === 'cash' ? 'Cash' : 'Bank', r.account === 'cash' ? '' : 'info') },
          { key: 'in', label: 'Received', align: 'num', render: (r) => (r.direction === 'in' ? el('span.ok-text', fmt.money(r.amount)) : '—') },
          { key: 'out', label: 'Paid', align: 'num', render: (r) => (r.direction === 'out' ? el('span.danger-text', fmt.money(r.amount)) : '—') }
        ],
        footer: ['Opening ' + fmt.money(data.opening), '', 'Totals', fmt.money(data.totals.inflow), fmt.money(data.totals.outflow)],
        empty: emptyState({ title: 'No cash movement in this period', iconName: 'wallet' })
      })
    });
  }

  async function paymentsPanel() {
    const data = await call('payments.list', { ...range, limit: 1000 });
    return card({
      title: 'Receipts & payments',
      subtitle: `Received ${fmt.money(data.totals.received)} · Paid ${fmt.money(data.totals.paid)}`,
      actions: el('div.row.tight',
        el('button.btn.sm.teal', { onclick: () => recordMoney('in') }, icon('download'), 'Receipt'),
        el('button.btn.sm', { onclick: () => recordMoney('out') }, icon('upload'), 'Payment')),
      flush: true,
      body: dataTable({
        rows: data.rows,
        columns: [
          { key: 'date', label: 'Date', render: (r) => fmt.date(r.date) },
          { key: 'party_name', label: 'Party', render: (r) => el('div', r.party_name || '—', el('div.fs-12.muted', r.party_type)) },
          { key: 'direction', label: 'Type', render: (r) => badge(r.direction === 'in' ? 'received' : 'paid', r.direction === 'in' ? 'ok' : 'warn') },
          { key: 'mode', label: 'Mode' },
          { key: 'ref_no', label: 'Reference', render: (r) => r.ref_no || '—' },
          { key: 'notes', label: 'Notes', render: (r) => el('span.fs-12', r.notes || '—') },
          { key: 'amount', label: 'Amount', align: 'num', render: (r) => el('b', fmt.money(r.amount)) },
          {
            key: 'x', label: '', align: 'center',
            render: (r) => (is('admin') && !r.sale_id && !r.purchase_id
              ? el('button.icon-btn', {
                title: 'Delete entry',
                onclick: async () => {
                  const ok = await confirm({ title: 'Delete this entry?', message: 'The cash/bank balance is adjusted back.', danger: true });
                  if (!ok) return;
                  await call('payments.remove', { id: r.id });
                  toast('Entry deleted.', { type: 'ok' });
                  await load();
                }
              }, icon('trash'))
              : null)
          }
        ],
        empty: emptyState({ title: 'No receipts or payments in this period', iconName: 'money' })
      })
    });
  }

  async function expensesPanel() {
    const data = await call('expenses.list', { ...range, limit: 1000 });
    const byCategory = Object.entries(data.byCategory).sort((a, b) => b[1] - a[1]);
    return el('div.grid', { style: { gridTemplateColumns: 'minmax(0, 1fr) 300px' } },
      card({
        title: 'Expenses',
        subtitle: `Total ${fmt.money(data.total)}`,
        actions: el('div.row.tight',
          el('button.btn.sm', {
            onclick: () => exportCsv([
              ['Date', 'Category', 'Paid to', 'Account', 'Amount', 'Notes'],
              ...data.rows.map((r) => [r.date, r.category, r.payee, r.account, r.amount, r.notes])
            ], `expenses-${range.from}.csv`)
          }, icon('download'), 'Export'),
          el('button.btn.sm.primary', { onclick: () => recordExpense(null) }, icon('plus'), 'New expense')),
        flush: true,
        body: dataTable({
          rows: data.rows,
          onRowClick: recordExpense,
          columns: [
            { key: 'date', label: 'Date', render: (r) => fmt.date(r.date) },
            { key: 'category', label: 'Category', render: (r) => el('b', r.category) },
            { key: 'payee', label: 'Paid to', render: (r) => r.payee || '—' },
            { key: 'account', label: 'From', render: (r) => badge(r.account === 'cash' ? 'Cash' : 'Bank') },
            { key: 'notes', label: 'Notes', render: (r) => el('span.fs-12', r.notes || '—') },
            { key: 'amount', label: 'Amount', align: 'num', render: (r) => el('b', fmt.money(r.amount)) },
            {
              key: 'x', label: '', align: 'center',
              render: (r) => el('button.icon-btn', {
                title: 'Delete',
                onclick: async (event) => {
                  event.stopPropagation();
                  const ok = await confirm({ title: 'Delete this expense?', message: 'The cash/bank balance is adjusted back.', danger: true });
                  if (!ok) return;
                  await call('expenses.remove', { id: r.id });
                  toast('Expense deleted.', { type: 'ok' });
                  await load();
                }
              }, icon('trash'))
            }
          ],
          footer: ['', '', '', '', 'Total', fmt.money(data.total), ''],
          empty: emptyState({ title: 'No expenses recorded in this period', iconName: 'wallet' })
        })
      }),
      card({
        title: 'By category',
        flush: true,
        body: byCategory.length
          ? dataTable({
            compact: true,
            rows: byCategory.map(([category, amount]) => ({ category, amount })),
            columns: [
              { key: 'category', label: 'Category' },
              { key: 'amount', label: 'Amount', align: 'num', render: (r) => fmt.money(r.amount) }
            ]
          })
          : emptyState({ title: 'Nothing yet', iconName: 'report' })
      }));
  }

  async function draw() {
    const panel = el('div', el('div.skeleton', { style: { height: '120px' } }));
    mount(host,
      el('div.grid.cols-3.mb-16',
        stat({ label: 'Cash in hand', value: fmt.money(balances.cash), iconName: 'wallet', accent: 'green' }),
        stat({ label: 'Bank balance', value: fmt.money(balances.bank), iconName: 'bank', accent: 'blue' }),
        stat({ label: 'Total balance', value: fmt.money(balances.total), iconName: 'money', accent: 'purple' })),
      el('div.row.mb-16',
        tabs({
          items: [{ key: 'ledger', label: 'Cash & bank book' }, { key: 'payments', label: 'Receipts & payments' }, { key: 'expenses', label: 'Expenses' }],
          active: tab,
          pill: true,
          onChange: (k) => { tab = k; draw(); }
        }),
        el('div.spacer'),
        dateRange({ from: range.from, to: range.to, onChange: (r) => { Object.assign(range, r); draw(); } })),
      panel);
    const built = tab === 'ledger' ? await ledgerPanel() : (tab === 'payments' ? await paymentsPanel() : await expensesPanel());
    mount(panel, built);
  }

  await load();
  return host;
}
