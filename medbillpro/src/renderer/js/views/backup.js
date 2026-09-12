import { el, mount } from '../dom.js';
import { icon } from '../icons.js';
import * as fmt from '../format.js';
import { call, dialog, shellApi } from '../api.js';
import { store, is } from '../store.js';
import { card, dataTable, emptyState, badge, stat, toast, confirm, modal } from '../ui.js';
import * as router from '../router.js';

export async function render() {
  const host = el('div');
  let status = await call('backup.status');

  async function reload() {
    status = await call('backup.status');
    draw();
  }

  async function backupTo() {
    const suggested = (await call('backup.suggestedName')).name;
    const target = await dialog.saveBackup(suggested);
    if (!target) return;
    const result = await call('backup.create', { targetPath: target });
    toast(`Backup saved (${(result.size / 1048576).toFixed(1)} MB).`, { type: 'ok', title: 'Backup complete' });
    const handle = modal({
      title: 'Backup complete',
      size: 'narrow',
      body: el('div',
        el('div.note.ok', icon('check'), el('div', 'Your data has been copied.')),
        el('div.mono.fs-12.mt-16', result.path)),
      footer: [
        el('button.btn', { onclick: () => { shellApi.showItem(result.path); handle.close(); } }, icon('folder'), 'Show in folder'),
        el('button.btn.primary', { onclick: () => handle.close() }, 'Done')
      ]
    });
    await reload();
  }

  async function quickBackup() {
    const result = await call('backup.create', {});
    toast(`Backup saved to the app folder (${(result.size / 1048576).toFixed(1)} MB).`, { type: 'ok' });
    await reload();
  }

  async function restoreFrom(path = null) {
    const source = path || await dialog.openBackup();
    if (!source) return;
    let info;
    try {
      info = await call('backup.inspect', { sourcePath: source });
    } catch { return; }

    const ok = await confirm({
      title: 'Restore this backup?',
      message: `“${info.storeName || 'MedV database'}” — ${info.counts.sales} bills, ${info.counts.products} medicines, `
        + `${info.counts.customers} patients. Last bill dated ${info.lastSale ? fmt.date(info.lastSale) : '—'}.`,
      detail: 'Everything currently in MedV will be replaced. A safety copy of your present data is taken automatically first, '
        + 'so this can be undone by restoring that copy.',
      confirmLabel: 'Replace my data',
      danger: true
    });
    if (!ok) return;

    try {
      const result = await call('backup.restore', { sourcePath: source, confirm: true });
      toast('Restore finished. Please sign in again.', { type: 'ok', title: 'Data restored' });
      const handle = modal({
        title: 'Restore complete',
        size: 'narrow',
        closeOnBackdrop: false,
        body: el('div',
          el('div.note.ok', icon('check'), el('div', 'The backup is now your live database.')),
          el('p.fs-13.mt-16', 'Your previous data was copied to:'),
          el('div.mono.fs-12', result.safetyCopy),
          el('p.fs-13.mt-16', 'MedV will reload so every screen shows the restored data.')),
        footer: el('button.btn.primary', { onclick: () => window.location.reload() }, icon('refresh'), 'Reload MedV')
      });
      void handle;
    } catch { /* message already shown */ }
  }

  async function clearData() {
    const ok = await confirm({
      title: 'Clear transactions?',
      message: 'All bills, purchases, returns, payments, expenses and cash entries are deleted. '
        + 'Medicines, patients, doctors and suppliers are kept, and every batch is set to zero stock.',
      detail: 'Use this only to clear trial data. Take a backup first — this cannot be undone.',
      confirmLabel: 'Clear transactions',
      danger: true
    });
    if (!ok) return;
    const second = await confirm({
      title: 'Are you absolutely sure?',
      message: 'This is the last confirmation. Type-free check: press Clear only if you have a backup.',
      confirmLabel: 'Clear now',
      danger: true
    });
    if (!second) return;
    await call('data.clear', { confirm: true, keepMasters: true });
    toast('Transaction data cleared.', { type: 'ok' });
    await reload();
  }

  function draw() {
    mount(host,
      el('div.grid.cols-3.mb-16',
        stat({
          label: 'Database size', value: `${(status.dbSize / 1048576).toFixed(2)} MB`,
          sub: 'Stored on this computer', iconName: 'save', accent: 'blue'
        }),
        stat({
          label: 'Last backup',
          value: status.lastBackupAt ? fmt.stamp(status.lastBackupAt) : 'Never',
          sub: status.overdue ? 'A fresh backup is recommended' : 'Up to date',
          iconName: 'backup',
          accent: status.overdue ? 'orange' : 'green'
        }),
        stat({ label: 'Backup files kept', value: String(status.count), sub: 'In the app data folder', iconName: 'folder', accent: 'purple' })),
      status.overdue
        ? el('div.note.warn.mb-16', icon('alert'), el('div',
          el('b', 'Take a backup today. '),
          'A copy on a pen drive or external disk protects you if this computer fails.'))
        : null,
      el('div.grid.cols-2.mb-16',
        card({
          title: 'Backup',
          body: el('div',
            el('p.fs-13.muted', 'A backup is a single .db file containing every bill, medicine and patient. '
              + 'Copy it to a pen drive, an external disk or another folder — you choose where it goes.'),
            el('div.row.mt-16',
              el('button.btn.primary', { onclick: backupTo }, icon('download'), 'Backup to…'),
              el('button.btn', { onclick: quickBackup }, icon('save'), 'Quick backup here')),
            el('div.note.mt-16', icon('shield'), el('div',
              'MedV also takes an automatic copy every time you close the app, keeping the ten most recent.')))
        }),
        card({
          title: 'Restore',
          body: el('div',
            el('p.fs-13.muted', 'Restoring replaces the current data with a backup file. '
              + 'MedV first copies your present data aside, so a restore can itself be undone.'),
            el('div.row.mt-16',
              is('admin')
                ? el('button.btn', { onclick: () => restoreFrom() }, icon('upload'), 'Restore from file…')
                : el('span.fs-13.muted', 'Only an administrator can restore a backup.')),
            el('div.note.warn.mt-16', icon('alert'), el('div',
              el('b', 'One computer, one database. '),
              'A restored file replaces everything — it does not merge two computers together.')))
        })),
      card({
        title: 'Backup files in the app folder',
        subtitle: status.paths.backups,
        actions: el('div.row.tight',
          el('button.btn.sm', { onclick: () => shellApi.showItem(status.paths.backups) }, icon('folder'), 'Open folder'),
          el('button.btn.sm', { onclick: reload }, icon('refresh'), 'Refresh')),
        flush: true,
        body: dataTable({
          rows: status.backups,
          columns: [
            { key: 'name', label: 'File', render: (r) => el('div', el('b', r.name), el('div.fs-12.muted', r.path)) },
            { key: 'kind', label: 'Type', render: (r) => badge(r.kind === 'auto' ? 'automatic' : 'manual', r.kind === 'auto' ? '' : 'info') },
            { key: 'size', label: 'Size', align: 'num', render: (r) => `${(r.size / 1048576).toFixed(2)} MB` },
            { key: 'modified', label: 'Taken', render: (r) => fmt.stamp(r.modified) },
            {
              key: 'actions', label: '', align: 'center',
              render: (r) => el('div.row.tight', { style: { flexWrap: 'nowrap' } },
                el('button.btn.sm', { onclick: () => shellApi.showItem(r.path) }, 'Show'),
                is('admin') ? el('button.btn.sm.danger', { onclick: () => restoreFrom(r.path) }, 'Restore') : null)
            }
          ],
          empty: emptyState({ title: 'No backups yet', message: 'Take your first backup now — it only takes a moment.', iconName: 'backup' })
        })
      }),
      el('div.grid.cols-2.mt-16',
        card({
          title: 'Where your data lives',
          body: el('dl.kv',
            el('dt', 'Database file'), el('dd', el('span.mono.fs-12', status.paths.db)),
            el('dt', 'Backups folder'), el('dd', el('span.mono.fs-12', status.paths.backups)),
            el('dt', 'Exports folder'), el('dd', el('span.mono.fs-12', status.paths.exports)),
            el('dt', 'Internet needed'), el('dd', 'No — everything above is on this computer'))
        }),
        is('admin')
          ? card({
            title: 'Clear trial data',
            body: el('div',
              el('p.fs-13.muted', 'Finished testing? Remove every bill, purchase and payment while keeping your medicine, '
                + 'patient and supplier lists.'),
              el('div.row.mt-16', el('button.btn.danger', { onclick: clearData }, icon('trash'), 'Clear transactions')))
          })
          : null));
  }

  draw();
  return host;
}
