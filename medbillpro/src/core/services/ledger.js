'use strict';

const db = require('../db');
const { r2 } = require('../util/money');
const { nowStamp } = require('../util/dates');

const ACCOUNTS = ['cash', 'bank'];
const MODES = ['Cash', 'UPI', 'Card', 'Cheque', 'Bank Transfer', 'Credit'];

/** Maps a payment mode to the account it moves money in or out of. */
function accountForMode(mode) {
  return mode === 'Cash' ? 'cash' : 'bank';
}

/** Appends a cash/bank movement. Must be called inside a transaction. */
function post({ date, account, direction, amount, sourceType, sourceId, description }) {
  const value = r2(amount);
  if (value === 0) return null;
  const info = db.get().prepare(`INSERT INTO ledger
      (date, account, direction, amount, source_type, source_id, description, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(date, account, direction, Math.abs(value), sourceType, sourceId ?? null, description ?? '', nowStamp());
  return Number(info.lastInsertRowid);
}

/** Removes entries created by a document that is being deleted/reversed. */
function reverseSource(sourceType, sourceId) {
  db.get().prepare('DELETE FROM ledger WHERE source_type = ? AND source_id = ?').run(sourceType, Number(sourceId));
}

function balances({ upto = null } = {}) {
  const clause = upto ? 'WHERE date <= ?' : '';
  const args = upto ? [upto] : [];
  const rows = db.get().prepare(`SELECT account,
      COALESCE(SUM(CASE WHEN direction = 'in' THEN amount ELSE 0 END), 0) AS credit,
      COALESCE(SUM(CASE WHEN direction = 'out' THEN amount ELSE 0 END), 0) AS debit
    FROM ledger ${clause} GROUP BY account`).all(...args);
  const out = { cash: 0, bank: 0, total: 0 };
  for (const r of rows) {
    if (out[r.account] === undefined) out[r.account] = 0;
    out[r.account] = r2(r.credit - r.debit);
  }
  out.total = r2(out.cash + out.bank);
  return out;
}

function entries({ from, to, account = '', limit = 500 } = {}) {
  const where = [];
  const args = [];
  if (from) { where.push('date >= ?'); args.push(from); }
  if (to) { where.push('date <= ?'); args.push(to); }
  if (account) { where.push('account = ?'); args.push(account); }
  const rows = db.get().prepare(`SELECT * FROM ledger ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY date DESC, id DESC LIMIT ?`).all(...args, Math.min(Number(limit) || 500, 5000));
  const opening = from
    ? balances({ upto: from })
    : { cash: 0, bank: 0, total: 0 };
  const openingBefore = from
    ? (() => {
      const r = db.get().prepare(`SELECT
          COALESCE(SUM(CASE WHEN direction='in' THEN amount ELSE 0 END),0) AS credit,
          COALESCE(SUM(CASE WHEN direction='out' THEN amount ELSE 0 END),0) AS debit
        FROM ledger WHERE date < ? ${account ? 'AND account = ?' : ''}`)
        .get(...(account ? [from, account] : [from]));
      return r2(r.credit - r.debit);
    })()
    : 0;
  const totals = rows.reduce((acc, r) => {
    if (r.direction === 'in') acc.inflow = r2(acc.inflow + r.amount);
    else acc.outflow = r2(acc.outflow + r.amount);
    return acc;
  }, { inflow: 0, outflow: 0 });
  return { rows, opening: openingBefore, totals, closing: r2(openingBefore + totals.inflow - totals.outflow), snapshot: opening };
}

module.exports = { ACCOUNTS, MODES, accountForMode, post, reverseSource, balances, entries };
