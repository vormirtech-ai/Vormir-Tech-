'use strict';

const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, protocol, net, ipcMain, dialog, shell, clipboard, Menu } = require('electron');

// The data folder is derived from the app name, so set it before anything
// touches app.getPath('userData'): %APPDATA%/MedBillPro on Windows.
app.setName('MedBillPro');

const paths = require('../core/paths');
const db = require('../core/db');
const api = require('../core/api');
const backup = require('../core/services/backup');
const settings = require('../core/services/settings');
const { buildMenu } = require('./menu');

const isDev = process.argv.includes('--dev') || !app.isPackaged;
const RENDERER_DIR = path.join(__dirname, '..', 'renderer');

protocol.registerSchemesAsPrivileged([{
  scheme: 'app',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
}]);

let mainWindow = null;
let bootError = null;

/** Serves the renderer from app://medv/ so ES modules and fetch behave normally. */
function registerRendererProtocol() {
  protocol.handle('app', async (request) => {
    const url = new URL(request.url);
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    const target = path.join(RENDERER_DIR, rel);
    // Never serve anything outside the renderer folder.
    if (!target.startsWith(RENDERER_DIR)) return new Response('Forbidden', { status: 403 });
    const file = fs.existsSync(target) && fs.statSync(target).isFile()
      ? target
      : path.join(RENDERER_DIR, 'index.html');
    return net.fetch(`file://${file.split(path.sep).join('/')}`);
  });
}

function openDatabase() {
  try {
    paths.configure(app.getPath('userData'));
    const opened = db.open(paths.dbFile());
    return opened;
  } catch (err) {
    bootError = err;
    return null;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 680,
    show: false,
    backgroundColor: '#f4f7fb',
    title: 'MedV — Pharmacy Management',
    icon: path.join(__dirname, '..', '..', 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
  });

  mainWindow.loadURL('app://medv/index.html');

  // Everything runs locally; external links open in the user's browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('app://')) {
      event.preventDefault();
      if (/^https?:/.test(url)) shell.openExternal(url);
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
  return mainWindow;
}

function serialiseError(err) {
  return {
    __error: true,
    message: err?.expected ? err.message : (err?.message || 'Something went wrong.'),
    code: err?.code || 'ERROR',
    expected: Boolean(err?.expected)
  };
}

function registerIpc() {
  ipcMain.handle('api:call', async (_event, channel, payload) => {
    try {
      if (bootError) throw bootError;
      const result = await api.handle(channel, payload);
      return { ok: true, data: result === undefined ? null : result };
    } catch (err) {
      if (!err?.expected) console.error(`[api:${channel}]`, err);
      return { ok: false, error: serialiseError(err) };
    }
  });

  ipcMain.handle('app:state', () => ({
    version: app.getVersion(),
    isPackaged: app.isPackaged,
    platform: process.platform,
    paths: paths.paths(),
    bootError: bootError ? serialiseError(bootError) : null
  }));

  // --- native dialogs -----------------------------------------------------
  ipcMain.handle('dialog:saveBackup', async (_event, defaultName) => {
    const res = await dialog.showSaveDialog(mainWindow, {
      title: 'Save backup',
      defaultPath: path.join(app.getPath('documents'), defaultName || backup.suggestedName()),
      filters: [{ name: 'MedV backup', extensions: ['db'] }]
    });
    return res.canceled ? null : res.filePath;
  });

  ipcMain.handle('dialog:openBackup', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose a backup to restore',
      properties: ['openFile'],
      filters: [{ name: 'MedV backup', extensions: ['db', 'sqlite', 'sqlite3'] }]
    });
    return res.canceled || !res.filePaths.length ? null : res.filePaths[0];
  });

  ipcMain.handle('dialog:openSheet', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose a bill or catalogue file',
      properties: ['openFile'],
      filters: [
        { name: 'Spreadsheets', extensions: ['xlsx', 'csv', 'txt', 'tsv'] },
        { name: 'All files', extensions: ['*'] }
      ]
    });
    if (res.canceled || !res.filePaths.length) return null;
    const file = res.filePaths[0];
    const stat = fs.statSync(file);
    if (stat.size > 12 * 1024 * 1024) {
      return { error: 'That file is larger than 12 MB. Please split it before importing.' };
    }
    return { name: path.basename(file), path: file, base64: fs.readFileSync(file).toString('base64') };
  });

  ipcMain.handle('file:save', async (_event, { defaultName, content, filters }) => {
    const res = await dialog.showSaveDialog(mainWindow, {
      title: 'Save file',
      defaultPath: path.join(app.getPath('documents'), defaultName || 'medv-export.csv'),
      filters: filters || [{ name: 'CSV', extensions: ['csv'] }]
    });
    if (res.canceled || !res.filePath) return null;
    fs.writeFileSync(res.filePath, content, 'utf8');
    return res.filePath;
  });

  ipcMain.handle('shell:showItem', (_event, target) => {
    if (target && fs.existsSync(target)) shell.showItemInFolder(target);
    return true;
  });

  ipcMain.handle('shell:openExternal', (_event, url) => {
    if (/^(https?|mailto|tel|whatsapp):/i.test(String(url))) shell.openExternal(url);
    return true;
  });

  ipcMain.handle('clipboard:write', (_event, text) => {
    clipboard.writeText(String(text ?? ''));
    return true;
  });

  // --- printing -----------------------------------------------------------
  ipcMain.handle('print:html', async (_event, { html, format = 'a5', silent = false }) => {
    const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true, javascript: false } });
    try {
      await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      await new Promise((resolve) => setTimeout(resolve, 150));
      const options = {
        silent,
        printBackground: true,
        margins: { marginType: 'custom', top: 0, bottom: 0, left: 0, right: 0 },
        pageSize: format === 'thermal' ? { width: 80000, height: 297000 } : (format === 'a4' ? 'A4' : 'A5')
      };
      const result = await new Promise((resolve) => {
        win.webContents.print(options, (success, reason) => resolve({ success, reason }));
      });
      return result;
    } finally {
      win.destroy();
    }
  });

  ipcMain.handle('print:pdf', async (_event, { html, format = 'a5', defaultName = 'invoice.pdf' }) => {
    const res = await dialog.showSaveDialog(mainWindow, {
      title: 'Save as PDF',
      defaultPath: path.join(app.getPath('documents'), defaultName),
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    });
    if (res.canceled || !res.filePath) return null;
    const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true, javascript: false } });
    try {
      await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      await new Promise((resolve) => setTimeout(resolve, 150));
      const pdf = await win.webContents.printToPDF({
        printBackground: true,
        pageSize: format === 'thermal' ? { width: 3.15, height: 11.7 } : (format === 'a4' ? 'A4' : 'A5'),
        margins: { top: 0, bottom: 0, left: 0, right: 0 }
      });
      fs.writeFileSync(res.filePath, pdf);
      return res.filePath;
    } finally {
      win.destroy();
    }
  });

  ipcMain.handle('window:toggleFullScreen', () => {
    if (!mainWindow) return false;
    mainWindow.setFullScreen(!mainWindow.isFullScreen());
    return mainWindow.isFullScreen();
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    registerRendererProtocol();
    openDatabase();
    registerIpc();
    createWindow();
    Menu.setApplicationMenu(buildMenu({ getWindow: () => mainWindow, isDev }));

    if (bootError) {
      dialog.showErrorBox(
        'MedV could not open its database',
        `${bootError.message}\n\nThe database file is:\n${paths.dbFile()}\n\n`
        + 'If the file has been moved or is in use by another copy of MedV, close it and start again. '
        + 'You can also restore a backup from the Backup screen.'
      );
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    // A rolling local copy on every clean exit, then a checkpointed close.
    try {
      if (db.isOpen() && settings.flag('setup_complete')) {
        const dest = require('path').join(paths.backupDir(), `auto_exit_${Date.now()}.db`);
        db.get().backup(dest).catch(() => {});
      }
    } catch { /* never block shutdown */ }
    try { db.close(); } catch { /* ignore */ }
  });
}
