'use strict';

const db = require('../db');
const auth = require('./auth');
const audit = require('./audit');
const settings = require('./settings');
const products = require('./products');
const parties = require('./parties');
const purchases = require('./purchases');
const v = require('../util/validate');
const { assert } = require('../util/errors');
const { today, addMonths } = require('../util/dates');

function status() {
  return {
    complete: settings.flag('setup_complete'),
    settings: settings.all(),
    users: db.get().prepare('SELECT COUNT(*) AS n FROM users WHERE active = 1').get().n,
    hasData: db.get().prepare('SELECT COUNT(*) AS n FROM sales').get().n > 0
  };
}

const SAMPLE_PRODUCTS = [
  ['Paracetamol 500mg Tablet', 'Paracetamol', 'Cipla', 'Tablet', 10, 'Strip', 'Tablet', 12, 24.5, 18.2, 'A1'],
  ['Azithromycin 500mg Tablet', 'Azithromycin', 'Alkem', 'Tablet', 5, 'Strip', 'Tablet', 12, 118.0, 86.4, 'A2'],
  ['Amoxycillin 500mg Capsule', 'Amoxycillin', 'Sun Pharma', 'Tablet', 10, 'Strip', 'Capsule', 12, 96.0, 71.5, 'A3'],
  ['Pantoprazole 40mg Tablet', 'Pantoprazole', 'Zydus', 'Tablet', 15, 'Strip', 'Tablet', 12, 152.0, 108.0, 'B1'],
  ['Metformin 500mg Tablet', 'Metformin', 'USV', 'Tablet', 20, 'Strip', 'Tablet', 12, 68.0, 47.5, 'B2'],
  ['Amlodipine 5mg Tablet', 'Amlodipine', 'Torrent', 'Tablet', 10, 'Strip', 'Tablet', 12, 42.0, 29.0, 'B3'],
  ['Cetirizine 10mg Tablet', 'Cetirizine', 'Dr Reddy’s', 'Tablet', 10, 'Strip', 'Tablet', 12, 32.0, 21.0, 'C1'],
  ['Cough Syrup 100ml', 'Dextromethorphan', 'Glenmark', 'Syrup', 1, 'Bottle', 'Bottle', 12, 128.0, 92.0, 'C2'],
  ['ORS Powder Sachet', 'Oral Rehydration Salts', 'FDC', 'General', 1, 'Sachet', 'Sachet', 5, 22.0, 15.0, 'C3'],
  ['Insulin Glargine 100IU', 'Insulin Glargine', 'Biocon', 'Injection', 1, 'Vial', 'Vial', 5, 460.0, 352.0, 'F1'],
  ['Vitamin D3 60000 IU', 'Cholecalciferol', 'Mankind', 'General', 4, 'Strip', 'Sachet', 12, 89.0, 62.0, 'D1'],
  ['Digital Thermometer', '', 'Dr Morepen', 'Surgical', 1, 'Piece', 'Piece', 18, 240.0, 165.0, 'S1'],
  ['Surgical Face Mask', '', 'Romsons', 'Surgical', 50, 'Box', 'Piece', 5, 250.0, 150.0, 'S2'],
  ['Betadine Ointment 20g', 'Povidone Iodine', 'Win-Medicare', 'Ointment', 1, 'Tube', 'Tube', 12, 148.0, 106.0, 'S3']
];

/** Optional demo catalogue so a new install has something to click through. */
function loadSampleData(actor) {
  const supplier = parties.saveSupplier(actor, {
    name: 'Nagpur Medical Distributors',
    phone: '9226406057',
    address: 'Itwari Market, Nagpur',
    gstin: '27ABCDE1234F1Z5',
    dl_no: 'MH-NAG-20B-123456'
  });
  parties.saveSupplier(actor, { name: 'Sanjivani Pharma Agencies', phone: '9834523160', address: 'Sitabuldi, Nagpur' });
  const doctor = parties.saveDoctor(actor, { name: 'Dr. A. Deshmukh', clinic: 'Shree Clinic', reg_no: 'MMC-45821', commission_pct: 2 });
  void doctor;
  parties.saveDoctor(actor, { name: 'Dr. S. Iyer', clinic: 'City Hospital', reg_no: 'MMC-31204', commission_pct: 0 });
  parties.saveCustomer(actor, { name: 'Ramesh Patil', phone: '9822012345', address: 'Dharampeth, Nagpur' });
  parties.saveCustomer(actor, { name: 'Sunita Kale', phone: '9765098765', address: 'Sadar, Nagpur' });
  parties.saveCustomer(actor, { name: 'Imran Sheikh', phone: '9970011223', address: 'Mominpura, Nagpur' });

  const created = SAMPLE_PRODUCTS.map(([name, generic, mfr, category, pack, packLabel, unitLabel, gst, mrp, ptr, rack]) => {
    const product = products.save(actor, {
      name,
      generic,
      manufacturer: mfr,
      category,
      pack_size: pack,
      pack_label: packLabel,
      unit_label: unitLabel,
      gst_rate: gst,
      rack,
      reorder_level: pack * 2,
      hsn: category === 'Surgical' ? '9018' : '3004'
    });
    return { product, mrp, ptr, pack };
  });

  // One opening purchase so every medicine has stock in a real batch.
  purchases.create(actor, {
    date: today(),
    supplier_id: supplier.id,
    ref_no: 'OPENING-01',
    payment_mode: 'Credit',
    paid: 0,
    notes: 'Opening stock (sample data)',
    items: created.map(({ product, mrp, ptr, pack }, i) => ({
      product_id: product.id,
      batch_no: `B${String(1001 + i)}`,
      expiry: addMonths(today(), 14 + (i % 10)).slice(0, 7),
      mrp,
      qty_units: pack * 10,
      free_units: 0,
      rate_per_unit: Number((ptr / pack).toFixed(3)),
      disc_pct: 0,
      gst_rate: product.gst_rate
    }))
  });
  return { products: created.length };
}

function complete(actor, payload = {}) {
  const store = {
    store_name: v.str(payload.store_name, 'Store name', { required: true, max: 120 }),
    store_tagline: v.str(payload.store_tagline, 'Tagline', { max: 80 }),
    store_address: v.str(payload.store_address, 'Address', { max: 300 }),
    store_city: v.str(payload.store_city, 'City', { max: 80 }),
    store_state: v.str(payload.store_state, 'State', { max: 80 }),
    store_pincode: v.str(payload.store_pincode, 'PIN code', { max: 10 }),
    store_phone: v.phone(payload.store_phone, 'Phone'),
    store_email: v.str(payload.store_email, 'Email', { max: 120 }),
    store_gstin: payload.store_gstin ? v.gstin(payload.store_gstin) : '',
    store_dl_no: v.str(payload.store_dl_no, 'Drug licence number', { max: 60 }),
    store_fssai: v.str(payload.store_fssai, 'FSSAI number', { max: 30 }),
    invoice_prefix: (v.str(payload.invoice_prefix, 'Invoice prefix', { max: 8 }) || 'INV').toUpperCase(),
    default_gst_rate: String(v.number(payload.default_gst_rate, 'Default GST %', { min: 0, max: 28, fallback: 12 })),
    print_format: v.oneOf(payload.print_format, 'Print format', ['a4', 'a5', 'thermal'], 'a5'),
    expiry_alert_days: String(v.integer(payload.expiry_alert_days, 'Expiry alert (days)', { min: 7, max: 365, fallback: 90 }))
  };
  const password = String(payload.admin_password ?? '');
  assert(password.length >= 4, 'Set an administrator password of at least 4 characters.');
  assert(password !== 'admin123', 'Please choose a password other than the default one.');

  const actingUser = actor ?? { id: null, username: 'setup', role: 'admin' };
  const result = db.tx(() => {
    for (const [key, value] of Object.entries(store)) settings.put(key, value);
    auth.setAdminPassword(password);
    settings.put('setup_complete', '1');
    audit.log(actingUser, 'setup.complete', 'settings', null, { store: store.store_name });
    return { ok: true };
  });
  if (payload.sample_data) {
    try {
      loadSampleData({ id: null, username: actingUser.username, role: 'admin' });
    } catch (err) {
      // Sample data is a convenience; never block setup because of it.
      audit.log(actingUser, 'setup.sample_failed', 'settings', null, err.message);
    }
  }
  return { ...result, settings: settings.all() };
}

module.exports = { status, complete, loadSampleData };
