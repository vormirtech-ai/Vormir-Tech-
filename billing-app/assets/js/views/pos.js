/*  views/pos.js — the billing counter.
 *  Left: the menu as price tables (Quick Picks first — the white-box items).
 *  Right: the running order, totals and settlement.
 */
(function (App) {
  'use strict';

  var U = App.U, UI = App.UI, Store = App.Store;
  var DRAFT_KEY = 'lavi_pos.draft';

  var cart = [];
  var meta = newMeta();
  var activeCat = 'quick';
  var search = '';
  var root = null;

  function newMeta() {
    return {
      billId: null, billNo: null, createdAt: null, status: 'new',
      orderType: 'Dine-In', tableNo: '', customerName: '', customerPhone: '',
      discountType: 'flat', discountValue: 0, paymentMode: 'Cash', note: ''
    };
  }

  /* ------------------------------------------------------------ draft */

  function saveDraft() {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ cart: cart, meta: meta }));
    } catch (e) { /* storage full — the order is still safe in memory */ }
  }

  function loadDraft() {
    try {
      var raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      var d = JSON.parse(raw);
      if (d && Array.isArray(d.cart) && d.cart.length) {
        cart = d.cart;
        meta = Object.assign(newMeta(), d.meta || {});
      }
    } catch (e) { /* ignore a corrupt draft */ }
  }

  function clearDraft() {
    try { localStorage.removeItem(DRAFT_KEY); } catch (e) {}
  }

  /* ------------------------------------------------------------- cart */

  function keyFor(itemId, variant) { return itemId + '||' + variant; }

  function addToCart(itemId, variant) {
    var item = Store.menuItem(itemId);
    if (!item) return;
    var v = item.variants.filter(function (x) { return x.label === variant; })[0];
    if (!v) return;

    var key = keyFor(itemId, variant);
    var line = cart.filter(function (l) { return l.key === key; })[0];
    if (line) line.qty += 1;
    else cart.push({
      key: key, itemId: itemId, name: item.name, cat: item.cat,
      variant: variant, price: v.price, qty: 1, note: ''
    });

    saveDraft();
    renderCart();
    flashLine(key);
  }

  function setQty(key, qty) {
    var i = cart.findIndex(function (l) { return l.key === key; });
    if (i < 0) return;
    qty = Math.max(0, Math.round(U.num(qty)));
    if (qty === 0) cart.splice(i, 1);
    else cart[i].qty = Math.min(qty, 999);
    saveDraft();
    renderCart();
  }

  function resetOrder() {
    cart = [];
    meta = newMeta();
    clearDraft();
    renderCart();
  }

  function flashLine(key) {
    var node = root && root.querySelector('[data-line="' + CSS.escape(key) + '"]');
    if (!node) return;
    node.classList.add('is-flash');
    node.scrollIntoView({ block: 'nearest' });
    setTimeout(function () { node.classList.remove('is-flash'); }, 400);
  }

  /* ------------------------------------------------------- menu panel */

  function visibleItems() {
    var items = Store.activeMenu();
    if (search) {
      return items.filter(function (i) {
        return U.match(i.name, search) || U.match(Store.category(i.cat).name, search);
      });
    }
    if (activeCat === 'quick') return items.filter(function (i) { return i.popular; });
    if (activeCat === 'all') return items;
    return items.filter(function (i) { return i.cat === activeCat; });
  }

  // Renders one category as a price table; columns come from the variant
  // labels actually used by that category (Half/Full, Plate, Tari/Masala …).
  function categoryTable(catId, items) {
    var labels = [];
    items.forEach(function (i) {
      i.variants.forEach(function (v) {
        if (labels.indexOf(v.label) === -1) labels.push(v.label);
      });
    });

    var cat = Store.category(catId);
    var table = U.el('table', { class: 'menu-table' });
    var thead = U.el('thead', {}, [
      U.el('tr', {}, [U.el('th', { class: 'menu-table__name', text: 'Item' })].concat(
        labels.map(function (l) { return U.el('th', { class: 'ta-center', text: l }); })
      ))
    ]);
    var tbody = U.el('tbody');

    items.forEach(function (item) {
      var tr = U.el('tr');
      tr.appendChild(U.el('td', { class: 'menu-table__name' }, [
        U.el('span', { class: 'menu-item__name', text: item.name }),
        item.note ? U.el('span', { class: 'menu-item__note', text: item.note }) : null,
        item.popular ? U.el('span', { class: 'menu-item__star', text: '★', title: 'Quick pick' }) : null
      ]));
      labels.forEach(function (label) {
        var v = item.variants.filter(function (x) { return x.label === label; })[0];
        var td = U.el('td', { class: 'ta-center' });
        if (v) {
          td.appendChild(U.el('button', {
            type: 'button', class: 'price-btn',
            dataset: { item: item.id, variant: label },
            title: 'Add ' + item.name + ' (' + label + ')'
          }, [U.el('span', { text: '₹' + U.moneyShort(v.price) })]));
        } else {
          td.appendChild(U.el('span', { class: 'price-na', text: '—' }));
        }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });

    table.appendChild(thead);
    table.appendChild(tbody);

    return U.el('section', { class: 'menu-group' }, [
      U.el('header', { class: 'menu-group__head' }, [
        U.el('span', { class: 'menu-group__icon', text: cat.icon || '🍽️' }),
        U.el('h3', { class: 'menu-group__title', text: cat.name }),
        cat.popular ? U.el('span', { class: 'chip chip--hot', text: 'Quick pick' }) : null,
        U.el('span', { class: 'menu-group__count', text: items.length + ' items' })
      ]),
      U.el('div', { class: 'menu-group__body' }, [table])
    ]);
  }

  function renderMenu() {
    var host = root.querySelector('#menu-body');
    if (!host) return;
    host.innerHTML = '';

    var items = visibleItems();
    if (!items.length) {
      host.appendChild(UI.empty('🔍', 'No items found',
        search ? 'Nothing matches “' + search + '”.' : 'This category is empty.'));
      return;
    }

    var groups = U.groupBy(items, function (i) { return i.cat; });
    Store.categories().forEach(function (cat) {
      if (!groups[cat.id]) return;
      host.appendChild(categoryTable(cat.id, U.sortBy(groups[cat.id], 'sort')));
      delete groups[cat.id];
    });
    // Any category no longer in the settings list still gets rendered.
    Object.keys(groups).forEach(function (id) {
      host.appendChild(categoryTable(id, groups[id]));
    });
  }

  function renderTabs() {
    var host = root.querySelector('#cat-tabs');
    host.innerHTML = '';
    var tabs = [{ id: 'quick', name: 'Quick Picks', icon: '⭐' }]
      .concat(Store.categories())
      .concat([{ id: 'all', name: 'Full Menu', icon: '📋' }]);

    tabs.forEach(function (t) {
      host.appendChild(U.el('button', {
        type: 'button',
        class: 'tab' + (activeCat === t.id && !search ? ' is-active' : '') + (t.id === 'quick' ? ' tab--hot' : ''),
        dataset: { cat: t.id },
        onclick: function () {
          activeCat = t.id;
          search = '';
          var box = root.querySelector('#menu-search');
          if (box) box.value = '';
          renderTabs();
          renderMenu();
        }
      }, [
        U.el('span', { class: 'tab__icon', text: t.icon || '🍽️' }),
        U.el('span', { text: t.name })
      ]));
    });
  }

  /* ------------------------------------------------------- cart panel */

  function totals() {
    return Store.calcTotals(cart, {
      discountType: meta.discountType,
      discountValue: meta.discountValue
    });
  }

  function renderCart() {
    var host = root.querySelector('#cart-body');
    var footHost = root.querySelector('#cart-foot');
    if (!host) return;
    var t = totals();
    var s = Store.settings();

    host.innerHTML = '';
    if (!cart.length) {
      host.appendChild(UI.empty('🧾', 'No items yet', 'Tap a price to start the order.'));
    } else {
      cart.forEach(function (l) {
        host.appendChild(U.el('div', { class: 'cart-line', dataset: { line: l.key } }, [
          U.el('div', { class: 'cart-line__main' }, [
            U.el('div', { class: 'cart-line__name' }, [
              U.el('span', { text: l.name }),
              l.variant && l.variant !== 'Plate'
                ? U.el('span', { class: 'cart-line__variant', text: l.variant }) : null
            ]),
            U.el('div', { class: 'cart-line__rate', text: '₹' + U.moneyShort(l.price) + ' each' }),
            l.note ? U.el('div', { class: 'cart-line__note', text: '↳ ' + l.note }) : null
          ]),
          U.el('div', { class: 'qty-box' }, [
            U.el('button', { type: 'button', class: 'qty-btn', text: '−', 'aria-label': 'Decrease',
              onclick: function () { setQty(l.key, l.qty - 1); } }),
            U.el('input', { class: 'qty-input', type: 'text', inputmode: 'numeric', value: l.qty,
              'aria-label': 'Quantity for ' + l.name,
              onchange: function (e) { setQty(l.key, e.target.value); } }),
            U.el('button', { type: 'button', class: 'qty-btn', text: '+', 'aria-label': 'Increase',
              onclick: function () { setQty(l.key, l.qty + 1); } })
          ]),
          U.el('div', { class: 'cart-line__amt', text: '₹' + U.money(l.amount || l.price * l.qty) }),
          U.el('div', { class: 'cart-line__tools' }, [
            U.el('button', { type: 'button', class: 'link-btn', text: 'Note',
              onclick: function () { editNote(l.key); } }),
            U.el('button', { type: 'button', class: 'link-btn link-btn--danger', text: 'Remove',
              onclick: function () { setQty(l.key, 0); } })
          ])
        ]));
      });
    }

    footHost.innerHTML = '';
    var rows = [['Sub Total (' + t.qty + ' qty)', '₹' + U.money(t.subtotal)]];
    if (t.discount > 0) rows.push(['Discount' + (t.discountType === 'percent' ? ' ' + t.discountValue + '%' : ''), '− ₹' + U.money(t.discount)]);
    if (t.serviceCharge > 0) rows.push(['Service Charge ' + t.serviceChargeRate + '%', '₹' + U.money(t.serviceCharge)]);
    if (t.tax > 0) rows.push(['GST ' + t.gstRate + '%', '₹' + U.money(t.tax)]);
    if (t.roundOff) rows.push(['Round Off', (t.roundOff > 0 ? '+ ' : '− ') + '₹' + U.money(Math.abs(t.roundOff))]);

    rows.forEach(function (r) {
      footHost.appendChild(U.el('div', { class: 'sum-row' }, [
        U.el('span', { text: r[0] }), U.el('span', { text: r[1] })
      ]));
    });
    footHost.appendChild(U.el('div', { class: 'sum-row sum-row--total' }, [
      U.el('span', { text: 'Total Payable' }),
      U.el('span', { text: s.currency + U.money(t.total) })
    ]));

    var badge = root.querySelector('#cart-count');
    if (badge) badge.textContent = t.qty ? t.qty + ' qty' : 'empty';
    var ref = root.querySelector('#cart-ref');
    if (ref) {
      ref.textContent = meta.billNo ? 'Editing ' + meta.billNo : 'New order';
      ref.className = 'cart__ref' + (meta.billNo ? ' is-editing' : '');
    }
    var settle = root.querySelector('#btn-settle');
    if (settle) settle.disabled = !cart.length;
    var hold = root.querySelector('#btn-hold');
    if (hold) hold.disabled = !cart.length;
  }

  function editNote(key) {
    var line = cart.filter(function (l) { return l.key === key; })[0];
    if (!line) return;
    var form = UI.form([
      { name: 'note', label: 'Kitchen note', type: 'text', value: line.note,
        placeholder: 'e.g. kam mirchi, extra butter', autofocus: true }
    ]);
    UI.modal({
      title: line.name, size: 'sm', body: form.node,
      actions: [
        { label: 'Cancel', value: false },
        { label: 'Save note', value: true, primary: true }
      ]
    }).then(function (ok) {
      if (!ok) return;
      line.note = form.values().note;
      saveDraft();
      renderCart();
    });
  }

  /* ---------------------------------------------------- order options */

  function orderOptions() {
    var s = Store.settings();
    var tables = [{ value: '', label: '—' }];
    for (var i = 1; i <= U.num(s.tables, 12); i++) tables.push({ value: String(i), label: 'Table ' + i });

    var form = UI.form([
      { name: 'orderType', label: 'Order type', type: 'select', width: 'half', value: meta.orderType,
        options: ['Dine-In', 'Takeaway', 'Delivery', 'Parcel'].map(function (x) { return { value: x, label: x }; }) },
      { name: 'tableNo', label: 'Table', type: 'select', width: 'half', value: meta.tableNo, options: tables },
      { name: 'customerName', label: 'Customer name', type: 'text', width: 'half', value: meta.customerName },
      { name: 'customerPhone', label: 'Phone', type: 'tel', width: 'half', value: meta.customerPhone },
      { name: 'note', label: 'Order note', type: 'textarea', rows: 2, value: meta.note }
    ]);

    return UI.modal({
      title: 'Order details', body: form.node,
      actions: [{ label: 'Cancel', value: false }, { label: 'Apply', value: true, primary: true }]
    }).then(function (ok) {
      if (!ok) return;
      Object.assign(meta, form.values());
      saveDraft();
      renderHeaderMeta();
    });
  }

  function discountDialog() {
    var form = UI.form([
      { name: 'discountType', label: 'Discount type', type: 'select', width: 'half', value: meta.discountType,
        options: [{ value: 'flat', label: 'Flat (₹)' }, { value: 'percent', label: 'Percent (%)' }] },
      { name: 'discountValue', label: 'Value', type: 'number', width: 'half', min: 0, step: '0.01',
        value: meta.discountValue || '', autofocus: true }
    ]);
    return UI.modal({
      title: 'Apply discount', size: 'sm', body: form.node,
      actions: [
        { label: 'Remove', value: 'clear' },
        { label: 'Apply', value: 'apply', primary: true }
      ]
    }).then(function (choice) {
      if (!choice) return;
      if (choice === 'clear') { meta.discountType = 'flat'; meta.discountValue = 0; }
      else {
        var v = form.values();
        meta.discountType = v.discountType;
        meta.discountValue = Math.max(0, U.num(v.discountValue));
      }
      saveDraft();
      renderCart();
    });
  }

  function renderHeaderMeta() {
    var host = root.querySelector('#order-meta');
    if (!host) return;
    host.innerHTML = '';
    var bits = [meta.orderType];
    if (meta.tableNo) bits.push('Table ' + meta.tableNo);
    if (meta.customerName) bits.push(meta.customerName);
    host.appendChild(U.el('span', { text: bits.join(' • ') }));
  }

  /* ------------------------------------------------------- settlement */

  function buildBill(status, billNo) {
    var t = totals();
    return {
      id: meta.billId || U.uid('bill'),
      billNo: billNo,
      date: U.today(meta.createdAt ? new Date(meta.createdAt) : new Date()),
      createdAt: meta.createdAt || Date.now(),
      status: status,
      orderType: meta.orderType,
      tableNo: meta.tableNo,
      customerName: meta.customerName,
      customerPhone: meta.customerPhone,
      note: meta.note,
      paymentMode: meta.paymentMode,
      items: t.items.map(function (l) {
        return { itemId: l.itemId, name: l.name, cat: l.cat, variant: l.variant,
          price: l.price, qty: l.qty, amount: l.amount, note: l.note || '' };
      }),
      qty: t.qty,
      subtotal: t.subtotal,
      discountType: t.discountType,
      discountValue: t.discountValue,
      discount: t.discount,
      serviceChargeRate: t.serviceChargeRate,
      serviceCharge: t.serviceCharge,
      gstRate: t.gstRate,
      tax: t.tax,
      cgst: t.cgst,
      sgst: t.sgst,
      roundOff: t.roundOff,
      total: t.total
    };
  }

  function hold() {
    if (!cart.length) return;
    var promise = meta.billNo && meta.status === 'open'
      ? Promise.resolve(meta.billNo)
      : App.DB.nextSeq('token', 0).then(function (n) { return 'T-' + n; });

    promise.then(function (no) {
      var bill = buildBill('open', no);
      return Store.saveBill(bill);
    }).then(function (bill) {
      UI.ok('Order ' + bill.billNo + ' held.');
      resetOrder();
      refreshHeld();
    }).catch(UI.err);
  }

  function settle() {
    if (!cart.length) return;
    var t = totals();
    var s = Store.settings();

    var form = UI.form([
      { name: 'paymentMode', label: 'Payment mode', type: 'select', width: 'half', value: meta.paymentMode,
        options: ['Cash', 'UPI', 'Card', 'Due'].map(function (x) { return { value: x, label: x }; }) },
      { name: 'tendered', label: 'Cash received', type: 'number', width: 'half', min: 0, step: '1',
        value: Math.ceil(t.total), autofocus: true,
        onInput: function (e) {
          var change = U.num(e.target.value) - t.total;
          var out = document.getElementById('change-due');
          if (out) {
            out.textContent = change >= 0 ? 'Change to return: ₹' + U.money(change) : 'Short by ₹' + U.money(-change);
            out.className = 'settle__change' + (change < 0 ? ' is-short' : '');
          }
        } },
      { name: 'print', label: 'Print bill after saving', type: 'checkbox', value: true }
    ]);

    var body = U.el('div', {}, [
      U.el('div', { class: 'settle__total' }, [
        U.el('span', { text: 'Total payable' }),
        U.el('strong', { text: s.currency + U.money(t.total) })
      ]),
      form.node,
      U.el('div', { id: 'change-due', class: 'settle__change', text: 'Change to return: ₹' + U.money(Math.ceil(t.total) - t.total) })
    ]);

    UI.modal({
      title: 'Settle bill', body: body,
      actions: [
        { label: 'Cancel', value: false },
        { label: 'Save & Finish', value: true, primary: true }
      ]
    }).then(function (ok) {
      if (!ok) return;
      var v = form.values();
      meta.paymentMode = v.paymentMode;

      // Held orders carry a token number; a real bill number is minted on payment.
      var needsNumber = !meta.billNo || String(meta.billNo).indexOf('T-') === 0;
      var numberPromise = needsNumber ? Store.nextBillNo() : Promise.resolve(meta.billNo);

      numberPromise.then(function (no) {
        var bill = buildBill('paid', no);
        bill.tendered = U.num(v.tendered);
        bill.change = U.round2(Math.max(0, bill.tendered - bill.total));
        return Store.saveBill(bill);
      }).then(function (bill) {
        UI.ok('Bill ' + bill.billNo + ' saved — ' + Store.settings().currency + U.money(bill.total));
        if (v.print) App.Receipt.print(bill, Store.settings());
        resetOrder();
        refreshHeld();
        App.Shell.refreshTodayStat();
      }).catch(UI.err);
    });
  }

  /* ------------------------------------------------------ held orders */

  function refreshHeld() {
    var host = root && root.querySelector('#held-strip');
    if (!host) return;
    Store.openBills().then(function (bills) {
      host.innerHTML = '';
      if (!bills.length) { host.hidden = true; return; }
      host.hidden = false;
      host.appendChild(U.el('span', { class: 'held__label', text: 'Held orders' }));
      bills.forEach(function (b) {
        host.appendChild(U.el('button', {
          type: 'button', class: 'held-chip',
          onclick: function () { resumeBill(b); }
        }, [
          U.el('strong', { text: b.billNo }),
          U.el('span', { text: (b.tableNo ? 'T' + b.tableNo + ' • ' : '') + '₹' + U.moneyShort(b.total) })
        ]));
      });
    });
  }

  function resumeBill(bill) {
    var proceed = cart.length
      ? UI.confirm('Replace current order?', 'The order on screen has not been saved. Open ' + bill.billNo + ' instead?', 'Open it')
      : Promise.resolve(true);

    proceed.then(function (yes) {
      if (!yes) return;
      cart = bill.items.map(function (l) {
        return {
          key: keyFor(l.itemId, l.variant), itemId: l.itemId, name: l.name, cat: l.cat,
          variant: l.variant, price: l.price, qty: l.qty, note: l.note || ''
        };
      });
      meta = Object.assign(newMeta(), {
        billId: bill.id, billNo: bill.billNo, createdAt: bill.createdAt, status: 'open',
        orderType: bill.orderType, tableNo: bill.tableNo,
        customerName: bill.customerName, customerPhone: bill.customerPhone,
        discountType: bill.discountType, discountValue: bill.discountValue,
        paymentMode: bill.paymentMode, note: bill.note
      });
      saveDraft();
      renderCart();
      renderHeaderMeta();
      UI.toast('Opened ' + bill.billNo);
    });
  }

  /* ------------------------------------------------------------ mount */

  function onKey(e) {
    if (!root || !document.body.contains(root)) return;
    if (document.body.classList.contains('is-modal-open')) return;
    if (e.key === 'F2') { e.preventDefault(); root.querySelector('#menu-search').focus(); }
    if (e.key === 'F4') { e.preventDefault(); settle(); }
    if (e.key === 'F6') { e.preventDefault(); hold(); }
  }

  function render(container) {
    root = container;
    loadDraft();

    container.innerHTML = '';
    container.appendChild(U.el('div', { class: 'pos' }, [
      // ---- menu side ----
      U.el('div', { class: 'pos__menu card' }, [
        U.el('div', { class: 'pos__search' }, [
          U.el('span', { class: 'pos__search-icon', text: '🔍' }),
          U.el('input', {
            id: 'menu-search', class: 'input input--search', type: 'search',
            placeholder: 'Search any item…  (F2)', autocomplete: 'off',
            oninput: U.debounce(function (e) {
              search = e.target.value.trim();
              renderTabs();
              renderMenu();
            }, 120)
          })
        ]),
        U.el('div', { id: 'cat-tabs', class: 'tabs' }),
        U.el('div', { id: 'held-strip', class: 'held', hidden: true }),
        U.el('div', { id: 'menu-body', class: 'pos__menu-body' })
      ]),

      // ---- order side ----
      U.el('aside', { class: 'pos__cart card' }, [
        U.el('header', { class: 'cart__head' }, [
          U.el('div', {}, [
            U.el('h2', { class: 'cart__title' }, [
              U.el('span', { text: 'Current Order' }),
              U.el('span', { id: 'cart-count', class: 'cart__count', text: 'empty' })
            ]),
            U.el('div', { id: 'order-meta', class: 'cart__meta' })
          ]),
          U.el('div', { id: 'cart-ref', class: 'cart__ref', text: 'New order' })
        ]),
        U.el('div', { class: 'cart__tools' }, [
          UI.button('Details', orderOptions, 'btn--chip', '🧍'),
          UI.button('Discount', discountDialog, 'btn--chip', '％'),
          UI.button('Clear', function () {
            if (!cart.length) return;
            UI.confirm('Clear order?', 'All items on this order will be removed.', 'Clear', true)
              .then(function (yes) { if (yes) { resetOrder(); UI.toast('Order cleared'); } });
          }, 'btn--chip', '🗑')
        ]),
        U.el('div', { id: 'cart-body', class: 'cart__body' }),
        U.el('div', { id: 'cart-foot', class: 'cart__sum' }),
        U.el('div', { class: 'cart__actions' }, [
          U.el('button', { id: 'btn-hold', type: 'button', class: 'btn btn--ghost btn--lg',
            onclick: hold }, [U.el('span', { text: 'Hold (F6)' })]),
          U.el('button', { id: 'btn-settle', type: 'button', class: 'btn btn--primary btn--lg',
            onclick: settle }, [U.el('span', { text: 'Settle & Print (F4)' })])
        ])
      ])
    ]));

    // One delegated listener covers every price button in the menu.
    U.on(container.querySelector('#menu-body'), 'click', '.price-btn', function (e, btn) {
      addToCart(btn.dataset.item, btn.dataset.variant);
    });

    renderTabs();
    renderMenu();
    renderCart();
    renderHeaderMeta();
    refreshHeld();

    document.addEventListener('keydown', onKey);
    return function teardown() { document.removeEventListener('keydown', onKey); };
  }

  App.Views = App.Views || {};
  App.Views.pos = { title: 'Billing', render: render };
})(window.App = window.App || {});
