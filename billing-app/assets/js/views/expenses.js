/*  views/expenses.js — shop spending (kharcha).
 *  Everything that goes OUT of the till: sabzi, gas, rent, repairs, wages.
 *  Sales minus this is what the dhaba actually made.
 */
(function (App) {
  'use strict';

  var U = App.U, UI = App.UI, Store = App.Store;

  var range = { from: U.month() + '-01', to: U.today() };
  var query = '', catFilter = 'all';
  var rows = [];
  var root = null;

  function preset(kind) {
    var t = U.today();
    if (kind === 'today') range = { from: t, to: t };
    else if (kind === 'week') range = { from: U.addDays(t, -6), to: t };
    else if (kind === 'month') range = { from: U.month() + '-01', to: t };
    else if (kind === 'last') {
      var end = U.addDays(U.month() + '-01', -1);
      range = { from: end.slice(0, 7) + '-01', to: end };
    }
    load();
  }

  /* ----------------------------------------------------------- editor */

  function editor(existing) {
    var exp = existing || {
      date: U.today(), cat: 'Vegetables', amount: '', paidTo: '',
      paidBy: '', mode: 'Cash', note: ''
    };

    var staffOptions = [{ value: '', label: 'Owner / counter' }].concat(
      Store.activeEmployees().map(function (e) { return { value: e.id, label: e.name }; }));

    var form = UI.form([
      { name: 'amount', label: 'Amount (₹)', type: 'number', value: exp.amount, min: 0, step: '1',
        width: 'half', required: true, autofocus: true },
      { name: 'cat', label: 'Kis cheez ka kharcha', type: 'select', value: exp.cat, width: 'half',
        options: Store.EXPENSE_CATS.map(function (c) { return { value: c, label: c }; }) },
      { name: 'date', label: 'Date', type: 'date', value: exp.date, width: 'half' },
      { name: 'mode', label: 'Paid by', type: 'select', value: exp.mode, width: 'half',
        options: ['Cash', 'UPI', 'Card', 'Bank'].map(function (m) { return { value: m, label: m }; }) },
      { name: 'paidTo', label: 'Paid to (shop / vendor)', type: 'text', value: exp.paidTo, width: 'half',
        placeholder: 'e.g. Sharma Traders' },
      { name: 'paidBy', label: 'Who spent it', type: 'select', value: exp.paidBy, width: 'half',
        options: staffOptions, hint: 'Staff money taken as advance goes in the Staff screen instead.' },
      { name: 'note', label: 'Note', type: 'text', value: exp.note, placeholder: 'Optional' }
    ]);

    UI.modal({
      title: existing ? 'Edit expense' : 'Add expense',
      body: form.node,
      actions: [
        { label: 'Cancel', value: false },
        {
          label: 'Save', primary: true,
          onClick: function (close) {
            if (!form.validate()) return false;
            var v = form.values();
            return Store.saveExpense(Object.assign({}, exp, v)).then(function () {
              UI.ok('₹' + U.money(v.amount) + ' recorded.');
              close(true);
              load();
              return true;
            });
          }
        }
      ]
    });
  }

  /* ------------------------------------------------------- quick add */

  // The four things a dhaba pays for most, one tap away.
  function quickAdd(cat) {
    var form = UI.form([
      { name: 'amount', label: 'Amount (₹)', type: 'number', min: 0, step: '1', required: true,
        autofocus: true, width: 'half' },
      { name: 'paidTo', label: 'Paid to', type: 'text', width: 'half', placeholder: 'Optional' },
      { name: 'note', label: 'Note', type: 'text', placeholder: 'Optional' }
    ]);
    UI.modal({
      title: cat, size: 'sm', body: form.node,
      actions: [
        { label: 'Cancel', value: false },
        {
          label: 'Save', primary: true,
          onClick: function (close) {
            if (!form.validate()) return false;
            var v = form.values();
            return Store.saveExpense({ cat: cat, amount: v.amount, paidTo: v.paidTo, note: v.note })
              .then(function () {
                UI.ok(cat + ': ₹' + U.money(v.amount));
                close(true);
                load();
                return true;
              });
          }
        }
      ]
    });
  }

  /* ---------------------------------------------------------- render */

  function filtered() {
    return rows.filter(function (e) {
      if (catFilter !== 'all' && e.cat !== catFilter) return false;
      if (!query) return true;
      return U.match(e.cat, query) || U.match(e.paidTo || '', query) ||
        U.match(e.note || '', query) || U.match(e.paidByName || '', query);
    });
  }

  function exportCSV() {
    var out = [['Date', 'Category', 'Amount', 'Paid To', 'Spent By', 'Mode', 'Note']];
    filtered().forEach(function (e) {
      out.push([e.date, e.cat, e.amount, e.paidTo || '', e.paidByName || '', e.mode, e.note || '']);
    });
    U.download('expenses-' + range.from + '_to_' + range.to + '.csv', U.toCSV(out), 'text/csv;charset=utf-8');
    UI.ok('Exported ' + (out.length - 1) + ' expenses.');
  }

  function draw() {
    var s = Store.settings();
    var list = filtered();
    var sum = Store.summariseExpenses(list);

    // Sales for the same window, so the screen can show what is actually left.
    Store.billsBetween(range.from, range.to).then(function (bills) {
      var sales = Store.summarise(bills);
      var statsHost = root.querySelector('#exp-stats');
      if (!statsHost) return;
      var profit = U.round2(sales.net - sum.total);
      statsHost.innerHTML = '';
      [
        UI.stat('Total Spent', s.currency + U.money(sum.total), sum.count + ' entries', 'danger'),
        UI.stat('Sales', s.currency + U.money(sales.net), sales.bills + ' bills'),
        UI.stat(profit >= 0 ? 'Left Over' : 'Short By', s.currency + U.money(Math.abs(profit)),
          'sales − kharcha', profit >= 0 ? 'primary' : 'danger'),
        UI.stat('Biggest Head', Object.keys(sum.byCat).sort(function (a, b) { return sum.byCat[b] - sum.byCat[a]; })[0] || '—',
          Object.keys(sum.byCat).length + ' categories', 'warn')
      ].forEach(function (n) { statsHost.appendChild(n); });
    });

    var host = root.querySelector('#exp-list');
    host.innerHTML = '';
    host.appendChild(UI.table([
      { key: 'date', label: 'Date', width: '150px',
        render: function (e) { return U.esc(U.dateLabel(e.date)) + '<div class="muted">' + U.esc(U.timeLabel(e.createdAt)) + '</div>'; } },
      { key: 'cat', label: 'Category', width: '150px',
        render: function (e) { return '<span class="cat-pill">' + U.esc(e.cat) + '</span>'; } },
      { key: 'paidTo', label: 'Paid To / Note',
        render: function (e) {
          var main = e.paidTo || e.note || '—';
          return U.esc(main) + (e.paidTo && e.note ? '<div class="muted">' + U.esc(e.note) + '</div>' : '');
        } },
      { key: 'paidByName', label: 'Spent By', width: '140px',
        render: function (e) { return U.esc(e.paidByName || 'Owner'); } },
      { key: 'mode', label: 'Mode', width: '90px', render: function (e) { return U.esc(e.mode); } },
      { key: 'amount', label: 'Amount', align: 'right', width: '120px',
        render: function (e) { return '<strong>' + s.currency + U.money(e.amount) + '</strong>'; },
        footer: function (rs) { return '<strong>' + s.currency + U.money(U.sum(rs, function (e) { return e.amount; })) + '</strong>'; } },
      { key: 'act', label: '', align: 'right', width: '120px', className: 'nowrap',
        render: function (e) {
          return '<button type="button" class="link-btn" data-act="edit" data-id="' + U.esc(e.id) + '">Edit</button>' +
            '<button type="button" class="link-btn link-btn--danger" data-act="del" data-id="' + U.esc(e.id) + '">Delete</button>';
        } }
    ], list, { empty: 'No expenses recorded in this period.', footer: true }));

    // category breakdown
    var splitHost = root.querySelector('#exp-split');
    splitHost.innerHTML = '';
    var cats = Object.keys(sum.byCat).map(function (c) { return { name: c, value: sum.byCat[c] }; })
      .sort(function (a, b) { return b.value - a.value; });
    var total = sum.total || 1;
    splitHost.appendChild(U.el('div', { class: 'panel__head' }, [U.el('h3', { text: 'Where the money went' })]));
    var bars = U.el('div', { class: 'share' });
    cats.forEach(function (c) {
      var pct = Math.round(c.value / total * 100);
      bars.appendChild(U.el('div', { class: 'share__row' }, [
        U.el('span', { class: 'share__name', text: c.name }),
        U.el('span', { class: 'share__track' }, [
          U.el('span', { class: 'share__fill share__fill--spend', style: 'width:' + Math.max(pct, 1) + '%' })
        ]),
        U.el('span', { class: 'share__val', text: '₹' + U.moneyShort(c.value) + ' · ' + pct + '%' })
      ]));
    });
    if (!cats.length) bars.appendChild(U.el('p', { class: 'muted', text: 'Nothing spent in this period.' }));
    splitHost.appendChild(bars);
  }

  function load() {
    if (!root) return Promise.resolve();
    var f = root.querySelector('#exp-from'), t = root.querySelector('#exp-to');
    if (f) f.value = range.from;
    if (t) t.value = range.to;
    return Store.expensesBetween(range.from, range.to).then(function (list) {
      rows = list;
      draw();
    });
  }

  function render(container) {
    root = container;
    container.innerHTML = '';

    container.appendChild(UI.section('Expenses / Kharcha', 'Everything that goes out of the counter.', [
      UI.button('Export CSV', exportCSV, 'btn--ghost', '⬇'),
      UI.button('Add Expense', function () { editor(null); }, 'btn--primary', '＋')
    ]));

    container.appendChild(U.el('div', { class: 'quick-spend' },
      ['Vegetables', 'Grocery', 'Meat & Fish', 'Gas & Fuel'].map(function (c) {
        return U.el('button', { type: 'button', class: 'quick-spend__btn', onclick: function () { quickAdd(c); } }, [
          U.el('span', { class: 'quick-spend__label', text: c }),
          U.el('span', { class: 'quick-spend__plus', text: '＋' })
        ]);
      })
    ));

    container.appendChild(U.el('div', { id: 'exp-stats', class: 'stat-grid' }));

    container.appendChild(U.el('div', { class: 'filters card' }, [
      U.el('div', { class: 'filters__group' }, [
        U.el('label', { class: 'field__label', text: 'From' }),
        U.el('input', { id: 'exp-from', class: 'input', type: 'date', value: range.from,
          onchange: function (e) { range.from = e.target.value || range.from; load(); } })
      ]),
      U.el('div', { class: 'filters__group' }, [
        U.el('label', { class: 'field__label', text: 'To' }),
        U.el('input', { id: 'exp-to', class: 'input', type: 'date', value: range.to,
          onchange: function (e) { range.to = e.target.value || range.to; load(); } })
      ]),
      U.el('div', { class: 'filters__group filters__group--grow' }, [
        U.el('label', { class: 'field__label', text: 'Search' }),
        U.el('input', { class: 'input', type: 'search', placeholder: 'Vendor, note or category…',
          oninput: U.debounce(function (e) { query = e.target.value.trim(); draw(); }, 150) })
      ]),
      U.el('div', { class: 'filters__group' }, [
        U.el('label', { class: 'field__label', text: 'Category' }),
        U.el('select', { class: 'input', onchange: function (e) { catFilter = e.target.value; draw(); } },
          [U.el('option', { value: 'all', text: 'All' })].concat(
            Store.EXPENSE_CATS.map(function (c) { return U.el('option', { value: c, text: c }); })))
      ]),
      U.el('div', { class: 'filters__presets' }, [
        UI.button('Today', function () { preset('today'); }, 'btn--chip'),
        UI.button('7 Days', function () { preset('week'); }, 'btn--chip'),
        UI.button('This Month', function () { preset('month'); }, 'btn--chip'),
        UI.button('Last Month', function () { preset('last'); }, 'btn--chip')
      ])
    ]));

    container.appendChild(U.el('div', { id: 'exp-split', class: 'card panel' }));
    container.appendChild(U.el('div', { id: 'exp-list', class: 'card card--flush' }));

    U.on(container, 'click', '[data-act]', function (e, btn) {
      var exp = rows.filter(function (x) { return x.id === btn.dataset.id; })[0];
      if (!exp) return;
      if (btn.dataset.act === 'edit') editor(exp);
      else {
        UI.confirm('Delete this expense?', '₹' + U.money(exp.amount) + ' — ' + exp.cat, 'Delete', true)
          .then(function (yes) {
            if (!yes) return;
            Store.removeExpense(exp.id).then(function () { UI.ok('Expense deleted.'); load(); });
          });
      }
    });

    load();
  }

  App.Views = App.Views || {};
  App.Views.expenses = { title: 'Expenses', render: render };
})(window.App = window.App || {});
