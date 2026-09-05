/*  sw.js — offline cache.
 *  Every file the app needs is pre-cached on install, so after the first visit
 *  the whole system opens with no network at all. Bump CACHE when files change:
 *  the old cache is then dropped on activate.
 */
var CACHE = 'lavi-pos-v1';

var ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/css/app.css',
  './assets/js/utils.js',
  './assets/js/db.js',
  './assets/js/seed.js',
  './assets/js/store.js',
  './assets/js/ui.js',
  './assets/js/receipt.js',
  './assets/js/views/pos.js',
  './assets/js/views/bills.js',
  './assets/js/views/reports.js',
  './assets/js/views/menu.js',
  './assets/js/views/inventory.js',
  './assets/js/views/attendance.js',
  './assets/js/views/staff.js',
  './assets/js/views/settings.js',
  './assets/js/app.js',
  './assets/icons/favicon.svg',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-maskable-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (cache) { return cache.addAll(ASSETS); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (k) {
          return k === CACHE ? null : caches.delete(k);
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

/*  Cache first — the app files never change between releases, and this keeps
 *  the counter instant even on a flaky connection. Anything not in the cache
 *  falls through to the network, and a failed navigation returns the shell.
 */
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  e.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res && res.ok && res.type === 'basic') {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () {
        if (req.mode === 'navigate') return caches.match('./index.html');
        return new Response('', { status: 504, statusText: 'Offline' });
      });
    })
  );
});
