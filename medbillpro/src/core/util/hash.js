'use strict';

/**
 * Password hashing that behaves identically in Node and in a browser, so a
 * database created by the web build can be restored into the desktop build and
 * everyone can still sign in.
 *
 * PBKDF2-HMAC-SHA256. Node uses its native implementation; the browser uses the
 * pure-JS one below. Both produce the same bytes — `tests/hash.test.js` checks
 * that against Node's crypto.
 */

const ITERATIONS = 15000;
const KEY_BYTES = 32;

// ------------------------------------------------------------------ sha-256
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);

function sha256(bytes) {
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const length = bytes.length;
  const withPadding = new Uint8Array((((length + 8) >> 6) + 1) << 6);
  withPadding.set(bytes);
  withPadding[length] = 0x80;
  const bitLength = length * 8;
  const view = new DataView(withPadding.buffer);
  view.setUint32(withPadding.length - 4, bitLength >>> 0, false);
  view.setUint32(withPadding.length - 8, Math.floor(bitLength / 4294967296), false);

  const w = new Uint32Array(64);
  for (let offset = 0; offset < withPadding.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(offset + i * 4, false);
    for (let i = 16; i < 64; i += 1) {
      const s0 = ((w[i - 15] >>> 7) | (w[i - 15] << 25)) ^ ((w[i - 15] >>> 18) | (w[i - 15] << 14)) ^ (w[i - 15] >>> 3);
      const s1 = ((w[i - 2] >>> 17) | (w[i - 2] << 15)) ^ ((w[i - 2] >>> 19) | (w[i - 2] << 13)) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i += 1) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const temp1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e;
      e = (d + temp1) >>> 0;
      d = c; c = b; b = a;
      a = (temp1 + temp2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
  }
  const out = new Uint8Array(32);
  new DataView(out.buffer).setUint32(0, h[0], false);
  for (let i = 0; i < 8; i += 1) new DataView(out.buffer).setUint32(i * 4, h[i], false);
  return out;
}

function hmacSha256(key, message) {
  let blockKey = key;
  if (blockKey.length > 64) blockKey = sha256(blockKey);
  const padded = new Uint8Array(64);
  padded.set(blockKey);
  const inner = new Uint8Array(64 + message.length);
  const outer = new Uint8Array(64 + 32);
  for (let i = 0; i < 64; i += 1) {
    inner[i] = padded[i] ^ 0x36;
    outer[i] = padded[i] ^ 0x5c;
  }
  inner.set(message, 64);
  outer.set(sha256(inner), 64);
  return sha256(outer);
}

function pbkdf2Js(password, salt, iterations, keyBytes) {
  const blocks = Math.ceil(keyBytes / 32);
  const out = new Uint8Array(blocks * 32);
  const saltBlock = new Uint8Array(salt.length + 4);
  saltBlock.set(salt);
  for (let block = 1; block <= blocks; block += 1) {
    new DataView(saltBlock.buffer).setUint32(salt.length, block, false);
    let u = hmacSha256(password, saltBlock);
    const acc = u.slice();
    for (let i = 1; i < iterations; i += 1) {
      u = hmacSha256(password, u);
      for (let j = 0; j < 32; j += 1) acc[j] ^= u[j];
    }
    out.set(acc, (block - 1) * 32);
  }
  return out.slice(0, keyBytes);
}

// --------------------------------------------------------------- platform
const nodeCrypto = (() => {
  try {
    // eslint-disable-next-line global-require
    return typeof process !== 'undefined' && process.versions && process.versions.node ? require('crypto') : null;
  } catch { return null; }
})();

function utf8(text) {
  return new TextEncoder().encode(String(text));
}

function toHex(bytes) {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

function fromHex(hex) {
  const clean = String(hex);
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

function randomHex(byteLength = 16) {
  const bytes = new Uint8Array(byteLength);
  const source = (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.getRandomValues)
    ? globalThis.crypto
    : null;
  if (source) source.getRandomValues(bytes);
  else if (nodeCrypto) bytes.set(nodeCrypto.randomBytes(byteLength));
  else for (let i = 0; i < byteLength; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  return toHex(bytes);
}

/** Derives the password key. Same bytes in Node and in the browser. */
function derive(password, saltHex, iterations = ITERATIONS, keyBytes = KEY_BYTES) {
  const salt = fromHex(saltHex);
  if (nodeCrypto) {
    return new Uint8Array(nodeCrypto.pbkdf2Sync(Buffer.from(utf8(password)), Buffer.from(salt), iterations, keyBytes, 'sha256'));
  }
  return pbkdf2Js(utf8(password), salt, iterations, keyBytes);
}

function hashPassword(password, salt = randomHex(16)) {
  return { hash: toHex(derive(password, salt)), salt };
}

/** Constant-time comparison of two hex digests. */
function verifyPassword(password, hash, salt) {
  const candidate = toHex(derive(password, salt));
  const expected = String(hash ?? '');
  if (candidate.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < candidate.length; i += 1) diff |= candidate.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

module.exports = { sha256, hmacSha256, pbkdf2Js, derive, hashPassword, verifyPassword, randomHex, toHex, fromHex, ITERATIONS, KEY_BYTES };
