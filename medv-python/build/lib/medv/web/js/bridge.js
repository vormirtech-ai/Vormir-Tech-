/**
 * MedV desktop bridge (Python edition).
 *
 * The interface is the same one the Electron and web editions use; it talks to
 * `window.medv`. Here that is implemented over the local Python server running
 * on 127.0.0.1, so file dialogs, printing and backups behave like a desktop
 * application while the business logic stays in Python.
 */
(function () {
  'use strict';

  const boot = document.getElementById('boot-status');
  const say = (text) => { if (boot) boot.textContent = text; };
  const menuHandlers = new Set();
  let appState = null;

  async function post(url, body) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body || {})
    });
    if (!response.ok) throw new Error(`MedV is not responding (${response.status}).`);
    return response.json();
  }

  function pickFile(accept) {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;
      input.style.cssText = 'position:fixed;left:-1000px';
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

  /** Prints through a hidden iframe — no pop-up, no blocker. */
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

  function download(filename, content, mime) {
    const blob = new Blob([content], { type: mime || 'application/octet-stream' });
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

  window.medv = {
    isElectron: false,
    platform: 'python',

    async call(channel, payload) {
      const result = await post('/api', { channel, payload: payload || {} });
      if (result && result.ok) return result.data;
      const error = new Error((result && result.error && result.error.message) || 'Something went wrong.');
      error.code = result && result.error && result.error.code;
      error.expected = Boolean(result && result.error && result.error.expected);
      throw error;
    },

    async state() {
      if (!appState) appState = await post('/api/state');
      return appState;
    },

    dialog: {
      /** Backups are written by the server into Documents\MedV Backups. */
      async saveBackup(name) {
        const result = await post('/api/backup-target', { name });
        return result.path;
      },
      /** A chosen file is uploaded to the server, which returns a real path. */
      async openBackup() {
        const file = await pickFile('.db,.sqlite,.sqlite3');
        if (!file) return null;
        const bytes = new Uint8Array(await file.arrayBuffer());
        const result = await post('/api/upload', { name: file.name, base64: toBase64(bytes) });
        return result.ok ? result.path : null;
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
      pdf: async ({ html }) => { await printHtml(html); return null; }
    },

    shell: {
      showItem: async (target) => {
        const result = await post('/api/open-folder', { path: target });
        return Boolean(result && result.ok);
      },
      openExternal: async (url) => { window.open(url, '_blank', 'noopener'); return true; }
    },

    clipboard: {
      write: async (text) => {
        try {
          await navigator.clipboard.writeText(String(text ?? ''));
        } catch {
          const area = document.createElement('textarea');
          area.value = String(text ?? '');
          document.body.appendChild(area);
          area.select();
          document.execCommand('copy');
          area.remove();
        }
        return true;
      }
    },

    onMenu(handler) {
      menuHandlers.add(handler);
      return () => menuHandlers.delete(handler);
    }
  };

  async function start() {
    try {
      say('Connecting to MedV…');
      await window.medv.state();
      say('Starting…');
      await import('./app.js');
    } catch (error) {
      console.error(error);
      const root = document.getElementById('root');
      if (root) {
        root.innerHTML = `<div style="max-width:620px;margin:12vh auto;padding:0 24px;font-family:system-ui">
          <h1 style="font-size:20px;margin-bottom:8px">MedV is not responding</h1>
          <p style="color:#46567a">${String(error && error.message ? error.message : error)}</p>
          <p style="color:#77869f;font-size:13px">Check that the MedV window (the black command window)
          is still open, then reload this page.</p>
          <button onclick="location.reload()" style="margin-top:12px;padding:9px 16px;border-radius:8px;
            border:1px solid #1565d8;background:#1565d8;color:#fff;font-size:14px;cursor:pointer">Reload</button>
        </div>`;
      }
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
