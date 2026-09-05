/*  views/bills.js — bill history: search, reprint, cancel, export. */
(function (App) {
  'use strict';

  var U = App.U, UI = App.UI, Store = App.Store;

  var range = { from: U.today(), to: U.today() };
  var query = '';
  var statusFilter = 'all';
  var root = null;
  var loaded = [];

  function preset(kind) {
    var t = U.today();
    if (kind === 'today') range = { from: t, to: t };
    else if (kind === 'yesterday') { var y = U.addDays(t, -1); range = { from: y, to: y }; }
    else if (kind === 'week') range = { from: U.addDays(t, -6), to: t };
    else if (kind === 'month') range = { from: U.month() + '-01', to: t };
    refresh();
  }

  function filtered() {
    return loaded.filter(function (b) {
      if (statusFilter !== 'all' && b.status !== statusFilter) return false;
      if (!query) return true;
      return U.match(b.billNo, query) || U.match(b.customerName || '', query) ||
        U.match(b.customerPhone || '', query) || U.match(b.tableNo || '', query);
    });
  }

  function statusBadge(b) {
    if (b.status === 'paid') return UI.badge('Paid', 'green');
    if (b.status === 'open') return UI.badge('Held', 'amber');
    return UI.badge('Cancelled', 'red');
  }

  function billDetail(bill) {
    var s = Store.settings();
    var rows = bill.items.map(function (l) {
      return '<tr><td>' + U.esc(l.name) +
        (l.variant && l.variant !== 'Plate' ? ' <em>(' + U.esc(l.variant) + ')</em>' : '') +
        (l.note ? '<div class="muted">↳ ' + U.esc(l.note) + '</div>' : '') +
        '</td><td class="ta-center">' + l.qty + '</td>' +
        '<td class="ta-right">' + U.money(l.price) + '</td>' +
        '<td class="ta-right">' + U.money(l.amount) + '</td></tr>';
    }).join('');

    var sums = [['Sub Total', bill.subtotal]];
    if (bill.discount > 0) sums.push(['Discount', -bill.discount]);
    if (bill.serviceCharge > 0) sums.push(['Service Charge', bill.serviceCharge]);
    if (bill.tax > 0) sums.push(['GST ' + bill.gstRate + '%', bill.tax]);
    if (bill.roundOff) sums.push(['Round Off', bill.roundOff]);

    var html = '<div class="bill-detail">' +
      '<div class="bill-detail__head"><div><strong>' + U.esc(bill.billNo) + '</strong>' +
      '<div class="muted">' + U.esc(U.dateTimeLabel(bill.createdAt)) + '</div></div>' +
      '<div class="ta-right">' + statusBadge(bill) +
      '<div class="muted">' + U.esc(bill.orderType || 'Dine-In') +
      (bill.tableNo ? ' • Table ' + U.esc(bill.tableNo) : '') + '</div></div></div>' +
      ((bill.customerName || bill.customerPhone)
        ? '<p class="muted">Customer: ' + U.esc([bill.customerName, bill.customerPhone].filter(Boolean).join(' • ')) + '</p>' : '') +
      '<div class="table-wrap"><table class="table"><thead><tr><th>Item</th>' +
      '<th class="ta-center">Qty</th><th class="ta-right">Rate</th><th class="ta-right">Amount</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<div class="bill-detail__sums">' +
      sums.map(function (r) {
        return '<div class="sum-row"><span>' + U.esc(r[0]) + '</span><span>' +
          (r[1] < 0 ? '− ' : '') + s.currency + U.money(Math.abs(r[1])) + '</span></div>';
      }).join('') +
      '<div class="sum-row sum-row--total"><span>Total</span><span>' + s.currency + U.money(bill.total) + '</span></div>' +
      '<div class="sum-row"><span>Payment</span><span>' + U.esc(bill.paymentMode || 'Cash') + '</span></div>' +
      (bill.tendered ? '<div class="sum-row"><span>Received / Change</span><span>' +
        s.currency + U.money(bill.tendered) + ' / ' + s.currency + U.money(bill.change || 0) + '</span></div>' : '') +
      '</div></div>';

    var actions = [{ label: 'Close', value: null }];
    if (bill.status !== 'cancelled') {
      actions.push({
        label: 'Cancel bill', kind: 'danger',
        onClick: function (close) {
          return UI.confirm('Cancel ' + bill.billNo + '?',
            'The bill stays in the records but stops counting towards sales.', 'Cancel bill', true)
            .then(function (yes) {
              if (!yes) return false;
              bill.status = 'cancelled';
              return Store.saveBill(bill).then(function () {
                UI.ok(bill.billNo + ' cancelled.');
                close(null);
                refresh();
                return true;
              });
            });
        }
      });
    }
    actions.push({ label: 'Print A4', onClick: function () { App.Receipt.print(bill, s, 'a4'); return false; } });
    actions.push({ label: 'Print Receipt', primary: true, onClick: function () { App.Receipt.print(bill, s, '80mm'); return false; } });

    UI.modal({ title: 'Bill ' + bill.billNo, size: 'lg', body: U.el('div', { html: html }), actions: actions });
  }

  function exportCSV() {
    var rows = [['Bill No', 'Date', 'Time', 'Type', 'Table', 'Customer', 'Phone', 'Items', 'Qty',
      'Sub Total', 'Discount', 'Service Charge', 'GST', 'Round Off', 'Total', 'Payment', 'Status']];
    filtered().forEach(function (b) {
      rows.push([b.billNo, b.date, U.timeLabel(b.createdAt), b.orderType || '', b.tableNo || '',
        b.customerName || '', b.customerPhone || '',
        (b.items || []).map(function (l) { return l.name + (l.variant !== 'Plate' ? ' (' + l.variant + ')' : '') + ' x' + l.qty; }).join('; '),
        b.qty, b.subtotal, b.discount, b.serviceCharge, b.tax, b.roundOff, b.total,
        b.paymentMode || '', b.status]);
    });
    U.download('bills-' + range.from + '_to_' + range.to + '.csv', U.toCSV(rows), 'text/csv;charset=utf-8');
    UI.ok('Exported ' + (rows.length - 1) + ' bills.');
  }

  function renderList() {
    var host = root.querySelector('#bills-list');
    var statsHost = root.querySelector('#bills-stats');
    var rows = filtered();
    var s = Store.settings();
    var sum = Store.summarise(rows);

    statsHost.innerHTML = '';
    [
      UI.stat('Net Sales', s.currency + U.money(sum.net), sum.bills + ' paid bills', 'primary'),
      UI.stat('Average Bill', s.currency + U.money(sum.avg), 'per paid bill'),
      UI.stat('Discount Given', s.currency + U.money(sum.discount), 'across the range'),
      UI.stat('Held / Cancelled', sum.open + ' / ' + sum.cancelled, 'not counted in sales', sum.open ? 'warn' : '')
    ].forEach(function (n) { statsHost.appendChild(n); });

    host.innerHTML = '';
    host.appendChild(UI.table([
      { key: 'billNo', label: 'Bill No', width: '110px',
        render: function (b) { return '<strong>' + U.esc(b.billNo) + '</strong>'; } },
      { key: 'date', label: 'Date & Time', width: '170px',
        render: function (b) { return U.esc(U.dateLabel(b.date)) + '<div class="muted">' + U.esc(U.timeLabel(b.createdAt)) + '</div>'; } },
      { key: 'orderType', label: 'Order', width: '120px',
        render: function (b) {
          return U.esc(b.orderType || 'Dine-In') + (b.tableNo ? '<div class="muted">Table ' + U.esc(b.tableNo) + '</div>' : '');
        } },
      { key: 'customerName', label: 'Customer',
        render: function (b) {
          if (!b.customerName && !b.customerPhone) return '<span class="muted">Walk-in</span>';
          return U.esc(b.customerName || '') + (b.customerPhone ? '<div class="muted">' + U.esc(b.customerPhone) + '</div>' : '');
        } },
      { key: 'qty', label: 'Items', align: 'center', width: '70px',
        render: function (b) { return (b.items || []).length + '<div class="muted">' + b.qty + ' qty</div>'; } },
      { key: 'paymentMode', label: 'Payment', width: '90px',
        render: function (b) { return U.esc(b.paymentMode || 'Cash'); } },
      { key: 'status', label: 'Status', width: '100px', render: statusBadge },
      { key: 'total', label: 'Total', align: 'right', width: '110px',
        render: function (b) { return '<strong>' + s.currency + U.money(b.total) + '</strong>'; },
        footer: function (rs) {
          return '<strong>' + s.currency + U.money(U.sum(rs.filter(function (b) { return b.status === 'paid'; }), function (b) { return b.total; })) + '</strong>';
        } },
      { key: 'act', label: '', align: 'right', width: '140px',
        render: function (b) {
          return '<button type="button" class="link-btn" data-act="view" data-id="' + U.esc(b.id) + '">View</button>' +
            '<button type="button" class="link-btn" data-act="print" data-id="' + U.esc(b.id) + '">Print</button>';
        } }
    ], rows, {
      empty: 'No bills in this period.',
      footer: true,
      rowClass: function (b) { return b.status === 'cancelled' ? 'is-void' : ''; }
    }));
  }

  function refresh() {
    if (!root) return;
    var f = root.querySelector('#from-date'), t = root.querySelector('#to-date');
    if (f) f.value = range.from;
    if (t) t.value = range.to;
    return Store.billsBetween(range.from, range.to).then(function (rows) {
      loaded = rows;
      renderList();
    });
  }

  function render(container) {
    root = container;
    container.innerHTML = '';

    var head = UI.section('Bills & Orders', 'Every bill is stored on this device.', [
      UI.button('Export CSV', exportCSV, 'btn--ghost', '⬇'),
      UI.button('Day Summary', function () { App.Router.go('reports'); }, 'btn--ghost', '📊')
    ]);

    var filters = U.el('div', { class: 'filters card' }, [
      U.el('div', { class: 'filters__group' }, [
        U.el('label', { class: 'field__label', text: 'From' }),
        U.el('input', { id: 'from-date', class: 'input', type: 'date', value: range.from,
          onchange: function (e) { range.from = e.target.value || range.from; refresh(); } })
      ]),
      U.el('div', { class: 'filters__group' }, [
        U.el('label', { class: 'field__label', text: 'To' }),
        U.el('input', { id: 'to-date', class: 'input', type: 'date', value: range.to,
          onchange: function (e) { range.to = e.target.value || range.to; refresh(); } })
      ]),
      U.el('div', { class: 'filters__group filters__group--grow' }, [
        U.el('label', { class: 'field__label', text: 'Search' }),
        U.el('input', { class: 'input', type: 'search', placeholder: 'Bill no, customer, phone or table…',
          oninput: U.debounce(function (e) { query = e.target.value.trim(); renderList(); }, 150) })
      ]),
      U.el('div', { class: 'filters__group' }, [
        U.el('label', { class: 'field__label', text: 'Status' }),
        U.el('select', { class: 'input', onchange: function (e) { statusFilter = e.target.value; renderList(); } },
          [['all', 'All'], ['paid', 'Paid'], ['open', 'Held'], ['cancelled', 'Cancelled']].map(function (o) {
            return U.el('option', { value: o[0], text: o[1] });
          }))
      ]),
      U.el('div', { class: 'filters__presets' }, [
        UI.button('Today', function () { preset('today'); }, 'btn--chip'),
        UI.button('Yesterday', function () { preset('yesterday'); }, 'btn--chip'),
        UI.button('7 Days', function () { preset('week'); }, 'btn--chip'),
        UI.button('This Month', function () { preset('month'); }, 'btn--chip')
      ])
    ]);

    container.appendChild(head);
    container.appendChild(filters);
    container.appendChild(U.el('div', { id: 'bills-stats', class: 'stat-grid' }));
    container.appendChild(U.el('div', { id: 'bills-list', class: 'card card--flush' }));

    U.on(container, 'click', '[data-act]', function (e, btn) {
      var bill = loaded.filter(function (b) { return b.id === btn.dataset.id; })[0];
      if (!bill) return;
      if (btn.dataset.act === 'view') billDetail(bill);
      else App.Receipt.print(bill, Store.settings());
    });

    refresh();
  }

  App.Views = App.Views || {};
  App.Views.bills = { title: 'Bills', render: render };
})(window.App = window.App || {});
