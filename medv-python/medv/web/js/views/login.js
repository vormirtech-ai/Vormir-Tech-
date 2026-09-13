import { el } from '../dom.js';
import { icon } from '../icons.js';
import { call } from '../api.js';
import { store } from '../store.js';
import { card, form, toast } from '../ui.js';

const FEATURES = [
  ['package', 'Batch, expiry and loose-tablet stock, tracked to the strip'],
  ['billing', 'Counter billing in seconds, with GST split on every line'],
  ['gst', 'GSTR-1, GSTR-2 and 3B ready whenever your accountant asks'],
  ['shield', 'Works with the internet unplugged — data never leaves this PC']
];

export async function render({ onSignedIn }) {
  const f = form([
    { name: 'username', label: 'Username', required: true, autofocus: true, placeholder: 'admin', span: 'full' },
    { name: 'password', label: 'Password', type: 'password', required: true, span: 'full' }
  ], { username: 'admin' }, { columns: 1, onSubmit: () => signIn() });

  const button = el('button.btn.primary.lg.block', { onclick: () => signIn() }, icon('logout'), 'Sign in');
  const hint = el('div.fs-12.muted.mt-16', { style: { textAlign: 'center' } },
    'Data folder: ', el('span.mono', store.state?.paths?.root || ''));

  async function signIn() {
    if (!f.validate()) return;
    button.disabled = true;
    try {
      const result = await call('auth.login', f.values());
      store.settings = result.settings;
      toast(`Welcome back, ${result.user.name.split(' ')[0]}.`, { type: 'ok', timeout: 2600 });
      await onSignedIn(result.user);
    } catch {
      f.set('password', '');
      f.focus('password');
      button.disabled = false;
    }
  }

  return el('div.auth',
    el('div.auth-art',
      el('div.brand', el('img', { src: 'assets/logo.png', alt: 'MedV' })),
      el('div',
        el('h1', 'Your medical store,', el('br'), 'completely under control.'),
        el('p.lead', `${store.settings.store_name || 'MedV'} runs entirely on this computer — billing, inventory, GST and reports, with or without an internet connection.`),
        el('ul.auth-features', ...FEATURES.map(([ico, text]) => el('li', icon(ico), el('span', text))))),
      el('div.foot', 'MedV by Vormir Tech Solutions · 100% local SQLite storage')),
    el('div.auth-form',
      el('div.auth-card',
        el('img.logo-sm', { src: 'assets/logo.png', alt: 'MedV' }),
        card({
          title: 'Sign in',
          subtitle: store.settings.store_name || '',
          body: el('div', f.node, el('div.mt-16', button))
        }),
        hint)));
}
