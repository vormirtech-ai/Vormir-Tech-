'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');

/**
 * Where the app keeps its data on this computer. The Electron main process
 * sets this from app.getPath('userData'); tests and the dev harness set their
 * own folder. Nothing here ever touches a temporary directory.
 */
let root = null;

function defaultRoot() {
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'MedBillPro');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'MedBillPro');
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'MedBillPro');
}

function configure(dir) {
  root = dir || defaultRoot();
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.mkdirSync(backupDir(), { recursive: true });
  fs.mkdirSync(exportDir(), { recursive: true });
  return paths();
}

function base() {
  if (!root) configure(defaultRoot());
  return root;
}

function dataDir() { return path.join(base(), 'data'); }
function backupDir() { return path.join(base(), 'backups'); }
function exportDir() { return path.join(base(), 'exports'); }
function dbFile() { return path.join(dataDir(), 'medbill.db'); }

function paths() {
  return { root: base(), data: dataDir(), backups: backupDir(), exports: exportDir(), db: dbFile() };
}

module.exports = { configure, paths, base, dataDir, backupDir, exportDir, dbFile, defaultRoot };
