import { el, mount, debounce } from '../dom.js';
import { icon } from '../icons.js';
import * as fmt from '../format.js';
import { call, dialog } from '../api.js';
import { store, is } from '../store.js';
import { card, dataTable, emptyState, badge, toast, modal, confirm, formModal, form, searchBox, tabs, exportCsv } from '../ui.js';

const GST_RATES = [0, 5, 12, 18, 28];

function productFields(meta, values = {}) {
  return [
    { name: 'name', label: 'Medicine / product name', required: true, span: 2, autofocus: true, placeholder: 'Paracetamol 500mg Tablet' },
    { name: 'generic', label: 'Salt / generic name', span: 2, placeholder: 'Paracetamol' },
    { name: 'manufacturer', label: 'Manufacturer' },
    { name: 'category', label: 'Category', type: 'select', options: meta.categories },
    { name: 'schedule_type', label: 'Drug schedule', type: 'select', options: meta.schedules },
    { name: 'hsn', label: 'HSN code', placeholder: '3004' },
    { name: 'gst_rate', label: 'GST %', type: 'select', options: GST_RATES },
    { name: 'pack_size', label: 'Units per pack', type: 'number', min: 1, step: 1, help: 'e.g. 10 tablets in a strip' },
    { name: 'pack_label', label: 'Pack is called', placeholder: 'Strip' },
    { name: 'unit_label', label: 'Single unit is called', placeholder: 'Tablet' },
    { name: 'rack', label: 'Rack / shelf', placeholder: 'A1' },
    { name: 'reorder_level', label: 'Reorder level (units)', type: 'number', min: 0, step: 1 },
    { name: 'allow_loose', label: 'Can be sold loose (single tablets)', type: 'checkbox', span: 'full' },
    { name: 'active', label: 'Active — available while billing', type: 'checkbox', span: 'full' },
    ...(values.id ? [] : [])
  ];
}

export async function render({ query }) {
  const meta = await call('products.meta');
  const state = { search: query?.q || '', category: '', onlyActive: true, rows: [] };
  const tableHost = el('div');
  const countNode = el('span.hint');

  async function load() {
    mount(tableHost, el('div.skeleton', { style: { height: '120px', margin: '16px' } }));
    state.rows = await call('products.list', {
      search: state.search, category: state.category, onlyActive: state.onlyActive, limit: 2000
    });
    draw();
  }

  function draw() {
    countNode.textContent = `${state.rows.length} medicine${state.rows.length === 1 ? '' : 's'}`;
    mount(tableHost, dataTable({
      rows: state.rows,
      onRowClick: (row) => openBatches(row),
      rowClass: (row) => (row.stock_units === 0 ? 'row-warn' : ''),
      columns: [
        {
          key: 'name',
          label: 'Medicine',
          render: (r) => el('div',
            el('b', r.name),
            !r.active ? badge('inactive', 'danger') : null,
            el('div.fs-12.muted', [r.generic, r.manufacturer].filter(Boolean).join(' · ') || '—'))
        },
        { key: 'category', label: 'Category', render: (r) => el('div', r.category, r.schedule_type !== 'General' ? el('div', badge(r.schedule_type, 'warn')) : null) },
        { key: 'pack', label: 'Pack', render: (r) => (r.pack_size > 1 ? `${r.pack_size} ${r.unit_label} / ${r.pack_label}` : r.unit_label) },
        { key: 'rack', label: 'Rack', render: (r) => r.rack || '—' },
        { key: 'gst', label: 'GST', align: 'num', render: (r) => `${r.gst_rate}%` },
        { key: 'mrp', label: 'Last MRP', align: 'num', render: (r) => (r.last_mrp ? fmt.money(r.last_mrp) : '—') },
        {
          key: 'stock',
          label: 'Stock',
          render: (r) => (r.stock_units > 0
            ? el('div', el('b', r.stock_label), el('div.fs-12.muted', `${r.batch_count} batch(es)`))
            : badge('out of stock', 'danger'))
        },
        {
          key: 'flags',
          label: '',
          render: (r) => el('div.row.tight',
            r.low_stock && r.stock_units > 0 ? badge('low', 'warn') : null,
            r.min_expiry ? el('span.fs-12.muted', `exp ${fmt.expiry(r.min_expiry)}`) : null)
        },
        {
          key: 'actions',
          label: '',
          align: 'center',
          render: (r) => el('div.row.tight', { style: { flexWrap: 'nowrap' } },
            el('button.icon-btn', { title: 'Add batch / stock', onclick: () => addBatch(r) }, icon('plus')),
            el('button.icon-btn', { title: 'Edit medicine', onclick: () => editProduct(r) }, icon('edit')),
            is('admin', 'pharmacist')
              ? el('button.icon-btn', { title: 'Remove', onclick: () => removeProduct(r) }, icon('trash'))
              : null)
        }
      ],
      empty: emptyState({
        iconName: 'pill',
        title: state.search ? `Nothing matches “${state.search}”` : 'No medicines yet',
        message: 'Add medicines one by one, or import your catalogue from a spreadsheet.',
        action: el('button.btn.primary', { onclick: () => editProduct(null) }, icon('plus'), 'Add medicine')
      })
    }));
  }

  async function editProduct(row) {
    const values = row
      ? { ...row }
      : { category: 'Medicine', schedule_type: 'General', hsn: '3004', gst_rate: Number(store.settings.default_gst_rate) || 12, pack_size: 10, pack_label: 'Strip', unit_label: 'Tablet', allow_loose: 1, active: 1, reorder_level: 0 };
    const saved = await formModal({
      title: row ? `Edit ${row.name}` : 'New medicine',
      fields: productFields(meta, values),
      values,
      columns: 2,
      size: 'wide',
      submitLabel: row ? 'Save changes' : 'Add medicine',
      onSubmit: (v) => call('products.save', { ...v, id: row?.id })
    });
    if (saved) {
      toast(row ? 'Medicine updated.' : `${saved.name} added.`, { type: 'ok' });
      await load();
      if (!row) addBatch(saved);
    }
  }

  async function removeProduct(row) {
    const ok = await confirm({
      title: `Remove ${row.name}?`,
      message: 'If the medicine has stock or appears on saved bills it is marked inactive instead of deleted, so your records stay intact.',
      confirmLabel: 'Remove',
      danger: true
    });
    if (!ok) return;
    const res = await call('products.remove', { id: row.id });
    toast(res.deleted ? 'Medicine deleted.' : 'Medicine marked inactive.', { type: 'ok' });
    await load();
  }

  async function addBatch(product) {
    const saved = await formModal({
      title: `Add batch — ${product.name}`,
      columns: 2,
      submitLabel: 'Add batch',
      note: 'Use this for opening stock or a quick correction. For supplier bills use Purchase entry so the payable is recorded too.',
      fields: [
        { name: 'batch_no', label: 'Batch number', required: true, autofocus: true },
        { name: 'expiry', label: 'Expiry (MM/YYYY)', required: true, placeholder: '06/2028' },
        { name: 'mrp', label: `MRP per ${product.pack_label}`, type: 'number', step: '0.01', required: true },
        { name: 'rate_per_unit', label: `Cost per ${product.unit_label}`, type: 'number', step: '0.001', help: 'Used for margin reports' },
        { name: 'qty_units', label: `Quantity in ${product.unit_label}s`, type: 'number', step: 1, required: true, help: product.pack_size > 1 ? `${product.pack_size} ${product.unit_label} = 1 ${product.pack_label}` : null }
      ],
      values: { mrp: product.last_mrp || '', rate_per_unit: product.last_rate || '' },
      onSubmit: (v) => call('batches.save', { ...v, product_id: product.id })
    });
    if (saved) {
      toast('Batch saved and stock updated.', { type: 'ok' });
      await load();
    }
  }

  async function openBatches(product) {
    const batches = await call('batches.list', { product_id: product.id });
    const body = el('div');
    const handle = modal({
      title: `${product.name} — batches`,
      size: 'wide',
      body
    });

    function drawBatches(rows) {
      mount(body,
        el('div.row.between.mb-16',
          el('div',
            el('div.fs-13.muted', [product.generic, product.manufacturer].filter(Boolean).join(' · ')),
            el('b', `In stock: ${product.stock_label}`)),
          el('button.btn.sm.primary', { onclick: async () => { handle.close(); await addBatch(product); } }, icon('plus'), 'Add batch')),
        dataTable({
          rows,
          compact: true,
          rowClass: (b) => (b.expired ? 'row-danger' : (b.expiring_soon ? 'row-warn' : '')),
          columns: [
            { key: 'batch_no', label: 'Batch', render: (b) => el('b', b.batch_no) },
            {
              key: 'expiry',
              label: 'Expiry',
              render: (b) => el('div', fmt.expiry(b.expiry),
                b.expired ? badge('expired', 'danger') : (b.expiring_soon ? badge('soon', 'warn') : null))
            },
            { key: 'mrp', label: 'MRP', align: 'num', render: (b) => fmt.money(b.mrp) },
            { key: 'rate', label: 'Cost / unit', align: 'num', render: (b) => fmt.money(b.rate_per_unit) },
            { key: 'qty', label: 'Quantity', align: 'num', render: (b) => fmt.qtyLabel(b.qty_units, b.pack_size, b.pack_label, b.unit_label) },
            { key: 'value', label: 'Value at cost', align: 'num', render: (b) => fmt.money(b.qty_units * b.rate_per_unit) },
            {
              key: 'actions',
              label: '',
              align: 'center',
              render: (b) => el('div.row.tight', { style: { flexWrap: 'nowrap' } },
                el('button.btn.sm', { onclick: () => adjust(b) }, 'Adjust'),
                el('button.icon-btn', { title: 'Edit batch details', onclick: () => editBatch(b) }, icon('edit')),
                el('button.icon-btn', { title: 'Delete batch', onclick: () => removeBatch(b) }, icon('trash')))
            }
          ],
          empty: emptyState({ title: 'No batches yet', message: 'Add a batch to put this medicine on the shelf.', iconName: 'package' })
        }));
    }

    async function refresh() {
      const rows = await call('batches.list', { product_id: product.id });
      const fresh = await call('products.get', { id: product.id });
      Object.assign(product, fresh);
      drawBatches(rows);
      await load();
    }

    async function adjust(batch) {
      const saved = await formModal({
        title: `Adjust stock — batch ${batch.batch_no}`,
        columns: 1,
        submitLabel: 'Apply adjustment',
        note: `Current stock: ${batch.qty_units} ${product.unit_label}. Use a negative number to remove stock (breakage, expiry, sampling).`,
        fields: [
          { name: 'qty_units', label: 'Change in units (+/-)', type: 'number', step: 1, required: true, autofocus: true },
          { name: 'reason', label: 'Reason', required: true, placeholder: 'Damaged strip / physical count correction' }
        ],
        onSubmit: (v) => call('batches.adjust', { ...v, batch_id: batch.id })
      });
      if (saved) { toast('Stock adjusted.', { type: 'ok' }); await refresh(); }
    }

    async function editBatch(batch) {
      const saved = await formModal({
        title: `Edit batch ${batch.batch_no}`,
        columns: 2,
        fields: [
          { name: 'batch_no', label: 'Batch number', required: true },
          { name: 'expiry', label: 'Expiry (MM/YYYY)', required: true },
          { name: 'mrp', label: 'MRP', type: 'number', step: '0.01', required: true },
          { name: 'rate_per_unit', label: 'Cost per unit', type: 'number', step: '0.001' }
        ],
        values: { batch_no: batch.batch_no, expiry: batch.expiry, mrp: batch.mrp, rate_per_unit: batch.rate_per_unit },
        onSubmit: (v) => call('batches.save', { ...v, id: batch.id, product_id: product.id, qty_units: batch.qty_units })
      });
      if (saved) { toast('Batch updated.', { type: 'ok' }); await refresh(); }
    }

    async function removeBatch(batch) {
      const ok = await confirm({
        title: `Delete batch ${batch.batch_no}?`,
        message: 'This is only possible while the batch has never been billed.',
        danger: true,
        confirmLabel: 'Delete batch'
      });
      if (!ok) return;
      try {
        await call('batches.remove', { id: batch.id });
        toast('Batch deleted.', { type: 'ok' });
        await refresh();
      } catch { /* message already shown */ }
    }

    drawBatches(batches);
  }

  async function importCatalogue() {
    const file = await dialog.openSheet();
    if (!file) return;
    if (file.error) { toast(file.error, { type: 'error' }); return; }
    const ok = await confirm({
      title: 'Import medicine master',
      message: `Read “${file.name}” and create any medicine that is not already in your list?`,
      detail: 'Columns are detected from the header row: Product / Item name, Pack, HSN, GST%, Manufacturer.',
      confirmLabel: 'Import'
    });
    if (!ok) return;
    const result = await call('import.products', { filename: file.name, base64: file.base64 });
    toast(`${result.created} medicine(s) added${result.skipped.length ? `, ${result.skipped.length} skipped` : ''}.`, { type: 'ok' });
    if (result.skipped.length) {
      modal({
        title: 'Rows that were skipped',
        body: dataTable({
          rows: result.skipped,
          compact: true,
          columns: [{ key: 'name', label: 'Row' }, { key: 'reason', label: 'Reason' }]
        })
      });
    }
    await load();
  }

  const search = searchBox({
    placeholder: 'Search by name, salt or manufacturer…',
    value: state.search,
    autofocus: true,
    onInput: (value) => { state.search = value; load(); }
  });

  const head = el('div.row.mb-16',
    search,
    (() => {
      const sel = el('select', { style: { width: '170px' } },
        el('option', { value: '' }, 'All categories'),
        ...meta.categories.map((c) => el('option', { value: c }, c)));
      sel.addEventListener('change', () => { state.category = sel.value; load(); });
      return sel;
    })(),
    el('label.check',
      (() => {
        const cb = el('input', { type: 'checkbox', checked: true });
        cb.addEventListener('change', () => { state.onlyActive = cb.checked; load(); });
        return cb;
      })(),
      el('span', 'Active only')),
    el('div.spacer'),
    el('button.btn', { onclick: importCatalogue }, icon('upload'), 'Import list'),
    el('button.btn', {
      onclick: () => exportCsv([
        ['Name', 'Salt', 'Manufacturer', 'Category', 'Pack', 'HSN', 'GST%', 'Rack', 'Stock units', 'Stock', 'Reorder level'],
        ...state.rows.map((r) => [r.name, r.generic, r.manufacturer, r.category, r.pack_size, r.hsn, r.gst_rate, r.rack, r.stock_units, r.stock_label, r.reorder_level])
      ], 'medicines.csv')
    }, icon('download'), 'Export'),
    el('button.btn.primary', { onclick: () => editProduct(null) }, icon('plus'), 'New medicine'));

  await load();
  return el('div', head, card({ title: 'Medicine master', subtitle: null, actions: countNode, flush: true, body: tableHost }));
}
