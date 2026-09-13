'use strict';

const nodeZlib = (() => {
  try {
    return typeof process !== 'undefined' && process.versions && process.versions.node ? require('zlib') : null;
  } catch { return null; }
})();

/**
 * Raw DEFLATE, whichever platform we are on: Node's zlib on the desktop,
 * the browser's DecompressionStream in the web build.
 */
async function inflateRaw(bytes) {
  if (nodeZlib) return nodeZlib.inflateRawSync(bytes);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * A minimal, dependency-free reader for the two file formats a distributor
 * bill ever arrives in: .xlsx (a ZIP of XML parts) and .csv.
 * Only what is needed to read the first worksheet as a grid of strings.
 */

async function readZipEntries(input) {
  const bytes = toBytes(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u32 = (offset) => view.getUint32(offset, true);
  const u16 = (offset) => view.getUint16(offset, true);
  const entries = new Map();

  // Walk the central directory from the end-of-central-directory record.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0 && i > bytes.length - 66000; i -= 1) {
    if (u32(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('That file is not a valid .xlsx workbook.');
  const count = u16(eocd + 10);
  let ptr = u32(eocd + 16);
  for (let n = 0; n < count; n += 1) {
    if (ptr + 46 > bytes.length || u32(ptr) !== 0x02014b50) break;
    const method = u16(ptr + 10);
    const compSize = u32(ptr + 20);
    const nameLen = u16(ptr + 28);
    const extraLen = u16(ptr + 30);
    const commentLen = u16(ptr + 32);
    const localOffset = u32(ptr + 42);
    const name = decodeUtf8(bytes.subarray(ptr + 46, ptr + 46 + nameLen));
    const localNameLen = u16(localOffset + 26);
    const localExtraLen = u16(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const raw = bytes.subarray(dataStart, dataStart + compSize);
    entries.set(name, method === 0 ? raw : await inflateRaw(raw));
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function decodeXmlText(s) {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');
}

function parseSharedStrings(xml) {
  if (!xml) return [];
  const out = [];
  const re = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = re.exec(xml))) out.push(decodeXmlText(m[1]));
  return out;
}

function colToIndex(ref) {
  const letters = ref.replace(/\d+/g, '');
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Excel serial date -> ISO date (1900 epoch, with the Lotus leap-year quirk). */
function serialToIso(serial) {
  const n = Number(serial);
  if (!Number.isFinite(n) || n < 1 || n > 90000) return null;
  const ms = Math.round((n - 25569) * 86400 * 1000);
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function parseSheet(xml, shared) {
  const rows = [];
  const rowRe = /<row\b[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g;
  let rowMatch;
  while ((rowMatch = rowRe.exec(xml))) {
    const cells = [];
    const cellRe = /<c\b([^>]*)\/>|<c\b([^>]*)>([\s\S]*?)<\/c>/g;
    let cellMatch;
    while ((cellMatch = cellRe.exec(rowMatch[2]))) {
      const attrs = cellMatch[1] || cellMatch[2] || '';
      const body = cellMatch[3] || '';
      const refMatch = attrs.match(/r="([A-Z]+\d+)"/);
      const typeMatch = attrs.match(/t="([^"]+)"/);
      const index = refMatch ? colToIndex(refMatch[1]) : cells.length;
      const type = typeMatch ? typeMatch[1] : 'n';
      let value = '';
      if (type === 's') {
        const v = body.match(/<v>([\s\S]*?)<\/v>/);
        value = v ? (shared[Number(v[1])] ?? '') : '';
      } else if (type === 'inlineStr') {
        value = decodeXmlText(body);
      } else {
        const v = body.match(/<v>([\s\S]*?)<\/v>/);
        value = v ? decodeXmlText(v[1]) : '';
      }
      cells[index] = String(value).trim();
    }
    for (let i = 0; i < cells.length; i += 1) if (cells[i] === undefined) cells[i] = '';
    rows.push(cells);
  }
  return rows;
}

/** Reads the first worksheet of an .xlsx buffer into an array of string rows. */
async function readWorkbook(buffer) {
  const entries = await readZipEntries(buffer);
  const shared = parseSharedStrings(decodeUtf8(entries.get('xl/sharedStrings.xml')));
  const sheetName = [...entries.keys()]
    .filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k))
    .sort()[0];
  if (!sheetName) throw new Error('No worksheet was found inside that workbook.');
  return parseSheet(decodeUtf8(entries.get(sheetName)), shared);
}

/** Accepts a Buffer, a Uint8Array or an ArrayBuffer and returns bytes. */
function toBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (Array.isArray(input)) return Uint8Array.from(input);
  return new Uint8Array(input);
}

/** Decodes a base64 string to bytes in Node and in the browser alike. */
function bytesFromBase64(base64) {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(String(base64), 'base64'));
  const binary = atob(String(base64));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

function bytesFromText(text) {
  return new TextEncoder().encode(String(text));
}

function decodeUtf8(bytes) {
  if (!bytes) return '';
  return typeof Buffer !== 'undefined' && Buffer.isBuffer(bytes)
    ? bytes.toString('utf8')
    : new TextDecoder('utf-8').decode(bytes);
}

/** RFC4180-ish CSV/TSV reader that copes with quotes and embedded newlines. */
function readDelimited(text, delimiter = null) {
  const source = text.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const sep = delimiter || (() => {
    const head = source.split('\n')[0] || '';
    const counts = [[',', (head.match(/,/g) || []).length], [';', (head.match(/;/g) || []).length], ['\t', (head.match(/\t/g) || []).length]];
    counts.sort((a, b) => b[1] - a[1]);
    return counts[0][1] > 0 ? counts[0][0] : ',';
  })();
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') { field += '"'; i += 1; } else quoted = false;
      } else field += ch;
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === sep) {
      row.push(field.trim());
      field = '';
    } else if (ch === '\n') {
      row.push(field.trim());
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  row.push(field.trim());
  if (row.some((c) => c !== '')) rows.push(row);
  return rows;
}

async function readAny(input, filename = '') {
  const bytes = toBytes(input);
  const isXlsx = /\.xlsx$/i.test(filename)
    || (bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b);
  return isXlsx ? readWorkbook(bytes) : readDelimited(decodeUtf8(bytes));
}

module.exports = { readWorkbook, readDelimited, readAny, serialToIso, inflateRaw, decodeUtf8, toBytes, bytesFromBase64, bytesFromText };
