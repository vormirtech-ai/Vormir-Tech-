/*  views/inventory.js — pantry stock: on-hand counts, purchases, usage,
 *  wastage and a full movement ledger.
 */
(function (App) {
  'use strict';

  var U = App.U, UI = App.UI, Store = App.Store;

  var tab = 'stock';
  var query = '', catFilter = 'all', lowOnly = false;
  var moveRange = { from: U.addDays(U.today(), -6), to: U.today() };
  var moves = [];
  var root = null;

  var MOVE_META = {
    in:      { label: 'Purchase / Stock In', badge: 'green', sign: '+' },
    out:     { label: 'Used / Issued',       badge: 'blue',  sign: '−' },
    wastage: { label: 'Wastage',             badge: 'red',   sign: '−' },
    adjust:  { label: 'Stock Count',         badge: 'amber', sign: '=' }
  };

  function categories() {
    var set = {};
    Store.inventory().forEach(function (i) { set[i.cat || 'Other'] = true; });
    return Object.keys(set).sort();
  }

  /* ---------------------------------------------------- item editor */

  function itemEditor(existing) {
    var item = existing || { name: '', cat: 'Grocery', unit: 'kg', stock: 0, min: 0, cost: 0, supplier: '', active: true };
    var form = UI.form([
      { name: 'name', label: 'Item name', type: 'text', value: item.name, required: true, width: 'half', autofocus: true },
      { name: 'cat', label: 'Category', type: 'text', value: item.cat, width: 'half', placeholder: 'Grocery, Dairy, Meat…' },
      { name: 'unit', label: 'Unit', type: 'select', value: item.unit, width: 'third',
        options: ['kg', 'gm', 'ltr', 'ml', 'pcs', 'pkt', 'box', 'bag'].map(function (u) { return { value: u, label: u }; }) },
      { name: 'stock', label: existing ? 'Stock on hand' : 'Opening stock', type: 'number', value: item.stock, width: 'third', min: 0, step: '0.01' },
      { name: 'min', label: 'Low-stock alert at', type: 'number', value: item.min, width: 'third', min: 0, step: '0.01' },
      { name: 'cost', label: 'Cost per unit (₹)', type: 'number', value: item.cost, width: 'half', min: 0, step: '0.01' },
      { name: 'supplier', label: 'Supplier', type: 'text', value: item.supplier, width: 'half' },
      { name: 'active', label: 'Track this item', type: 'checkbox', value: item.active !== false }
    ]);

    UI.modal({
      title: existing ? 'Edit ' + item.name : 'New inventory item',
      body: form.node,
      actions: [
        { label: 'Cancel', value: false },
        {
          label: 'Save', primary: true,
          onClick: function (close) {
            if (!form.validate()) return false;
            var v = form.values();
            return Store.saveInventoryItem(Object.assign({}, item, {
              name: v.name, cat: v.cat || 'Other', unit: v.unit,
              stock: U.num(v.stock), min: U.num(v.min), cost: U.num(v.cost),
              supplier: v.supplier, active: v.active
            })).then(function () {
              UI.ok(v.name + ' saved.');
              close(true);
              refresh();
              return true;
            });
          }
        }
      ]
    });
  }

  /* -------------------------------------------------- stock movement */

  function moveDialog(item, type) {
    var meta = MOVE_META[type];
    var form = UI.form([
      { name: 'qty', label: type === 'adjust' ? 'Counted stock (' + item.unit + ')' : 'Quantity (' + item.unit + ')',
        type: 'number', min: 0, step: '0.01', value: type === 'adjust' ? item.stock : '', required: true,
        width: 'half', autofocus: true },
      { name: 'rate', label: 'Rate per ' + item.unit + ' (₹)', type: 'number', min: 0, step: '0.01',
        value: item.cost, width: 'half', hint: type === 'in' ? 'Updates the item cost price.' : '' },
      { name: 'date', label: 'Date', type: 'date', value: U.today(), width: 'half' },
      type === 'in' ? { name: 'supplier', label: 'Supplier', type: 'text', value: item.supplier, width: 'half' } : null,
      { name: 'note', label: 'Note', type: 'text', placeholder: 'Optional' }
    ]);

    var body = U.el('div', {}, [
      U.el('div', { class: 'settle__total' }, [
        U.el('span', { text: item.name + ' — on hand' }),
        U.el('strong', { text: U.moneyShort(item.stock) + ' ' + item.unit })
      ]),
      form.node
    ]);

    UI.modal({
      title: meta.label, body: body,
      actions: [
        { label: 'Cancel', value: false },
        {
          label: 'Record', primary: true,
          onClick: function (close) {
            var v = form.values();
            if (v.qty === '' ) { UI.err('Enter a quantity.'); return false; }
            return Store.recordMove(item.id, type, v.qty, {
              rate: v.rate, note: v.note, supplier: v.supplier, date: v.date
            }).then(function (mv) {
              UI.ok(item.name + ': ' + meta.sign + Math.abs(mv.qty) + ' ' + item.unit + ' → ' + mv.after + ' ' + item.unit);
              close(true);
              refresh();
              return true;
            });
          }
        }
      ]
    });
  }

  /* ------------------------------------------------------------ list */

  function stockRows() {
    return Store.inventory().filter(function (i) {
      if (catFilter !== 'all' && (i.cat || 'Other') !== catFilter) return false;
      if (lowOnly && U.num(i.stock) > U.num(i.min)) return false;
      if (!query) return true;
      return U.match(i.name, query) || U.match(i.cat || '', query) || U.match(i.supplier || '', query);
    });
  }

  function renderStock() {
    var host = root.querySelector('#inv-body');
    var list = stockRows();
    host.innerHTML = '';
    host.appendChild(UI.table([
      { key: 'name', label: 'Item',
        render: function (i) {
          return '<strong>' + U.esc(i.name) + '</strong>' +
            (i.supplier ? '<div class="muted">' + U.esc(i.supplier) + '</div>' : '');
        } },
      { key: 'cat', label: 'Category', width: '120px',
        render: function (i) { return '<span class="cat-pill">' + U.esc(i.cat || 'Other') + '</span>'; } },
      { key: 'stock', label: 'On Hand', align: 'right', width: '110px',
        render: function (i) {
          var low = U.num(i.stock) <= U.num(i.min);
          return '<strong class="' + (low ? 'is-low' : '') + '">' + U.moneyShort(i.stock) + ' ' + U.esc(i.unit) + '</strong>';
        } },
      { key: 'min', label: 'Min', align: 'right', width: '80px',
        render: function (i) { return '<span class="muted">' + U.moneyShort(i.min) + '</span>'; } },
      { key: 'cost', label: 'Cost/Unit', align: 'right', width: '100px',
        render: function (i) { return '₹' + U.money(i.cost); } },
      { key: 'value', label: 'Stock Value', align: 'right', width: '110px',
        render: function (i) { return '₹' + U.money(U.num(i.stock) * U.num(i.cost)); },
        footer: function (rs) {
          return '<strong>₹' + U.money(U.sum(rs, function (i) { return U.num(i.stock) * U.num(i.cost); })) + '</strong>';
        } },
      { key: 'status', label: 'Status', align: 'center', width: '110px',
        render: function (i) {
          if (i.active === false) return UI.badge('Not tracked', 'grey');
          if (U.num(i.stock) <= 0) return UI.badge('Out of stock', 'red');
          if (U.num(i.stock) <= U.num(i.min)) return UI.badge('Low', 'amber');
          return UI.badge('In stock', 'green');
        } },
      { key: 'act', label: '', align: 'right', width: '278px', className: 'nowrap',
        render: function (i) {
          return '<button type="button" class="link-btn" data-act="in" data-id="' + U.esc(i.id) + '">+ Stock</button>' +
            '<button type="button" class="link-btn" data-act="out" data-id="' + U.esc(i.id) + '">Use</button>' +
            '<button type="button" class="link-btn" data-act="wastage" data-id="' + U.esc(i.id) + '">Waste</button>' +
            '<button type="button" class="link-btn" data-act="adjust" data-id="' + U.esc(i.id) + '">Count</button>' +
            '<button type="button" class="link-btn" data-act="edit" data-id="' + U.esc(i.id) + '">Edit</button>';
        } }
    ], list, { empty: 'No inventory items match.', footer: true }));
  }

  function renderMoves() {
    var host = root.querySelector('#inv-body');
    host.innerHTML = '';
    host.appendChild(U.el('div', { class: 'filters filters--inline' }, [
      U.el('div', { class: 'filters__group' }, [
        U.el('label', { class: 'field__label', text: 'From' }),
        U.el('input', { class: 'input', type: 'date', value: moveRange.from,
          onchange: function (e) { moveRange.from = e.target.value; loadMoves(); } })
      ]),
      U.el('div', { class: 'filters__group' }, [
        U.el('label', { class: 'field__label', text: 'To' }),
        U.el('input', { class: 'input', type: 'date', value: moveRange.to,
          onchange: function (e) { moveRange.to = e.target.value; loadMoves(); } })
      ]),
      U.el('div', { class: 'filters__presets' }, [
        UI.button('Export CSV', function () {
          var rows = [['Date', 'Time', 'Item', 'Type', 'Qty', 'Unit', 'Before', 'After', 'Rate', 'Value', 'Supplier', 'Note']];
          moves.forEach(function (m) {
            rows.push([m.date, U.timeLabel(m.createdAt), m.itemName, MOVE_META[m.type].label, m.qty, m.unit,
              m.before, m.after, m.rate, m.value, m.supplier || '', m.note || '']);
          });
          U.download('stock-moves-' + moveRange.from + '_to_' + moveRange.to + '.csv', U.toCSV(rows), 'text/csv;charset=utf-8');
        }, 'btn--chip', '⬇')
      ])
    ]));

    host.appendChild(UI.table([
      { key: 'date', label: 'When', width: '160px',
        render: function (m) { return U.esc(U.dateLabel(m.date)) + '<div class="muted">' + U.esc(U.timeLabel(m.createdAt)) + '</div>'; } },
      { key: 'itemName', label: 'Item', render: function (m) { return '<strong>' + U.esc(m.itemName) + '</strong>'; } },
      { key: 'type', label: 'Movement', width: '150px',
        render: function (m) { return UI.badge(MOVE_META[m.type].label, MOVE_META[m.type].badge); } },
      { key: 'qty', label: 'Qty', align: 'right', width: '110px',
        render: function (m) {
          var cls = m.qty < 0 ? 'is-low' : '';
          return '<strong class="' + cls + '">' + (m.qty > 0 ? '+' : '') + U.moneyShort(m.qty) + ' ' + U.esc(m.unit) + '</strong>';
        } },
      { key: 'after', label: 'Balance', align: 'right', width: '110px',
        render: function (m) { return '<span class="muted">' + U.moneyShort(m.before) + ' → </span>' + U.moneyShort(m.after); } },
      { key: 'value', label: 'Value', align: 'right', width: '100px',
        render: function (m) { return '₹' + U.money(m.value); } },
      { key: 'note', label: 'Note',
        render: function (m) { return U.esc([m.supplier, m.note].filter(Boolean).join(' • ')) || '<span class="muted">—</span>'; } }
    ], moves, { empty: 'No stock movements in this period.' }));
  }

  function loadMoves() {
    return Store.movesBetween(moveRange.from, moveRange.to).then(function (rows) {
      moves = rows;
      if (tab === 'moves') renderMoves();
    });
  }

  function renderStats() {
    var host = root.querySelector('#inv-stats');
    var low = Store.lowStock();
    var out = Store.inventory().filter(function (i) { return i.active !== false && U.num(i.stock) <= 0; });
    host.innerHTML = '';
    [
      UI.stat('Stock Value', '₹' + U.money(Store.stockValue()), Store.inventory().length + ' items tracked', 'primary'),
      UI.stat('Low Stock', String(low.length), low.length ? low.slice(0, 3).map(function (i) { return i.name; }).join(', ') : 'Everything above minimum', low.length ? 'warn' : ''),
      UI.stat('Out of Stock', String(out.length), out.length ? 'Reorder soon' : 'Nothing has run out', out.length ? 'danger' : ''),
      UI.stat('Categories', String(categories().length), categories().slice(0, 4).join(', '))
    ].forEach(function (n) { host.appendChild(n); });
  }

  function refresh() {
    if (!root) return;
    renderStats();
    if (tab === 'stock') renderStock(); else renderMoves();
  }

  function render(container) {
    root = container;
    container.innerHTML = '';

    container.appendChild(UI.section('Inventory', 'Track what the kitchen holds, buys and wastes.', [
      UI.button('Low Stock Report', function () {
        var low = Store.lowStock();
        if (!low.length) return UI.alert('Low stock', 'Nothing is below its minimum right now.');
        UI.modal({
          title: 'Items to reorder', size: 'md',
          body: UI.table([
            { key: 'name', label: 'Item' },
            { key: 'stock', label: 'On hand', align: 'right', render: function (i) { return U.moneyShort(i.stock) + ' ' + i.unit; } },
            { key: 'min', label: 'Minimum', align: 'right', render: function (i) { return U.moneyShort(i.min) + ' ' + i.unit; } },
            { key: 'supplier', label: 'Supplier', render: function (i) { return U.esc(i.supplier || '—'); } }
          ], low, {}),
          actions: [{ label: 'Close', value: null }, {
            label: 'Print', primary: true, onClick: function () {
              UI.print('<!doctype html><html><head><meta charset="utf-8"><title>Reorder list</title><style>' +
                'body{font-family:Arial,sans-serif;padding:16px}h1{font-size:18px}table{width:100%;border-collapse:collapse;font-size:13px}' +
                'th,td{border:1px solid #ccc;padding:6px;text-align:left}th{background:#1d2b45;color:#fff}</style></head><body>' +
                '<h1>Reorder list — ' + U.esc(U.dateLabel(U.today())) + '</h1><table><tr><th>Item</th><th>On hand</th><th>Minimum</th><th>Supplier</th></tr>' +
                low.map(function (i) {
                  return '<tr><td>' + U.esc(i.name) + '</td><td>' + U.moneyShort(i.stock) + ' ' + U.esc(i.unit) +
                    '</td><td>' + U.moneyShort(i.min) + ' ' + U.esc(i.unit) + '</td><td>' + U.esc(i.supplier || '') + '</td></tr>';
                }).join('') + '</table></body></html>', 'Reorder list');
              return false;
            }
          }]
        });
      }, 'btn--ghost', '⚠'),
      UI.button('New Item', function () { itemEditor(null); }, 'btn--primary', '＋')
    ]));

    container.appendChild(U.el('div', { id: 'inv-stats', class: 'stat-grid' }));

    container.appendChild(U.el('div', { class: 'subtabs' }, [
      U.el('button', { type: 'button', class: 'subtab' + (tab === 'stock' ? ' is-active' : ''), text: 'Stock on hand',
        onclick: function (e) { tab = 'stock'; U.qsa('.subtab', container).forEach(function (b) { b.classList.remove('is-active'); }); e.target.classList.add('is-active'); toggleFilters(); refresh(); } }),
      U.el('button', { type: 'button', class: 'subtab' + (tab === 'moves' ? ' is-active' : ''), text: 'Movement ledger',
        onclick: function (e) { tab = 'moves'; U.qsa('.subtab', container).forEach(function (b) { b.classList.remove('is-active'); }); e.target.classList.add('is-active'); toggleFilters(); loadMoves().then(refresh); } })
    ]));

    container.appendChild(U.el('div', { id: 'inv-filters', class: 'filters card' }, [
      U.el('div', { class: 'filters__group filters__group--grow' }, [
        U.el('label', { class: 'field__label', text: 'Search' }),
        U.el('input', { class: 'input', type: 'search', placeholder: 'Item, category or supplier…',
          oninput: U.debounce(function (e) { query = e.target.value.trim(); if (tab === 'stock') renderStock(); }, 150) })
      ]),
      U.el('div', { class: 'filters__group' }, [
        U.el('label', { class: 'field__label', text: 'Category' }),
        U.el('select', { class: 'input', onchange: function (e) { catFilter = e.target.value; renderStock(); } },
          [U.el('option', { value: 'all', text: 'All' })].concat(
            categories().map(function (c) { return U.el('option', { value: c, text: c }); })))
      ]),
      U.el('div', { class: 'filters__group' }, [
        U.el('label', { class: 'field__label', text: 'Show' }),
        U.el('label', { class: 'check-row' }, [
          U.el('input', { type: 'checkbox', class: 'checkbox',
            onchange: function (e) { lowOnly = e.target.checked; renderStock(); } }),
          U.el('span', { text: 'Low stock only' })
        ])
      ])
    ]));

    container.appendChild(U.el('div', { id: 'inv-body', class: 'card card--flush' }));

    function toggleFilters() {
      container.querySelector('#inv-filters').hidden = tab !== 'stock';
    }
    toggleFilters();

    U.on(container, 'click', '[data-act]', function (e, btn) {
      var item = Store.inventoryItem(btn.dataset.id);
      if (!item) return;
      var act = btn.dataset.act;
      if (act === 'edit') itemEditor(item);
      else moveDialog(item, act);
    });

    refresh();
    loadMoves();
  }

  App.Views = App.Views || {};
  App.Views.inventory = { title: 'Inventory', render: render };
})(window.App = window.App || {});
