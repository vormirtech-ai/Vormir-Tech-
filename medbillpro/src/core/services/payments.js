'use strict';

const db = require('../db');
const audit = require('./audit');
const auth = require('./auth');
const ledger = require('./ledger');
const parties = require('./parties');
const v = require('../util/validate');
const { assert } = require('../util/errors');
const { r2 } = require('../util/money');
const { nowStamp, today } = require('../util/dates');

const CATEGORIES = ['Rent', 'Salary', 'Electricity', 'Transport', 'Packing', 'Telephone', 'Maintenance', 'Licence & Fees', 'Tea & Refreshment', 'General', 'Other'];

/** Records a receipt from a customer or a payment to a supplier. */
function record(actor, payload) {
  auth.requireRole(actor, ['admin', 'pharmacist', 'cashier']);
  const partyType = v.oneOf(payload.party_type, 'Party type', ['customer', 'supplier'], 'customer');
  const partyId = v.integer(payload.party_id, partyType === 'customer' ? 'Customer' : 'Supplier', { required: true, min: 1 });
  const direction = v.oneOf(payload.direction, 'Direction', ['in', 'out'], partyType === 'customer' ? 'in' : 'out');
  const amount = r2(v.number(payload.amount, 'Amount', { required: true, min: 0.01, max: 1e9 }));
  const mode = v.oneOf(payload.mode, 'Payment mode', ledger.MODES.filter((m) => m !== 'Credit'), 'Cash');
  const date = v.date(payload.date, 'Date', { required: false, fallback: 'today' }) || today();
  const refNo = v.str(payload.ref_no, 'Reference', { max: 60 });
  const notes = v.str(payload.notes, 'Notes', { max: 300 });
  const account = ledger.accountForMode(mode);

  const party = partyType === 'customer' ? parties.customerById(partyId) : parties.supplierById(partyId);
  assert(party, 'That party no longer exists.');

  return db.tx(() => {
    const info = db.get().prepare(`INSERT INTO payments
      (date, party_type, party_id, party_name, direction, amount, mode, account, ref_no, notes, created_at, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(date, partyType, partyId, party.name, direction, amount, mode, account, refNo, notes,
        nowStamp(), actor?.username ?? '');
    const id = Number(info.lastInsertRowid);
    ledger.post({
      date,
      account,
      direction,
      amount,
      sourceType: 'payment',
      sourceId: id,
      description: `${direction === 'in' ? 'Received from' : 'Paid to'} ${party.name}${refNo ? ` (${refNo})` : ''}`
    });
    audit.log(actor, 'payment.record', 'payment', id, { partyType, partyId, amount, mode });
    return { id, balance: (partyType === 'customer' ? parties.customerById(partyId) : parties.supplierById(partyId)).balance };
  });
}

function remove(actor, { id }) {
  auth.requireRole(actor, ['admin']);
  const pid = v.integer(id, 'Payment', { required: true, min: 1 });
  return db.tx(() => {
    const row = db.get().prepare('SELECT * FROM payments WHERE id = ?').get(pid);
    assert(row, 'That payment no longer exists.');
    assert(!row.sale_id && !row.purchase_id, 'This receipt was taken with a bill. Edit or delete the bill instead.');
    ledger.reverseSource('payment', pid);
    db.get().prepare('DELETE FROM payments WHERE id = ?').run(pid);
    audit.log(actor, 'payment.delete', 'payment', pid, row);
    return { ok: true };
  });
}

function list({ from, to, partyType = '', direction = '', limit = 500 } = {}) {
  const where = [];
  const args = [];
  if (from) { where.push('date >= ?'); args.push(from); }
  if (to) { where.push('date <= ?'); args.push(to); }
  if (partyType) { where.push('party_type = ?'); args.push(partyType); }
  if (direction) { where.push('direction = ?'); args.push(direction); }
  const rows = db.get().prepare(`SELECT * FROM payments ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY date DESC, id DESC LIMIT ?`).all(...args, Math.min(Number(limit) || 500, 5000));
  const totals = rows.reduce((a, r) => {
    if (r.direction === 'in') a.received = r2(a.received + r.amount); else a.paid = r2(a.paid + r.amount);
    return a;
  }, { received: 0, paid: 0 });
  return { rows, totals };
}

// ---------------------------------------------------------------- expenses

function saveExpense(actor, payload) {
  auth.requireRole(actor, ['admin', 'pharmacist']);
  const id = payload.id ? v.integer(payload.id, 'Expense', { min: 1 }) : null;
  const date = v.date(payload.date, 'Date', { required: false, fallback: 'today' }) || today();
  const category = v.str(payload.category, 'Category', { required: true, max: 60 });
  const payee = v.str(payload.payee, 'Paid to', { max: 120 });
  const amount = r2(v.number(payload.amount, 'Amount', { required: true, min: 0.01, max: 1e9 }));
  const account = v.oneOf(payload.account, 'Account', ledger.ACCOUNTS, 'cash');
  const notes = v.str(payload.notes, 'Notes', { max: 300 });

  return db.tx(() => {
    let expenseId = id;
    if (id) {
      const row = db.get().prepare('SELECT * FROM expenses WHERE id = ?').get(id);
      assert(row, 'That expense no longer exists.');
      db.get().prepare(`UPDATE expenses SET date=?, category=?, payee=?, amount=?, account=?, notes=? WHERE id=?`)
        .run(date, category, payee, amount, account, notes, id);
      ledger.reverseSource('expense', id);
    } else {
      const info = db.get().prepare(`INSERT INTO expenses (date, category, payee, amount, account, notes, created_at, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(date, category, payee, amount, account, notes, nowStamp(), actor?.username ?? '');
      expenseId = Number(info.lastInsertRowid);
    }
    ledger.post({
      date, account, direction: 'out', amount, sourceType: 'expense', sourceId: expenseId,
      description: `${category}${payee ? ` — ${payee}` : ''}`
    });
    audit.log(actor, id ? 'expense.update' : 'expense.create', 'expense', expenseId, { category, amount });
    return { id: expenseId };
  });
}

function listExpenses({ from, to, category = '', limit = 500 } = {}) {
  const where = [];
  const args = [];
  if (from) { where.push('date >= ?'); args.push(from); }
  if (to) { where.push('date <= ?'); args.push(to); }
  if (category) { where.push('category = ?'); args.push(category); }
  const rows = db.get().prepare(`SELECT * FROM expenses ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY date DESC, id DESC LIMIT ?`).all(...args, Math.min(Number(limit) || 500, 5000));
  const byCategory = {};
  let total = 0;
  for (const r of rows) {
    byCategory[r.category] = r2((byCategory[r.category] || 0) + r.amount);
    total = r2(total + r.amount);
  }
  return { rows, total, byCategory };
}

function removeExpense(actor, { id }) {
  auth.requireRole(actor, ['admin', 'pharmacist']);
  const eid = v.integer(id, 'Expense', { required: true, min: 1 });
  return db.tx(() => {
    const row = db.get().prepare('SELECT * FROM expenses WHERE id = ?').get(eid);
    assert(row, 'That expense no longer exists.');
    ledger.reverseSource('expense', eid);
    db.get().prepare('DELETE FROM expenses WHERE id = ?').run(eid);
    audit.log(actor, 'expense.delete', 'expense', eid, row);
    return { ok: true };
  });
}

/** Manual cash <-> bank movement (deposit / withdrawal). */
function transfer(actor, payload) {
  auth.requireRole(actor, ['admin', 'pharmacist']);
  const amount = r2(v.number(payload.amount, 'Amount', { required: true, min: 0.01, max: 1e9 }));
  const from = v.oneOf(payload.from, 'From account', ledger.ACCOUNTS, 'cash');
  const to = v.oneOf(payload.to, 'To account', ledger.ACCOUNTS, 'bank');
  assert(from !== to, 'Choose two different accounts.');
  const date = v.date(payload.date, 'Date', { required: false, fallback: 'today' }) || today();
  const notes = v.str(payload.notes, 'Notes', { max: 200 });
  return db.tx(() => {
    const label = `${from === 'cash' ? 'Cash to bank' : 'Bank to cash'}${notes ? ` — ${notes}` : ''}`;
    const outId = ledger.post({ date, account: from, direction: 'out', amount, sourceType: 'transfer', sourceId: null, description: label });
    ledger.post({ date, account: to, direction: 'in', amount, sourceType: 'transfer', sourceId: outId, description: label });
    audit.log(actor, 'account.transfer', 'ledger', outId, { from, to, amount });
    return { ok: true, balances: ledger.balances() };
  });
}

module.exports = { CATEGORIES, record, remove, list, saveExpense, listExpenses, removeExpense, transfer };
