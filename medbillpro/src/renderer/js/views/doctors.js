import { el, mount } from '../dom.js';
import { icon } from '../icons.js';
import * as fmt from '../format.js';
import { call } from '../api.js';
import { card, dataTable, emptyState, badge, stat, tabs, toast, formModal, confirm, searchBox, exportCsv } from '../ui.js';

export async function render() {
  let tab = 'doctors';
  const host = el('div');
  let doctors = [];
  let commissions = [];
  let search = '';

  async function load() {
    [doctors, commissions] = await Promise.all([
      call('doctors.list', { search }),
      call('doctors.commissions', {})
    ]);
    draw();
  }

  async function edit(row) {
    const saved = await formModal({
      title: row ? `Edit ${row.name}` : 'New doctor',
      columns: 2,
      submitLabel: row ? 'Save changes' : 'Add doctor',
      values: row ? { ...row } : { active: 1, commission_pct: 0 },
      fields: [
        { name: 'name', label: 'Doctor name', required: true, span: 2, autofocus: true, placeholder: 'Dr. A. Deshmukh' },
        { name: 'clinic', label: 'Clinic / hospital', span: 2 },
        { name: 'phone', label: 'Phone' },
        { name: 'reg_no', label: 'Registration number' },
        { name: 'commission_pct', label: 'Commission %', type: 'number', step: '0.5', min: 0, max: 100, help: 'Recorded on every bill referred by this doctor' },
        { name: 'active', label: 'Active', type: 'checkbox' }
      ],
      onSubmit: (v) => call('doctors.save', { ...v, id: row?.id })
    });
    if (saved) { toast(row ? 'Doctor updated.' : 'Doctor added.', { type: 'ok' }); await load(); }
  }

  async function settle(rows) {
    const ok = await confirm({
      title: 'Mark commission as paid?',
      message: `${rows.length} entry(ies) totalling ${fmt.money(rows.reduce((s, r) => s + r.amount, 0))} will be marked settled.`,
      confirmLabel: 'Mark paid'
    });
    if (!ok) return;
    await call('doctors.settleCommission', { ids: rows.map((r) => r.id), paid: 1 });
    toast('Commission marked paid.', { type: 'ok' });
    await load();
  }

  function draw() {
    const due = commissions.filter((c) => !c.paid);
    mount(host,
      el('div.grid.cols-3.mb-16',
        stat({ label: 'Doctors', value: String(doctors.length), iconName: 'doctor', accent: 'blue' }),
        stat({ label: 'Referred bills', value: String(doctors.reduce((s, d) => s + d.referrals, 0)), iconName: 'billing', accent: 'purple' }),
        stat({ label: 'Commission due', value: fmt.money(due.reduce((s, c) => s + c.amount, 0)), iconName: 'money', accent: due.length ? 'orange' : 'green' })),
      el('div.row.mb-16',
        tabs({
          items: [{ key: 'doctors', label: 'Doctors' }, { key: 'commission', label: 'Commission', count: due.length }],
          active: tab,
          pill: true,
          onChange: (k) => { tab = k; draw(); }
        }),
        el('div.spacer'),
        searchBox({ placeholder: 'Search doctor…', value: search, width: '240px', onInput: (v) => { search = v; load(); } }),
        el('button.btn.primary', { onclick: () => edit(null) }, icon('plus'), 'New doctor')),
      tab === 'doctors'
        ? card({
          title: 'Referring doctors',
          flush: true,
          body: dataTable({
            rows: doctors,
            onRowClick: edit,
            columns: [
              { key: 'name', label: 'Doctor', render: (r) => el('div', el('b', r.name), el('div.fs-12.muted', [r.clinic, r.phone].filter(Boolean).join(' · ') || '—')) },
              { key: 'reg_no', label: 'Reg. no', render: (r) => r.reg_no || '—' },
              { key: 'referrals', label: 'Bills referred', align: 'num' },
              { key: 'commission_pct', label: 'Commission', align: 'num', render: (r) => (r.commission_pct ? `${r.commission_pct}%` : '—') },
              { key: 'commission_total', label: 'Earned', align: 'num', render: (r) => fmt.money(r.commission_total) },
              { key: 'commission_due', label: 'Due', align: 'num', render: (r) => (r.commission_due > 0.01 ? el('span.warn-text', fmt.money(r.commission_due)) : '—') }
            ],
            empty: emptyState({
              iconName: 'doctor',
              title: 'No doctors yet',
              message: 'Add the doctors who refer patients to you — bills can then be tagged to them.',
              action: el('button.btn.primary', { onclick: () => edit(null) }, 'New doctor')
            })
          })
        })
        : card({
          title: 'Commission ledger',
          subtitle: `${due.length} unpaid entry(ies)`,
          actions: el('div.row.tight',
            due.length ? el('button.btn.sm.teal', { onclick: () => settle(due) }, icon('check'), 'Mark all paid') : null,
            el('button.btn.sm', {
              onclick: () => exportCsv([
                ['Date', 'Doctor', 'Bill', 'Base amount', 'Percent', 'Commission', 'Paid'],
                ...commissions.map((c) => [c.date, c.doctor_name, c.invoice_no || '', c.base_amount, c.pct, c.amount, c.paid ? 'Yes' : 'No'])
              ], 'doctor-commission.csv')
            }, icon('download'), 'Export')),
          flush: true,
          body: dataTable({
            rows: commissions,
            rowClass: (c) => (c.paid ? '' : 'row-warn'),
            columns: [
              { key: 'date', label: 'Date', render: (c) => fmt.date(c.date) },
              { key: 'doctor_name', label: 'Doctor' },
              { key: 'invoice_no', label: 'Bill', render: (c) => c.invoice_no || '—' },
              { key: 'base_amount', label: 'Bill value', align: 'num', render: (c) => fmt.money(c.base_amount) },
              { key: 'pct', label: '%', align: 'num', render: (c) => `${c.pct}%` },
              { key: 'amount', label: 'Commission', align: 'num', render: (c) => el('b', fmt.money(c.amount)) },
              {
                key: 'paid', label: 'Status', align: 'center',
                render: (c) => (c.paid
                  ? badge('paid', 'ok')
                  : el('button.btn.sm', { onclick: () => settle([c]) }, 'Mark paid'))
              }
            ],
            empty: emptyState({ title: 'No commission recorded yet', message: 'Set a commission % on a doctor, then tag bills to them.', iconName: 'money' })
          })
        }));
  }

  await load();
  return host;
}
