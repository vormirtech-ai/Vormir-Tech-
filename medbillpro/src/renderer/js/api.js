import { toast } from './ui.js';

const bridge = window.medv;

/**
 * Calls into the main process. Expected errors (validation, permissions) are
 * shown as a toast and re-thrown so callers can stop; unexpected ones are
 * logged too.
 */
export async function call(channel, payload = {}, { quiet = false } = {}) {
  if (!bridge) throw new Error('The application bridge is unavailable. Please restart MedV.');
  try {
    return await bridge.call(channel, payload);
  } catch (err) {
    if (!quiet) toast(err.message, { type: 'error', title: err.expected ? null : 'Unexpected error' });
    if (!err.expected) console.error(`[${channel}]`, err);
    throw err;
  }
}

/** Same as call() but resolves to `fallback` instead of throwing. */
export async function tryCall(channel, payload = {}, fallback = null, options = {}) {
  try {
    return await call(channel, payload, options);
  } catch {
    return fallback;
  }
}

export const state = () => bridge.state();
export const dialog = bridge.dialog;
export const printer = bridge.print;
export const shellApi = bridge.shell;
export const clipboard = bridge.clipboard;
export const onMenu = bridge.onMenu;
