'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * The only bridge between the interface and the database. The renderer gets
 * a small, explicit surface — no Node, no file system, no direct SQL.
 */
const listeners = new Set();
ipcRenderer.on('menu:action', (_event, payload) => {
  for (const fn of listeners) {
    try { fn(payload); } catch (err) { console.error(err); }
  }
});

contextBridge.exposeInMainWorld('medv', {
  isElectron: true,

  /** Calls a service channel; rejects with a plain, user-readable Error. */
  async call(channel, payload) {
    const res = await ipcRenderer.invoke('api:call', channel, payload ?? {});
    if (res && res.ok) return res.data;
    const err = new Error(res?.error?.message || 'Something went wrong.');
    err.code = res?.error?.code || 'ERROR';
    err.expected = Boolean(res?.error?.expected);
    throw err;
  },

  state: () => ipcRenderer.invoke('app:state'),

  dialog: {
    saveBackup: (name) => ipcRenderer.invoke('dialog:saveBackup', name),
    openBackup: () => ipcRenderer.invoke('dialog:openBackup'),
    openSheet: () => ipcRenderer.invoke('dialog:openSheet'),
    saveFile: (options) => ipcRenderer.invoke('file:save', options)
  },

  print: {
    html: (options) => ipcRenderer.invoke('print:html', options),
    pdf: (options) => ipcRenderer.invoke('print:pdf', options)
  },

  shell: {
    showItem: (target) => ipcRenderer.invoke('shell:showItem', target),
    openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url)
  },

  clipboard: {
    write: (text) => ipcRenderer.invoke('clipboard:write', text)
  },

  onMenu(handler) {
    listeners.add(handler);
    return () => listeners.delete(handler);
  }
});
