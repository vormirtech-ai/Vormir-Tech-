/*  app.js — application shell: navigation, routing and boot. */
(function (App) {
  'use strict';

  var U = App.U, UI = App.UI, Store = App.Store;

  var NAV = [
    { id: 'pos',        label: 'Billing',    icon: '🧾', hint: 'Take an order' },
    { id: 'bills',      label: 'Bills',      icon: '📑', hint: 'Bill history' },
    { id: 'reports',    label: 'Reports',    icon: '📊', hint: 'Sales & summaries' },
    { id: 'menu',       label: 'Menu',       icon: '🍽️', hint: 'Items & prices' },
    { id: 'inventory',  label: 'Inventory',  icon: '📦', hint: 'Kitchen stock' },
    { id: 'attendance', label: 'Attendance', icon: '📅', hint: 'Staff attendance' },
    { id: 'staff',      label: 'Staff',      icon: '👥', hint: 'Team & wages' },
    { id: 'settings',   label: 'Settings',   icon: '⚙️', hint: 'Shop & backup' }
  ];

  var current = null;
  var teardown = null;

  /* ----------------------------------------------------------- router */

  var Router = {
    go: function (id) {
      if (!App.Views[id]) id = 'pos';
      if (location.hash !== '#/' + id) location.hash = '#/' + id;
      else Router.render(id);
    },
    current: function () {
      var id = (location.hash || '').replace(/^#\/?/, '');
      return App.Views[id] ? id : 'pos';
    },
    render: function (id) {
      var view = App.Views[id];
      if (!view) return;
      if (typeof teardown === 'function') { try { teardown(); } catch (e) {} }
      teardown = null;
      current = id;

      U.qsa('.nav__item').forEach(function (a) {
        a.classList.toggle('is-active', a.dataset.view === id);
      });
      var titleNode = document.getElementById('view-title');
      if (titleNode) titleNode.textContent = view.title;
      document.title = view.title + ' • ' + Store.settings().name;

      var host = document.getElementById('view');
      host.scrollTop = 0;
      var result = view.render(host);
      if (typeof result === 'function') teardown = result;
      closeSidebar();
      refreshTodayStat();
    }
  };

  /* ------------------------------------------------------------ shell */

  function closeSidebar() {
    document.body.classList.remove('is-nav-open');
  }

  function refreshTodayStat() {
    var node = document.getElementById('today-sales');
    if (!node) return;
    Store.billsBetween(U.today(), U.today()).then(function (bills) {
      var sum = Store.summarise(bills);
      node.innerHTML = '<span class="topstat__label">Today</span>' +
        '<span class="topstat__value">' + Store.settings().currency + U.money(sum.net) + '</span>' +
        '<span class="topstat__sub">' + sum.bills + ' bills</span>';
    });
  }

  function refreshBrand() {
    var s = Store.settings();
    var name = document.getElementById('brand-name');
    var tag = document.getElementById('brand-tag');
    if (name) name.textContent = s.name;
    if (tag) tag.textContent = s.tagline;
    document.title = (App.Views[current] ? App.Views[current].title + ' • ' : '') + s.name;
  }

  function updateOnlineBadge() {
    var node = document.getElementById('net-state');
    if (!node) return;
    var offline = !navigator.onLine;
    node.textContent = offline ? 'Offline — working normally' : 'Online';
    node.className = 'netstate' + (offline ? ' is-offline' : '');
    node.title = 'This app never needs the internet. Your data stays on this device.';
  }

  function buildShell() {
    var s = Store.settings();
    var app = document.getElementById('app');
    app.innerHTML = '';

    var nav = U.el('nav', { class: 'nav', 'aria-label': 'Main' },
      NAV.map(function (n, i) {
        return U.el('a', {
          class: 'nav__item', href: '#/' + n.id, dataset: { view: n.id }, title: n.hint + '  (Alt+' + (i + 1) + ')'
        }, [
          U.el('span', { class: 'nav__icon', text: n.icon }),
          U.el('span', { class: 'nav__label', text: n.label })
        ]);
      })
    );

    var sidebar = U.el('aside', { class: 'sidebar', id: 'sidebar' }, [
      U.el('div', { class: 'brand' }, [
        U.el('span', { class: 'brand__mark', text: 'DA' }),
        U.el('span', { class: 'brand__text' }, [
          U.el('strong', { id: 'brand-name', text: s.name }),
          U.el('small', { id: 'brand-tag', text: s.tagline })
        ])
      ]),
      nav,
      U.el('div', { class: 'sidebar__foot' }, [
        U.el('div', { id: 'net-state', class: 'netstate' }),
        U.el('div', { class: 'sidebar__note', text: 'Data stored on this device' })
      ])
    ]);

    var header = U.el('header', { class: 'topbar' }, [
      U.el('button', {
        class: 'icon-btn nav-toggle', type: 'button', 'aria-label': 'Menu',
        onclick: function () { document.body.classList.toggle('is-nav-open'); }
      }, [U.el('span', { text: '☰' })]),
      U.el('h1', { id: 'view-title', class: 'topbar__title', text: 'Billing' }),
      U.el('div', { class: 'topbar__right' }, [
        U.el('div', { id: 'today-sales', class: 'topstat' }),
        U.el('div', { class: 'clock', id: 'clock' })
      ])
    ]);

    app.appendChild(sidebar);
    app.appendChild(U.el('div', { class: 'main' }, [
      header,
      U.el('main', { id: 'view', class: 'view' })
    ]));
    app.appendChild(U.el('div', { class: 'nav-scrim', onclick: closeSidebar }));

    var clock = document.getElementById('clock');
    function tick() {
      var now = new Date();
      clock.innerHTML = '<span class="clock__time">' + U.timeLabel(now.getTime()) + '</span>' +
        '<span class="clock__date">' + U.dateLabel(U.today(now)) + '</span>';
    }
    tick();
    setInterval(tick, 20000);

    window.addEventListener('online', updateOnlineBadge);
    window.addEventListener('offline', updateOnlineBadge);
    updateOnlineBadge();

    document.addEventListener('keydown', function (e) {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      var n = parseInt(e.key, 10);
      if (n >= 1 && n <= NAV.length) {
        e.preventDefault();
        Router.go(NAV[n - 1].id);
      }
    });

    window.addEventListener('hashchange', function () { Router.render(Router.current()); });
  }

  /* ------------------------------------------------------------- boot */

  function fatal(err) {
    document.getElementById('app').innerHTML =
      '<div class="boot boot--error"><h1>Could not start</h1><p>' + U.esc(err.message || String(err)) +
      '</p><p class="muted">If this browser blocks local storage (private-browsing mode, for example), ' +
      'open the app in a normal window.</p></div>';
  }

  function boot() {
    Store.boot().then(function () {
      buildShell();
      Router.render(Router.current());

      // Low-stock nudge, once per session.
      var low = Store.lowStock();
      if (low.length) {
        setTimeout(function () {
          UI.toast(low.length + ' item(s) low on stock — check Inventory', 'error', 5000);
        }, 1500);
      }
    }).catch(fatal);
  }

  App.Router = Router;
  App.Shell = { refreshBrand: refreshBrand, refreshTodayStat: refreshTodayStat };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  /* Service worker: makes the app load with no network at all. */
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* offline caching unavailable */ });
    });
  }
})(window.App = window.App || {});
