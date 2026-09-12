'use strict';

const zlib = require('zlib');

/**
 * A minimal, dependency-free reader for the two file formats a distributor
 * bill ever arrives in: .xlsx (a ZIP of XML parts) and .csv.
 * Only what is needed to read the first worksheet as a grid of strings.
 */

function readZipEntries(buffer) {
  const entries = new Map();
  // Walk the central directory from the end-of-central-directory record.
  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0 && i > buffer.length - 66000; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('That file is not a valid .xlsx workbook.');
  const count = buffer.readUInt16LE(eocd + 10);
  let ptr = buffer.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n += 1) {
    if (buffer.readUInt32LE(ptr) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(ptr + 10);
    const compSize = buffer.readUInt32LE(ptr + 20);
    const nameLen = buffer.readUInt16LE(ptr + 28);
    const extraLen = buffer.readUInt16LE(ptr + 30);
    const commentLen = buffer.readUInt16LE(ptr + 32);
    const localOffset = buffer.readUInt32LE(ptr + 42);
    const name = buffer.toString('utf8', ptr + 46, ptr + 46 + nameLen);
    const localNameLen = buffer.readUInt16LE(localOffset + 26);
    const localExtraLen = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const raw = buffer.subarray(dataStart, dataStart + compSize);
    entries.set(name, method === 0 ? raw : zlib.inflateRawSync(raw));
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
function readWorkbook(buffer) {
  const entries = readZipEntries(buffer);
  const shared = parseSharedStrings(entries.get('xl/sharedStrings.xml')?.toString('utf8'));
  const sheetName = [...entries.keys()]
    .filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k))
    .sort()[0];
  if (!sheetName) throw new Error('No worksheet was found inside that workbook.');
  return parseSheet(entries.get(sheetName).toString('utf8'), shared);
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

function readAny(buffer, filename = '') {
  const isXlsx = /\.xlsx$/i.test(filename)
    || (buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4b);
  return isXlsx ? readWorkbook(buffer) : readDelimited(buffer.toString('utf8'));
}

module.exports = { readWorkbook, readDelimited, readAny, serialToIso };
