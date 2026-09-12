'use strict';

const db = require('../db');
const audit = require('./audit');
const auth = require('./auth');
const settings = require('./settings');
const v = require('../util/validate');
const { assert } = require('../util/errors');
const { nowStamp, today, addDays } = require('../util/dates');

/**
 * Refill reminders live entirely in the local database. The app never sends
 * anything by itself — it prepares the message and hands it to WhatsApp (or
 * the clipboard) only when the operator clicks Send.
 */
function list({ status = 'pending', from = null, to = null, limit = 300 } = {}) {
  const where = [];
  const args = [];
  if (status) { where.push('r.status = ?'); args.push(status); }
  if (from) { where.push('r.due_date >= ?'); args.push(from); }
  if (to) { where.push('r.due_date <= ?'); args.push(to); }
  const rows = db.get().prepare(`SELECT r.*, c.name AS customer_name, c.phone, s.no AS invoice_no
    FROM rx_reminders r JOIN customers c ON c.id = r.customer_id
    LEFT JOIN sales s ON s.id = r.sale_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY r.due_date, r.id LIMIT ?`).all(...args, Math.min(Number(limit) || 300, 2000));
  const ref = today();
  return rows.map((r) => ({ ...r, due: r.due_date <= ref, message: composeMessage(r) }));
}

function composeMessage(reminder) {
  const template = settings.get('whatsapp_template');
  return template
    .replace(/\{name\}/g, reminder.customer_name || 'there')
    .replace(/\{store\}/g, settings.get('store_name'))
    .replace(/\{medicines\}/g, reminder.medicines || 'your regular medicines')
    .replace(/\{phone\}/g, settings.get('store_phone'))
    .replace(/\{date\}/g, reminder.due_date || '');
}

function save(actor, payload) {
  auth.requireRole(actor, ['admin', 'pharmacist', 'cashier']);
  const customerId = v.integer(payload.customer_id, 'Customer', { required: true, min: 1 });
  const customer = db.get().prepare('SELECT * FROM customers WHERE id = ?').get(customerId);
  assert(customer, 'That customer no longer exists.');
  const dueDate = v.date(payload.due_date, 'Due date', { required: false })
    || addDays(today(), settings.num('rx_reminder_days', 25));
  const medicines = v.str(payload.medicines, 'Medicines', { max: 300 });
  const note = v.str(payload.note, 'Note', { max: 200 });
  const id = payload.id ? v.integer(payload.id, 'Reminder', { min: 1 }) : null;
  if (id) {
    db.get().prepare('UPDATE rx_reminders SET due_date = ?, medicines = ?, note = ? WHERE id = ?')
      .run(dueDate, medicines, note, id);
    audit.log(actor, 'reminder.update', 'rx_reminder', id);
    return { id };
  }
  const info = db.get().prepare(`INSERT INTO rx_reminders (customer_id, sale_id, due_date, medicines, note, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'pending', ?)`)
    .run(customerId, payload.sale_id ? Number(payload.sale_id) : null, dueDate, medicines, note, nowStamp());
  audit.log(actor, 'reminder.create', 'rx_reminder', info.lastInsertRowid);
  return { id: Number(info.lastInsertRowid) };
}

function setStatus(actor, { id, status }) {
  auth.requireRole(actor, ['admin', 'pharmacist', 'cashier']);
  const rid = v.integer(id, 'Reminder', { required: true, min: 1 });
  const next = v.oneOf(status, 'Status', ['pending', 'sent', 'done', 'cancelled'], 'sent');
  db.get().prepare('UPDATE rx_reminders SET status = ?, sent_at = ? WHERE id = ?')
    .run(next, next === 'sent' ? nowStamp() : null, rid);
  audit.log(actor, 'reminder.status', 'rx_reminder', rid, next);
  return { ok: true };
}

function remove(actor, { id }) {
  auth.requireRole(actor, ['admin', 'pharmacist']);
  const rid = v.integer(id, 'Reminder', { required: true, min: 1 });
  db.get().prepare('DELETE FROM rx_reminders WHERE id = ?').run(rid);
  audit.log(actor, 'reminder.delete', 'rx_reminder', rid);
  return { ok: true };
}

/** Suggests refills from buying history for customers with no open reminder. */
function suggestions({ days = 30, limit = 40 } = {}) {
  const gap = Math.max(7, Number(days) || 30);
  return db.get().prepare(`SELECT c.id AS customer_id, c.name AS customer_name, c.phone,
      MAX(s.date) AS last_visit,
      (SELECT GROUP_CONCAT(x.name, ', ') FROM (
         SELECT DISTINCT si.name FROM sale_items si
         JOIN sales s2 ON s2.id = si.sale_id
         WHERE s2.customer_id = c.id ORDER BY si.id DESC LIMIT 4) x) AS medicines
    FROM customers c JOIN sales s ON s.customer_id = c.id
    WHERE c.active = 1 AND c.phone <> ''
      AND NOT EXISTS (SELECT 1 FROM rx_reminders r WHERE r.customer_id = c.id AND r.status = 'pending')
    GROUP BY c.id
    HAVING julianday('now') - julianday(MAX(s.date)) >= ?
    ORDER BY last_visit DESC LIMIT ?`).all(gap, Math.min(Number(limit) || 40, 200));
}

module.exports = { list, save, setStatus, remove, suggestions, composeMessage };
