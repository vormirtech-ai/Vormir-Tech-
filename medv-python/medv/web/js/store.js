import { call } from './api.js';
import * as fmt from './format.js';

/** Shared application state: who is signed in, shop settings, alert counts. */
export const store = {
  user: null,
  settings: {},
  info: null,
  state: null,
  badges: { stockAlerts: 0, pendingRx: 0 },
  listeners: new Set()
};

export function onChange(fn) {
  store.listeners.add(fn);
  return () => store.listeners.delete(fn);
}

function emit() {
  for (const fn of store.listeners) {
    try { fn(store); } catch (err) { console.error(err); }
  }
}

export async function loadSettings() {
  store.settings = await call('settings.all');
  fmt.state.currency = store.settings.currency_symbol || '₹';
  applyTheme(store.settings.theme);
  emit();
  return store.settings;
}

export function applyTheme(theme) {
  const value = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', value);
}

export async function refreshBadges() {
  try {
    const [low, expiry, reminders] = await Promise.all([
      call('stock.low', {}, { quiet: true }),
      call('stock.expiry', { withinDays: Number(store.settings.expiry_alert_days) || 90 }, { quiet: true }),
      call('reminders.list', { status: 'pending', to: fmt.today() }, { quiet: true })
    ]);
    store.badges = {
      stockAlerts: (low?.length || 0) + (expiry?.length || 0),
      pendingRx: reminders?.length || 0
    };
  } catch {
    store.badges = { stockAlerts: 0, pendingRx: 0 };
  }
  emit();
  return store.badges;
}

export function setUser(user) {
  store.user = user;
  emit();
}

export function is(...roles) {
  return Boolean(store.user && roles.includes(store.user.role));
}

export function requireRole(...roles) {
  return is(...roles);
}
