/*  store.js — domain layer.
 *  Small, frequently-read collections (settings, menu, staff, inventory) are
 *  cached in memory and written through to the database; bills, attendance and
 *  stock movements are queried by date range so the app stays fast after years
 *  of trading.
 */
(function (App) {
  'use strict';

  var DB = App.DB, U = App.U, Seed = App.Seed;

  var DEFAULT_SETTINGS = {
    id: 'app',
    name: 'Lavi The Dhawa',
    tagline: '& Family Restaurant',
    address: '',
    phone: '9340020696',
    gstin: '',
    fssai: '',
    billPrefix: 'LD',
    gstEnabled: false,
    gstRate: 5,
    serviceChargeEnabled: false,
    serviceChargeRate: 5,
    roundOff: true,
    currency: '₹',
    tables: 12,
    printFormat: '80mm',          // '80mm' thermal roll or 'a4'
    footerNote: 'Dhanyavaad! Phir aaiyega.',
    weekOff: '',                  // 0=Sun … 6=Sat, '' = none
    categories: null,             // filled from the seed on first run
    seeded: false
  };

  var state = {
    settings: null,
    menu: [],
    employees: [],
    inventory: []
  };

  var Store = { state: state };

  /* ------------------------------------------------------------- boot */

  Store.boot = function () {
    return DB.open()
      .then(function () { return DB.get('settings', 'app'); })
      .then(function (saved) {
        state.settings = Object.assign({}, DEFAULT_SETTINGS, saved || {});
        if (!Array.isArray(state.settings.categories) || !state.settings.categories.length) {
          state.settings.categories = Seed.categories.map(function (c) { return Object.assign({}, c); });
        }
        return DB.all('menu');
      })
      .then(function (menu) {
        if (menu.length) return menu;
        return DB.putMany('menu', Seed.menu()).then(function (rows) { return rows; });
      })
      .then(function (menu) {
        state.menu = menu;
        return DB.all('inventory');
      })
      .then(function (inv) {
        if (inv.length || state.settings.seeded) return inv;
        return DB.putMany('inventory', Seed.inventory());
      })
      .then(function (inv) {
        state.inventory = inv;
        return DB.all('employees');
      })
      .then(function (emps) {
        state.employees = emps;
        if (!state.settings.seeded) {
          state.settings.seeded = true;
          return DB.put('settings', state.settings);
        }
      })
      .then(function () { return Store; });
  };

  /* --------------------------------------------------------- settings */

  Store.settings = function () { return state.settings; };

  Store.saveSettings = function (patch) {
    Object.assign(state.settings, patch);
    return DB.put('settings', state.settings).then(function () { return state.settings; });
  };

  Store.categories = function () {
    return U.sortBy(state.settings.categories, 'sort');
  };

  Store.category = function (id) {
    return state.settings.categories.filter(function (c) { return c.id === id; })[0] ||
      { id: id, name: id, icon: '🍽️', popular: false, sort: 99 };
  };

  Store.saveCategory = function (cat) {
    var list = state.settings.categories;
    var i = list.findIndex(function (c) { return c.id === cat.id; });
    if (i >= 0) list[i] = Object.assign(list[i], cat);
    else list.push(Object.assign({ icon: '🍽️', popular: false, sort: list.length + 1 }, cat));
    return Store.saveSettings({ categories: list });
  };

  Store.removeCategory = function (id) {
    var used = state.menu.filter(function (m) { return m.cat === id; }).length;
    if (used) return Promise.reject(new Error(used + ' item(s) still use this category.'));
    return Store.saveSettings({
      categories: state.settings.categories.filter(function (c) { return c.id !== id; })
    });
  };

  /* ------------------------------------------------------------- menu */

  Store.menu = function () { return state.menu; };

  Store.activeMenu = function () {
    return state.menu.filter(function (m) { return m.active !== false; });
  };

  Store.menuItem = function (id) {
    return state.menu.filter(function (m) { return m.id === id; })[0];
  };

  Store.popularItems = function () {
    return Store.activeMenu().filter(function (m) { return m.popular; });
  };

  Store.saveMenuItem = function (item) {
    if (!item.id) item.id = U.uid('item');
    item.variants = (item.variants || []).filter(function (v) {
      return v.label && isFinite(v.price);
    }).map(function (v) {
      return { label: String(v.label).trim(), price: U.round2(v.price) };
    });
    if (!item.variants.length) return Promise.reject(new Error('Add at least one price for this item.'));
    var i = state.menu.findIndex(function (m) { return m.id === item.id; });
    if (i >= 0) state.menu[i] = item; else state.menu.push(item);
    return DB.put('menu', item).then(function () { return item; });
  };

  Store.removeMenuItem = function (id) {
    state.menu = state.menu.filter(function (m) { return m.id !== id; });
    return DB.del('menu', id);
  };

  Store.resetMenu = function () {
    return DB.clear('menu')
      .then(function () { return DB.putMany('menu', Seed.menu()); })
      .then(function (rows) { state.menu = rows; return rows; });
  };

  /* -------------------------------------------------------- bill maths */

  /*  cart line: { itemId, name, variant, price, qty, note }
   *  Returns every intermediate figure so the bill and the printout agree
   *  exactly — nothing is recomputed at print time.
   */
  Store.calcTotals = function (lines, opts) {
    var s = state.settings;
    opts = opts || {};

    var items = lines.map(function (l) {
      var qty = Math.max(0, U.num(l.qty));
      var price = U.round2(U.num(l.price));
      return Object.assign({}, l, { qty: qty, price: price, amount: U.round2(price * qty) });
    });

    var subtotal = U.round2(U.sum(items, function (l) { return l.amount; }));

    var discountType = opts.discountType || 'flat';
    var discountValue = Math.max(0, U.num(opts.discountValue));
    var discount = discountType === 'percent'
      ? U.round2(subtotal * Math.min(discountValue, 100) / 100)
      : U.round2(discountValue);
    discount = Math.min(discount, subtotal);

    var taxable = U.round2(subtotal - discount);

    var scRate = opts.serviceChargeEnabled === undefined
      ? (s.serviceChargeEnabled ? U.num(s.serviceChargeRate) : 0)
      : (opts.serviceChargeEnabled ? U.num(opts.serviceChargeRate) : 0);
    var serviceCharge = U.round2(taxable * scRate / 100);

    var gstRate = opts.gstEnabled === undefined
      ? (s.gstEnabled ? U.num(s.gstRate) : 0)
      : (opts.gstEnabled ? U.num(opts.gstRate) : 0);
    var taxBase = U.round2(taxable + serviceCharge);
    var tax = U.round2(taxBase * gstRate / 100);
    var cgst = U.round2(tax / 2);
    var sgst = U.round2(tax - cgst);

    var gross = U.round2(taxBase + tax);
    var roundOff = s.roundOff ? U.round2(Math.round(gross) - gross) : 0;
    var total = U.round2(gross + roundOff);

    return {
      items: items,
      count: items.length,
      qty: U.sum(items, function (l) { return l.qty; }),
      subtotal: subtotal,
      discountType: discountType,
      discountValue: discountValue,
      discount: discount,
      taxable: taxable,
      serviceChargeRate: scRate,
      serviceCharge: serviceCharge,
      gstRate: gstRate,
      tax: tax,
      cgst: cgst,
      sgst: sgst,
      gross: gross,
      roundOff: roundOff,
      total: total
    };
  };

  /* ------------------------------------------------------------ bills */

  Store.nextBillNo = function () {
    var s = state.settings;
    return DB.nextSeq('billNo', 1000).then(function (n) {
      return (s.billPrefix ? s.billPrefix + '-' : '') + n;
    });
  };

  Store.saveBill = function (bill) {
    if (!bill.id) bill.id = U.uid('bill');
    bill.updatedAt = Date.now();
    if (!bill.createdAt) bill.createdAt = bill.updatedAt;
    if (!bill.date) bill.date = U.today(new Date(bill.createdAt));
    return DB.put('bills', bill).then(function () { return bill; });
  };

  Store.getBill = function (id) { return DB.get('bills', id); };
  Store.removeBill = function (id) { return DB.del('bills', id); };

  Store.billsBetween = function (from, to) {
    return DB.range('bills', 'date', from, to).then(function (rows) {
      return rows.sort(function (a, b) { return b.createdAt - a.createdAt; });
    });
  };

  Store.openBills = function () {
    return DB.equals('bills', 'status', 'open').then(function (rows) {
      return rows.sort(function (a, b) { return a.createdAt - b.createdAt; });
    });
  };

  // Day / range roll-up used by the dashboard and the reports view.
  Store.summarise = function (bills) {
    var paid = bills.filter(function (b) { return b.status === 'paid'; });
    var byMode = {}, byItem = {}, byDate = {}, byCat = {};

    paid.forEach(function (b) {
      var mode = b.paymentMode || 'Cash';
      byMode[mode] = U.round2((byMode[mode] || 0) + b.total);
      byDate[b.date] = U.round2((byDate[b.date] || 0) + b.total);
      (b.items || []).forEach(function (l) {
        var k = l.name + (l.variant && l.variant !== 'Plate' ? ' (' + l.variant + ')' : '');
        var row = byItem[k] || (byItem[k] = { name: k, qty: 0, amount: 0 });
        row.qty += l.qty;
        row.amount = U.round2(row.amount + l.amount);
        var cat = l.cat || 'other';
        byCat[cat] = U.round2((byCat[cat] || 0) + l.amount);
      });
    });

    return {
      bills: paid.length,
      cancelled: bills.filter(function (b) { return b.status === 'cancelled'; }).length,
      open: bills.filter(function (b) { return b.status === 'open'; }).length,
      gross: U.round2(U.sum(paid, function (b) { return b.subtotal; })),
      discount: U.round2(U.sum(paid, function (b) { return b.discount; })),
      tax: U.round2(U.sum(paid, function (b) { return b.tax; })),
      net: U.round2(U.sum(paid, function (b) { return b.total; })),
      avg: paid.length ? U.round2(U.sum(paid, function (b) { return b.total; }) / paid.length) : 0,
      byMode: byMode,
      byDate: byDate,
      byCat: byCat,
      topItems: Object.keys(byItem).map(function (k) { return byItem[k]; })
        .sort(function (a, b) { return b.qty - a.qty; })
    };
  };

  /* -------------------------------------------------------- employees */

  Store.employees = function () { return U.sortBy(state.employees, 'name'); };

  Store.activeEmployees = function () {
    return Store.employees().filter(function (e) { return e.active !== false; });
  };

  Store.employee = function (id) {
    return state.employees.filter(function (e) { return e.id === id; })[0];
  };

  Store.saveEmployee = function (emp) {
    if (!emp.id) emp.id = U.uid('emp');
    var i = state.employees.findIndex(function (e) { return e.id === emp.id; });
    if (i >= 0) state.employees[i] = emp; else state.employees.push(emp);
    return DB.put('employees', emp).then(function () { return emp; });
  };

  Store.removeEmployee = function (id) {
    state.employees = state.employees.filter(function (e) { return e.id !== id; });
    return DB.del('employees', id);
  };

  /* -------------------------------------------------------- attendance */

  Store.attendanceId = function (empId, date) { return empId + '__' + date; };

  Store.attendanceForMonth = function (ym) {
    return DB.equals('attendance', 'month', ym);
  };

  Store.attendanceForDate = function (date) {
    return DB.equals('attendance', 'date', date);
  };

  Store.markAttendance = function (empId, date, patch) {
    var id = Store.attendanceId(empId, date);
    return DB.get('attendance', id).then(function (existing) {
      var row = Object.assign({
        id: id,
        empId: empId,
        date: date,
        month: date.slice(0, 7),
        status: 'present',
        inTime: '',
        outTime: '',
        overtime: 0,
        note: ''
      }, existing || {}, patch || {});
      return DB.put('attendance', row).then(function () { return row; });
    });
  };

  Store.clearAttendance = function (empId, date) {
    return DB.del('attendance', Store.attendanceId(empId, date));
  };

  // How a day counts towards salary.
  Store.DAY_WEIGHT = { present: 1, half: 0.5, leave: 0, absent: 0, off: 0, paidleave: 1 };

  Store.STATUS_META = {
    present:   { label: 'Present',    short: 'P',  cls: 'is-present' },
    half:      { label: 'Half Day',   short: 'H',  cls: 'is-half' },
    absent:    { label: 'Absent',     short: 'A',  cls: 'is-absent' },
    leave:     { label: 'Leave',      short: 'L',  cls: 'is-leave' },
    paidleave: { label: 'Paid Leave', short: 'PL', cls: 'is-paidleave' },
    off:       { label: 'Week Off',   short: 'WO', cls: 'is-off' }
  };

  /*  Payable salary for a month.
   *  Monthly staff are paid pro-rata on the calendar month; daily-wage staff on
   *  days actually worked. Overtime is paid at the day rate ÷ 8 per hour.
   */
  Store.payrollFor = function (emp, rows, ym) {
    var counts = { present: 0, half: 0, absent: 0, leave: 0, paidleave: 0, off: 0 };
    var overtime = 0;
    rows.forEach(function (r) {
      if (r.empId !== emp.id) return;
      if (counts[r.status] === undefined) counts[r.status] = 0;
      counts[r.status] += 1;
      overtime += U.num(r.overtime);
    });

    var days = U.daysInMonth(ym);
    var worked = counts.present + counts.paidleave + counts.half * 0.5;
    var salary = U.num(emp.salary);
    var dayRate = emp.salaryType === 'daily' ? salary : (days ? U.round2(salary / days) : 0);
    var base = U.round2(dayRate * worked);
    var otPay = U.round2((dayRate / 8) * overtime);
    var advance = U.num(emp.advance);

    return {
      counts: counts,
      worked: worked,
      overtime: overtime,
      dayRate: dayRate,
      base: base,
      otPay: otPay,
      advance: advance,
      payable: U.round2(base + otPay - advance)
    };
  };

  /* --------------------------------------------------------- inventory */

  Store.inventory = function () { return U.sortBy(state.inventory, 'name'); };

  Store.inventoryItem = function (id) {
    return state.inventory.filter(function (i) { return i.id === id; })[0];
  };

  Store.saveInventoryItem = function (item) {
    if (!item.id) item.id = U.uid('inv');
    item.stock = U.round2(U.num(item.stock));
    item.min = U.round2(U.num(item.min));
    item.cost = U.round2(U.num(item.cost));
    item.updatedAt = Date.now();
    var i = state.inventory.findIndex(function (x) { return x.id === item.id; });
    if (i >= 0) state.inventory[i] = item; else state.inventory.push(item);
    return DB.put('inventory', item).then(function () { return item; });
  };

  Store.removeInventoryItem = function (id) {
    state.inventory = state.inventory.filter(function (i) { return i.id !== id; });
    return DB.del('inventory', id);
  };

  Store.lowStock = function () {
    return Store.inventory().filter(function (i) {
      return i.active !== false && U.num(i.stock) <= U.num(i.min);
    });
  };

  Store.stockValue = function () {
    return U.round2(U.sum(state.inventory, function (i) { return U.num(i.stock) * U.num(i.cost); }));
  };

  /*  Records a movement and applies it to the item's stock in one step, so the
   *  ledger and the on-hand figure can never disagree.
   *  type: 'in' | 'out' | 'wastage' | 'adjust'  ('adjust' sets an absolute count)
   */
  Store.recordMove = function (itemId, type, qty, opts) {
    opts = opts || {};
    var item = Store.inventoryItem(itemId);
    if (!item) return Promise.reject(new Error('Inventory item not found.'));

    qty = U.round2(U.num(qty));
    if (type !== 'adjust' && qty <= 0) return Promise.reject(new Error('Enter a quantity greater than zero.'));

    var before = U.num(item.stock);
    var after;
    if (type === 'in') after = U.round2(before + qty);
    else if (type === 'out' || type === 'wastage') after = U.round2(before - qty);
    else after = qty;                       // adjust → absolute stock count

    if (after < 0) return Promise.reject(new Error('Not enough stock: only ' + item.stock + ' ' + item.unit + ' on hand.'));

    var move = {
      id: U.uid('mv'),
      itemId: itemId,
      itemName: item.name,
      unit: item.unit,
      type: type,
      qty: type === 'adjust' ? U.round2(after - before) : qty,
      before: before,
      after: after,
      rate: U.round2(U.num(opts.rate, item.cost)),
      note: opts.note || '',
      supplier: opts.supplier || '',
      date: opts.date || U.today(),
      createdAt: Date.now()
    };
    move.value = U.round2(Math.abs(move.qty) * move.rate);

    item.stock = after;
    // A purchase updates the item's running cost price.
    if (type === 'in' && opts.rate !== undefined && opts.rate !== '' && U.num(opts.rate) > 0) {
      item.cost = U.round2(U.num(opts.rate));
    }
    item.updatedAt = Date.now();

    return DB.put('inventory', item)
      .then(function () { return DB.put('moves', move); })
      .then(function () { return move; });
  };

  Store.movesBetween = function (from, to) {
    return DB.range('moves', 'date', from, to).then(function (rows) {
      return rows.sort(function (a, b) { return b.createdAt - a.createdAt; });
    });
  };

  App.Store = Store;
})(window.App = window.App || {});
