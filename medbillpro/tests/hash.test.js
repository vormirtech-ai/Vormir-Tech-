'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const hash = require('../src/core/util/hash');

const utf8 = (s) => new TextEncoder().encode(s);

test('the pure-JS SHA-256 matches Node for every shape of input', () => {
  for (const input of ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'The quick brown fox', '₹ मेडिकल स्टोर']) {
    assert.equal(
      hash.toHex(hash.sha256(utf8(input))),
      crypto.createHash('sha256').update(input, 'utf8').digest('hex'),
      `sha256 mismatch for ${JSON.stringify(input.slice(0, 24))}`
    );
  }
});

test('the pure-JS HMAC-SHA256 matches Node', () => {
  for (const [key, message] of [['key', 'message'], ['', ''], ['k'.repeat(80), 'long key case']]) {
    assert.equal(
      hash.toHex(hash.hmacSha256(utf8(key), utf8(message))),
      crypto.createHmac('sha256', key).update(message).digest('hex')
    );
  }
});

test('the pure-JS PBKDF2 matches Node, so web and desktop share one database', () => {
  const salt = Buffer.from('a1b2c3d4e5f60718293a4b5c6d7e8f90', 'hex');
  for (const iterations of [1, 10, 2000]) {
    assert.equal(
      hash.toHex(hash.pbkdf2Js(utf8('shop@2026'), new Uint8Array(salt), iterations, 32)),
      crypto.pbkdf2Sync('shop@2026', salt, iterations, 32, 'sha256').toString('hex'),
      `pbkdf2 mismatch at ${iterations} iterations`
    );
  }
});

test('hashPassword / verifyPassword round-trip', () => {
  const { hash: digest, salt } = hash.hashPassword('shop@2026');
  assert.equal(digest.length, 64);
  assert.equal(salt.length, 32);
  assert.equal(hash.verifyPassword('shop@2026', digest, salt), true);
  assert.equal(hash.verifyPassword('shop@2025', digest, salt), false);
  assert.equal(hash.verifyPassword('', digest, salt), false);
  // Two hashes of the same password differ, because the salt is random.
  assert.notEqual(hash.hashPassword('same').hash, hash.hashPassword('same').hash);
});

test('randomHex returns the requested number of bytes', () => {
  assert.equal(hash.randomHex(16).length, 32);
  assert.notEqual(hash.randomHex(16), hash.randomHex(16));
});
