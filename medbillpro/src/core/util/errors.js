'use strict';

/** Errors carrying `expected: true` are shown to the user verbatim. */
class AppError extends Error {
  constructor(message, code = 'APP_ERROR', details = null) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
    this.expected = true;
  }
}

function fail(message, code, details) {
  throw new AppError(message, code, details);
}

function assert(cond, message, code = 'VALIDATION', details) {
  if (!cond) fail(message, code, details);
}

module.exports = { AppError, fail, assert };
