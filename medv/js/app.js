import { el, mount, clear } from './dom.js';
import { icon } from './icons.js';
import * as fmt from './format.js';
import { call, state as appState, onMenu } from './api.js';
import { store, loadSettings, refreshBadges, setUser, applyTheme, onChange } from './store.js';
import { NAV, canSee } from './nav.js';
import * as router from './router.js';
import { toast, modal, confirm, formModal, card, emptyState } from './ui.js';

const root = document.getElementById('root');
let shell = null;
let contentNode = null;
let titleNode = null;
let subtitleNode = null;

const ROUTES = [
  ['#/dashboard', () => import('./views/dashboard.js'), 'Dashboard', 'Live picture of your store'],
  ['#/billing', () => import('./views/billing.js'), 'New Bill', 'Counter sale — press F2 any time'],
  ['#/sales', () => import('./views/sales.js'), 'Bills', 'Every invoice you have raised'],
  ['#/sales/:id', () => import('./views/sales.js'), 'Bill', 'Invoice detail'],
  ['#/returns', () => import('./views/returns.js'), 'Returns', 'Sales and purchase returns'],
  ['#/products', () => import('./views/products.js'), 'Medicines', 'Your medicine master'],
  ['#/stock', () => import('./views/stock.js'), 'Stock & Expiry', 'Batch-wise stock, expiry and valuation'],
  ['#/purchases', () => import('./views/purchases.js'), 'Purchases', 'Supplier bills and stock inward'],
  ['#/purchases/new', () => import('./views/purchaseEntry.js'), 'Purchase Entry', 'Type it or import the bill'],
  ['#/customers', () => import('./views/customers.js'), 'Patients', 'Customer ledger and history'],
  ['#/doctors', () => import('./views/doctors.js'), 'Doctors', 'Referrals and commission'],
  ['#/suppliers', () => import('./views/suppliers.js'), 'Suppliers', 'Distributors and payables'],
  ['#/money', () => import('./views/money.js'), 'Cash & Bank', 'Receipts, payments and expenses'],
  ['#/reminders', () => import('./views/reminders.js'), 'Refill Reminders', 'Bring repeat patients back'],
  ['#/reports', () => import('./views/reports.js'), 'Reports', 'Sales, stock, profit and daybook'],
  ['#/gst', () => import('./views/gst.js'), 'GST', 'GSTR-1, GSTR-2, GSTR-3B and reconciliation'],
  ['#/backup', () => import('./views/backup.js'), 'Backup & Restore', 'Your data lives on this computer'],
  ['#/settings', () => import('./views/settings.js'), 'Settings', 'Shop profile, users and data']
];

for (const [pattern, loader, title, subtitle] of ROUTES) {
  router.register(pattern, loader, { title, subtitle });
}

// ------------------------------------------------------------------- shell
function navItem(item) {
  const count = item.badge ? store.badges[item.badge] : 0;
  const active = window.location.hash.startsWith(item.hash)
    && (item.hash !== '#/dashboard' || window.location.hash === '#/dashboard' || window.location.hash === '');
  return el(`button.nav-item${active ? '.active' : ''}`, {
    onclick: () => router.navigate(item.hash),
    title: item.key ? `${item.label} (${item.key})` : item.label,
    dataset: { hash: item.hash }
  },
    icon(item.icon),
    el('span.label', item.label),
    count ? el('span.badge.solid-danger', count > 99 ? '99+' : String(count)) : null);
}

function buildSidebar() {
  const nav = el('nav.sidebar-nav');
  for (const group of NAV) {
    const items = group.items.filter((item) => canSee(item.hash, store.user?.role));
    if (!items.length) continue;
    nav.appendChild(el('div.nav-group', group.group));
    for (const item of items) nav.appendChild(navItem(item));
  }
  return el('aside.sidebar',
    el('div.sidebar-head',
      el('img.logo', { src: 'assets/logo.png', alt: 'MedV' }),
      el('img.mark', { src: 'assets/mark.png', alt: 'MedV' })),
    nav,
    el('div.sidebar-foot',
      el('div.offline', el('span.dot'), el('span', 'Offline ready — data on this PC')),
      el('div', { style: { marginTop: '4px', fontSize: '10.5px' } }, `v${store.state?.version || '1.0.0'}`)));
}

function userMenu(anchor) {
  const handle = modal({
    title: store.user.name,
    size: 'narrow',
    body: el('div',
      el('dl.kv',
        el('dt', 'Username'), el('dd', store.user.username),
        el('dt', 'Role'), el('dd', { style: { textTransform: 'capitalize' } }, store.user.role),
        el('dt', 'Store'), el('dd', store.settings.store_name || '—'),
        el('dt', 'Data folder'), el('dd.mono.fs-12', store.state?.paths?.root || '—')),
      el('div.row.mt-16',
        el('button.btn.sm', {
          onclick: async () => {
            handle.close();
            const values = await formModal({
              title: 'Change password',
              columns: 1,
              submitLabel: 'Update password',
              fields: [
                { name: 'currentPassword', label: 'Current password', type: 'password', required: true, autofocus: true },
                { name: 'newPassword', label: 'New password', type: 'password', required: true },
                { name: 'confirmPassword', label: 'Repeat new password', type: 'password', required: true }
              ],
              onSubmit: async (v, f) => {
                if (v.newPassword !== v.confirmPassword) {
                  f.showError('confirmPassword', 'The two passwords do not match.');
                  return false;
                }
                await call('auth.changePassword', v);
                return true;
              }
            });
            if (values) toast('Password updated.', { type: 'ok' });
          }
        }, icon('key'), 'Change password'),
        el('div.spacer'),
        el('button.btn.sm.danger', { onclick: () => { handle.close(); logout(); } }, icon('logout'), 'Sign out'))),
    onClose: () => {}
  });
  void anchor;
}

function buildTopbar() {
  titleNode = el('div.title', 'Dashboard');
  subtitleNode = el('div.subtitle', '');
  const themeBtn = el('button.icon-btn', {
    title: 'Switch light / dark theme',
    onclick: async () => {
      const next = store.settings.theme === 'dark' ? 'light' : 'dark';
      store.settings.theme = next;
      applyTheme(next);
      clear(themeBtn).appendChild(icon(next === 'dark' ? 'sun' : 'moon'));
      try { await call('settings.save', { theme: next }, { quiet: true }); } catch { /* keep the local switch */ }
    }
  }, icon(store.settings.theme === 'dark' ? 'sun' : 'moon'));

  return el('header.topbar',
    el('button.icon-btn', {
      title: 'Collapse menu',
      onclick: () => shell.classList.toggle('collapsed')
    }, icon('menu')),
    el('div', titleNode, subtitleNode),
    el('div.spacer'),
    el('div.row.tight',
      el('span.badge.ok', { title: 'Every feature works without internet' }, icon('shield'), 'Offline'),
      el('span.badge', { title: 'Today' }, icon('calendar'), fmt.dateLong(fmt.today()))),
    el('button.icon-btn', { title: 'Keyboard shortcuts (F1)', onclick: showShortcuts }, icon('info')),
    themeBtn,
    el('div.user-chip', { onclick: (e) => userMenu(e.currentTarget) },
      el('div.avatar', fmt.initials(store.user?.name)),
      el('div.meta', el('b', store.user?.name || '—'), el('small', store.user?.role || ''))));
}

function renderShell() {
  shell = el('div.shell', buildSidebar(), el('main.main', buildTopbar(), el('div.content')));
  contentNode = shell.querySelector('.content');
  mount(root, shell);
}

function refreshSidebar() {
  if (!shell) return;
  const old = shell.querySelector('.sidebar');
  const next = buildSidebar();
  shell.replaceChild(next, old);
}

function setHeader(title, subtitle) {
  if (titleNode) titleNode.textContent = title;
  if (subtitleNode) subtitleNode.textContent = subtitle || '';
  document.title = `${title} — MedV`;
}

// ------------------------------------------------------------------ routing
let renderToken = 0;

async function renderRoute(ctx) {
  if (!store.user) return;
  const token = ++renderToken;
  if (ctx.notFound) {
    setHeader('Not found', ctx.hash);
    mount(contentNode, card({ body: emptyState({ title: 'That screen does not exist', message: ctx.hash, iconName: 'alert' }) }));
    return;
  }
  if (!canSee(ctx.route.pattern, store.user.role)) {
    setHeader('Not available', 'Your role does not include this screen');
    mount(contentNode, card({
      body: emptyState({
        title: 'You do not have access to this screen',
        message: `Signed in as ${store.user.role}. Ask an administrator if you need access.`,
        iconName: 'shield'
      })
    }));
    return;
  }
  setHeader(ctx.route.meta.title, ctx.route.meta.subtitle);
  contentNode.classList.toggle('flush', ctx.route.pattern === '#/billing');
  mount(contentNode, el('div', { style: { padding: ctx.route.pattern === '#/billing' ? '20px' : '0' } },
    el('div.skeleton', { style: { width: '38%', height: '18px', marginBottom: '14px' } }),
    el('div.skeleton', { style: { width: '100%', height: '120px' } })));
  try {
    const module = await ctx.route.view();
    if (token !== renderToken) return;
    const node = await module.render({ ...ctx, reload: () => router.reload() });
    if (token !== renderToken) return;
    mount(contentNode, node);
    contentNode.scrollTop = 0;
    refreshSidebar();
  } catch (err) {
    console.error(err);
    if (token !== renderToken) return;
    mount(contentNode, card({
      title: 'This screen could not be opened',
      body: el('div',
        el('p', err?.message || 'Unknown error'),
        el('button.btn.primary', { onclick: () => router.reload() }, icon('refresh'), 'Try again'))
    }));
  }
}

// ------------------------------------------------------------------ session
async function logout() {
  await call('auth.logout', {}, { quiet: true });
  setUser(null);
  await showLogin();
}

async function showLogin() {
  const module = await import('./views/login.js');
  mount(root, await module.render({
    onSignedIn: async (user) => {
      setUser(user);
      await loadSettings();
      await refreshBadges();
      renderShell();
      router.start(renderRoute);
      if (!window.location.hash || window.location.hash === '#/') router.navigate('#/dashboard', { replace: true });
      else router.reload();
    }
  }));
}

async function showSetup() {
  const module = await import('./views/setup.js');
  mount(root, await module.render({
    onDone: async () => {
      await loadSettings();
      await showLogin();
    }
  }));
}

function showBootError(error) {
  mount(root, el('div.auth',
    el('div.auth-form', el('div.auth-card',
      el('img.logo-sm', { src: 'assets/logo.png', alt: 'MedV' }),
      card({
        title: 'MedV could not start',
        body: el('div',
          el('div.note.danger', icon('alert'), el('div', error.message)),
          el('p.mt-16.fs-13.muted', 'The database lives in your application data folder. '
            + 'If another copy of MedV is running, close it and start again. You can also restore a backup.'),
          el('div.mono.fs-12', store.state?.paths?.db || '')),
        footer: el('button.btn.primary', { onclick: () => window.location.reload() }, icon('refresh'), 'Retry')
      })))));
}

// --------------------------------------------------------------- shortcuts
function showShortcuts() {
  const rows = [
    ['F1', 'Show this list'],
    ['F2', 'New bill'],
    ['F4', 'New purchase'],
    ['Ctrl + 1…8', 'Jump to Dashboard, Billing, Medicines, Purchases, Patients, Reports, GST, Settings'],
    ['Ctrl + B', 'Backup screen'],
    ['Ctrl + P', 'Print the open document'],
    ['Esc', 'Close a dialog'],
    ['In billing — Enter', 'Add the highlighted medicine to the bill'],
    ['In billing — ↑ / ↓', 'Move through search results'],
    ['In billing — Ctrl + Enter', 'Save and print the bill'],
    ['In billing — Ctrl + Del', 'Clear the bill']
  ];
  modal({
    title: 'Keyboard shortcuts',
    body: el('dl.kv', ...rows.flatMap(([k, v]) => [el('dt', el('kbd', k)), el('dd', v)]))
  });
}

function bindGlobalKeys() {
  document.addEventListener('keydown', (event) => {
    if (!store.user) return;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName);
    if (event.key === 'F1') { event.preventDefault(); showShortcuts(); return; }
    if (event.key === 'F2') { event.preventDefault(); router.navigate('#/billing'); return; }
    if (event.key === 'F4') { event.preventDefault(); router.navigate('#/purchases/new'); return; }
    if (event.ctrlKey && !event.shiftKey && !typing && /^[1-8]$/.test(event.key)) {
      const map = ['#/dashboard', '#/billing', '#/products', '#/purchases', '#/customers', '#/reports', '#/gst', '#/settings'];
      event.preventDefault();
      router.navigate(map[Number(event.key) - 1]);
    }
  });

  onMenu(({ channel, payload }) => {
    if (channel === 'navigate') router.navigate(payload);
    else if (channel === 'print') window.print();
    else if (channel === 'shortcuts') showShortcuts();
  });
}

// ------------------------------------------------------------------- boot
async function boot() {
  try {
    store.state = await appState();
    if (store.state.bootError) {
      showBootError(store.state.bootError);
      return;
    }
    store.info = await call('app.info', {}, { quiet: true });
    await loadSettings();
    bindGlobalKeys();
    onChange(() => { /* badges refresh redraws the sidebar on demand */ });
    if (!store.info.setup.complete) await showSetup();
    else await showLogin();
  } catch (err) {
    console.error(err);
    showBootError({ message: err?.message || 'Unknown start-up error.' });
  }
}

window.addEventListener('unhandledrejection', (event) => {
  if (event.reason?.expected) event.preventDefault();
});

boot();

export { router, logout, showShortcuts, refreshSidebar, setHeader };
