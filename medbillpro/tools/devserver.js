'use strict';

/**
 * Offline development harness. It serves the renderer over 127.0.0.1 and
 * answers the same API channels the Electron main process does, so the real
 * interface can be driven by automated tests in a plain browser.
 *
 * This file is NOT part of the packaged application (see electron-builder.yml).
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const paths = require('../src/core/paths');
const dataDir = process.env.MEDV_DEV_DIR || path.join(os.tmpdir(), 'medv-dev');
paths.configure(dataDir);

const db = require('../src/core/db');
const api = require('../src/core/api');

db.open(paths.dbFile());

const RENDERER = path.join(__dirname, '..', 'src', 'renderer');
const PORT = Number(process.env.PORT || 4173);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const BRIDGE = `
// Dev bridge: mirrors the Electron preload surface over HTTP.
const post = async (url, body) => {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
  return res.json();
};
window.__dev = { savedFiles: [], printed: [], nextOpenFile: null, nextSavePath: null, nextBackupPath: null };
window.medv = {
  isElectron: false,
  async call(channel, payload) {
    const res = await post('/api', { channel, payload });
    if (res && res.ok) return res.data;
    const err = new Error((res && res.error && res.error.message) || 'Request failed');
    err.code = res && res.error && res.error.code;
    err.expected = Boolean(res && res.error && res.error.expected);
    throw err;
  },
  state: () => post('/api/state'),
  dialog: {
    saveBackup: async (name) => window.__dev.nextBackupPath || (await post('/api/devpath', { name: name || 'MedV_Backup.db' })).path,
    openBackup: async () => window.__dev.nextBackupPath,
    openSheet: async () => window.__dev.nextOpenFile,
    saveFile: async ({ defaultName, content }) => {
      window.__dev.savedFiles.push({ name: defaultName, content });
      return window.__dev.nextSavePath || ('/dev/saved/' + defaultName);
    }
  },
  print: {
    html: async (options) => { window.__dev.printed.push(options); return { success: true }; },
    pdf: async (options) => { window.__dev.printed.push(options); return '/dev/saved/invoice.pdf'; }
  },
  shell: { showItem: async () => true, openExternal: async (url) => { window.__dev.opened = url; return true; } },
  clipboard: { write: async (text) => { window.__dev.clipboard = text; return true; } },
  onMenu: (handler) => { window.__dev.menuHandler = handler; return () => {}; }
};
`;

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 20e6) reject(new Error('Payload too large'));
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch (err) { reject(err); }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  if (req.method === 'POST' && url.pathname === '/api') {
    try {
      const { channel, payload } = await readBody(req);
      const data = await api.handle(channel, payload);
      send(res, 200, JSON.stringify({ ok: true, data: data === undefined ? null : data }), MIME['.json']);
    } catch (err) {
      send(res, 200, JSON.stringify({
        ok: false,
        error: { message: err.message, code: err.code || 'ERROR', expected: Boolean(err.expected) }
      }), MIME['.json']);
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/state') {
    send(res, 200, JSON.stringify({
      version: require('../package.json').version,
      isPackaged: false,
      platform: process.platform,
      paths: paths.paths(),
      bootError: null
    }), MIME['.json']);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/devpath') {
    const body = await readBody(req);
    send(res, 200, JSON.stringify({ path: path.join(paths.exportDir(), body.name || 'file.db') }), MIME['.json']);
    return;
  }

  if (url.pathname === '/__dev/bridge.js') {
    send(res, 200, BRIDGE, MIME['.js']);
    return;
  }

  const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
  const file = path.join(RENDERER, rel);
  if (!file.startsWith(RENDERER) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    send(res, 404, 'Not found');
    return;
  }
  if (rel === 'index.html') {
    const html = fs.readFileSync(file, 'utf8')
      .replace('<script type="module" src="js/app.js"></script>',
        '<script src="/__dev/bridge.js"></script>\n  <script type="module" src="js/app.js"></script>')
      .replace(/<meta http-equiv="Content-Security-Policy"[\s\S]*?>/, '');
    send(res, 200, html, MIME['.html']);
    return;
  }
  send(res, 200, fs.readFileSync(file), MIME[path.extname(file)] || 'application/octet-stream');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`MedV dev harness on http://127.0.0.1:${PORT}  (data: ${paths.base()})`);
});

process.on('SIGTERM', () => { try { db.close(); } catch { /* ignore */ } server.close(() => process.exit(0)); });
process.on('SIGINT', () => { try { db.close(); } catch { /* ignore */ } server.close(() => process.exit(0)); });
