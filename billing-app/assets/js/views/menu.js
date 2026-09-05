/*  views/menu.js — menu manager: items, prices, categories. */
(function (App) {
  'use strict';

  var U = App.U, UI = App.UI, Store = App.Store;
  var query = '', catFilter = 'all', root = null;

  /* ---------------------------------------------------- item editor */

  function variantRow(v, onRemove) {
    var row = U.el('div', { class: 'variant-row' }, [
      U.el('input', { class: 'input', type: 'text', value: v.label || '', placeholder: 'Half / Full / Plate', 'data-vf': 'label' }),
      U.el('input', { class: 'input', type: 'number', min: '0', step: '1', value: v.price === undefined ? '' : v.price, placeholder: 'Price', 'data-vf': 'price' }),
      U.el('button', { type: 'button', class: 'icon-btn icon-btn--danger', title: 'Remove price', html: '&times;',
        onclick: function () { onRemove(row); } })
    ]);
    return row;
  }

  function itemEditor(existing) {
    var item = existing
      ? JSON.parse(JSON.stringify(existing))
      : { id: '', name: '', cat: Store.categories()[0].id, note: '', popular: false, active: true, variants: [{ label: 'Half', price: '' }, { label: 'Full', price: '' }] };

    var form = UI.form([
      { name: 'name', label: 'Item name', type: 'text', value: item.name, required: true, width: 'half', autofocus: true },
      { name: 'cat', label: 'Category', type: 'select', value: item.cat, width: 'half',
        options: Store.categories().map(function (c) { return { value: c.id, label: c.icon + '  ' + c.name }; }) },
      { name: 'note', label: 'Note on the menu', type: 'text', value: item.note, width: 'half', placeholder: 'e.g. 3 Plate, 1 Kilo' },
      { name: 'popular', label: 'Show in Quick Picks', type: 'checkbox', value: item.popular, width: 'half' },
      { name: 'active', label: 'Available for billing', type: 'checkbox', value: item.active !== false, width: 'half' }
    ]);

    var variantHost = U.el('div', { class: 'variant-list' });
    function removeVariant(row) {
      if (variantHost.children.length <= 1) { UI.err('An item needs at least one price.'); return; }
      variantHost.removeChild(row);
    }
    item.variants.forEach(function (v) { variantHost.appendChild(variantRow(v, removeVariant)); });

    var body = U.el('div', {}, [
      form.node,
      U.el('div', { class: 'field' }, [
        U.el('label', { class: 'field__label', text: 'Prices' }),
        U.el('div', { class: 'variant-head' }, [
          U.el('span', { text: 'Label' }), U.el('span', { text: 'Price (₹)' }), U.el('span', {})
        ]),
        variantHost,
        UI.button('Add another price', function () {
          variantHost.appendChild(variantRow({ label: '', price: '' }, removeVariant));
        }, 'btn--chip', '＋')
      ])
    ]);

    UI.modal({
      title: existing ? 'Edit item' : 'New item',
      size: 'md',
      body: body,
      submitOnEnter: false,
      actions: [
        { label: 'Cancel', value: false },
        {
          label: 'Save item', primary: true,
          onClick: function (close) {
            if (!form.validate()) return false;
            var v = form.values();
            var variants = U.qsa('.variant-row', variantHost).map(function (row) {
              return {
                label: row.querySelector('[data-vf="label"]').value.trim(),
                price: U.num(row.querySelector('[data-vf="price"]').value, NaN)
              };
            }).filter(function (x) { return x.label && isFinite(x.price); });

            if (!variants.length) { UI.err('Add at least one label and price.'); return false; }

            var labels = variants.map(function (x) { return x.label.toLowerCase(); });
            if (new Set(labels).size !== labels.length) { UI.err('Two prices share the same label.'); return false; }

            return Store.saveMenuItem({
              id: item.id || '',
              name: v.name, cat: v.cat, note: v.note,
              popular: v.popular, active: v.active,
              sort: item.sort || Store.menu().length + 1,
              variants: variants
            }).then(function () {
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

  /* ------------------------------------------------ category editor */

  function categoryManager() {
    var body = U.el('div', { class: 'cat-manager' });

    function draw() {
      body.innerHTML = '';
      var counts = U.groupBy(Store.menu(), function (m) { return m.cat; });
      Store.categories().forEach(function (c) {
        body.appendChild(U.el('div', { class: 'cat-row' }, [
          U.el('input', { class: 'input input--icon', type: 'text', value: c.icon, maxlength: 3,
            onchange: function (e) { Store.saveCategory({ id: c.id, icon: e.target.value || '🍽️' }); } }),
          U.el('input', { class: 'input', type: 'text', value: c.name,
            onchange: function (e) {
              var name = e.target.value.trim();
              if (name) Store.saveCategory({ id: c.id, name: name });
            } }),
          U.el('label', { class: 'check-row' }, [
            (function () {
              var cb = U.el('input', { type: 'checkbox', class: 'checkbox' });
              cb.checked = !!c.popular;
              cb.addEventListener('change', function () {
                Store.saveCategory({ id: c.id, popular: cb.checked });
                // Keep the items in step with their category's quick-pick flag.
                var items = Store.menu().filter(function (m) { return m.cat === c.id; });
                Promise.all(items.map(function (m) {
                  m.popular = cb.checked;
                  return Store.saveMenuItem(m);
                })).then(refresh);
              });
              return cb;
            })(),
            U.el('span', { text: 'Quick pick' })
          ]),
          U.el('span', { class: 'muted', text: (counts[c.id] || []).length + ' items' }),
          U.el('button', {
            type: 'button', class: 'icon-btn icon-btn--danger', html: '&times;', title: 'Delete category',
            onclick: function () {
              Store.removeCategory(c.id).then(function () { draw(); refresh(); })
                .catch(UI.err);
            }
          })
        ]));
      });

      var nameInput = U.el('input', { class: 'input', type: 'text', placeholder: 'New category name' });
      body.appendChild(U.el('div', { class: 'cat-row cat-row--new' }, [
        nameInput,
        UI.button('Add category', function () {
          var name = nameInput.value.trim();
          if (!name) return UI.err('Enter a category name.');
          var id = U.slug(name);
          if (Store.categories().some(function (c) { return c.id === id; })) return UI.err('That category already exists.');
          Store.saveCategory({ id: id, name: name, icon: '🍽️', popular: false, sort: Store.categories().length + 1 })
            .then(function () { nameInput.value = ''; draw(); refresh(); });
        }, 'btn--primary')
      ]));
    }

    draw();
    UI.modal({ title: 'Categories', size: 'md', body: body, actions: [{ label: 'Done', value: true, primary: true }] });
  }

  /* --------------------------------------------------------- export */

  function exportCSV() {
    var rows = [['Item', 'Category', 'Note', 'Quick Pick', 'Active', 'Price Label 1', 'Price 1', 'Price Label 2', 'Price 2', 'Price Label 3', 'Price 3']];
    U.sortBy(Store.menu(), 'sort').forEach(function (m) {
      var r = [m.name, Store.category(m.cat).name, m.note || '', m.popular ? 'Yes' : 'No', m.active === false ? 'No' : 'Yes'];
      for (var i = 0; i < 3; i++) {
        r.push(m.variants[i] ? m.variants[i].label : '');
        r.push(m.variants[i] ? m.variants[i].price : '');
      }
      rows.push(r);
    });
    U.download('menu-' + U.today() + '.csv', U.toCSV(rows), 'text/csv;charset=utf-8');
    UI.ok('Menu exported.');
  }

  function printMenu() {
    var s = Store.settings();
    var groups = U.groupBy(Store.activeMenu(), function (m) { return m.cat; });
    var sections = Store.categories().map(function (c) {
      var items = U.sortBy(groups[c.id] || [], 'sort');
      if (!items.length) return '';
      var labels = [];
      items.forEach(function (i) { i.variants.forEach(function (v) { if (labels.indexOf(v.label) === -1) labels.push(v.label); }); });
      return '<section><h2>' + U.esc(c.name) + (c.popular ? ' <em>• White Box Special</em>' : '') + '</h2>' +
        '<table><thead><tr><th>Item</th>' + labels.map(function (l) { return '<th class="r">' + U.esc(l) + '</th>'; }).join('') +
        '</tr></thead><tbody>' + items.map(function (i) {
          return '<tr><td>' + U.esc(i.name) + (i.note ? ' <em>(' + U.esc(i.note) + ')</em>' : '') + '</td>' +
            labels.map(function (l) {
              var v = i.variants.filter(function (x) { return x.label === l; })[0];
              return '<td class="r">' + (v ? U.moneyShort(v.price) + '/-' : '—') + '</td>';
            }).join('') + '</tr>';
        }).join('') + '</tbody></table></section>';
    }).join('');

    UI.print('<!doctype html><html><head><meta charset="utf-8"><title>Menu</title><style>' +
      '@page{size:A4;margin:12mm}body{font-family:"Segoe UI",Arial,sans-serif;color:#14181f;margin:0}' +
      'h1{font-size:24px;margin:0;color:#1d2b45}.tag{color:#b0311f;font-weight:600;margin-bottom:14px}' +
      'section{break-inside:avoid;margin-bottom:16px}h2{font-size:14px;background:#1d2b45;color:#fff;padding:6px 10px;margin:0 0 6px;border-radius:4px}' +
      'h2 em{font-weight:400;font-size:11px;opacity:.85}table{width:100%;border-collapse:collapse;font-size:12px}' +
      'th{text-align:left;border-bottom:1.5px solid #1d2b45;padding:4px 8px;font-size:10px;text-transform:uppercase;letter-spacing:.5px}' +
      'td{padding:4px 8px;border-bottom:1px solid #eceff3}.r{text-align:right}em{color:#8a94a3;font-size:11px}' +
      '</style></head><body><h1>' + U.esc(s.name) + '</h1><div class="tag">' + U.esc(s.tagline) + '</div>' +
      sections + '</body></html>', 'Menu');
  }

  /* ----------------------------------------------------------- list */

  function rows() {
    return U.sortBy(Store.menu(), 'sort').filter(function (m) {
      if (catFilter !== 'all' && m.cat !== catFilter) return false;
      if (!query) return true;
      return U.match(m.name, query) || U.match(Store.category(m.cat).name, query);
    });
  }

  function refresh() {
    if (!root) return;
    var host = root.querySelector('#menu-list');
    var list = rows();

    host.innerHTML = '';
    host.appendChild(UI.table([
      { key: 'name', label: 'Item',
        render: function (m) {
          return '<strong>' + U.esc(m.name) + '</strong>' +
            (m.note ? '<div class="muted">' + U.esc(m.note) + '</div>' : '');
        } },
      { key: 'cat', label: 'Category', width: '150px',
        render: function (m) {
          var c = Store.category(m.cat);
          return '<span class="cat-pill">' + U.esc(c.icon) + ' ' + U.esc(c.name) + '</span>';
        } },
      { key: 'variants', label: 'Prices',
        render: function (m) {
          return m.variants.map(function (v) {
            return '<span class="price-pill"><b>' + U.esc(v.label) + '</b> ₹' + U.moneyShort(v.price) + '</span>';
          }).join(' ');
        } },
      { key: 'popular', label: 'Quick Pick', align: 'center', width: '100px',
        render: function (m) {
          return '<button type="button" class="star-btn' + (m.popular ? ' is-on' : '') +
            '" data-act="star" data-id="' + U.esc(m.id) + '" title="Toggle quick pick">★</button>';
        } },
      { key: 'active', label: 'Status', align: 'center', width: '100px',
        render: function (m) {
          return m.active === false ? UI.badge('Off menu', 'grey') : UI.badge('Available', 'green');
        } },
      { key: 'act', label: '', align: 'right', width: '130px',
        render: function (m) {
          return '<button type="button" class="link-btn" data-act="edit" data-id="' + U.esc(m.id) + '">Edit</button>' +
            '<button type="button" class="link-btn link-btn--danger" data-act="del" data-id="' + U.esc(m.id) + '">Delete</button>';
        } }
    ], list, { empty: 'No items match this filter.' }));

    var count = root.querySelector('#menu-count');
    if (count) {
      count.textContent = list.length + ' of ' + Store.menu().length + ' items • ' +
        Store.popularItems().length + ' quick picks';
    }
  }

  function render(container) {
    root = container;
    container.innerHTML = '';

    container.appendChild(UI.section('Menu & Prices', 'Change a price here and the billing screen picks it up instantly.', [
      UI.button('Categories', categoryManager, 'btn--ghost', '🏷'),
      UI.button('Print Menu', printMenu, 'btn--ghost', '🖨'),
      UI.button('Export CSV', exportCSV, 'btn--ghost', '⬇'),
      UI.button('New Item', function () { itemEditor(null); }, 'btn--primary', '＋')
    ]));

    container.appendChild(U.el('div', { class: 'filters card' }, [
      U.el('div', { class: 'filters__group filters__group--grow' }, [
        U.el('label', { class: 'field__label', text: 'Search' }),
        U.el('input', { class: 'input', type: 'search', placeholder: 'Item or category…',
          oninput: U.debounce(function (e) { query = e.target.value.trim(); refresh(); }, 150) })
      ]),
      U.el('div', { class: 'filters__group' }, [
        U.el('label', { class: 'field__label', text: 'Category' }),
        U.el('select', { class: 'input', onchange: function (e) { catFilter = e.target.value; refresh(); } },
          [U.el('option', { value: 'all', text: 'All categories' })].concat(
            Store.categories().map(function (c) { return U.el('option', { value: c.id, text: c.icon + ' ' + c.name }); })
          ))
      ]),
      U.el('div', { class: 'filters__group' }, [
        U.el('label', { class: 'field__label', text: 'Total' }),
        U.el('div', { id: 'menu-count', class: 'filters__note' })
      ])
    ]));

    container.appendChild(U.el('div', { id: 'menu-list', class: 'card card--flush' }));

    U.on(container, 'click', '[data-act]', function (e, btn) {
      var item = Store.menuItem(btn.dataset.id);
      if (!item) return;
      var act = btn.dataset.act;
      if (act === 'edit') itemEditor(item);
      else if (act === 'star') {
        item.popular = !item.popular;
        Store.saveMenuItem(item).then(refresh);
      } else if (act === 'del') {
        UI.confirm('Delete ' + item.name + '?', 'Past bills keep their record; the item just leaves the menu.', 'Delete', true)
          .then(function (yes) {
            if (!yes) return;
            Store.removeMenuItem(item.id).then(function () { UI.ok('Item deleted.'); refresh(); });
          });
      }
    });

    refresh();
  }

  App.Views = App.Views || {};
  App.Views.menu = { title: 'Menu', render: render };
})(window.App = window.App || {});
