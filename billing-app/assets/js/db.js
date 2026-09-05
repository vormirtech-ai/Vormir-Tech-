/*  db.js — local, offline-only persistence.
 *
 *  Everything lives on this device. IndexedDB is the primary engine; if the
 *  browser refuses it (private mode, a file:// origin on some browsers) we fall
 *  back to a localStorage-backed store with the exact same async interface, so
 *  no calling code has to care which one is running.
 */
(function (App) {
  'use strict';

  var DB_NAME = 'lavi_dhaba_pos';
  var DB_VERSION = 1;

  var SCHEMA = {
    settings:   { key: 'id', indexes: [] },
    counters:   { key: 'id', indexes: [] },
    menu:       { key: 'id', indexes: ['cat'] },
    bills:      { key: 'id', indexes: ['date', 'status', 'billNo'] },
    employees:  { key: 'id', indexes: [] },
    attendance: { key: 'id', indexes: ['date', 'empId', 'month'] },
    inventory:  { key: 'id', indexes: ['cat'] },
    moves:      { key: 'id', indexes: ['date', 'itemId'] }
  };

  var STORES = Object.keys(SCHEMA);

  /* ============================================================ IndexedDB */

  function IdbDriver(handle) { this.db = handle; }

  IdbDriver.prototype._tx = function (store, mode) {
    return this.db.transaction(store, mode).objectStore(store);
  };

  function request(req) {
    return new Promise(function (resolve, reject) {
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  IdbDriver.prototype.all = function (store) {
    return request(this._tx(store, 'readonly').getAll());
  };

  IdbDriver.prototype.get = function (store, id) {
    return request(this._tx(store, 'readonly').get(id));
  };

  IdbDriver.prototype.put = function (store, value) {
    return request(this._tx(store, 'readwrite').put(value)).then(function () { return value; });
  };

  IdbDriver.prototype.putMany = function (store, values) {
    if (!values.length) return Promise.resolve([]);
    var self = this;
    return new Promise(function (resolve, reject) {
      var tx = self.db.transaction(store, 'readwrite');
      var os = tx.objectStore(store);
      values.forEach(function (v) { os.put(v); });
      tx.oncomplete = function () { resolve(values); };
      tx.onerror = function () { reject(tx.error); };
      tx.onabort = function () { reject(tx.error); };
    });
  };

  IdbDriver.prototype.del = function (store, id) {
    return request(this._tx(store, 'readwrite').delete(id));
  };

  IdbDriver.prototype.clear = function (store) {
    return request(this._tx(store, 'readwrite').clear());
  };

  // Inclusive range scan over an index; `lower`/`upper` may be null for open ends.
  IdbDriver.prototype.range = function (store, index, lower, upper) {
    var os = this._tx(store, 'readonly');
    if (!os.indexNames.contains(index)) {
      return this.all(store).then(function (rows) {
        return rows.filter(function (r) {
          return (lower === null || r[index] >= lower) && (upper === null || r[index] <= upper);
        });
      });
    }
    var kr = null;
    if (lower !== null && upper !== null) kr = IDBKeyRange.bound(lower, upper);
    else if (lower !== null) kr = IDBKeyRange.lowerBound(lower);
    else if (upper !== null) kr = IDBKeyRange.upperBound(upper);
    return request(os.index(index).getAll(kr));
  };

  IdbDriver.prototype.equals = function (store, index, value) {
    return this.range(store, index, value, value);
  };

  // Sequence bump inside one transaction so two tabs cannot mint the same bill no.
  IdbDriver.prototype.nextSeq = function (name, start) {
    var self = this;
    return new Promise(function (resolve, reject) {
      var tx = self.db.transaction('counters', 'readwrite');
      var os = tx.objectStore('counters');
      var next;
      os.get(name).onsuccess = function (e) {
        var row = e.target.result;
        next = (row && typeof row.value === 'number' ? row.value : (start || 0)) + 1;
        os.put({ id: name, value: next });
      };
      tx.oncomplete = function () { resolve(next); };
      tx.onerror = function () { reject(tx.error); };
      tx.onabort = function () { reject(tx.error); };
    });
  };

  function openIdb() {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) return reject(new Error('IndexedDB unavailable'));
      var req;
      try { req = indexedDB.open(DB_NAME, DB_VERSION); }
      catch (err) { return reject(err); }

      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        STORES.forEach(function (name) {
          var def = SCHEMA[name];
          var os = db.objectStoreNames.contains(name)
            ? e.target.transaction.objectStore(name)
            : db.createObjectStore(name, { keyPath: def.key });
          def.indexes.forEach(function (ix) {
            if (!os.indexNames.contains(ix)) os.createIndex(ix, ix, { unique: false });
          });
        });
      };
      req.onsuccess = function () { resolve(new IdbDriver(req.result)); };
      req.onerror = function () { reject(req.error); };
      req.onblocked = function () { reject(new Error('IndexedDB blocked by another tab')); };
    });
  }

  /* ======================================================== localStorage */

  function LsDriver() {
    this.cache = {};
    var self = this;
    STORES.forEach(function (name) { self.cache[name] = self._load(name); });
  }

  LsDriver.prototype._key = function (store) { return 'lavi_pos.' + store; };

  LsDriver.prototype._load = function (store) {
    try {
      var raw = localStorage.getItem(this._key(store));
      var parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) { return []; }
  };

  LsDriver.prototype._save = function (store) {
    try {
      localStorage.setItem(this._key(store), JSON.stringify(this.cache[store]));
    } catch (e) {
      throw new Error('Device storage is full. Export a backup and clear old bills.');
    }
  };

  LsDriver.prototype.all = function (store) {
    return Promise.resolve(this.cache[store].slice());
  };

  LsDriver.prototype.get = function (store, id) {
    var found = this.cache[store].filter(function (r) { return r.id === id; })[0];
    return Promise.resolve(found ? JSON.parse(JSON.stringify(found)) : undefined);
  };

  LsDriver.prototype.put = function (store, value) {
    var rows = this.cache[store];
    var i = rows.findIndex(function (r) { return r.id === value.id; });
    if (i >= 0) rows[i] = value; else rows.push(value);
    this._save(store);
    return Promise.resolve(value);
  };

  LsDriver.prototype.putMany = function (store, values) {
    var rows = this.cache[store];
    values.forEach(function (value) {
      var i = rows.findIndex(function (r) { return r.id === value.id; });
      if (i >= 0) rows[i] = value; else rows.push(value);
    });
    this._save(store);
    return Promise.resolve(values);
  };

  LsDriver.prototype.del = function (store, id) {
    this.cache[store] = this.cache[store].filter(function (r) { return r.id !== id; });
    this._save(store);
    return Promise.resolve();
  };

  LsDriver.prototype.clear = function (store) {
    this.cache[store] = [];
    this._save(store);
    return Promise.resolve();
  };

  LsDriver.prototype.range = function (store, index, lower, upper) {
    return Promise.resolve(this.cache[store].filter(function (r) {
      return (lower === null || r[index] >= lower) && (upper === null || r[index] <= upper);
    }));
  };

  LsDriver.prototype.equals = function (store, index, value) {
    return Promise.resolve(this.cache[store].filter(function (r) { return r[index] === value; }));
  };

  LsDriver.prototype.nextSeq = function (name, start) {
    var rows = this.cache.counters;
    var row = rows.filter(function (r) { return r.id === name; })[0];
    var next = (row && typeof row.value === 'number' ? row.value : (start || 0)) + 1;
    if (row) row.value = next; else rows.push({ id: name, value: next });
    this._save('counters');
    return Promise.resolve(next);
  };

  /* ============================================================== facade */

  var driver = null;

  var DB = {
    engine: 'none',
    stores: STORES,

    open: function () {
      if (driver) return Promise.resolve(DB);
      return openIdb().then(function (d) {
        driver = d;
        DB.engine = 'IndexedDB';
        return DB;
      }).catch(function () {
        driver = new LsDriver();
        DB.engine = 'localStorage';
        return DB;
      });
    },

    all:      function (s) { return driver.all(s); },
    get:      function (s, id) { return driver.get(s, id); },
    put:      function (s, v) { return driver.put(s, v); },
    putMany:  function (s, v) { return driver.putMany(s, v); },
    del:      function (s, id) { return driver.del(s, id); },
    clear:    function (s) { return driver.clear(s); },
    range:    function (s, ix, lo, hi) { return driver.range(s, ix, lo, hi); },
    equals:   function (s, ix, v) { return driver.equals(s, ix, v); },
    nextSeq:  function (name, start) { return driver.nextSeq(name, start); },

    // Whole-database snapshot, used by Settings → Backup.
    exportAll: function () {
      return Promise.all(STORES.map(function (s) { return driver.all(s); }))
        .then(function (results) {
          var out = { app: 'lavi-dhaba-pos', version: DB_VERSION, exportedAt: Date.now(), data: {} };
          STORES.forEach(function (s, i) { out.data[s] = results[i]; });
          return out;
        });
    },

    // Replaces the database with a backup file's contents.
    importAll: function (payload) {
      if (!payload || !payload.data) return Promise.reject(new Error('Not a valid backup file.'));
      var data = payload.data;
      var known = STORES.filter(function (s) { return Array.isArray(data[s]); });
      if (!known.length) return Promise.reject(new Error('Backup file contains no data.'));
      return Promise.all(known.map(function (s) { return driver.clear(s); }))
        .then(function () {
          return Promise.all(known.map(function (s) { return driver.putMany(s, data[s]); }));
        })
        .then(function () { return known; });
    },

    wipe: function () {
      return Promise.all(STORES.map(function (s) { return driver.clear(s); }));
    }
  };

  App.DB = DB;
})(window.App = window.App || {});
