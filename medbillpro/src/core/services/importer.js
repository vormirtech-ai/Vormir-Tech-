'use strict';

const db = require('../db');
const products = require('./products');
const settings = require('./settings');
const { readAny, serialToIso } = require('../util/xlsx');
const { assert } = require('../util/errors');
const { r2, r3 } = require('../util/money');
const { isExpiryMonth } = require('../util/dates');

/**
 * Purchase-bill import. Distributor sheets never share a layout, so columns
 * are detected from the header row by keyword, and anything ambiguous comes
 * back to the screen as an editable preview instead of being guessed at.
 */
const FIELDS = {
  name: ['product', 'item', 'medicine', 'description', 'particulars', 'name', 'product name', 'item name'],
  pack: ['pack', 'packing'],
  batch: ['batch', 'batch no', 'batchno', 'b.no', 'bno', 'lot'],
  expiry: ['expiry', 'exp', 'exp date', 'expdt', 'exp.dt', 'expiry date'],
  qty: ['qty', 'quantity', 'qnty', 'nos', 'units', 'pcs'],
  free: ['free', 'free qty', 'scheme', 'bonus'],
  mrp: ['mrp', 'm.r.p', 'mrp rs', 'retail'],
  rate: ['rate', 'ptr', 'purchase rate', 'price', 'net rate', 'basic', 'trade rate'],
  disc: ['disc', 'discount', 'disc %', 'dis%', 'cd'],
  gst: ['gst', 'gst %', 'tax', 'igst', 'cgst+sgst', 'gst rate', 'vat'],
  hsn: ['hsn', 'hsn code'],
  mfr: ['mfr', 'manufacturer', 'company', 'mfg', 'marketer']
};

function normaliseHeader(cell) {
  return String(cell || '').toLowerCase().replace(/[._]/g, ' ').replace(/\s+/g, ' ').trim();
}

function detectColumns(headerRow) {
  const map = {};
  headerRow.forEach((cell, index) => {
    const h = normaliseHeader(cell);
    if (!h) return;
    for (const [field, keys] of Object.entries(FIELDS)) {
      if (map[field] !== undefined) continue;
      if (keys.some((k) => h === k)) { map[field] = index; return; }
    }
    for (const [field, keys] of Object.entries(FIELDS)) {
      if (map[field] !== undefined) continue;
      if (keys.some((k) => h.includes(k))) { map[field] = index; return; }
    }
  });
  return map;
}

/** Picks the header row — the first row that names a product and a quantity. */
function findHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 25); i += 1) {
    const map = detectColumns(rows[i]);
    if (map.name !== undefined && (map.qty !== undefined || map.rate !== undefined)) return { index: i, map };
  }
  return { index: -1, map: {} };
}

function toNumber(value) {
  if (value === undefined || value === null || value === '') return 0;
  const cleaned = String(value).replace(/[₹,\s]/g, '').replace(/[^0-9.+-]/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function parseExpiry(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  if (isExpiryMonth(raw)) return raw;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw.slice(0, 7);
  const serial = Number(raw);
  if (Number.isFinite(serial) && serial > 1000) {
    const iso = serialToIso(serial);
    if (iso) return iso.slice(0, 7);
  }
  const mmYY = raw.match(/^(\d{1,2})\s*[/\-.]\s*(\d{2}|\d{4})$/);
  if (mmYY) {
    const mm = String(Math.min(12, Math.max(1, Number(mmYY[1])))).padStart(2, '0');
    const yy = mmYY[2].length === 2 ? `20${mmYY[2]}` : mmYY[2];
    return `${yy}-${mm}`;
  }
  const monthName = raw.match(/^([A-Za-z]{3,9})[\s-]*(\d{2}|\d{4})$/);
  if (monthName) {
    const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const idx = months.indexOf(monthName[1].slice(0, 3).toLowerCase());
    if (idx >= 0) {
      const yy = monthName[2].length === 2 ? `20${monthName[2]}` : monthName[2];
      return `${yy}-${String(idx + 1).padStart(2, '0')}`;
    }
  }
  const dmy = raw.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (dmy) {
    const mm = String(Math.min(12, Math.max(1, Number(dmy[2])))).padStart(2, '0');
    const yy = dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3];
    return `${yy}-${mm}`;
  }
  return null;
}

/** Units per pack from strings like "10x10", "1x15 TAB", "30 ML". */
function parsePack(value) {
  const raw = String(value ?? '').toLowerCase();
  const cross = raw.match(/(\d+)\s*[x*]\s*(\d+)/);
  if (cross) return Math.max(1, Number(cross[2]));
  const plain = raw.match(/(\d+)/);
  return plain ? Math.max(1, Number(plain[1])) : 1;
}

function matchProduct(name) {
  const conn = db.get();
  const clean = String(name || '').trim();
  if (!clean) return null;
  const exact = conn.prepare('SELECT * FROM products WHERE lower(name) = lower(?) AND active = 1').get(clean);
  if (exact) return exact;
  const like = conn.prepare('SELECT * FROM products WHERE name LIKE ? AND active = 1 ORDER BY length(name) LIMIT 1')
    .get(`${clean.split(/\s+/)[0]}%`);
  if (like && like.name.toLowerCase().startsWith(clean.slice(0, 4).toLowerCase())) return like;
  return null;
}

/**
 * Parses a spreadsheet into draft purchase lines. Nothing is written to the
 * database here — the operator reviews the preview and then saves.
 */
function preview({ filename = '', base64 = '', text = '' }) {
  const buffer = base64 ? Buffer.from(base64, 'base64') : Buffer.from(String(text), 'utf8');
  assert(buffer.length > 0, 'That file is empty.');
  assert(buffer.length < 12 * 1024 * 1024, 'That file is larger than 12 MB — please split it.');
  const rows = readAny(buffer, filename);
  assert(rows.length > 1, 'No rows could be read from that file.');
  const { index, map } = findHeaderRow(rows);
  assert(index >= 0, 'Could not find a header row. The sheet needs column titles such as Product, Batch, Expiry, Qty, Rate, MRP.');

  const defaultGst = settings.num('default_gst_rate', 12);
  const body = rows.slice(index + 1);
  const lines = [];
  for (const row of body) {
    const cell = (field) => (map[field] === undefined ? '' : row[map[field]] ?? '');
    const name = String(cell('name')).trim();
    if (!name) continue;
    if (/^(total|grand total|sub total|net amount|amount)/i.test(name)) continue;
    const qty = Math.round(toNumber(cell('qty')));
    const rate = toNumber(cell('rate'));
    if (qty <= 0 && rate <= 0) continue;
    const packSize = map.pack !== undefined ? parsePack(cell('pack')) : 1;
    const matched = matchProduct(name);
    const expiry = parseExpiry(cell('expiry'));
    const gstRaw = toNumber(cell('gst'));
    const mrp = toNumber(cell('mrp'));
    const issues = [];
    if (!matched) issues.push('New medicine — will be created on import');
    if (!expiry) issues.push('Expiry missing or unreadable');
    if (qty <= 0) issues.push('Quantity missing');
    if (rate <= 0) issues.push('Rate missing');
    lines.push({
      source_name: name,
      product_id: matched?.id ?? null,
      product_name: matched?.name ?? name,
      manufacturer: String(cell('mfr')).trim(),
      hsn: String(cell('hsn')).trim() || '3004',
      pack_size: matched?.pack_size ?? packSize,
      batch_no: String(cell('batch')).trim().toUpperCase() || 'NA',
      expiry,
      qty_units: qty > 0 ? qty * (matched ? 1 : 1) : 0,
      free_units: Math.max(0, Math.round(toNumber(cell('free')))),
      mrp: r2(mrp),
      rate_per_unit: r3(rate),
      disc_pct: Math.min(100, Math.max(0, toNumber(cell('disc')))),
      gst_rate: [0, 5, 12, 18, 28].includes(gstRaw) ? gstRaw : (matched?.gst_rate ?? defaultGst),
      issues
    });
  }
  assert(lines.length > 0, 'No usable item rows were found in that file.');
  return {
    filename,
    headerRow: index + 1,
    columns: map,
    detected: Object.keys(map),
    lines,
    summary: {
      rows: lines.length,
      newProducts: lines.filter((l) => !l.product_id).length,
      withIssues: lines.filter((l) => l.issues.length > 0).length,
      value: r2(lines.reduce((s, l) => s + l.qty_units * l.rate_per_unit, 0))
    }
  };
}

/** Creates any medicines the sheet introduced, returning lines ready to save. */
function materialise(actor, { lines = [] }) {
  assert(Array.isArray(lines) && lines.length, 'Nothing to import.');
  return db.tx(() => lines.map((line) => {
    let productId = line.product_id ? Number(line.product_id) : null;
    if (!productId) {
      const created = products.save(actor, {
        name: line.product_name || line.source_name,
        manufacturer: line.manufacturer || '',
        hsn: line.hsn || '3004',
        gst_rate: line.gst_rate,
        pack_size: line.pack_size || 1,
        category: 'Medicine'
      });
      productId = created.id;
    }
    return {
      product_id: productId,
      batch_no: line.batch_no,
      expiry: line.expiry,
      mrp: line.mrp,
      qty_units: line.qty_units,
      free_units: line.free_units,
      rate_per_unit: line.rate_per_unit,
      disc_pct: line.disc_pct,
      gst_rate: line.gst_rate
    };
  }));
}

/** Medicine-master import — used to load an opening catalogue quickly. */
function importProducts(actor, { filename = '', base64 = '', text = '' }) {
  const buffer = base64 ? Buffer.from(base64, 'base64') : Buffer.from(String(text), 'utf8');
  const rows = readAny(buffer, filename);
  const { index, map } = findHeaderRow(rows);
  assert(index >= 0, 'Could not find a header row with a product name column.');
  const created = [];
  const skipped = [];
  db.tx(() => {
    for (const row of rows.slice(index + 1)) {
      const cell = (f) => (map[f] === undefined ? '' : row[map[f]] ?? '');
      const name = String(cell('name')).trim();
      if (!name) continue;
      try {
        created.push(products.save(actor, {
          name,
          manufacturer: String(cell('mfr')).trim(),
          hsn: String(cell('hsn')).trim() || '3004',
          gst_rate: [0, 5, 12, 18, 28].includes(toNumber(cell('gst'))) ? toNumber(cell('gst')) : settings.num('default_gst_rate', 12),
          pack_size: map.pack !== undefined ? parsePack(cell('pack')) : 1
        }).name);
      } catch (err) {
        skipped.push({ name, reason: err.message });
      }
    }
  });
  return { created: created.length, skipped, names: created.slice(0, 50) };
}

module.exports = { preview, materialise, importProducts, detectColumns, parseExpiry, parsePack, toNumber };
