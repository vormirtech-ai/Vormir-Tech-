'use strict';

const crypto = require('crypto');
const db = require('../db');
const audit = require('./audit');
const { assert, fail } = require('../util/errors');
const v = require('../util/validate');
const { nowStamp } = require('../util/dates');

const ROLES = ['admin', 'pharmacist', 'cashier'];

/** scrypt keeps password hashing local — no native module, no network. */
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
  return { hash, salt };
}

function verifyPassword(password, hash, salt) {
  const candidate = Buffer.from(hashPassword(password, salt).hash, 'hex');
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

function publicUser(row) {
  if (!row) return null;
  return { id: row.id, username: row.username, name: row.name, role: row.role, active: !!row.active };
}

function login({ username, password }) {
  const uname = v.str(username, 'Username', { required: true, max: 40 }).toLowerCase();
  assert(String(password ?? '').length > 0, 'Password is required.');
  const row = db.get().prepare('SELECT * FROM users WHERE lower(username) = ?').get(uname);
  if (!row || !row.active || !verifyPassword(password, row.pass_hash, row.pass_salt)) {
    fail('Incorrect username or password.', 'AUTH_FAILED');
  }
  audit.log(row, 'login', 'user', row.id);
  return publicUser(row);
}

function list() {
  return db.get().prepare('SELECT * FROM users ORDER BY role, name').all().map(publicUser);
}

function create(actor, payload) {
  requireAdmin(actor);
  const username = v.str(payload.username, 'Username', { required: true, max: 40, min: 3 }).toLowerCase();
  assert(/^[a-z0-9._-]+$/.test(username), 'Username may use letters, numbers, dot, dash and underscore only.');
  const name = v.str(payload.name, 'Full name', { required: true, max: 80 });
  const role = v.oneOf(payload.role, 'Role', ROLES, 'cashier');
  const password = String(payload.password ?? '');
  assert(password.length >= 4, 'Password must be at least 4 characters.');
  const exists = db.get().prepare('SELECT id FROM users WHERE lower(username) = ?').get(username);
  assert(!exists, 'That username is already taken.');
  const { hash, salt } = hashPassword(password);
  const info = db.get().prepare(`INSERT INTO users (username, name, role, pass_hash, pass_salt, active, created_at)
                                 VALUES (?, ?, ?, ?, ?, 1, ?)`).run(username, name, role, hash, salt, nowStamp());
  audit.log(actor, 'user.create', 'user', info.lastInsertRowid, { username, role });
  return publicUser(db.get().prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid));
}

function update(actor, payload) {
  requireAdmin(actor);
  const id = v.integer(payload.id, 'User', { required: true, min: 1 });
  const row = db.get().prepare('SELECT * FROM users WHERE id = ?').get(id);
  assert(row, 'That user no longer exists.');
  const name = v.str(payload.name, 'Full name', { required: true, max: 80 });
  const role = v.oneOf(payload.role, 'Role', ROLES, row.role);
  const active = v.bool(payload.active);
  if (row.role === 'admin' && (role !== 'admin' || !active)) {
    const admins = db.get().prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1 AND id <> ?").get(id).n;
    assert(admins > 0, 'At least one active administrator must remain.');
  }
  db.get().prepare('UPDATE users SET name = ?, role = ?, active = ? WHERE id = ?').run(name, role, active, id);
  if (payload.password) {
    assert(String(payload.password).length >= 4, 'Password must be at least 4 characters.');
    const { hash, salt } = hashPassword(payload.password);
    db.get().prepare('UPDATE users SET pass_hash = ?, pass_salt = ? WHERE id = ?').run(hash, salt, id);
  }
  audit.log(actor, 'user.update', 'user', id, { name, role, active });
  return publicUser(db.get().prepare('SELECT * FROM users WHERE id = ?').get(id));
}

function changePassword(actor, { currentPassword, newPassword }) {
  assert(actor?.id, 'You must be signed in.');
  const row = db.get().prepare('SELECT * FROM users WHERE id = ?').get(actor.id);
  assert(row, 'That user no longer exists.');
  assert(verifyPassword(String(currentPassword ?? ''), row.pass_hash, row.pass_salt), 'Current password is incorrect.');
  assert(String(newPassword ?? '').length >= 4, 'New password must be at least 4 characters.');
  const { hash, salt } = hashPassword(newPassword);
  db.get().prepare('UPDATE users SET pass_hash = ?, pass_salt = ? WHERE id = ?').run(hash, salt, actor.id);
  audit.log(actor, 'user.password', 'user', actor.id);
  return { ok: true };
}

/** Used by the setup wizard to replace the default admin credentials. */
function setAdminPassword(password) {
  assert(String(password ?? '').length >= 4, 'Password must be at least 4 characters.');
  const row = db.get().prepare("SELECT * FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").get();
  assert(row, 'No administrator account exists.');
  const { hash, salt } = hashPassword(password);
  db.get().prepare('UPDATE users SET pass_hash = ?, pass_salt = ? WHERE id = ?').run(hash, salt, row.id);
  return publicUser(row);
}

function requireAdmin(actor) {
  assert(actor && actor.role === 'admin', 'Only an administrator can do that.', 'FORBIDDEN');
}

function requireRole(actor, roles) {
  assert(actor && roles.includes(actor.role), 'You do not have permission for that action.', 'FORBIDDEN');
}

function remove(actor, { id }) {
  requireAdmin(actor);
  const uid = v.integer(id, 'User', { required: true, min: 1 });
  assert(uid !== actor.id, 'You cannot delete the account you are signed in with.');
  const row = db.get().prepare('SELECT * FROM users WHERE id = ?').get(uid);
  assert(row, 'That user no longer exists.');
  if (row.role === 'admin') {
    const admins = db.get().prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1 AND id <> ?").get(uid).n;
    assert(admins > 0, 'At least one active administrator must remain.');
  }
  db.get().prepare('UPDATE users SET active = 0 WHERE id = ?').run(uid);
  audit.log(actor, 'user.deactivate', 'user', uid);
  return { ok: true };
}

module.exports = {
  ROLES, hashPassword, verifyPassword, login, list, create, update, remove,
  changePassword, setAdminPassword, requireAdmin, requireRole, publicUser
};
