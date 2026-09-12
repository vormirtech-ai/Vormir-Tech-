import { el, mount, clear, debounce } from '../dom.js';
import { icon } from '../icons.js';
import * as fmt from '../format.js';
import { call } from '../api.js';
import { store } from '../store.js';
import { toast, modal, confirm, form, formModal, card, dataTable, emptyState, badge } from '../ui.js';
import { lineTotals, applyBillDiscount, roundOff, r2, r3 } from '../calc.js';
import { invoiceMarkup, printMarkup, savePdf } from '../print.js';
import * as router from '../router.js';

/** Counter billing. Keyboard-first: search, Enter, qty, repeat, Ctrl+Enter. */
export async function render() {
  const [meta, doctors] = await Promise.all([
    call('sales.meta', {}, { quiet: true }),
    call('doctors.list', {}, { quiet: true })
  ]);

  const bill = {
    lines: [],
    customer: null,
    doctorId: '',
    patientName: '',
    patientPhone: '',
    rxNo: '',
    paymentMode: 'Cash',
    paid: null,
    billDiscount: 0,
    reminderDays: 0,
    interState: false,
    notes: ''
  };

  const linesHost = el('div.pos-lines');
  const sideHost = el('div.pos-side-body');
  const footHost = el('div.pos-side-foot');
  const suggestHost = el('div.suggest.hidden');
  const searchInput = el('input', {
    type: 'text',
    placeholder: 'Type a medicine name or salt, then press Enter…',
    autocomplete: 'off',
    style: { height: '42px', fontSize: '15px', paddingLeft: '38px' }
  });

  let results = [];
  let cursor = 0;

  // ------------------------------------------------------------- searching
  const runSearch = debounce(async (term) => {
    if (!term || term.length < 2) {
      results = [];
      drawSuggestions();
      return;
    }
    try {
      results = await call('products.search', { q: term, limit: 10 }, { quiet: true });
    } catch {
      results = [];
    }
    cursor = 0;
    drawSuggestions();
  }, 130);

  function drawSuggestions() {
    if (!results.length) {
      suggestHost.classList.add('hidden');
      clear(suggestHost);
      return;
    }
    suggestHost.classList.remove('hidden');
    mount(suggestHost, ...results.map((p, i) => {
      const usable = p.batches.filter((b) => !b.expired && b.qty_units > 0);
      const best = usable[0];
      return el(`div.suggest-item${i === cursor ? '.active' : ''}`, {
        onclick: () => addLine(p)
      },
        el('div.name', p.name, p.schedule_type && p.schedule_type !== 'General' ? el('span.badge.warn', { style: { marginLeft: '6px' } }, p.schedule_type) : null),
        el('div.meta', [p.generic, p.manufacturer, p.rack ? `Rack ${p.rack}` : null].filter(Boolean).join(' · ') || '—'),
        el('div.right',
          el('b', p.stock_units > 0 ? p.stock_label : 'Out of stock'),
          el('div.fs-12.muted', best ? `MRP ${fmt.money(best.mrp)} · Exp ${fmt.expiry(best.expiry)}` : 'No sellable batch')));
    }));
  }

  searchInput.addEventListener('input', () => runSearch(searchInput.value.trim()));
  searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); cursor = Math.min(cursor + 1, results.length - 1); drawSuggestions(); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); cursor = Math.max(cursor - 1, 0); drawSuggestions(); }
    else if (event.key === 'Enter') {
      event.preventDefault();
      if (results[cursor]) addLine(results[cursor]);
    } else if (event.key === 'Escape') {
      results = [];
      drawSuggestions();
    }
  });
  document.addEventListener('click', (event) => {
    if (!suggestHost.contains(event.target) && event.target !== searchInput) {
      results = [];
      drawSuggestions();
    }
  });

  // ----------------------------------------------------------------- lines
  function addLine(product) {
    const usable = (product.batches || []).filter((b) => !b.expired && b.qty_units > 0);
    if (!usable.length) {
      toast(`${product.name} has no sellable stock. Add a purchase first.`, { type: 'warn' });
      return;
    }
    const batch = usable[0];
    const pack = Math.max(1, product.pack_size || 1);
    const existing = bill.lines.find((l) => l.product.id === product.id && l.batch.id === batch.id);
    if (existing) {
      existing.packs += pack > 1 ? 1 : 0;
      if (pack === 1) existing.loose += 1;
      redraw();
      focusQty(bill.lines.indexOf(existing));
    } else {
      bill.lines.push({
        product,
        batches: usable,
        batch,
        packs: pack > 1 ? 1 : 0,
        loose: pack > 1 ? 0 : 1,
        ratePack: r2(batch.mrp || 0),
        discPct: 0,
        gstRate: product.gst_rate
      });
      redraw();
      focusQty(bill.lines.length - 1);
    }
    searchInput.value = '';
    results = [];
    drawSuggestions();
  }

  function focusQty(index) {
    setTimeout(() => {
      const input = linesHost.querySelector(`[data-qty="${index}"]`);
      if (input) { input.focus(); input.select(); }
    }, 20);
  }

  function lineUnits(line) {
    const pack = Math.max(1, line.product.pack_size || 1);
    return Math.max(0, Math.round((Number(line.packs) || 0) * pack + (Number(line.loose) || 0)));
  }

  function lineRatePerUnit(line) {
    const pack = Math.max(1, line.product.pack_size || 1);
    return r3((Number(line.ratePack) || 0) / pack);
  }

  function computed() {
    const gstInclusive = store.settings.price_includes_gst === '1';
    let lines = bill.lines.map((line) => {
      const units = lineUnits(line);
      const rate = lineRatePerUnit(line);
      const t = lineTotals({ qty: units, rate, discPct: line.discPct, gstRate: line.gstRate, interState: bill.interState, gstInclusive });
      return { ...t, gst_rate: line.gstRate, units, rate, ref: line };
    });
    lines = applyBillDiscount(lines, bill.billDiscount, bill.interState);
    const subtotal = r2(lines.reduce((s, l) => s + l.taxable, 0));
    const gst = r2(lines.reduce((s, l) => s + l.gstAmount, 0));
    const gross = r2(subtotal + gst);
    const rounded = store.settings.round_off_invoice === '1' ? roundOff(gross) : { total: gross, roundOff: 0 };
    const stockIssues = bill.lines.filter((l) => lineUnits(l) > l.batch.qty_units);
    return { lines, subtotal, gst, gross, total: rounded.total, roundOff: rounded.roundOff, stockIssues };
  }

  function numberInput(value, attrs, onChange) {
    const input = el('input.num', {
      type: 'number', value, step: attrs.step || '1', min: attrs.min ?? '0',
      style: { width: attrs.width || '74px', height: '30px', padding: '0 7px' },
      dataset: attrs.dataset || {}
    });
    input.addEventListener('input', () => onChange(input.value === '' ? 0 : Number(input.value)));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); searchInput.focus(); }
    });
    return input;
  }

  function drawLines() {
    const calc = computed();
    if (!bill.lines.length) {
      mount(linesHost, emptyState({
        iconName: 'billing',
        title: 'Start typing to add medicines',
        message: 'Search by brand or salt name. Use ↑ ↓ to choose, Enter to add, then type the quantity.'
      }));
      return;
    }
    const rows = bill.lines.map((line, i) => {
      const pack = Math.max(1, line.product.pack_size || 1);
      const t = calc.lines[i];
      const short = t.units > line.batch.qty_units;
      return el(`tr${short ? '.row-danger' : ''}`,
        el('td.center.muted', i + 1),
        el('td',
          el('b', line.product.name),
          el('div.fs-12.muted', [line.product.manufacturer, `${pack > 1 ? `${pack} ${line.product.unit_label}/${line.product.pack_label}` : line.product.unit_label}`].filter(Boolean).join(' · '))),
        el('td',
          (() => {
            const select = el('select', { style: { height: '30px', minWidth: '148px' } },
              ...line.batches.map((b) => el('option', {
                value: b.id, selected: b.id === line.batch.id
              }, `${b.batch_no} · Exp ${fmt.expiry(b.expiry)} · ${b.qty_units} ${line.product.unit_label}`)));
            select.addEventListener('change', () => {
              line.batch = line.batches.find((b) => String(b.id) === select.value) || line.batch;
              line.ratePack = r2(line.batch.mrp || line.ratePack);
              redraw();
            });
            return select;
          })(),
          el('div.fs-12.muted', `In stock: ${fmt.qtyLabel(line.batch.qty_units, pack, line.product.pack_label, line.product.unit_label)}`)),
        el('td.num', el('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px' } },
          pack > 1
          ? el('div.row.tight', { style: { justifyContent: 'flex-end', flexWrap: 'nowrap' } },
            numberInput(line.packs, { width: '54px', dataset: { qty: String(i) } }, (v) => { line.packs = v; redraw(false); }),
            el('span.fs-12.muted', line.product.pack_label.slice(0, 6)),
            numberInput(line.loose, { width: '48px', max: pack - 1 }, (v) => { line.loose = v; redraw(false); }))
            : numberInput(line.loose, { width: '68px', dataset: { qty: String(i) } }, (v) => { line.loose = v; redraw(false); }),
          el('span.fs-12.muted', `${t.units} ${line.product.unit_label.toLowerCase()}${t.units === 1 ? '' : 's'}`))),
        el('td.num', numberInput(line.ratePack, { step: '0.01', width: '82px' }, (v) => { line.ratePack = v; redraw(false); })),
        el('td.num', numberInput(line.discPct, { step: '0.5', max: '100', width: '56px' }, (v) => { line.discPct = v; redraw(false); })),
        el('td.num.fs-12.muted', `${line.gstRate}%`),
        el('td.num', el('b', fmt.money(t.total))),
        el('td.center', el('button.icon-btn', {
          title: 'Remove line',
          onclick: () => { bill.lines.splice(i, 1); redraw(); }
        }, icon('trash'))));
    });

    mount(linesHost, el('table.data',
      el('thead', el('tr',
        el('th.center', { style: { width: '38px' } }, '#'),
        el('th', 'Medicine'),
        el('th', 'Batch & expiry'),
        el('th.num', 'Quantity'),
        el('th.num', 'Rate / pack'),
        el('th.num', 'Disc %'),
        el('th.num', 'GST'),
        el('th.num', 'Amount'),
        el('th.center', { style: { width: '44px' } }, ''))),
      el('tbody', ...rows)));
  }

  // ------------------------------------------------------------ right rail
  function customerBlock() {
    const searchBoxInput = el('input', { type: 'text', placeholder: 'Search patient by name or phone', autocomplete: 'off' });
    const resultHost = el('div.suggest.hidden', { style: { position: 'static', marginTop: '6px', maxHeight: '190px' } });

    const doSearch = debounce(async () => {
      const term = searchBoxInput.value.trim();
      if (term.length < 2) { resultHost.classList.add('hidden'); return; }
      const rows = await call('customers.list', { search: term, limit: 8 }, { quiet: true });
      if (!rows.length) {
        mount(resultHost, el('div.suggest-empty', 'No patient found — ',
          el('a', { href: '#', onclick: (e) => { e.preventDefault(); newCustomer(term); } }, 'add a new one')));
        resultHost.classList.remove('hidden');
        return;
      }
      mount(resultHost, ...rows.map((c) => el('div.suggest-item', {
        onclick: () => { bill.customer = c; bill.patientName = c.name; bill.patientPhone = c.phone; drawSide(); }
      },
        el('div.name', c.name),
        el('div.meta', [c.phone, c.balance ? `Balance ${fmt.money(c.balance)}` : null].filter(Boolean).join(' · ')))));
      resultHost.classList.remove('hidden');
    }, 160);
    searchBoxInput.addEventListener('input', doSearch);

    async function newCustomer(name = '') {
      const created = await formModal({
        title: 'New patient',
        columns: 2,
        submitLabel: 'Add patient',
        fields: [
          { name: 'name', label: 'Name', required: true, span: 'full', autofocus: true },
          { name: 'phone', label: 'Phone' },
          { name: 'dob', label: 'Date of birth', type: 'date' },
          { name: 'address', label: 'Address', span: 'full' }
        ],
        values: { name },
        onSubmit: (values) => call('customers.save', values)
      });
      if (created) {
        bill.customer = created;
        bill.patientName = created.name;
        bill.patientPhone = created.phone;
        toast('Patient added.', { type: 'ok' });
        drawSide();
      }
    }

    if (bill.customer) {
      return el('div',
        el('div.row.between',
          el('div', el('b', bill.customer.name), el('div.fs-12.muted', bill.customer.phone || 'No phone')),
          el('button.btn.sm.ghost', { onclick: () => { bill.customer = null; drawSide(); } }, icon('close'), 'Change')),
        Number(bill.customer.balance) ? el('div.note.warn.mt-8', icon('alert'),
          el('div', `Previous balance ${fmt.money(bill.customer.balance)}`)) : null);
    }
    return el('div',
      searchBoxInput,
      resultHost,
      el('div.row.tight.mt-8',
        el('button.btn.sm', { onclick: () => newCustomer(searchBoxInput.value.trim()) }, icon('plus'), 'New patient'),
        el('span.fs-12.muted', 'or leave blank for a walk-in bill')));
  }

  function drawSide() {
    const calc = computed();
    const paid = bill.paid === null ? calc.total : bill.paid;

    const patientFields = form([
      { name: 'patient_name', label: 'Name on bill', value: bill.patientName, span: 'full', placeholder: 'Walk-in customer', onInput: (v) => { bill.patientName = v; } },
      { name: 'patient_phone', label: 'Phone', value: bill.patientPhone, onInput: (v) => { bill.patientPhone = v; } },
      { name: 'rx_no', label: 'Rx number', value: bill.rxNo, onInput: (v) => { bill.rxNo = v; } },
      {
        name: 'doctor_id',
        label: 'Prescribed by',
        type: 'select',
        span: 'full',
        value: bill.doctorId,
        options: [{ value: '', label: '— not recorded —' }, ...(doctors || []).map((d) => ({ value: d.id, label: `${d.name}${d.clinic ? ` (${d.clinic})` : ''}` }))],
        onChange: (v) => { bill.doctorId = v; }
      }
    ], {}, { columns: 2 });

    mount(sideHost,
      card({
        title: 'Patient',
        body: el('div', customerBlock(), el('div.mt-16', patientFields.node))
      }),
      card({
        title: 'Payment',
        body: form([
          {
            name: 'payment_mode', label: 'Mode', type: 'select', value: bill.paymentMode,
            options: meta.paymentModes, onChange: (v) => { bill.paymentMode = v; bill.paid = v === 'Credit' ? 0 : null; drawSide(); }
          },
          {
            name: 'paid', label: 'Amount received', type: 'number', value: paid, step: '0.01',
            disabled: bill.paymentMode === 'Credit',
            onInput: (v) => { bill.paid = v === '' ? 0 : Number(v); drawTotals(); }
          },
          {
            name: 'bill_discount', label: 'Extra discount ₹', type: 'number', value: bill.billDiscount, step: '0.01',
            onInput: (v) => { bill.billDiscount = Number(v) || 0; redraw(false); }
          },
          {
            name: 'reminder_days', label: 'Refill reminder', type: 'select', value: bill.reminderDays,
            options: [{ value: 0, label: 'None' }, { value: 15, label: 'In 15 days' }, { value: 25, label: 'In 25 days' }, { value: 30, label: 'In 30 days' }, { value: 60, label: 'In 60 days' }],
            onChange: (v) => { bill.reminderDays = Number(v) || 0; }
          },
          {
            name: 'inter_state', label: 'Inter-state supply (IGST)', type: 'checkbox', value: bill.interState, span: 'full',
            onChange: (v, f) => { bill.interState = Boolean(f.get('inter_state')); redraw(false); }
          },
          { name: 'notes', label: 'Note on bill', span: 'full', value: bill.notes, onInput: (v) => { bill.notes = v; } }
        ], {}, { columns: 2 }).node
      }));
  }

  // --------------------------------------------------------------- footer
  const totalsHost = el('div');
  const saveBtn = el('button.btn.primary.lg', { onclick: () => save({ print: false }) }, icon('save'), 'Save bill');
  const savePrintBtn = el('button.btn.teal.lg', { onclick: () => save({ print: true }) }, icon('print'), 'Save & print');

  function drawTotals() {
    const calc = computed();
    const paid = bill.paid === null ? calc.total : bill.paid;
    const balance = r2(calc.total - paid);
    mount(totalsHost,
      el('div.totals-line', el('span.muted', `Items (${bill.lines.length})`), el('span', fmt.money(calc.subtotal))),
      bill.billDiscount ? el('div.totals-line', el('span.muted', 'Extra discount'), el('span', `- ${fmt.money(bill.billDiscount)}`)) : null,
      el('div.totals-line', el('span.muted', bill.interState ? 'IGST' : 'CGST + SGST'), el('span', fmt.money(calc.gst))),
      calc.roundOff ? el('div.totals-line', el('span.muted', 'Round off'), el('span', fmt.money(calc.roundOff))) : null,
      el('div.totals-line.grand', el('span', 'Total'), el('span', fmt.money(calc.total))),
      balance > 0.009
        ? el('div.totals-line', el('span.warn-text', 'Balance due'), el('span.warn-text', fmt.money(balance)))
        : null,
      calc.stockIssues.length
        ? el('div.note.danger.mt-8', icon('alert'), el('div', `Not enough stock for ${calc.stockIssues.map((l) => l.product.name).join(', ')}.`))
        : null);
    saveBtn.disabled = bill.lines.length === 0 || calc.stockIssues.length > 0;
    savePrintBtn.disabled = saveBtn.disabled;
  }

  mount(footHost,
    totalsHost,
    el('div.row.mt-16', { style: { flexWrap: 'nowrap' } }, saveBtn, savePrintBtn),
    el('div.row.between.mt-8',
      el('button.btn.sm.ghost', { onclick: clearBill }, icon('trash'), 'Clear bill'),
      el('span.fs-12.muted', el('kbd', 'Ctrl'), '+', el('kbd', 'Enter'), ' to save & print')));

  function redraw(redrawSide = true) {
    drawLines();
    drawTotals();
    if (redrawSide) drawSide();
  }

  async function clearBill() {
    if (bill.lines.length && !(await confirm({
      title: 'Clear this bill?',
      message: 'The lines you have entered will be discarded. Nothing is saved until you press Save.',
      confirmLabel: 'Clear bill',
      danger: true
    }))) return;
    bill.lines = [];
    bill.customer = null;
    bill.patientName = '';
    bill.patientPhone = '';
    bill.rxNo = '';
    bill.billDiscount = 0;
    bill.paid = null;
    bill.notes = '';
    redraw();
    searchInput.focus();
  }

  let saving = false;
  async function save({ print }) {
    if (saving || !bill.lines.length) return;
    const calc = computed();
    if (calc.stockIssues.length) {
      toast('Reduce the quantity — some lines exceed the stock on hand.', { type: 'error' });
      return;
    }
    saving = true;
    saveBtn.disabled = true;
    savePrintBtn.disabled = true;
    try {
      const payload = {
        customer_id: bill.customer?.id || null,
        doctor_id: bill.doctorId || null,
        patient_name: bill.patientName,
        patient_phone: bill.patientPhone,
        rx_no: bill.rxNo,
        payment_mode: bill.paymentMode,
        paid: bill.paid === null ? calc.total : bill.paid,
        bill_discount: bill.billDiscount,
        reminder_days: bill.reminderDays,
        inter_state: bill.interState ? 1 : 0,
        notes: bill.notes,
        items: bill.lines.map((line) => ({
          product_id: line.product.id,
          batch_id: line.batch.id,
          qty_units: lineUnits(line),
          rate_per_unit: lineRatePerUnit(line),
          disc_pct: line.discPct,
          gst_rate: line.gstRate
        }))
      };
      const sale = await call('sales.create', payload);
      toast(`Bill ${sale.no} saved — ${fmt.money(sale.total)}`, { type: 'ok', title: 'Saved locally' });
      bill.lines = [];
      bill.customer = null;
      bill.patientName = '';
      bill.patientPhone = '';
      bill.rxNo = '';
      bill.billDiscount = 0;
      bill.paid = null;
      bill.notes = '';
      redraw();
      searchInput.focus();
      if (print) await printInvoice(sale);
      else showSavedDialog(sale);
    } catch {
      /* the toast from call() already explained it */
    } finally {
      saving = false;
      drawTotals();
    }
  }

  async function printInvoice(sale) {
    const format = store.settings.print_format || 'a5';
    await printMarkup(invoiceMarkup(sale, { format }), format);
  }

  function showSavedDialog(sale) {
    const handle = modal({
      title: `Bill ${sale.no} saved`,
      size: 'narrow',
      body: el('div',
        el('div.note.ok', icon('check'), el('div', `${fmt.money(sale.total)} — saved to this computer.`)),
        el('dl.kv.mt-16',
          el('dt', 'Patient'), el('dd', sale.customer_name || sale.patient_name || 'Walk-in'),
          el('dt', 'Items'), el('dd', String(sale.items.length)),
          el('dt', 'Payment'), el('dd', `${sale.payment_mode} · ${fmt.money(sale.paid)}`),
          sale.balance > 0.009 ? el('dt', 'Balance') : null,
          sale.balance > 0.009 ? el('dd.warn-text', fmt.money(sale.balance)) : null)),
      footer: [
        el('button.btn', { onclick: () => { handle.close(); router.navigate(`#/sales/${sale.id}`); } }, icon('eye'), 'Open bill'),
        el('button.btn.primary', { onclick: () => { handle.close(); printInvoice(sale); } }, icon('print'), 'Print')
      ]
    });
  }

  // ----------------------------------------------------------------- setup
  const node = el('div.pos',
    el('div.pos-main',
      el('div.pos-head',
        el('div.pos-search', icon('search'), searchInput, suggestHost),
        el('button.btn', {
          onclick: () => router.navigate('#/products')
        }, icon('plus'), 'New medicine')),
      linesHost),
    el('div.pos-side', sideHost, footHost));

  const keyHandler = (event) => {
    if (!node.isConnected) return;
    if (event.ctrlKey && event.key === 'Enter') { event.preventDefault(); save({ print: true }); }
    else if (event.ctrlKey && (event.key === 'Delete' || event.key === 'Backspace')) { event.preventDefault(); clearBill(); }
  };
  document.addEventListener('keydown', keyHandler);

  redraw();
  setTimeout(() => searchInput.focus(), 60);
  return node;
}
