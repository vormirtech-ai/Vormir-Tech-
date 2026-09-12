'use strict';

const db = require('../db');
const audit = require('./audit');
const auth = require('./auth');
const v = require('../util/validate');
const { assert } = require('../util/errors');
const { r2 } = require('../util/money');
const { nowStamp } = require('../util/dates');

/**
 * Customers, doctors and suppliers share a shape, so one module handles all
 * three. Balances are derived from documents + payments, never stored.
 */

const CUSTOMER_BALANCE = `
  c.opening_balance
  + COALESCE((SELECT SUM(s.total) FROM sales s WHERE s.customer_id = c.id), 0)
  - COALESCE((SELECT SUM(r.total) FROM sale_returns r WHERE r.customer_id = c.id), 0)
  - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.party_type = 'customer' AND p.party_id = c.id AND p.direction = 'in'), 0)
  + COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.party_type = 'customer' AND p.party_id = c.id AND p.direction = 'out'), 0)`;

const SUPPLIER_BALANCE = `
  s.opening_balance
  + COALESCE((SELECT SUM(p.total) FROM purchases p WHERE p.supplier_id = s.id), 0)
  - COALESCE((SELECT SUM(r.total) FROM purchase_returns r WHERE r.supplier_id = s.id), 0)
  - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.party_type = 'supplier' AND p.party_id = s.id AND p.direction = 'out'), 0)
  + COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.party_type = 'supplier' AND p.party_id = s.id AND p.direction = 'in'), 0)`;

function listCustomers({ search = '', limit = 500, onlyActive = true } = {}) {
  const where = [];
  const args = [];
  if (onlyActive) where.push('c.active = 1');
  if (search) {
    where.push('(c.name LIKE ? OR c.phone LIKE ?)');
    args.push(`%${search}%`, `%${search}%`);
  }
  return db.get().prepare(`SELECT c.*, ROUND(${CUSTOMER_BALANCE}, 2) AS balance,
      (SELECT COUNT(*) FROM sales s WHERE s.customer_id = c.id) AS bill_count,
      (SELECT MAX(s.date) FROM sales s WHERE s.customer_id = c.id) AS last_visit
    FROM customers c ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY c.name LIMIT ?`).all(...args, Math.min(Number(limit) || 500, 5000));
}

function customerById(id) {
  return db.get().prepare(`SELECT c.*, ROUND(${CUSTOMER_BALANCE}, 2) AS balance FROM customers c WHERE c.id = ?`)
    .get(Number(id));
}

function saveCustomer(actor, payload) {
  auth.requireRole(actor, ['admin', 'pharmacist', 'cashier']);
  const id = payload.id ? v.integer(payload.id, 'Customer', { min: 1 }) : null;
  const data = {
    name: v.str(payload.name, 'Patient / customer name', { required: true, max: 120 }),
    phone: v.phone(payload.phone, 'Phone'),
    email: v.str(payload.email, 'Email', { max: 120 }),
    address: v.str(payload.address, 'Address', { max: 300 }),
    gstin: payload.gstin ? v.gstin(payload.gstin) : '',
    dob: v.date(payload.dob, 'Date of birth', { required: false }),
    notes: v.str(payload.notes, 'Notes', { max: 500 }),
    opening_balance: r2(v.number(payload.opening_balance, 'Opening balance', { min: -1e9, max: 1e9 })),
    active: v.bool(payload.active ?? 1)
  };
  if (id) {
    db.get().prepare(`UPDATE customers SET name=@name, phone=@phone, email=@email, address=@address,
      gstin=@gstin, dob=@dob, notes=@notes, opening_balance=@opening_balance, active=@active WHERE id=@id`)
      .run({ ...data, id });
    audit.log(actor, 'customer.update', 'customer', id, data.name);
    return customerById(id);
  }
  const info = db.get().prepare(`INSERT INTO customers
    (name, phone, email, address, gstin, dob, notes, opening_balance, active, created_at)
    VALUES (@name, @phone, @email, @address, @gstin, @dob, @notes, @opening_balance, @active, @created_at)`)
    .run({ ...data, created_at: nowStamp() });
  audit.log(actor, 'customer.create', 'customer', info.lastInsertRowid, data.name);
  return customerById(info.lastInsertRowid);
}

function customerHistory({ id, limit = 100 }) {
  const cid = v.integer(id, 'Customer', { required: true, min: 1 });
  const sales = db.get().prepare(`SELECT s.*, d.name AS doctor_name FROM sales s
    LEFT JOIN doctors d ON d.id = s.doctor_id
    WHERE s.customer_id = ? ORDER BY s.date DESC, s.id DESC LIMIT ?`).all(cid, Number(limit) || 100);
  const payments = db.get().prepare(`SELECT * FROM payments WHERE party_type = 'customer' AND party_id = ?
    ORDER BY date DESC, id DESC LIMIT ?`).all(cid, Number(limit) || 100);
  const items = db.get().prepare(`SELECT si.name, SUM(si.qty_units) AS units, MAX(s.date) AS last_date
    FROM sale_items si JOIN sales s ON s.id = si.sale_id
    WHERE s.customer_id = ? GROUP BY si.name ORDER BY units DESC LIMIT 20`).all(cid);
  return { customer: customerById(cid), sales, payments, items };
}

// ---------------------------------------------------------------- doctors

function listDoctors({ search = '', onlyActive = true } = {}) {
  const where = [];
  const args = [];
  if (onlyActive) where.push('d.active = 1');
  if (search) { where.push('d.name LIKE ?'); args.push(`%${search}%`); }
  return db.get().prepare(`SELECT d.*,
      (SELECT COUNT(*) FROM sales s WHERE s.doctor_id = d.id) AS referrals,
      COALESCE((SELECT SUM(c.amount) FROM doctor_commissions c WHERE c.doctor_id = d.id), 0) AS commission_total,
      COALESCE((SELECT SUM(c.amount) FROM doctor_commissions c WHERE c.doctor_id = d.id AND c.paid = 0), 0) AS commission_due
    FROM doctors d ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY d.name`).all(...args);
}

function saveDoctor(actor, payload) {
  auth.requireRole(actor, ['admin', 'pharmacist']);
  const id = payload.id ? v.integer(payload.id, 'Doctor', { min: 1 }) : null;
  const data = {
    name: v.str(payload.name, 'Doctor name', { required: true, max: 120 }),
    phone: v.phone(payload.phone, 'Phone'),
    clinic: v.str(payload.clinic, 'Clinic / hospital', { max: 160 }),
    reg_no: v.str(payload.reg_no, 'Registration number', { max: 40 }),
    commission_pct: v.number(payload.commission_pct, 'Commission %', { min: 0, max: 100 }),
    active: v.bool(payload.active ?? 1)
  };
  if (id) {
    db.get().prepare(`UPDATE doctors SET name=@name, phone=@phone, clinic=@clinic, reg_no=@reg_no,
      commission_pct=@commission_pct, active=@active WHERE id=@id`).run({ ...data, id });
    audit.log(actor, 'doctor.update', 'doctor', id, data.name);
  } else {
    const info = db.get().prepare(`INSERT INTO doctors (name, phone, clinic, reg_no, commission_pct, active, created_at)
      VALUES (@name, @phone, @clinic, @reg_no, @commission_pct, @active, @created_at)`)
      .run({ ...data, created_at: nowStamp() });
    audit.log(actor, 'doctor.create', 'doctor', info.lastInsertRowid, data.name);
  }
  return listDoctors({});
}

function doctorCommissions({ doctorId = null, from = null, to = null, unpaidOnly = false } = {}) {
  const where = [];
  const args = [];
  if (doctorId) { where.push('c.doctor_id = ?'); args.push(Number(doctorId)); }
  if (from) { where.push('c.date >= ?'); args.push(from); }
  if (to) { where.push('c.date <= ?'); args.push(to); }
  if (unpaidOnly) where.push('c.paid = 0');
  return db.get().prepare(`SELECT c.*, d.name AS doctor_name, s.no AS invoice_no
    FROM doctor_commissions c JOIN doctors d ON d.id = c.doctor_id
    LEFT JOIN sales s ON s.id = c.sale_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY c.date DESC, c.id DESC LIMIT 1000`).all(...args);
}

function settleCommission(actor, { ids = [], paid = 1 }) {
  auth.requireRole(actor, ['admin', 'pharmacist']);
  assert(Array.isArray(ids) && ids.length, 'Select at least one commission entry.');
  return db.tx(() => {
    const stmt = db.get().prepare('UPDATE doctor_commissions SET paid = ? WHERE id = ?');
    for (const id of ids) stmt.run(paid ? 1 : 0, Number(id));
    audit.log(actor, 'doctor.commission.settle', 'doctor_commission', ids.join(','), { paid });
    return { ok: true, updated: ids.length };
  });
}

// --------------------------------------------------------------- suppliers

function listSuppliers({ search = '', onlyActive = true } = {}) {
  const where = [];
  const args = [];
  if (onlyActive) where.push('s.active = 1');
  if (search) { where.push('(s.name LIKE ? OR s.phone LIKE ?)'); args.push(`%${search}%`, `%${search}%`); }
  return db.get().prepare(`SELECT s.*, ROUND(${SUPPLIER_BALANCE}, 2) AS balance,
      (SELECT COUNT(*) FROM purchases p WHERE p.supplier_id = s.id) AS bill_count,
      (SELECT MAX(p.date) FROM purchases p WHERE p.supplier_id = s.id) AS last_purchase
    FROM suppliers s ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY s.name LIMIT ?`)
    .all(...args, 2000);
}

function supplierById(id) {
  return db.get().prepare(`SELECT s.*, ROUND(${SUPPLIER_BALANCE}, 2) AS balance FROM suppliers s WHERE s.id = ?`)
    .get(Number(id));
}

function saveSupplier(actor, payload) {
  auth.requireRole(actor, ['admin', 'pharmacist']);
  const id = payload.id ? v.integer(payload.id, 'Supplier', { min: 1 }) : null;
  const data = {
    name: v.str(payload.name, 'Supplier name', { required: true, max: 120 }),
    phone: v.phone(payload.phone, 'Phone'),
    email: v.str(payload.email, 'Email', { max: 120 }),
    address: v.str(payload.address, 'Address', { max: 300 }),
    gstin: payload.gstin ? v.gstin(payload.gstin) : '',
    dl_no: v.str(payload.dl_no, 'Drug licence number', { max: 60 }),
    opening_balance: r2(v.number(payload.opening_balance, 'Opening balance', { min: -1e9, max: 1e9 })),
    active: v.bool(payload.active ?? 1)
  };
  if (id) {
    db.get().prepare(`UPDATE suppliers SET name=@name, phone=@phone, email=@email, address=@address,
      gstin=@gstin, dl_no=@dl_no, opening_balance=@opening_balance, active=@active WHERE id=@id`)
      .run({ ...data, id });
    audit.log(actor, 'supplier.update', 'supplier', id, data.name);
    return supplierById(id);
  }
  const info = db.get().prepare(`INSERT INTO suppliers
    (name, phone, email, address, gstin, dl_no, opening_balance, active, created_at)
    VALUES (@name, @phone, @email, @address, @gstin, @dl_no, @opening_balance, @active, @created_at)`)
    .run({ ...data, created_at: nowStamp() });
  audit.log(actor, 'supplier.create', 'supplier', info.lastInsertRowid, data.name);
  return supplierById(info.lastInsertRowid);
}

function supplierHistory({ id, limit = 100 }) {
  const sid = v.integer(id, 'Supplier', { required: true, min: 1 });
  return {
    supplier: supplierById(sid),
    purchases: db.get().prepare(`SELECT * FROM purchases WHERE supplier_id = ?
      ORDER BY date DESC, id DESC LIMIT ?`).all(sid, Number(limit) || 100),
    payments: db.get().prepare(`SELECT * FROM payments WHERE party_type = 'supplier' AND party_id = ?
      ORDER BY date DESC, id DESC LIMIT ?`).all(sid, Number(limit) || 100)
  };
}

function deactivate(actor, { type, id }) {
  auth.requireRole(actor, ['admin', 'pharmacist']);
  const table = { customer: 'customers', doctor: 'doctors', supplier: 'suppliers' }[type];
  assert(table, 'Unknown record type.');
  const rid = v.integer(id, 'Record', { required: true, min: 1 });
  db.get().prepare(`UPDATE ${table} SET active = 0 WHERE id = ?`).run(rid);
  audit.log(actor, `${type}.deactivate`, type, rid);
  return { ok: true };
}

module.exports = {
  listCustomers, customerById, saveCustomer, customerHistory,
  listDoctors, saveDoctor, doctorCommissions, settleCommission,
  listSuppliers, supplierById, saveSupplier, supplierHistory, deactivate,
  CUSTOMER_BALANCE, SUPPLIER_BALANCE
};
