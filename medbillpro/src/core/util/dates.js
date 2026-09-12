'use strict';

/** All dates are stored as ISO 'YYYY-MM-DD' strings so SQLite sorts them correctly. */
function today(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function nowStamp(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${today(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function isIsoDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
}

/** Expiry is stored as 'YYYY-MM' (batches expire at month end). */
function isExpiryMonth(s) {
  return typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
}

/** Last calendar day of an expiry month, as an ISO date. */
function expiryEndDate(expiry) {
  if (!isExpiryMonth(expiry)) return null;
  const [y, m] = expiry.split('-').map(Number);
  const last = new Date(y, m, 0);
  return today(last);
}

function isExpired(expiry, ref = today()) {
  const end = expiryEndDate(expiry);
  return end ? end < ref : false;
}

function addDays(iso, days) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return today(d);
}

function addMonths(iso, months) {
  const d = new Date(`${iso}T00:00:00`);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
  return today(d);
}

function monthStart(iso = today()) { return `${iso.slice(0, 7)}-01`; }

function monthEnd(iso = today()) {
  const [y, m] = iso.split('-').map(Number);
  return today(new Date(y, m, 0));
}

/** Indian financial year (April–March) containing the given date. */
function financialYear(iso = today()) {
  const [y, m] = iso.split('-').map(Number);
  const start = m >= 4 ? y : y - 1;
  return { from: `${start}-04-01`, to: `${start + 1}-03-31`, label: `${start}-${String(start + 1).slice(2)}` };
}

function formatDate(iso) {
  if (!iso) return '';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return d ? `${d}/${m}/${y}` : `${m}/${y}`;
}

function formatExpiry(exp) {
  if (!exp) return '';
  const [y, m] = String(exp).split('-');
  return `${m}/${String(y).slice(2)}`;
}

/** Inclusive list of ISO dates between two dates (capped, used by charts). */
function dateRange(from, to, cap = 400) {
  const out = [];
  let cur = from;
  while (cur <= to && out.length < cap) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

module.exports = {
  today, nowStamp, isIsoDate, isExpiryMonth, expiryEndDate, isExpired,
  addDays, addMonths, monthStart, monthEnd, financialYear, formatDate, formatExpiry, dateRange
};
