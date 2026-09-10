/*  views/dues.js — Udhaar khata.
 *  Who owes the dhaba money, how much, since when — and taking payment
 *  against it. Payments clear the oldest bill first, the way a paper khata
 *  is settled.
 */
(function (App) {
  'use strict';

  var U = App.U, UI = App.UI, Store = App.Store;

  var groups = [];
  var query = '';
  var root = null;

  function filtered() {
    if (!query) return groups;
    return groups.filter(function (g) {
      return U.match(g.name, query) || U.match(g.phone, query);
    });
  }

  /* ------------------------------------------------------- payment */

  function takePayment(group) {
    var form = UI.form([
      { name: 'amount', label: 'Amount received (₹)', type: 'number', min: 0, step: '1',
        value: group.due, required: true, autofocus: true, width: 'half' },
      { name: 'mode', label: 'Received by', type: 'select', value: 'Cash', width: 'half',
        options: ['Cash', 'UPI', 'Card', 'Bank'].map(function (m) { return { value: m, label: m }; }) },
      { name: 'date', label: 'Date', type: 'date', value: U.today(), width: 'half' },
      { name: 'note', label: 'Note', type: 'text', placeholder: 'Optional' }
    ]);

    var body = U.el('div', {}, [
      U.el('div', { class: 'settle__total' }, [
        U.el('span', { text: group.name + ' owes' }),
        U.el('strong', { text: '₹' + U.money(group.due) })
      ]),
      form.node,
      U.el('p', { class: 'muted', text: 'The payment clears the oldest bill first. A part payment is fine — the rest stays outstanding.' })
    ]);

    UI.modal({
      title: 'Receive payment', body: body,
      actions: [
        { label: 'Cancel', value: false },
        {
          label: 'Receive', primary: true,
          onClick: function (close) {
            if (!form.validate()) return false;
            var v = form.values();
            return Store.recordDuePayment(group.key, v.amount, {
              mode: v.mode, date: v.date, note: v.note
            }).then(function (applied) {
              var cleared = applied.filter(function (a) { return a.cleared; }).length;
              UI.ok('₹' + U.money(v.amount) + ' received — ' + applied.length + ' bill(s) updated' +
                (cleared ? ', ' + cleared + ' cleared' : ''));
              close(true);
              load();
              return true;
            });
          }
        }
      ]
    });
  }

  /* -------------------------------------------------------- details */

  function details(group) {
    var s = Store.settings();

    var billRows = UI.table([
      { key: 'billNo', label: 'Bill', width: '110px',
        render: function (b) { return '<strong>' + U.esc(b.billNo) + '</strong>'; } },
      { key: 'date', label: 'Date', width: '130px',
        render: function (b) { return U.esc(U.dateLabel(b.date)); } },
      { key: 'age', label: 'Age', align: 'center', width: '90px',
        render: function (b) {
          var days = Math.round((U.parseDate(U.today()) - U.parseDate(b.date)) / 86400000);
          return days === 0 ? 'Today' : days + ' day' + (days === 1 ? '' : 's');
        } },
      { key: 'total', label: 'Bill', align: 'right', width: '100px',
        render: function (b) { return s.currency + U.money(b.total); } },
      { key: 'received', label: 'Paid', align: 'right', width: '100px',
        render: function (b) { return U.num(b.received) ? s.currency + U.money(b.received) : '<span class="muted">—</span>'; } },
      { key: 'dueAmount', label: 'Outstanding', align: 'right', width: '120px',
        render: function (b) { return '<strong class="is-low">' + s.currency + U.money(b.dueAmount) + '</strong>'; },
        footer: function (rs) { return '<strong class="is-low">' + s.currency + U.money(U.sum(rs, function (b) { return U.num(b.dueAmount); })) + '</strong>'; } }
    ], group.bills, { footer: true, empty: 'Nothing outstanding.' });

    var edit = UI.form([
      { name: 'name', label: 'Name', type: 'text', value: group.name, width: 'half' },
      { name: 'phone', label: 'Phone', type: 'tel', value: group.phone, width: 'half' },
      { name: 'address', label: 'Address', type: 'text', value: group.address },
      { name: 'note', label: 'Note', type: 'text', value: group.note, placeholder: 'e.g. neighbour, pays every Sunday' }
    ]);

    UI.modal({
      title: group.name + ' — udhaar khata',
      size: 'lg',
      body: U.el('div', {}, [
        U.el('div', { class: 'settle__total' }, [
          U.el('span', { text: 'Outstanding' }),
          U.el('strong', { text: s.currency + U.money(group.due) })
        ]),
        billRows,
        U.el('div', { class: 'panel__head panel__head--sub' }, [U.el('h3', { text: 'Customer details' })]),
        edit.node
      ]),
      actions: [
        { label: 'Close', value: null },
        {
          label: 'Save details',
          onClick: function () {
            var v = edit.values();
            return Store.saveCustomer({ id: group.key, name: v.name, phone: v.phone, address: v.address, note: v.note })
              .then(function () { UI.ok('Customer details saved.'); load(); return false; });
          }
        },
        { label: 'Receive payment', primary: true, onClick: function (close) { close(null); takePayment(group); return false; } }
      ]
    });
  }

  function printKhata() {
    var s = Store.settings();
    var list = filtered();
    var rows = list.map(function (g) {
      return '<tr><td>' + U.esc(g.name) + (g.phone ? '<div class="m">' + U.esc(g.phone) + '</div>' : '') + '</td>' +
        '<td class="c">' + g.bills.length + '</td>' +
        '<td class="c">' + U.esc(U.dateLabel(g.oldest)) + '</td>' +
        '<td class="r">₹' + U.money(g.due) + '</td></tr>';
    }).join('') || '<tr><td colspan="4">Nobody owes anything.</td></tr>';

    UI.print('<!doctype html><html><head><meta charset="utf-8"><title>Udhaar khata</title><style>' +
      '@page{size:A4;margin:14mm}body{font-family:"Segoe UI",Arial,sans-serif;color:#14181f}' +
      'h1{font-size:22px;color:#1d2b45;margin:0}.tag{color:#b0311f;font-weight:600}' +
      '.period{color:#5a6472;font-size:12px;margin:4px 0 16px}' +
      'table{width:100%;border-collapse:collapse;font-size:12.5px}' +
      'th{background:#1d2b45;color:#fff;text-align:left;padding:7px 10px;font-size:10px;text-transform:uppercase}' +
      'td{padding:7px 10px;border-bottom:1px solid #e9ecf1}.r{text-align:right}.c{text-align:center}' +
      '.m{color:#8a94a3;font-size:11px}tfoot td{border-top:2px solid #1d2b45;font-weight:800;font-size:15px;color:#1d2b45}' +
      '</style></head><body><h1>' + U.esc(s.name) + '</h1><div class="tag">' + U.esc(s.tagline) + '</div>' +
      '<div class="period">Udhaar khata • ' + U.esc(U.dateLabel(U.today())) + '</div>' +
      '<table><thead><tr><th>Customer</th><th class="c">Bills</th><th class="c">Since</th><th class="r">Outstanding</th></tr></thead>' +
      '<tbody>' + rows + '</tbody>' +
      '<tfoot><tr><td colspan="3">Total outstanding</td><td class="r">₹' +
      U.money(U.sum(list, function (g) { return g.due; })) + '</td></tr></tfoot></table>' +
      '</body></html>', 'Udhaar khata');
  }

  /* --------------------------------------------------------- render */

  function draw() {
    var s = Store.settings();
    var list = filtered();
    var totalDue = U.round2(U.sum(groups, function (g) { return g.due; }));
    var oldest = groups.reduce(function (acc, g) { return !acc || g.oldest < acc ? g.oldest : acc; }, '');
    var overdue = groups.filter(function (g) {
      return (U.parseDate(U.today()) - U.parseDate(g.oldest)) / 86400000 > 30;
    });

    var statsHost = root.querySelector('#due-stats');
    statsHost.innerHTML = '';
    [
      UI.stat('Total Udhaar', s.currency + U.money(totalDue), groups.length + ' customers', totalDue > 0 ? 'warn' : 'primary'),
      UI.stat('Open Bills', String(U.sum(groups, function (g) { return g.bills.length; })), 'not yet settled'),
      UI.stat('Oldest', oldest ? U.dateLabel(oldest) : '—', oldest ? 'first unpaid bill' : 'nothing pending'),
      UI.stat('Over 30 Days', String(overdue.length), overdue.length ? 'follow these up' : 'all recent', overdue.length ? 'danger' : '')
    ].forEach(function (n) { statsHost.appendChild(n); });

    var host = root.querySelector('#due-list');
    host.innerHTML = '';

    if (!groups.length) {
      host.appendChild(UI.empty('✅', 'No udhaar pending',
        'When a bill is settled as “Due (Udhaar)”, the customer appears here with the amount owing.'));
      return;
    }

    host.appendChild(UI.table([
      { key: 'name', label: 'Customer',
        render: function (g) {
          return '<div class="who"><span class="avatar">' + U.esc(g.name.slice(0, 1).toUpperCase()) + '</span>' +
            '<div><strong>' + U.esc(g.name) + '</strong>' +
            (g.phone ? '<div class="muted">' + U.esc(g.phone) + '</div>' : '') + '</div></div>';
        } },
      { key: 'bills', label: 'Bills', align: 'center', width: '80px',
        render: function (g) { return String(g.bills.length); } },
      { key: 'oldest', label: 'Since', width: '140px',
        render: function (g) {
          var days = Math.round((U.parseDate(U.today()) - U.parseDate(g.oldest)) / 86400000);
          return U.esc(U.dateLabel(g.oldest)) + '<div class="muted">' + (days === 0 ? 'today' : days + ' days ago') + '</div>';
        } },
      { key: 'billed', label: 'Billed', align: 'right', width: '110px',
        render: function (g) { return s.currency + U.money(g.billed); } },
      { key: 'due', label: 'Outstanding', align: 'right', width: '130px',
        render: function (g) { return '<strong class="is-low">' + s.currency + U.money(g.due) + '</strong>'; },
        footer: function (rs) { return '<strong class="is-low">' + s.currency + U.money(U.sum(rs, function (g) { return g.due; })) + '</strong>'; } },
      { key: 'act', label: '', align: 'right', width: '190px', className: 'nowrap',
        render: function (g) {
          return '<button type="button" class="link-btn" data-act="view" data-key="' + U.esc(g.key) + '">Details</button>' +
            '<button type="button" class="btn btn--chip btn--primary" data-act="pay" data-key="' + U.esc(g.key) + '">Receive ₹</button>';
        } }
    ], list, { empty: 'No customer matches that search.', footer: true }));
  }

  function load() {
    if (!root) return Promise.resolve();
    return Store.dueLedger().then(function (list) {
      groups = list;
      draw();
      App.Shell.refreshTodayStat();
    });
  }

  function render(container) {
    root = container;
    container.innerHTML = '';

    container.appendChild(UI.section('Udhaar / Dues', 'Who owes the dhaba, and how much.', [
      UI.button('Print Khata', printKhata, 'btn--ghost', '🖨'),
      UI.button('Go to Billing', function () { App.Router.go('pos'); }, 'btn--primary', '🧾')
    ]));

    container.appendChild(U.el('div', { id: 'due-stats', class: 'stat-grid' }));

    container.appendChild(U.el('div', { class: 'filters card' }, [
      U.el('div', { class: 'filters__group filters__group--grow' }, [
        U.el('label', { class: 'field__label', text: 'Search' }),
        U.el('input', { class: 'input', type: 'search', placeholder: 'Customer name or phone…',
          oninput: U.debounce(function (e) { query = e.target.value.trim(); draw(); }, 150) })
      ]),
      U.el('div', { class: 'filters__group' }, [
        U.el('label', { class: 'field__label', text: 'How it works' }),
        U.el('div', { class: 'filters__note', text: 'Settle a bill as “Due (Udhaar)” to add it here.' })
      ])
    ]));

    container.appendChild(U.el('div', { id: 'due-list', class: 'card card--flush' }));

    U.on(container, 'click', '[data-act]', function (e, btn) {
      var group = groups.filter(function (g) { return g.key === btn.dataset.key; })[0];
      if (!group) return;
      if (btn.dataset.act === 'view') details(group);
      else takePayment(group);
    });

    load();
  }

  App.Views = App.Views || {};
  App.Views.dues = { title: 'Udhaar', render: render };
})(window.App = window.App || {});
