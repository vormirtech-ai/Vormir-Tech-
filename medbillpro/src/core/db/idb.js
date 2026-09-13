'use strict';

/** Minimal IndexedDB key/value store — the browser build's disk. */
const DB_NAME = 'medv';
const STORE = 'files';
const VERSION = 1;

let handle = null;

function openStore() {
  if (handle) return Promise.resolve(handle);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE)) database.createObjectStore(STORE);
    };
    request.onsuccess = () => { handle = request.result; resolve(handle); };
    request.onerror = () => reject(request.error);
  });
}

function run(mode, fn) {
  return openStore().then((database) => new Promise((resolve, reject) => {
    const tx = database.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    let request;
    try { request = fn(store); } catch (err) { reject(err); return; }
    // An IDBRequest always has a `result` property — it is `undefined` when the
    // key is absent, which must not be confused with the request object itself.
    tx.oncomplete = () => resolve(request && typeof request === 'object' && 'result' in request ? request.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}

const get = (key) => run('readonly', (store) => store.get(key));
const set = (key, value) => run('readwrite', (store) => store.put(value, key));
const del = (key) => run('readwrite', (store) => store.delete(key));
const keys = () => run('readonly', (store) => store.getAllKeys());

async function estimate() {
  if (navigator.storage && navigator.storage.estimate) {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    return { usage, quota };
  }
  return { usage: 0, quota: 0 };
}

/** Asks the browser to keep this data even when disk space runs low. */
async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    }
  } catch { /* not supported */ }
  return false;
}

module.exports = { get, set, del, keys, estimate, requestPersistence, DB_NAME, STORE };
