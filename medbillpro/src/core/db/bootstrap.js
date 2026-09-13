'use strict';

const migrations = require('./migrations');
const { DEFAULT_SETTINGS } = require('./defaults');
const { nowStamp } = require('../util/dates');

/**
 * Migration and seeding, written against the small statement API that both
 * better-sqlite3 (desktop) and the sql.js adapter (web) provide — so a database
 * created by either build is byte-for-byte the same shape.
 */
function runMigrations(conn) {
  const current = conn.pragma('user_version', { simple: true }) || 0;
  const pending = migrations.filter((m) => m.version > current).sort((a, b) => a.version - b.version);
  for (const m of pending) {
    const apply = conn.transaction(() => {
      m.up(conn);
      conn.pragma(`user_version = ${m.version}`);
    });
    apply();
  }
  return { from: current, to: conn.pragma('user_version', { simple: true }), applied: pending.length };
}

function seedDefaults(conn) {
  const insert = conn.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  const seed = conn.transaction(() => {
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) insert.run(key, value);
    for (const name of ['invoice', 'purchase', 'sale_return', 'purchase_return']) {
      conn.prepare('INSERT OR IGNORE INTO counters (name, value) VALUES (?, 0)').run(name);
    }
    const users = conn.prepare('SELECT COUNT(*) AS n FROM users').get().n;
    if (users === 0) {
      // First launch: create the initial Admin account. The setup wizard makes
      // the operator replace this password before the app can be used.
      const { hashPassword } = require('../util/hash');
      const { hash, salt } = hashPassword('admin123');
      conn.prepare(`INSERT INTO users (username, name, role, pass_hash, pass_salt, active, created_at)
                    VALUES ('admin', 'Administrator', 'admin', ?, ?, 1, ?)`).run(hash, salt, nowStamp());
    }
  });
  seed();
}

module.exports = { runMigrations, seedDefaults };
