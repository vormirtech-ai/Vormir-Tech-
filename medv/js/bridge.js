/**
 * MedV web bridge.
 *
 * The desktop build talks to the main process through Electron IPC; in the
 * browser the very same services run inside this page, so `window.medv` is
 * implemented here instead. The interface files under js/ are byte-identical
 * between the two builds.
 */
(function () {
  'use strict';

  const VERSION = '1.0.0';

  const boot = document.getElementById('boot-status');
  const say = (text) => { if (boot) boot.textContent = text; };

  const menuHandlers = new Set();
  let core = null;
  let api = null;
  let db = null;
  let backup = null;

  // ------------------------------------------------------------- utilities
  function download(filename, data, mime = 'application/octet-stream') {
    const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return filename;
  }

  function pickFile(accept) {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;
      input.style.position = 'fixed';
      input.style.left = '-1000px';
      document.body.appendChild(input);
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        input.remove();
        resolve(value);
      };
      input.addEventListener('change', () => finish(input.files && input.files[0] ? input.files[0] : null));
      input.addEventListener('cancel', () => finish(null));
      input.click();
      // Some browsers never fire `cancel`; give up quietly when focus returns
      // and nothing was chosen.
      window.addEventListener('focus', () => {
        setTimeout(() => { if (!input.files || input.files.length === 0) finish(null); }, 700);
      }, { once: true });
    });
  }

  const toBase64 = (bytes) => {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  };

  /** Prints through a hidden iframe — no pop-up window, no blocker. */
  function printHtml(html) {
    return new Promise((resolve) => {
      const frame = document.createElement('iframe');
      frame.setAttribute('aria-hidden', 'true');
      frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
      document.body.appendChild(frame);
      frame.onload = () => {
        try {
          frame.contentWindow.focus();
          frame.contentWindow.print();
        } catch (err) {
          console.error('[medv] print failed', err);
        }
        setTimeout(() => { frame.remove(); resolve({ success: true }); }, 1200);
      };
      frame.srcdoc = html;
    });
  }

  // --------------------------------------------------------------- the API
  const medv = {
    isElectron: false,
    platform: 'web',

    async call(channel, payload) {
      if (!api) throw new Error('MedV is still starting up. Please wait a moment.');
      const result = await api.handle(channel, payload || {});
      // A backup produces bytes the page has to hand to the browser.
      if (channel === 'backup.create' && result && result.download) {
        const bytes = backup.pending.downloads.get(result.name);
        if (bytes) {
          download(result.name, bytes, 'application/x-sqlite3');
          backup.pending.downloads.delete(result.name);
        }
      }
      return result;
    },

    async state() {
      return {
        version: VERSION,
        isPackaged: true,
        platform: 'web',
        paths: core ? core.require('core/paths').paths() : {},
        bootError: null
      };
    },

    dialog: {
      async saveBackup(name) {
        // In the browser the "where" is the Downloads folder; only the name matters.
        return name || `MedBillPro_Backup_${new Date().toISOString().slice(0, 10)}.db`;
      },
      async openBackup() {
        const file = await pickFile('.db,.sqlite,.sqlite3');
        if (!file) return null;
        const bytes = new Uint8Array(await file.arrayBuffer());
        backup.pending.uploads.set(file.name, bytes);
        return file.name;
      },
      async openSheet() {
        const file = await pickFile('.xlsx,.csv,.tsv,.txt');
        if (!file) return null;
        if (file.size > 12 * 1024 * 1024) {
          return { error: 'That file is larger than 12 MB. Please split it before importing.' };
        }
        const bytes = new Uint8Array(await file.arrayBuffer());
        return { name: file.name, path: file.name, base64: toBase64(bytes) };
      },
      async saveFile({ defaultName, content }) {
        return download(defaultName || 'medv-export.csv', content, 'text/csv;charset=utf-8');
      }
    },

    print: {
      html: ({ html }) => printHtml(html),
      // The browser's own print dialog has "Save as PDF" built in.
      pdf: async ({ html }) => { await printHtml(html); return null; }
    },

    shell: {
      showItem: async () => false,
      openExternal: async (url) => { window.open(url, '_blank', 'noopener'); return true; }
    },

    clipboard: {
      write: async (text) => {
        try {
          await navigator.clipboard.writeText(String(text ?? ''));
          return true;
        } catch {
          const area = document.createElement('textarea');
          area.value = String(text ?? '');
          document.body.appendChild(area);
          area.select();
          document.execCommand('copy');
          area.remove();
          return true;
        }
      }
    },

    onMenu(handler) {
      menuHandlers.add(handler);
      return () => menuHandlers.delete(handler);
    }
  };

  window.medv = medv;

  // ----------------------------------------------------------- start-up
  async function start() {
    try {
      say('Loading the database engine…');
      const SQL = await initSqlJs({ locateFile: (f) => `vendor/${f}` });

      say('Opening your local database…');
      core = window.MedVCore;
      db = core.require('core/db');
      await db.open({ SQL });
      api = core.require('core/api');
      backup = core.require('core/services/backup');

      // Keep an automatic copy in browser storage once a day.
      const settings = core.require('core/services/settings');
      try {
        const last = settings.get('last_auto_snapshot', '');
        const todayIso = new Date().toISOString().slice(0, 10);
        if (last !== todayIso && settings.flag('setup_complete')) {
          await backup.auto('daily');
          settings.put('last_auto_snapshot', todayIso);
        }
      } catch (err) {
        console.warn('[medv] automatic snapshot skipped', err);
      }

      // Never lose the last few writes if the tab is closed abruptly.
      window.addEventListener('pagehide', () => { db.persist(); });
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') db.persist();
      });

      say('Starting MedV…');
      await import('./app.js');
    } catch (err) {
      console.error(err);
      const root = document.getElementById('root');
      if (root) {
        root.innerHTML = `<div style="max-width:640px;margin:12vh auto;padding:0 24px;font-family:system-ui">
          <h1 style="font-size:20px;margin-bottom:8px">MedV could not start</h1>
          <p style="color:#46567a">${String(err && err.message ? err.message : err)}</p>
          <p style="color:#77869f;font-size:13px">If this browser is in private mode, MedV cannot save data —
          open it in a normal window. Otherwise reload the page.</p>
          <button onclick="location.reload()" style="margin-top:12px;padding:9px 16px;border-radius:8px;
            border:1px solid #1565d8;background:#1565d8;color:#fff;font-size:14px;cursor:pointer">Reload</button>
        </div>`;
      }
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  /** Offers a reload when a newer version has finished downloading. */
  function showUpdateBanner() {
    if (document.getElementById('medv-update')) return;
    const bar = document.createElement('div');
    bar.id = 'medv-update';
    bar.className = 'toast ok';
    bar.innerHTML = '<div class="bar"></div><div class="msg"><b>A new version of MedV is ready</b>'
      + 'Finish what you are doing, then reload to use it.</div>';
    const button = document.createElement('button');
    button.className = 'btn sm primary';
    button.textContent = 'Reload';
    button.onclick = () => window.location.reload();
    bar.appendChild(button);
    const host = document.getElementById('toasts');
    if (host) host.appendChild(bar);
  }

  // Register the service worker so the app keeps working with no connection.
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').then((registration) => {
        registration.addEventListener('updatefound', () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            // A controller already exists, so this is an update rather than the
            // very first install — never reload underneath a half-typed bill.
            if (installing.state === 'installed' && navigator.serviceWorker.controller) showUpdateBanner();
          });
        });
      }).catch((err) => console.warn('[medv] offline cache unavailable', err));
    });
  }
})();
