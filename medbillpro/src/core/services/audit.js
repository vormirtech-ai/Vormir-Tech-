'use strict';

const db = require('../db');
const { nowStamp } = require('../util/dates');

function log(user, action, entity, entityId, detail) {
  db.get().prepare(`INSERT INTO audit_log (at, user_id, username, action, entity, entity_id, detail)
                    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(nowStamp(), user?.id ?? null, user?.username ?? 'system', action, entity ?? null,
      entityId === undefined || entityId === null ? null : String(entityId),
      detail ? (typeof detail === 'string' ? detail : JSON.stringify(detail)) : null);
}

function list({ from, to, limit = 300 } = {}) {
  const where = [];
  const args = [];
  if (from) { where.push('at >= ?'); args.push(`${from} 00:00:00`); }
  if (to) { where.push('at <= ?'); args.push(`${to} 23:59:59`); }
  const sql = `SELECT * FROM audit_log ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
               ORDER BY id DESC LIMIT ?`;
  return db.get().prepare(sql).all(...args, Math.min(Number(limit) || 300, 2000));
}

module.exports = { log, list };
