'use strict';

const { Menu, shell, app } = require('electron');

/** Native menu — every shortcut here is mirrored inside the app. */
function buildMenu({ getWindow, isDev }) {
  const send = (channel, payload) => {
    const win = getWindow();
    if (win) win.webContents.send('menu:action', { channel, payload });
  };

  const template = [
    {
      label: '&File',
      submenu: [
        { label: 'New Bill', accelerator: 'F2', click: () => send('navigate', '#/billing') },
        { label: 'New Purchase', accelerator: 'F4', click: () => send('navigate', '#/purchases/new') },
        { type: 'separator' },
        { label: 'Backup Database…', accelerator: 'CmdOrCtrl+B', click: () => send('navigate', '#/backup') },
        { label: 'Restore Database…', click: () => send('navigate', '#/backup') },
        { type: 'separator' },
        { label: 'Print', accelerator: 'CmdOrCtrl+P', click: () => send('print') },
        { type: 'separator' },
        { role: 'quit', label: 'Exit' }
      ]
    },
    {
      label: '&Go',
      submenu: [
        { label: 'Dashboard', accelerator: 'CmdOrCtrl+1', click: () => send('navigate', '#/dashboard') },
        { label: 'Billing', accelerator: 'CmdOrCtrl+2', click: () => send('navigate', '#/billing') },
        { label: 'Medicines', accelerator: 'CmdOrCtrl+3', click: () => send('navigate', '#/products') },
        { label: 'Purchases', accelerator: 'CmdOrCtrl+4', click: () => send('navigate', '#/purchases') },
        { label: 'Patients', accelerator: 'CmdOrCtrl+5', click: () => send('navigate', '#/customers') },
        { label: 'Reports', accelerator: 'CmdOrCtrl+6', click: () => send('navigate', '#/reports') },
        { label: 'GST', accelerator: 'CmdOrCtrl+7', click: () => send('navigate', '#/gst') },
        { label: 'Settings', accelerator: 'CmdOrCtrl+8', click: () => send('navigate', '#/settings') }
      ]
    },
    {
      label: '&Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }
      ]
    },
    {
      label: '&View',
      submenu: [
        { role: 'reload' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(isDev ? [{ role: 'toggleDevTools' }] : [])
      ]
    },
    {
      label: '&Help',
      submenu: [
        { label: 'Keyboard Shortcuts', accelerator: 'F1', click: () => send('shortcuts') },
        { label: 'Open Data Folder', click: () => shell.openPath(require('../core/paths').base()) },
        { type: 'separator' },
        { label: `MedV ${app.getVersion()} — works fully offline`, enabled: false }
      ]
    }
  ];
  return Menu.buildFromTemplate(template);
}

module.exports = { buildMenu };
