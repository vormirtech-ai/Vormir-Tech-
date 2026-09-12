import { el, mount, clear } from './dom.js';
import { icon } from './icons.js';
import * as fmt from './format.js';

// ------------------------------------------------------------------ toasts
export function toast(message, { type = 'info', title = null, timeout = 4200 } = {}) {
  const host = document.getElementById('toasts');
  if (!host) return () => {};
  const node = el(`div.toast.${type}`,
    el('div.bar'),
    el('div.msg', title ? el('b', title) : null, message),
    el('button.icon-btn', { title: 'Dismiss', onclick: () => remove() }, icon('close'))
  );
  const remove = () => { if (node.parentNode) node.remove(); };
  host.appendChild(node);
  if (timeout) setTimeout(remove, timeout);
  return remove;
}

// ------------------------------------------------------------------ modals
const openModals = [];

export function modal({ title, body, footer, size = '', onClose = null, closeOnBackdrop = true }) {
  const overlay = el('div.overlay');
  const content = el(`div.modal${size ? `.${size}` : ''}`,
    el('div.modal-head',
      el('h3', title),
      el('button.icon-btn', { title: 'Close (Esc)', onclick: () => close() }, icon('close'))
    ),
    el('div.modal-body', body),
    footer ? el('div.modal-foot', footer) : null
  );
  overlay.appendChild(content);

  function close(result) {
    const i = openModals.indexOf(handle);
    if (i >= 0) openModals.splice(i, 1);
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    if (onClose) onClose(result);
  }
  function onKey(event) {
    if (event.key === 'Escape' && openModals[openModals.length - 1] === handle) {
      event.stopPropagation();
      close();
    }
  }
  overlay.addEventListener('mousedown', (event) => {
    if (closeOnBackdrop && event.target === overlay) close();
  });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);

  const handle = { close, overlay, content, body: content.querySelector('.modal-body') };
  openModals.push(handle);
  const focusable = content.querySelector('input, select, textarea, button.primary');
  if (focusable) setTimeout(() => focusable.focus(), 30);
  return handle;
}

export function confirm({ title = 'Please confirm', message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false, detail = null }) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => { if (!settled) { settled = true; resolve(value); } };
    const handle = modal({
      title,
      size: 'narrow',
      body: el('div',
        el('p', { style: { marginBottom: detail ? '10px' : '0' } }, message),
        detail ? el('div.note.warn', icon('alert'), el('div', detail)) : null
      ),
      footer: [
        el('button.btn', { onclick: () => { done(false); handle.close(); } }, cancelLabel),
        el(`button.btn.${danger ? 'danger' : 'primary'}`, {
          onclick: () => { done(true); handle.close(); }
        }, confirmLabel)
      ],
      onClose: () => done(false)
    });
  });
}

// ------------------------------------------------------------------- forms
const FIELD_WIDTHS = { sm: '110px', md: '170px', lg: '240px', full: '100%' };

/**
 * Declarative form builder. Returns the node plus `values()` and `set()`,
 * which keeps view code short and validation in one place.
 */
export function form(fields, values = {}, { columns = 2, onSubmit = null } = {}) {
  const inputs = new Map();
  const errors = new Map();

  const nodes = fields.filter(Boolean).map((spec) => {
    if (spec.kind === 'divider') return el('div', { style: { gridColumn: '1 / -1', borderTop: '1px solid var(--border)', margin: '4px 0' } });
    if (spec.kind === 'heading') return el('h3', { style: { gridColumn: '1 / -1', marginTop: '4px' } }, spec.label);
    if (spec.kind === 'node') return el('div', { style: { gridColumn: spec.span === 1 ? 'auto' : '1 / -1' } }, spec.node);

    const value = values[spec.name] ?? spec.value ?? (spec.type === 'checkbox' ? false : '');
    let input;
    if (spec.type === 'select') {
      input = el('select', { name: spec.name, disabled: spec.disabled },
        ...(spec.options || []).map((opt) => {
          const o = typeof opt === 'object' ? opt : { value: opt, label: opt };
          return el('option', { value: o.value, selected: String(o.value) === String(value) }, o.label);
        }));
      input.value = value === '' && spec.options?.length ? input.value : String(value);
    } else if (spec.type === 'textarea') {
      input = el('textarea', { name: spec.name, rows: spec.rows || 3, placeholder: spec.placeholder || '', disabled: spec.disabled }, String(value ?? ''));
    } else if (spec.type === 'checkbox') {
      input = el('input', { type: 'checkbox', name: spec.name, checked: Boolean(value), disabled: spec.disabled });
    } else {
      input = el('input', {
        type: spec.type || 'text',
        name: spec.name,
        value: value ?? '',
        placeholder: spec.placeholder || '',
        min: spec.min, max: spec.max, step: spec.step,
        maxlength: spec.maxlength,
        autocomplete: 'off',
        disabled: spec.disabled,
        readOnly: spec.readonly,
        class: ['number', 'num'].includes(spec.type) || spec.numeric ? 'num' : null
      });
      if (spec.type === 'number' && !spec.step) input.step = 'any';
    }
    if (spec.onInput) input.addEventListener('input', (e) => spec.onInput(e.target.value, api, e));
    if (spec.onChange) input.addEventListener('change', (e) => spec.onChange(e.target.value, api, e));
    if (spec.autofocus) setTimeout(() => input.focus(), 40);
    inputs.set(spec.name, { input, spec });

    const errorNode = el('div.error.hidden');
    errors.set(spec.name, errorNode);

    if (spec.type === 'checkbox') {
      return el('div.field', { style: { gridColumn: spec.span === 'full' ? '1 / -1' : 'auto', justifyContent: 'flex-end' } },
        el('label.check', input, el('span', spec.label)),
        spec.help ? el('div.help', spec.help) : null,
        errorNode);
    }

    const control = spec.suffix || spec.prefix
      ? el('div.input-group', spec.prefix ? el('span.addon', spec.prefix) : null, input, spec.suffix ? el('span.addon', spec.suffix) : null)
      : input;

    return el(`div.field${spec.required ? '.required' : ''}`, {
      style: {
        gridColumn: spec.span === 'full' ? '1 / -1' : (spec.span === 2 ? 'span 2' : 'auto'),
        maxWidth: spec.width ? FIELD_WIDTHS[spec.width] || spec.width : null
      }
    },
      el('label', { for: spec.name }, spec.label),
      control,
      spec.help ? el('div.help', spec.help) : null,
      errorNode);
  });

  const node = el('div', {
    style: { display: 'grid', gap: '14px', gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }
  }, nodes);

  const api = {
    node,
    inputs,
    get(name) {
      const entry = inputs.get(name);
      if (!entry) return undefined;
      const { input, spec } = entry;
      if (spec.type === 'checkbox') return input.checked ? 1 : 0;
      if (spec.type === 'number') return input.value === '' ? '' : Number(input.value);
      return input.value;
    },
    set(name, value) {
      const entry = inputs.get(name);
      if (!entry) return;
      if (entry.spec.type === 'checkbox') entry.input.checked = Boolean(value);
      else entry.input.value = value ?? '';
    },
    values() {
      const out = {};
      for (const [name] of inputs) out[name] = api.get(name);
      return out;
    },
    focus(name) { inputs.get(name)?.input.focus(); },
    showError(name, message) {
      const node2 = errors.get(name);
      if (!node2) return;
      node2.textContent = message || '';
      node2.classList.toggle('hidden', !message);
      if (message) inputs.get(name)?.input.focus();
    },
    clearErrors() { for (const [, n] of errors) { n.textContent = ''; n.classList.add('hidden'); } },
    validate() {
      api.clearErrors();
      for (const [name, { spec }] of inputs) {
        const value = api.get(name);
        if (spec.required && (value === '' || value === null || value === undefined)) {
          api.showError(name, `${spec.label} is required.`);
          return false;
        }
      }
      return true;
    }
  };

  if (onSubmit) {
    node.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && event.target.tagName !== 'TEXTAREA') {
        event.preventDefault();
        onSubmit(api);
      }
    });
  }
  return api;
}

/** Opens a form inside a modal and resolves with its values (or null). */
export function formModal({ title, fields, values = {}, columns = 2, submitLabel = 'Save', size = '', onSubmit, note = null }) {
  return new Promise((resolve) => {
    // Resolve exactly once: closing the dialog must not overwrite the result.
    let settled = false;
    const finish = (value) => { if (!settled) { settled = true; resolve(value); } };
    const f = form(fields, values, { columns, onSubmit: () => submit() });
    let working = false;

    async function submit() {
      if (working) return;
      if (!f.validate()) return;
      working = true;
      saveBtn.disabled = true;
      try {
        const result = onSubmit ? await onSubmit(f.values(), f) : f.values();
        if (result === false) { working = false; saveBtn.disabled = false; return; }
        finish(result === undefined ? f.values() : result);
        handle.close();
      } catch {
        working = false;
        saveBtn.disabled = false;
      }
    }
    const saveBtn = el('button.btn.primary', { onclick: submit }, icon('check'), submitLabel);
    const handle = modal({
      title,
      size,
      body: el('div', note ? el('div.note.mb-16', icon('info'), el('div', note)) : null, f.node),
      footer: [el('button.btn', { onclick: () => handle.close() }, 'Cancel'), saveBtn],
      onClose: () => finish(null)
    });
  });
}

// ------------------------------------------------------------------- cards
export function card({ title = null, subtitle = null, actions = null, body = null, footer = null, flush = false, className = '' }) {
  return el(`div.card${className ? `.${className}` : ''}`,
    title || actions
      ? el('div.card-head',
        title ? el('h3', title) : null,
        subtitle ? el('span.hint', subtitle) : null,
        el('div.spacer'),
        actions)
      : null,
    body ? el(`div.card-body${flush ? '.tight' : ''}`, body) : null,
    footer ? el('div.card-foot', footer) : null);
}

export function stat({ label, value, sub = null, iconName = null, accent = 'blue', onClick = null }) {
  return el(`div.stat.accent-${accent}${onClick ? '.clickable' : ''}`, { onclick: onClick },
    iconName ? el('div.stat-icon', icon(iconName)) : null,
    el('div.stat-label', label),
    el('div.stat-value', value),
    sub ? el('div.stat-sub', sub) : null);
}

export function emptyState({ title = 'Nothing here yet', message = '', iconName = 'list', action = null }) {
  return el('div.empty', icon(iconName), el('h4', title), message ? el('p', message) : null,
    action ? el('div', { style: { marginTop: '14px' } }, action) : null);
}

// ------------------------------------------------------------------ tables
/**
 * Column: { key, label, align, width, render(row, index), cell (className),
 * footer } — `rows` may be any array of objects.
 */
export function dataTable({ columns, rows, empty = null, onRowClick = null, rowClass = null, footer = null, compact = false, maxHeight = null }) {
  const cols = columns.filter(Boolean);
  if (!rows || rows.length === 0) {
    return empty || emptyState({ title: 'No records found' });
  }
  const table = el(`table.data${compact ? '.compact' : ''}`,
    el('thead', el('tr', ...cols.map((c) => el(`th${c.align ? `.${c.align}` : ''}`, { style: c.width ? { width: c.width } : null }, c.label)))),
    el('tbody', ...rows.map((row, index) => {
      const tr = el(`tr${onRowClick ? '.clickable' : ''}${rowClass ? `.${rowClass(row) || ''}` : ''}`,
        ...cols.map((c) => {
          const content = c.render ? c.render(row, index) : row[c.key];
          return el(`td${c.align ? `.${c.align}` : ''}${c.cell ? `.${c.cell}` : ''}`, content);
        }));
      if (onRowClick) {
        tr.addEventListener('click', (event) => {
          if (event.target.closest('button, a, input, select')) return;
          onRowClick(row, index, tr);
        });
      }
      return tr;
    })),
    footer ? el('tfoot', el('tr', ...footer.map((cell, i) => el(`td${cols[i]?.align ? `.${cols[i].align}` : ''}`, cell)))) : null);
  return el('div.table-wrap', { style: maxHeight ? { maxHeight } : null }, table);
}

export function tabs({ items, active, onChange, pill = false }) {
  const node = el(pill ? 'div.pill-tabs' : 'div.tabs');
  items.filter(Boolean).forEach((item) => {
    const key = item.key ?? item;
    const label = item.label ?? item;
    node.appendChild(el(`button${key === active ? '.active' : ''}`, {
      onclick: () => onChange(key)
    }, label, item.count !== undefined ? el('span.badge', { style: { marginLeft: '6px' } }, item.count) : null));
  });
  return node;
}

export function toolbar(...children) {
  return el('div.row.mb-16', children);
}

export function searchBox({ placeholder = 'Search…', value = '', onInput, autofocus = false, width = null }) {
  const input = el('input', { type: 'search', placeholder, value, autocomplete: 'off' });
  input.addEventListener('input', () => onInput(input.value.trim()));
  if (autofocus) setTimeout(() => input.focus(), 40);
  return el('div.search-input', { style: width ? { flexBasis: width, maxWidth: width } : null }, icon('search'), input);
}

export function dateRange({ from, to, onChange }) {
  const fromInput = el('input', { type: 'date', value: from, style: { width: '150px' } });
  const toInput = el('input', { type: 'date', value: to, style: { width: '150px' } });
  const fire = () => onChange({ from: fromInput.value, to: toInput.value });
  fromInput.addEventListener('change', fire);
  toInput.addEventListener('change', fire);
  const preset = (label, days) => el('button.btn.sm', {
    onclick: () => {
      const t = fmt.today();
      fromInput.value = days === 'month' ? fmt.monthStart(t) : fmt.addDays(t, -days);
      toInput.value = t;
      fire();
    }
  }, label);
  return el('div.row.tight',
    el('span.fs-12.muted', 'From'), fromInput,
    el('span.fs-12.muted', 'to'), toInput,
    preset('Today', 0), preset('7d', 6), preset('30d', 29), preset('This month', 'month'));
}

export function badge(text, type = '') {
  return el(`span.badge${type ? `.${type}` : ''}`, text);
}

export function spinner(label = 'Loading…') {
  return el('div.empty', el('div.skeleton', { style: { width: '180px', height: '12px', margin: '0 auto 10px' } }), el('p', label));
}

export function loadingCard() {
  return el('div.card', el('div.card-body',
    ...[80, 60, 70].map((w) => el('div.skeleton', { style: { width: `${w}%`, marginBottom: '10px' } }))));
}

// ------------------------------------------------------------------ charts
/** Sparkline/area chart for the dashboard trend. */
export function lineChart(points, { height = 168, valueKey = 'total', labelKey = 'date', format = fmt.moneyShort } = {}) {
  const width = 760;
  const pad = { top: 14, right: 12, bottom: 22, left: 46 };
  const values = points.map((p) => Number(p[valueKey]) || 0);
  const max = Math.max(1, ...values) * 1.15;
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const x = (i) => pad.left + (points.length <= 1 ? innerW / 2 : (i * innerW) / (points.length - 1));
  const y = (v) => pad.top + innerH - (v / max) * innerH;

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(values[i]).toFixed(1)}`).join(' ');
  const area = `${line} L${x(points.length - 1).toFixed(1)},${(pad.top + innerH).toFixed(1)} L${x(0).toFixed(1)},${(pad.top + innerH).toFixed(1)} Z`;

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((t) => {
    const gy = pad.top + innerH * t;
    return el('g',
      el('line.grid-line', { x1: pad.left, x2: width - pad.right, y1: gy, y2: gy }),
      el('text.axis', { x: pad.left - 8, y: gy + 3, 'text-anchor': 'end' }, format(max * (1 - t))));
  });

  const labels = points.map((p, i) => (points.length > 10 && i % 2 ? null
    : el('text.axis', { x: x(i), y: height - 6, 'text-anchor': 'middle' }, String(p[labelKey] ?? '').slice(8, 10))));

  return el('svg.chart', { viewBox: `0 0 ${width} ${height}` },
    el('defs',
      el('linearGradient', { id: 'medvArea', x1: '0', y1: '0', x2: '0', y2: '1' },
        el('stop', { offset: '0%', 'stop-color': '#1565d8', 'stop-opacity': '.28' }),
        el('stop', { offset: '100%', 'stop-color': '#15b391', 'stop-opacity': '.02' }))),
    gridLines,
    el('path.area', { d: area }),
    el('path.line', { d: line }),
    points.map((p, i) => el('circle.dot', { cx: x(i), cy: y(values[i]), r: points.length > 20 ? 2 : 3.2 },
      el('title', `${p[labelKey]}: ${format(values[i])}`))),
    labels);
}

export function barChart(items, { height = 168, valueKey = 'value', labelKey = 'name', format = fmt.moneyShort } = {}) {
  const width = 760;
  const pad = { top: 12, right: 12, bottom: 40, left: 46 };
  const values = items.map((i) => Number(i[valueKey]) || 0);
  const max = Math.max(1, ...values) * 1.1;
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const slot = innerW / Math.max(1, items.length);
  const barW = Math.min(46, slot * 0.6);

  return el('svg.chart', { viewBox: `0 0 ${width} ${height}` },
    el('defs',
      el('linearGradient', { id: 'medvBar', x1: '0', y1: '0', x2: '0', y2: '1' },
        el('stop', { offset: '0%', 'stop-color': '#1565d8' }),
        el('stop', { offset: '100%', 'stop-color': '#15b391' }))),
    [0, 0.5, 1].map((t) => el('line.grid-line', {
      x1: pad.left, x2: width - pad.right, y1: pad.top + innerH * t, y2: pad.top + innerH * t
    })),
    items.map((item, i) => {
      const v = values[i];
      const h = Math.max(2, (v / max) * innerH);
      const bx = pad.left + slot * i + (slot - barW) / 2;
      return el('g',
        el('rect.bar', { x: bx, y: pad.top + innerH - h, width: barW, height: h, rx: 3 },
          el('title', `${item[labelKey]}: ${format(v)}`)),
        el('text.axis', { x: bx + barW / 2, y: height - 24, 'text-anchor': 'middle' },
          String(item[labelKey] ?? '').slice(0, 12)),
        el('text.axis', { x: bx + barW / 2, y: height - 12, 'text-anchor': 'middle' }, format(v)));
    }));
}

// ------------------------------------------------------------------ export
export async function exportCsv(rows, filename) {
  const content = fmt.csv(rows);
  const saved = await window.medv.dialog.saveFile({ defaultName: filename, content });
  if (saved) {
    toast(`Saved to ${saved}`, { type: 'ok' });
    return saved;
  }
  return null;
}

export { el, mount, clear, icon };
