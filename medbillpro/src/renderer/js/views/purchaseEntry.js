import { el, mount, clear } from '../dom.js';
import { icon } from '../icons.js';
import * as fmt from '../format.js';
import { call, dialog } from '../api.js';
import { store } from '../store.js';
import { card, dataTable, emptyState, badge, toast, modal, confirm, form, formModal } from '../ui.js';
import { productPicker, partyPicker } from '../pickers.js';
import { lineTotals, roundOff, r2, r3 } from '../calc.js';
import { purchaseMarkup, printMarkup } from '../print.js';
import * as router from '../router.js';

/** Purchase entry — type the bill, or import the distributor's spreadsheet. */
export async function render() {
  const entry = {
    supplier: null,
    date: fmt.today(),
    refNo: '',
    interState: false,
    paymentMode: 'Credit',
    paid: 0,
    notes: '',
    lines: []
  };

  const linesHost = el('div');
  const totalsHost = el('div');

  function newLine(product, extra = {}) {
    const pack = Math.max(1, product.pack_size || 1);
    return {
      product,
      pack,
      batch_no: '',
      expiry: '',
      packs: 1,
      loose: 0,
      free: 0,
      mrp: product.last_mrp || 0,
      ratePack: 0,
      disc_pct: 0,
      gst_rate: product.gst_rate ?? 12,
      ...extra
    };
  }

  async function addProduct(product) {
    const last = await call('purchases.lastRate', { product_id: product.id }, { quiet: true });
    const pack = Math.max(1, product.pack_size || 1);
    entry.lines.push(newLine(product, {
      mrp: last?.mrp || product.last_mrp || 0,
      ratePack: last ? r2(last.rate_per_unit * pack) : 0,
      disc_pct: last?.disc_pct || 0,
      gst_rate: last?.gst_rate ?? product.gst_rate ?? 12
    }));
    draw();
    setTimeout(() => {
      const input = linesHost.querySelector(`[data-batch="${entry.lines.length - 1}"]`);
      if (input) input.focus();
    }, 30);
  }

  function units(line) {
    return Math.max(0, Math.round((Number(line.packs) || 0) * line.pack + (Number(line.loose) || 0)));
  }
  function ratePerUnit(line) {
    return r3((Number(line.ratePack) || 0) / line.pack);
  }

  function computed() {
    const lines = entry.lines.map((line) => lineTotals({
      qty: units(line), rate: ratePerUnit(line), discPct: line.disc_pct, gstRate: line.gst_rate, interState: entry.interState
    }));
    const subtotal = r2(lines.reduce((s, l) => s + l.taxable, 0));
    const gst = r2(lines.reduce((s, l) => s + l.gstAmount, 0));
    const rounded = roundOff(r2(subtotal + gst));
    return { lines, subtotal, gst, total: rounded.total, roundOff: rounded.roundOff };
  }

  function num(value, attrs, onChange) {
    const input = el('input.num', {
      type: 'number', value, step: attrs.step || '1', min: attrs.min ?? '0',
      style: { width: attrs.width || '70px', height: '30px', padding: '0 6px' },
      dataset: attrs.dataset || {}
    });
    input.addEventListener('input', () => onChange(input.value === '' ? 0 : Number(input.value)));
    return input;
  }

  function text(value, attrs, onChange) {
    const input = el('input', {
      type: 'text', value, placeholder: attrs.placeholder || '',
      style: { width: attrs.width || '96px', height: '30px', padding: '0 7px', textTransform: attrs.upper ? 'uppercase' : 'none' },
      dataset: attrs.dataset || {}
    });
    input.addEventListener('input', () => onChange(attrs.upper ? input.value.toUpperCase() : input.value));
    return input;
  }

  function draw() {
    const calc = computed();
    if (!entry.lines.length) {
      mount(linesHost, emptyState({
        iconName: 'truck',
        title: 'Add the items from the supplier bill',
        message: 'Search a medicine below, or import the bill as an Excel/CSV file to fill every line at once.'
      }));
    } else {
      mount(linesHost, el('div.table-wrap', el('table.data.compact',
        el('thead', el('tr',
          el('th.center', { style: { width: '32px' } }, '#'),
          el('th', 'Medicine'),
          el('th', 'Batch'),
          el('th', 'Expiry'),
          el('th.num', 'Qty'),
          el('th.num', 'Free'),
          el('th.num', 'MRP / pack'),
          el('th.num', 'Rate / pack'),
          el('th.num', 'Disc %'),
          el('th.num', 'GST'),
          el('th.num', 'Amount'),
          el('th.center', { style: { width: '40px' } }, ''))),
        el('tbody', ...entry.lines.map((line, i) => {
          const t = calc.lines[i];
          const missing = !line.batch_no || !line.expiry || units(line) <= 0 || ratePerUnit(line) <= 0;
          return el(`tr${missing ? '.row-warn' : ''}`,
            el('td.center.muted', i + 1),
            el('td',
              el('b', line.product.name),
              el('div.fs-12.muted', `${line.pack} ${line.product.unit_label} / ${line.product.pack_label}`)),
            el('td', text(line.batch_no, { width: '96px', upper: true, placeholder: 'B1234', dataset: { batch: String(i) } }, (v) => { line.batch_no = v; })),
            el('td', text(line.expiry, { width: '86px', placeholder: 'MM/YYYY' }, (v) => { line.expiry = v; })),
            el('td.num', el('div.row.tight', { style: { flexWrap: 'nowrap', justifyContent: 'flex-end' } },
              num(line.packs, { width: '58px' }, (v) => { line.packs = v; draw(); }),
              line.pack > 1 ? num(line.loose, { width: '52px', max: line.pack - 1 }, (v) => { line.loose = v; draw(); }) : null)),
            el('td.num', num(line.free, { width: '54px' }, (v) => { line.free = v; draw(); })),
            el('td.num', num(line.mrp, { step: '0.01', width: '84px' }, (v) => { line.mrp = v; draw(); })),
            el('td.num', num(line.ratePack, { step: '0.01', width: '88px' }, (v) => { line.ratePack = v; draw(); })),
            el('td.num', num(line.disc_pct, { step: '0.5', max: '100', width: '58px' }, (v) => { line.disc_pct = v; draw(); })),
            el('td.num', (() => {
              const sel = el('select', { style: { width: '72px', height: '30px' } },
                ...[0, 5, 12, 18, 28].map((g) => el('option', { value: g, selected: g === Number(line.gst_rate) }, `${g}%`)));
              sel.addEventListener('change', () => { line.gst_rate = Number(sel.value); draw(); });
              return sel;
            })()),
            el('td.num', el('b', fmt.money(t.total))),
            el('td.center', el('button.icon-btn', { title: 'Remove', onclick: () => { entry.lines.splice(i, 1); draw(); } }, icon('trash'))));
        })))));
    }

    mount(totalsHost,
      el('div.totals-line', el('span.muted', `Items (${entry.lines.length})`), el('span', fmt.money(calc.subtotal))),
      el('div.totals-line', el('span.muted', entry.interState ? 'IGST' : 'CGST + SGST'), el('span', fmt.money(calc.gst))),
      calc.roundOff ? el('div.totals-line', el('span.muted', 'Round off'), el('span', fmt.money(calc.roundOff))) : null,
      el('div.totals-line.grand', el('span', 'Bill total'), el('span', fmt.money(calc.total))));
    saveBtn.disabled = entry.lines.length === 0;
  }

  // ------------------------------------------------------------- importing
  async function importBill() {
    const file = await dialog.openSheet();
    if (!file) return;
    if (file.error) { toast(file.error, { type: 'error' }); return; }
    let preview;
    try {
      preview = await call('import.preview', { filename: file.name, base64: file.base64 });
    } catch { return; }

    const body = el('div');
    const handle = modal({
      title: `Import “${file.name}”`,
      size: 'wide',
      body
    });

    const drawPreview = () => mount(body,
      el('div.grid.cols-4.mb-16',
        el('div.stat', el('div.stat-label', 'Rows read'), el('div.stat-value', String(preview.summary.rows))),
        el('div.stat', el('div.stat-label', 'New medicines'), el('div.stat-value', String(preview.summary.newProducts))),
        el('div.stat', el('div.stat-label', 'Need attention'), el('div.stat-value', String(preview.summary.withIssues))),
        el('div.stat', el('div.stat-label', 'Approx. value'), el('div.stat-value', fmt.moneyShort(preview.summary.value)))),
      el('div.note.mb-16', icon('info'), el('div',
        `Columns detected: ${preview.detected.join(', ')}. Anything missing can be fixed in the table after importing.`)),
      dataTable({
        rows: preview.lines,
        compact: true,
        maxHeight: '42vh',
        rowClass: (r) => (r.issues.length ? 'row-warn' : ''),
        columns: [
          { key: 'product_name', label: 'Medicine', render: (r) => el('div', el('b', r.product_name), !r.product_id ? badge('new', 'info') : null, el('div.fs-12.muted', r.source_name !== r.product_name ? r.source_name : '')) },
          { key: 'batch_no', label: 'Batch' },
          { key: 'expiry', label: 'Expiry', render: (r) => (r.expiry ? fmt.expiry(r.expiry) : badge('missing', 'danger')) },
          { key: 'qty_units', label: 'Qty', align: 'num' },
          { key: 'free_units', label: 'Free', align: 'num' },
          { key: 'mrp', label: 'MRP', align: 'num', render: (r) => fmt.money(r.mrp) },
          { key: 'rate_per_unit', label: 'Rate/unit', align: 'num', render: (r) => fmt.money(r.rate_per_unit) },
          { key: 'gst_rate', label: 'GST', align: 'num', render: (r) => `${r.gst_rate}%` },
          { key: 'issues', label: 'Notes', render: (r) => (r.issues.length ? el('span.fs-12.warn-text', r.issues.join('; ')) : el('span.fs-12.ok-text', 'ready')) }
        ]
      }));
    drawPreview();

    const missingExpiry = preview.lines.filter((l) => !l.expiry);
    handle.content.querySelector('.modal-body').after(el('div.modal-foot',
      missingExpiry.length ? el('span.fs-12.warn-text', `${missingExpiry.length} row(s) have no expiry — set it before saving.`) : el('span'),
      el('div.spacer'),
      el('button.btn', { onclick: () => handle.close() }, 'Cancel'),
      el('button.btn.primary', {
        onclick: async () => {
          try {
            const lines = await call('import.materialise', { lines: preview.lines });
            const products = await Promise.all(lines.map((l) => call('products.get', { id: l.product_id }, { quiet: true })));
            entry.lines = lines.map((l, i) => {
              const product = products[i];
              const pack = Math.max(1, product?.pack_size || 1);
              return {
                product: product || { id: l.product_id, name: preview.lines[i].product_name, pack_size: pack, pack_label: 'Pack', unit_label: 'Unit', gst_rate: l.gst_rate },
                pack,
                batch_no: l.batch_no,
                expiry: l.expiry || '',
                packs: Math.floor(l.qty_units / pack),
                loose: l.qty_units % pack,
                free: l.free_units,
                mrp: l.mrp,
                ratePack: r2(l.rate_per_unit * pack),
                disc_pct: l.disc_pct,
                gst_rate: l.gst_rate
              };
            });
            handle.close();
            toast(`${entry.lines.length} line(s) imported — check batches and expiry, then save.`, { type: 'ok' });
            draw();
          } catch { /* handled */ }
        }
      }, icon('check'), 'Bring into the purchase')));
  }

  // ---------------------------------------------------------------- saving
  const saveBtn = el('button.btn.primary.lg', { onclick: () => save() }, icon('save'), 'Save purchase');
  let saving = false;

  async function save() {
    if (saving) return;
    if (!entry.supplier) { toast('Choose the supplier first.', { type: 'error' }); return; }
    const calc = computed();
    saving = true;
    saveBtn.disabled = true;
    try {
      const purchase = await call('purchases.create', {
        supplier_id: entry.supplier.id,
        date: entry.date,
        ref_no: entry.refNo,
        inter_state: entry.interState ? 1 : 0,
        payment_mode: entry.paymentMode,
        paid: entry.paymentMode === 'Credit' ? 0 : entry.paid,
        notes: entry.notes,
        items: entry.lines.map((line) => ({
          product_id: line.product.id,
          batch_no: line.batch_no,
          expiry: line.expiry,
          mrp: line.mrp,
          qty_units: units(line),
          free_units: line.free,
          rate_per_unit: ratePerUnit(line),
          disc_pct: line.disc_pct,
          gst_rate: line.gst_rate
        }))
      });
      toast(`Purchase ${purchase.no} saved — stock updated.`, { type: 'ok' });
      const handle = modal({
        title: `Purchase ${purchase.no} saved`,
        size: 'narrow',
        body: el('div',
          el('div.note.ok', icon('check'), el('div', `${fmt.money(purchase.total)} added to ${purchase.supplier_name}.`)),
          el('dl.kv.mt-16',
            el('dt', 'Items'), el('dd', String(purchase.items.length)),
            el('dt', 'Paid'), el('dd', fmt.money(purchase.paid)),
            el('dt', 'Balance'), el('dd', fmt.money(purchase.balance)))),
        footer: [
          el('button.btn', { onclick: () => { handle.close(); printMarkup(purchaseMarkup(purchase, { format: 'a4' }), 'a4'); } }, icon('print'), 'Print'),
          el('button.btn', { onclick: () => { handle.close(); router.navigate('#/purchases'); } }, 'All purchases'),
          el('button.btn.primary', { onclick: () => { handle.close(); reset(); } }, icon('plus'), 'Next bill')
        ]
      });
      void calc;
    } catch { /* toast shown */ } finally {
      saving = false;
      draw();
    }
  }

  function reset() {
    entry.lines = [];
    entry.refNo = '';
    entry.paid = 0;
    entry.notes = '';
    drawHead();
    draw();
  }

  // ------------------------------------------------------------------ head
  const headHost = el('div');
  function drawHead() {
    const supplierField = partyPicker({
      type: 'supplier',
      value: entry.supplier,
      onPick: (party) => {
        entry.supplier = party;
        if (party) supplierNote.textContent = party.balance ? `Outstanding ${fmt.money(party.balance)}` : 'No outstanding balance';
        else supplierNote.textContent = '';
      }
    });
    const supplierNote = el('div.help', entry.supplier?.balance ? `Outstanding ${fmt.money(entry.supplier.balance)}` : '');

    const f = form([
      { kind: 'node', span: 1, node: el('div.field.required', el('label', 'Supplier'), supplierField, supplierNote) },
      { name: 'date', label: 'Purchase date', type: 'date', value: entry.date, onChange: (v) => { entry.date = v; } },
      { name: 'ref_no', label: 'Supplier bill number', value: entry.refNo, placeholder: 'As printed on the bill', onInput: (v) => { entry.refNo = v; } },
      {
        name: 'payment_mode', label: 'Payment', type: 'select', value: entry.paymentMode,
        options: ['Credit', 'Cash', 'UPI', 'Cheque', 'Bank Transfer'],
        onChange: (v) => { entry.paymentMode = v; drawHead(); }
      },
      {
        name: 'paid', label: 'Amount paid now', type: 'number', step: '0.01', value: entry.paid,
        disabled: entry.paymentMode === 'Credit', onInput: (v) => { entry.paid = Number(v) || 0; }
      },
      { name: 'inter_state', label: 'Inter-state purchase (IGST)', type: 'checkbox', value: entry.interState, onChange: (v, ff) => { entry.interState = Boolean(ff.get('inter_state')); draw(); } },
      { name: 'notes', label: 'Notes', value: entry.notes, span: 2, onInput: (v) => { entry.notes = v; } }
    ], {}, { columns: 4 });
    mount(headHost, f.node);
  }
  drawHead();

  const picker = productPicker({
    placeholder: 'Search a medicine to add a line (or create a new one)…',
    onPick: addProduct,
    allowCreate: true
  });
  picker.style.flex = '1 1 320px';

  draw();

  return el('div.col', { style: { gap: '16px' } },
    el('div.row',
      el('button.btn', { onclick: () => router.navigate('#/purchases') }, icon('returns'), 'All purchases'),
      el('div.spacer'),
      el('button.btn.teal', { onclick: importBill }, icon('upload'), 'Import bill from Excel / CSV')),
    card({ title: 'Supplier & bill', body: headHost }),
    card({
      title: 'Items',
      actions: picker,
      flush: true,
      body: linesHost
    }),
    el('div.grid', { style: { gridTemplateColumns: 'minmax(0, 1fr) 340px' } },
      card({
        title: 'Before you save',
        body: el('ul.list-plain',
          el('li', icon('check'), 'Batch number and expiry are needed on every line — stock is tracked batch-wise.'),
          el('li', icon('check'), 'Free quantity is added to stock and lowers the average cost per unit.'),
          el('li', icon('check'), 'Rate is the purchase rate per pack, before GST.'),
          el('li', icon('check'), 'Saving is one transaction: bill, batches, stock and the payable move together.'))
      }),
      card({ title: 'Totals', body: el('div', totalsHost, el('div.mt-16', saveBtn)) })));
}
