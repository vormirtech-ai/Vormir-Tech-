import { el, mount, clear, debounce } from './dom.js';
import { icon } from './icons.js';
import * as fmt from './format.js';
import { call } from './api.js';
import { formModal, toast } from './ui.js';

/**
 * Inline type-ahead for medicines. Keyboard: type, ↑/↓, Enter.
 * `onPick(product)` receives the full product row (with batches).
 */
export function productPicker({ onPick, placeholder = 'Medicine name…', value = '', allowCreate = true, inStockOnly = false, compact = false } = {}) {
  const input = el('input', {
    type: 'text', placeholder, value, autocomplete: 'off',
    style: compact ? { height: '30px', minWidth: '190px' } : {}
  });
  const list = el('div.suggest.hidden');
  const wrap = el('div', { style: { position: 'relative', minWidth: compact ? '190px' : '260px' } }, input, list);
  let rows = [];
  let cursor = 0;

  function draw() {
    if (!rows.length) { list.classList.add('hidden'); clear(list); return; }
    list.classList.remove('hidden');
    mount(list, ...rows.map((p, i) => el(`div.suggest-item${i === cursor ? '.active' : ''}`, {
      onmousedown: (event) => { event.preventDefault(); pick(p); }
    },
      el('div.name', p.__create ? `Add “${p.name}” as a new medicine` : p.name),
      el('div.meta', p.__create ? 'Opens the new-medicine form' : ([p.generic, p.manufacturer].filter(Boolean).join(' · ') || '—')),
      el('div.right', p.__create ? icon('plus') : el('b', p.stock_units > 0 ? p.stock_label : 'no stock')))));
  }

  const search = debounce(async () => {
    const term = input.value.trim();
    if (term.length < 2) { rows = []; draw(); return; }
    const found = await call('products.search', { q: term, limit: 8, inStockOnly }, { quiet: true });
    rows = found;
    if (allowCreate) rows = [...found, { __create: true, name: term }];
    cursor = 0;
    draw();
  }, 140);

  async function pick(product) {
    if (product.__create) {
      const created = await createMedicine(product.name);
      if (!created) return;
      const full = await call('products.search', { q: created.name, limit: 1 }, { quiet: true });
      onPick(full[0] || { ...created, batches: [] });
    } else {
      onPick(product);
    }
    input.value = '';
    rows = [];
    draw();
  }

  input.addEventListener('input', search);
  input.addEventListener('focus', () => { if (input.value.trim().length >= 2) search(); });
  input.addEventListener('blur', () => setTimeout(() => { rows = []; draw(); }, 120));
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); cursor = Math.min(cursor + 1, rows.length - 1); draw(); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); cursor = Math.max(cursor - 1, 0); draw(); }
    else if (event.key === 'Enter') { event.preventDefault(); if (rows[cursor]) pick(rows[cursor]); }
    else if (event.key === 'Escape') { rows = []; draw(); }
  });

  wrap.focusInput = () => input.focus();
  wrap.inputEl = input;
  return wrap;
}

export async function createMedicine(name = '') {
  const meta = await call('products.meta');
  const saved = await formModal({
    title: 'New medicine',
    columns: 2,
    size: 'wide',
    submitLabel: 'Add medicine',
    values: { name, category: 'Medicine', schedule_type: 'General', hsn: '3004', gst_rate: 12, pack_size: 10, pack_label: 'Strip', unit_label: 'Tablet', allow_loose: 1, active: 1 },
    fields: [
      { name: 'name', label: 'Medicine name', required: true, span: 2, autofocus: true },
      { name: 'generic', label: 'Salt / generic', span: 2 },
      { name: 'manufacturer', label: 'Manufacturer' },
      { name: 'category', label: 'Category', type: 'select', options: meta.categories },
      { name: 'gst_rate', label: 'GST %', type: 'select', options: [0, 5, 12, 18, 28] },
      { name: 'hsn', label: 'HSN' },
      { name: 'pack_size', label: 'Units per pack', type: 'number', min: 1, step: 1 },
      { name: 'pack_label', label: 'Pack name' },
      { name: 'unit_label', label: 'Unit name' },
      { name: 'reorder_level', label: 'Reorder level', type: 'number', min: 0, step: 1 },
      { name: 'allow_loose', label: 'Can be sold loose', type: 'checkbox', span: 'full' }
    ],
    onSubmit: (v) => call('products.save', v)
  });
  if (saved) toast(`${saved.name} added to the medicine master.`, { type: 'ok' });
  return saved;
}

/** Generic party selector for customers, suppliers and doctors. */
export function partyPicker({ type = 'customer', onPick, value = null, allowCreate = true }) {
  const channels = {
    customer: { list: 'customers.list', save: 'customers.save', label: 'patient' },
    supplier: { list: 'suppliers.list', save: 'suppliers.save', label: 'supplier' },
    doctor: { list: 'doctors.list', save: 'doctors.save', label: 'doctor' }
  }[type];

  const input = el('input', { type: 'text', placeholder: `Search ${channels.label}…`, autocomplete: 'off', value: value?.name || '' });
  const list = el('div.suggest.hidden');
  const wrap = el('div', { style: { position: 'relative' } }, input, list);
  let rows = [];
  let cursor = 0;

  function draw() {
    if (!rows.length) { list.classList.add('hidden'); clear(list); return; }
    list.classList.remove('hidden');
    mount(list, ...rows.map((p, i) => el(`div.suggest-item${i === cursor ? '.active' : ''}`, {
      onmousedown: (event) => { event.preventDefault(); pick(p); }
    },
      el('div.name', p.__create ? `Add “${p.name}”` : p.name),
      el('div.meta', p.__create ? `New ${channels.label}` : [p.phone, p.balance ? `Balance ${fmt.money(p.balance)}` : null].filter(Boolean).join(' · ')))));
  }

  const search = debounce(async () => {
    const term = input.value.trim();
    if (term.length < 1) { rows = []; draw(); return; }
    const found = await call(channels.list, { search: term, limit: 8 }, { quiet: true });
    rows = allowCreate ? [...found, { __create: true, name: term }] : found;
    cursor = 0;
    draw();
  }, 150);

  async function pick(party) {
    if (party.__create) {
      const created = await formModal({
        title: `New ${channels.label}`,
        columns: 2,
        submitLabel: 'Add',
        values: { name: party.name },
        fields: [
          { name: 'name', label: 'Name', required: true, span: 'full', autofocus: true },
          { name: 'phone', label: 'Phone' },
          ...(type === 'supplier'
            ? [{ name: 'gstin', label: 'GSTIN' }, { name: 'dl_no', label: 'Drug licence' }, { name: 'address', label: 'Address', span: 'full' }]
            : []),
          ...(type === 'doctor' ? [{ name: 'clinic', label: 'Clinic' }, { name: 'commission_pct', label: 'Commission %', type: 'number', step: '0.5' }] : []),
          ...(type === 'customer' ? [{ name: 'address', label: 'Address', span: 'full' }] : [])
        ],
        onSubmit: (v) => call(channels.save, v)
      });
      if (!created) return;
      const row = Array.isArray(created) ? created.find((c) => c.name === party.name) : created;
      input.value = row?.name || party.name;
      onPick(row);
    } else {
      input.value = party.name;
      onPick(party);
    }
    rows = [];
    draw();
  }

  input.addEventListener('input', () => { onPick(null); search(); });
  input.addEventListener('blur', () => setTimeout(() => { rows = []; draw(); }, 120));
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); cursor = Math.min(cursor + 1, rows.length - 1); draw(); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); cursor = Math.max(cursor - 1, 0); draw(); }
    else if (event.key === 'Enter') { event.preventDefault(); if (rows[cursor]) pick(rows[cursor]); }
  });

  wrap.inputEl = input;
  return wrap;
}
