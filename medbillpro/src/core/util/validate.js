'use strict';

const { assert } = require('./errors');
const { isIsoDate, isExpiryMonth, today } = require('./dates');

function str(value, field, { required = false, max = 200, min = 0 } = {}) {
  const v = value === null || value === undefined ? '' : String(value).trim();
  assert(!(required && v.length === 0), `${field} is required.`);
  assert(v.length <= max, `${field} must be ${max} characters or fewer.`);
  assert(v.length === 0 || v.length >= min, `${field} must be at least ${min} characters.`);
  return v;
}

function number(value, field, { required = false, min = -1e12, max = 1e12, fallback = 0 } = {}) {
  if (value === '' || value === null || value === undefined) {
    assert(!required, `${field} is required.`);
    return fallback;
  }
  const v = Number(value);
  assert(Number.isFinite(v), `${field} must be a number.`);
  assert(v >= min, `${field} cannot be less than ${min}.`);
  assert(v <= max, `${field} cannot be more than ${max}.`);
  return v;
}

function integer(value, field, opts = {}) {
  const v = number(value, field, opts);
  assert(Number.isInteger(v), `${field} must be a whole number.`);
  return v;
}

function date(value, field, { required = true, fallback = null } = {}) {
  if (!value) {
    assert(!required, `${field} is required.`);
    return fallback === 'today' ? today() : fallback;
  }
  const v = String(value).slice(0, 10);
  assert(isIsoDate(v), `${field} must be a valid date.`);
  return v;
}

function expiry(value, field, { required = true } = {}) {
  if (!value) {
    assert(!required, `${field} is required.`);
    return null;
  }
  const v = String(value).trim();
  // Accept MM/YYYY and MM/YY as typed by users, normalise to YYYY-MM.
  const slash = v.match(/^(\d{1,2})\s*[/-]\s*(\d{2}|\d{4})$/);
  let norm = v;
  if (slash) {
    const mm = slash[1].padStart(2, '0');
    const yy = slash[2].length === 2 ? `20${slash[2]}` : slash[2];
    norm = `${yy}-${mm}`;
  }
  assert(isExpiryMonth(norm), `${field} must be a month like 06/2027.`);
  return norm;
}

function oneOf(value, field, allowed, fallback) {
  const v = value === null || value === undefined || value === '' ? fallback : String(value);
  assert(allowed.includes(v), `${field} must be one of: ${allowed.join(', ')}.`);
  return v;
}

function phone(value, field, { required = false } = {}) {
  const v = str(value, field, { required, max: 20 });
  if (v) assert(/^[0-9+\-\s()]{6,20}$/.test(v), `${field} must be a valid phone number.`);
  return v;
}

function gstin(value, field = 'GSTIN') {
  const v = str(value, field, { max: 15 }).toUpperCase();
  if (v) assert(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[A-Z0-9]{1}[Z]{1}[A-Z0-9]{1}$/.test(v),
    `${field} must be a valid 15-character GST number.`);
  return v;
}

function bool(value) {
  return value === true || value === 1 || value === '1' || value === 'true' ? 1 : 0;
}

module.exports = { str, number, integer, date, expiry, oneOf, phone, gstin, bool };
