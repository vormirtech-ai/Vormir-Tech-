import { el, mount } from '../dom.js';
import { icon } from '../icons.js';
import * as fmt from '../format.js';
import { call, shellApi } from '../api.js';
import { store, loadSettings, applyTheme, is } from '../store.js';
import { card, dataTable, emptyState, badge, tabs, toast, confirm, form, formModal, dateRange } from '../ui.js';

const STATES = ['Andhra Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Delhi', 'Goa', 'Gujarat', 'Haryana',
  'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Odisha',
  'Punjab', 'Rajasthan', 'Tamil Nadu', 'Telangana', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal'];

const TABS = [
  { key: 'store', label: 'Shop profile' },
  { key: 'invoice', label: 'Invoice & billing' },
  { key: 'users', label: 'Users' },
  { key: 'audit', label: 'Activity log' },
  { key: 'about', label: 'About' }
];

export async function render({ query }) {
  let tab = query?.tab || 'store';
  const host = el('div');
  const panel = el('div');

  async function save(values, label = 'Settings saved.') {
    await call('settings.save', values);
    await loadSettings();
    toast(label, { type: 'ok' });
  }

  function storePanel() {
    const f = form([
      { name: 'store_name', label: 'Store name', required: true, span: 2 },
      { name: 'store_tagline', label: 'Line under the name', span: 2 },
      { name: 'store_address', label: 'Address', span: 2 },
      { name: 'store_city', label: 'City' },
      { name: 'store_state', label: 'State', type: 'select', options: STATES },
      { name: 'store_pincode', label: 'PIN code' },
      { name: 'store_phone', label: 'Phone' },
      { name: 'store_email', label: 'Email' },
      { kind: 'divider' },
      { name: 'store_gstin', label: 'GSTIN', help: 'Printed on every invoice and used in GST reports' },
      { name: 'store_dl_no', label: 'Drug licence number' },
      { name: 'store_fssai', label: 'FSSAI number' }
    ], store.settings, { columns: 4 });

    return card({
      title: 'Shop profile',
      subtitle: 'Appears on invoices and GST reports',
      body: f.node,
      footer: el('div.row.w-100',
        el('span.fs-12.muted', 'Changes apply to the next invoice you print.'),
        el('div.spacer'),
        el('button.btn.primary', {
          onclick: async () => { if (f.validate()) await save(f.values(), 'Shop profile saved.'); }
        }, icon('save'), 'Save profile'))
    });
  }

  function invoicePanel() {
    const f = form([
      { kind: 'heading', label: 'Numbering' },
      { name: 'invoice_prefix', label: 'Invoice prefix', width: 'sm' },
      { name: 'purchase_prefix', label: 'Purchase prefix', width: 'sm' },
      { name: 'sale_return_prefix', label: 'Sales return prefix', width: 'sm' },
      { name: 'purchase_return_prefix', label: 'Purchase return prefix', width: 'sm' },
      { kind: 'heading', label: 'Billing behaviour' },
      {
        name: 'print_format', label: 'Invoice paper', type: 'select',
        options: [{ value: 'a5', label: 'A5 — half sheet' }, { value: 'a4', label: 'A4 — full sheet' }, { value: 'thermal', label: '80 mm thermal roll' }]
      },
      { name: 'default_gst_rate', label: 'Default GST % for new medicines', type: 'select', options: [0, 5, 12, 18, 28] },
      { name: 'expiry_alert_days', label: 'Expiry warning (days)', type: 'number', min: 7, max: 365 },
      { name: 'rx_reminder_days', label: 'Default refill reminder (days)', type: 'number', min: 0, max: 365 },
      { name: 'round_off_invoice', label: 'Round invoice totals to the nearest rupee', type: 'checkbox', span: 'full' },
      { name: 'price_includes_gst', label: 'Selling rates already include GST (MRP-inclusive billing)', type: 'checkbox', span: 'full' },
      { kind: 'heading', label: 'Printed text' },
      { name: 'invoice_terms', label: 'Terms printed on the invoice', type: 'textarea', span: 'full' },
      { name: 'invoice_footer', label: 'Thank-you line', span: 'full' },
      { kind: 'heading', label: 'WhatsApp reminder template' },
      {
        name: 'whatsapp_template', label: 'Message', type: 'textarea', span: 'full',
        help: 'Placeholders: {name} {store} {medicines} {phone} {date}'
      },
      { kind: 'heading', label: 'Appearance' },
      { name: 'theme', label: 'Theme', type: 'select', options: [{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }], onChange: (v) => applyTheme(v) },
      { name: 'currency_symbol', label: 'Currency symbol', width: 'sm' },
      { name: 'backup_reminder_days', label: 'Remind me to back up every (days)', type: 'number', min: 1, max: 90 }
    ], {
      ...store.settings,
      round_off_invoice: store.settings.round_off_invoice === '1',
      price_includes_gst: store.settings.price_includes_gst === '1'
    }, { columns: 4 });

    return card({
      title: 'Invoice & billing',
      body: f.node,
      footer: el('div.row.w-100',
        el('div.spacer'),
        el('button.btn.primary', {
          onclick: async () => {
            const values = f.values();
            values.round_off_invoice = values.round_off_invoice ? '1' : '0';
            values.price_includes_gst = values.price_includes_gst ? '1' : '0';
            await save(values, 'Billing settings saved.');
          }
        }, icon('save'), 'Save settings'))
    });
  }

  async function usersPanel() {
    if (!is('admin')) {
      return card({ body: emptyState({ title: 'Only an administrator can manage users', iconName: 'shield' }) });
    }
    const users = await call('auth.users');

    async function edit(row) {
      const saved = await formModal({
        title: row ? `Edit ${row.name}` : 'New user',
        columns: 2,
        submitLabel: row ? 'Save user' : 'Create user',
        values: row ? { ...row } : { role: 'cashier', active: 1 },
        fields: [
          { name: 'username', label: 'Username', required: !row, disabled: Boolean(row), span: row ? 'full' : 1, autofocus: !row, help: row ? null : 'Letters, numbers, dot, dash and underscore' },
          ...(row ? [] : [{ name: 'name', label: 'Full name', required: true }]),
          ...(row ? [{ name: 'name', label: 'Full name', required: true }] : []),
          {
            name: 'role', label: 'Role', type: 'select',
            options: [
              { value: 'admin', label: 'Administrator — everything' },
              { value: 'pharmacist', label: 'Pharmacist — billing, stock, purchases' },
              { value: 'cashier', label: 'Cashier — billing and receipts only' }
            ]
          },
          { name: 'password', label: row ? 'New password (leave blank to keep)' : 'Password', type: 'password', required: !row },
          { name: 'active', label: 'Active', type: 'checkbox', span: 'full' }
        ],
        onSubmit: (v) => (row ? call('auth.updateUser', { ...v, id: row.id }) : call('auth.createUser', v))
      });
      if (saved) { toast(row ? 'User updated.' : 'User created.', { type: 'ok' }); mount(panel, await usersPanel()); }
    }

    return el('div.col', { style: { gap: '16px' } },
      card({
        title: 'Users of this computer',
        subtitle: 'Passwords are stored as scrypt hashes in the local database',
        actions: el('button.btn.sm.primary', { onclick: () => edit(null) }, icon('plus'), 'New user'),
        flush: true,
        body: dataTable({
          rows: users,
          onRowClick: edit,
          columns: [
            { key: 'name', label: 'Name', render: (r) => el('div', el('b', r.name), el('div.fs-12.muted', r.username)) },
            {
              key: 'role', label: 'Role',
              render: (r) => badge(r.role, r.role === 'admin' ? 'info' : (r.role === 'pharmacist' ? 'purple' : ''))
            },
            { key: 'active', label: 'Status', render: (r) => (r.active ? badge('active', 'ok') : badge('disabled', 'danger')) },
            {
              key: 'actions', label: '', align: 'center',
              render: (r) => el('div.row.tight', { style: { flexWrap: 'nowrap' } },
                el('button.icon-btn', { title: 'Edit', onclick: () => edit(r) }, icon('edit')),
                r.id !== store.user.id
                  ? el('button.icon-btn', {
                    title: 'Disable user',
                    onclick: async (event) => {
                      event.stopPropagation();
                      const ok = await confirm({ title: `Disable ${r.name}?`, message: 'They will no longer be able to sign in. Their past entries are kept.', danger: true, confirmLabel: 'Disable' });
                      if (!ok) return;
                      await call('auth.removeUser', { id: r.id });
                      toast('User disabled.', { type: 'ok' });
                      mount(panel, await usersPanel());
                    }
                  }, icon('trash'))
                  : null)
            }
          ]
        })
      }),
      card({
        title: 'What each role can do',
        body: el('dl.kv',
          el('dt', 'Administrator'), el('dd', 'Everything, including users, settings, deletions, backup and restore.'),
          el('dt', 'Pharmacist'), el('dd', 'Billing, medicines, batches, purchases, returns, reports and GST. Cannot manage users or restore data.'),
          el('dt', 'Cashier'), el('dd', 'Billing, patients and receipts. Purchases, suppliers, GST, settings and backup are hidden.'))
      }));
  }

  async function auditPanel() {
    if (!is('admin')) {
      return card({ body: emptyState({ title: 'Only an administrator can read the activity log', iconName: 'shield' }) });
    }
    const range = { from: fmt.addDays(fmt.today(), -7), to: fmt.today() };
    const tableHost = el('div');

    async function load() {
      const rows = await call('audit.list', { ...range, limit: 500 });
      mount(tableHost, dataTable({
        rows,
        compact: true,
        columns: [
          { key: 'at', label: 'When', render: (r) => fmt.stamp(r.at) },
          { key: 'username', label: 'User' },
          { key: 'action', label: 'Action', render: (r) => el('span.mono.fs-12', r.action) },
          { key: 'entity', label: 'Record', render: (r) => [r.entity, r.entity_id].filter(Boolean).join(' #') || '—' },
          { key: 'detail', label: 'Detail', render: (r) => el('span.fs-12.muted', r.detail || '—') }
        ],
        empty: emptyState({ title: 'Nothing logged in this period', iconName: 'list' })
      }));
    }

    await load();
    return card({
      title: 'Activity log',
      subtitle: 'Every change made on this computer',
      actions: dateRange({ from: range.from, to: range.to, onChange: (r) => { Object.assign(range, r); load(); } }),
      flush: true,
      body: tableHost
    });
  }

  async function aboutPanel() {
    const info = await call('app.info');
    return el('div.grid.cols-2',
      card({
        title: 'MedV',
        body: el('div',
          el('img', { src: 'assets/logo.png', alt: 'MedV', style: { height: '34px', marginBottom: '14px' } }),
          el('dl.kv',
            el('dt', 'Version'), el('dd', info.version),
            el('dt', 'Product'), el('dd', 'MedV — pharmacy management'),
            el('dt', 'Built by'), el('dd', 'Vormir Tech Solutions, Nagpur'),
            el('dt', 'Storage'), el('dd', 'SQLite on this computer'),
            el('dt', 'Internet'), el('dd', 'Not required for any feature')),
          el('div.note.mt-16', icon('shield'), el('div',
            el('b', 'Offline by design. '),
            'Billing, stock, GST, reports and backup all run from the local database. Nothing is uploaded.')))
      }),
      card({
        title: 'Files on this computer',
        body: el('div',
          el('dl.kv',
            el('dt', 'Database'), el('dd', el('span.mono.fs-12', info.paths.db)),
            el('dt', 'Backups'), el('dd', el('span.mono.fs-12', info.paths.backups)),
            el('dt', 'Exports'), el('dd', el('span.mono.fs-12', info.paths.exports))),
          el('div.row.mt-16',
            el('button.btn', { onclick: () => shellApi.showItem(info.paths.db) }, icon('folder'), 'Open data folder'),
            el('button.btn', { onclick: () => window.location.reload() }, icon('refresh'), 'Reload app')),
          el('div.note.mt-16', icon('info'), el('div',
            'Keyboard shortcuts are listed under Help → Keyboard shortcuts, or press F1.')))
      }));
  }

  async function draw() {
    mount(host, el('div.row.mb-16', tabs({ items: TABS, active: tab, onChange: (k) => { tab = k; draw(); } })), panel);
    mount(panel, el('div.skeleton', { style: { height: '140px' } }));
    const builders = { store: storePanel, invoice: invoicePanel, users: usersPanel, audit: auditPanel, about: aboutPanel };
    mount(panel, await builders[tab]());
  }

  await draw();
  return host;
}
