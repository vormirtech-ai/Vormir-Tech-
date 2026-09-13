const INR = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const INR0 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

export const state = { currency: '₹' };

export function money(value, { symbol = true, dash = false } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return dash ? '—' : `${symbol ? state.currency : ''}0.00`;
  if (dash && n === 0) return '—';
  const sign = n < 0 ? '-' : '';
  return `${sign}${symbol ? state.currency : ''}${INR.format(Math.abs(n))}`;
}

/** Compact form for dashboard tiles: ₹1.2L, ₹3.4Cr. */
export function moneyShort(value) {
  const n = Number(value) || 0;
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e7) return `${sign}${state.currency}${(abs / 1e7).toFixed(2)}Cr`;
  if (abs >= 1e5) return `${sign}${state.currency}${(abs / 1e5).toFixed(2)}L`;
  if (abs >= 1000) return `${sign}${state.currency}${INR0.format(Math.round(abs))}`;
  return `${sign}${state.currency}${INR.format(abs)}`;
}

export function number(value, digits = 0) {
  const n = Number(value) || 0;
  return new Intl.NumberFormat('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
}

export function pct(value, digits = 1) {
  const n = Number(value) || 0;
  return `${n.toFixed(digits)}%`;
}

export function date(iso) {
  if (!iso) return '—';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return d ? `${d}-${m}-${y}` : `${m}-${y}`;
}

export function dateLong(iso) {
  if (!iso) return '—';
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return date(iso);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function stamp(value) {
  if (!value) return '—';
  return String(value).replace('T', ' ').slice(0, 16);
}

export function expiry(value) {
  if (!value) return '—';
  const [y, m] = String(value).split('-');
  return m ? `${m}/${String(y).slice(2)}` : String(value);
}

export function today(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function monthStart(iso = today()) { return `${iso.slice(0, 7)}-01`; }

export function addDays(iso, days) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + Number(days || 0));
  return today(d);
}

/** "2 Strip + 3 Tablet" from a unit count. */
export function qtyLabel(units, packSize = 1, packLabel = 'Strip', unitLabel = 'Unit') {
  const n = Number(units) || 0;
  const pack = Math.max(1, Number(packSize) || 1);
  if (pack === 1) return `${number(n)} ${unitLabel}`;
  const packs = Math.floor(n / pack);
  const loose = n % pack;
  if (packs === 0) return `${number(loose)} ${unitLabel}`;
  return `${number(packs)} ${packLabel}${loose ? ` + ${loose} ${unitLabel}` : ''}`;
}

export function initials(name) {
  return String(name || '?')
    .split(/\s+/).filter(Boolean).slice(0, 2)
    .map((w) => w[0].toUpperCase()).join('') || '?';
}

export function relativeDays(iso) {
  if (!iso) return '';
  const diff = Math.round((Date.parse(`${iso}T00:00:00`) - Date.parse(`${today()}T00:00:00`)) / 86400000);
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  if (diff === -1) return 'yesterday';
  return diff > 0 ? `in ${diff} days` : `${Math.abs(diff)} days ago`;
}

export function csv(rows) {
  return rows.map((row) => row.map((cell) => {
    const text = cell === null || cell === undefined ? '' : String(cell);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }).join(',')).join('\r\n');
}
