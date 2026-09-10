/*  views/staff.js — the team, their wages, and the money they take.
 *  The kharcha ledger is the daily reality of a dhaba: a waiter takes ₹100 at
 *  noon, the tandoor takes ₹200 on Friday. Each entry is dated, and payroll
 *  subtracts the month's total automatically.
 */
(function (App) {
  'use strict';

  var U = App.U, UI = App.UI, Store = App.Store;
  var query = '', showInactive = false, root = null;
  var ym = U.month();
  var ledger = [];

  var ROLES = ['Manager', 'Cashier', 'Chef / Cook', 'Tandoor', 'Helper', 'Waiter', 'Cleaner', 'Delivery'];

  /* ---------------------------------------------------- staff editor */

  function editor(existing) {
    var emp = existing || {
      name: '', code: '', role: 'Waiter', phone: '', address: '',
      salaryType: 'monthly', salary: '', advance: 0, advanceMigrated: true,
      joinDate: U.today(), active: true
    };

    var form = UI.form([
      { name: 'name', label: 'Full name', type: 'text', value: emp.name, required: true, width: 'half', autofocus: true },
      { name: 'code', label: 'Staff code', type: 'text', value: emp.code, width: 'half', placeholder: 'Optional' },
      { name: 'role', label: 'Role', type: 'select', value: emp.role, width: 'half',
        options: ROLES.map(function (r) { return { value: r, label: r }; }) },
      { name: 'phone', label: 'Phone', type: 'tel', value: emp.phone, width: 'half' },
      { name: 'salaryType', label: 'Salary basis', type: 'select', value: emp.salaryType, width: 'half',
        options: [{ value: 'monthly', label: 'Monthly salary' }, { value: 'daily', label: 'Daily wage' }] },
      { name: 'salary', label: 'Amount (₹)', type: 'number', value: emp.salary, min: 0, step: '1', width: 'half', required: true },
      { name: 'joinDate', label: 'Joining date', type: 'date', value: emp.joinDate, width: 'half' },
      { name: 'address', label: 'Address', type: 'textarea', rows: 2, value: emp.address },
      { name: 'active', label: 'Currently working', type: 'checkbox', value: emp.active !== false }
    ]);

    UI.modal({
      title: existing ? 'Edit ' + emp.name : 'Add staff member',
      body: form.node,
      actions: [
        { label: 'Cancel', value: false },
        {
          label: 'Save', primary: true,
          onClick: function (close) {
            if (!form.validate()) return false;
            var v = form.values();
            return Store.saveEmployee(Object.assign({}, emp, v, {
              salary: U.num(v.salary), advanceMigrated: true
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

  /* ------------------------------------------------- kharcha ledger */

  function takenBy(empId) {
    return ledger.filter(function (r) { return r.empId === empId; });
  }

  function netTaken(empId) {
    return U.round2(U.sum(takenBy(empId), function (r) {
      return r.type === 'bonus' ? -r.amount : r.amount;
    }));
  }

  /*  The one-tap entry: "Ramesh took ₹100". Preset buttons cover the amounts
   *  a dhaba hands out all day; anything else is typed in.
   */
  function quickTake(emp) {
    var form = UI.form([
      { name: 'amount', label: 'Amount (₹)', type: 'number', min: 0, step: '1', required: true,
        autofocus: true, width: 'half' },
      { name: 'type', label: 'Type', type: 'select', value: 'advance', width: 'half',
        options: Object.keys(Store.LEDGER_TYPES).map(function (k) {
          return { value: k, label: Store.LEDGER_TYPES[k].label };
        }) },
      { name: 'date', label: 'Date', type: 'date', value: U.today(), width: 'half' },
      { name: 'note', label: 'Note', type: 'text', placeholder: 'Optional', width: 'half' }
    ]);

    var presets = U.el('div', { class: 'amount-presets' },
      [50, 100, 200, 500, 1000].map(function (n) {
        return U.el('button', { type: 'button', class: 'btn btn--chip', text: '₹' + n,
          onclick: function () { form.inputs.amount.value = n; form.inputs.amount.focus(); } });
      }));

    var body = U.el('div', {}, [
      U.el('div', { class: 'settle__total' }, [
        U.el('span', { text: emp.name + ' — taken in ' + U.monthLabel(ym) }),
        U.el('strong', { text: '₹' + U.money(netTaken(emp.id)) })
      ]),
      presets,
      form.node
    ]);

    return UI.modal({
      title: 'Paisa diya — ' + emp.name,
      body: body,
      actions: [
        { label: 'Cancel', value: false },
        {
          label: 'Save entry', primary: true,
          onClick: function (close) {
            if (!form.validate()) return false;
            var v = form.values();
            return Store.addStaffLedger({
              empId: emp.id, amount: v.amount, type: v.type, date: v.date, note: v.note
            }).then(function () {
              UI.ok(emp.name + ': ₹' + U.money(v.amount) + ' — ' + Store.LEDGER_TYPES[v.type].label);
              close(true);
              return load();
            });
          }
        }
      ]
    });
  }

  function ledgerFor(emp) {
    var body = U.el('div');

    function draw() {
      var mine = takenBy(emp.id).sort(function (a, b) { return b.createdAt - a.createdAt; });
      body.innerHTML = '';
      body.appendChild(U.el('div', { class: 'settle__total' }, [
        U.el('span', { text: 'Net taken in ' + U.monthLabel(ym) }),
        U.el('strong', { text: '₹' + U.money(netTaken(emp.id)) })
      ]));
      body.appendChild(UI.table([
        { key: 'date', label: 'Date', width: '140px',
          render: function (r) { return U.esc(U.dateLabel(r.date)) + '<div class="muted">' + U.esc(U.timeLabel(r.createdAt)) + '</div>'; } },
        { key: 'type', label: 'Type', width: '160px',
          render: function (r) {
            var m = Store.LEDGER_TYPES[r.type] || Store.LEDGER_TYPES.advance;
            return UI.badge(m.label, m.tone);
          } },
        { key: 'note', label: 'Note',
          render: function (r) { return U.esc(r.note || '') || '<span class="muted">—</span>'; } },
        { key: 'amount', label: 'Amount', align: 'right', width: '110px',
          render: function (r) {
            var bonus = r.type === 'bonus';
            return '<strong class="' + (bonus ? '' : 'is-low') + '">' + (bonus ? '+ ' : '− ') + '₹' + U.money(r.amount) + '</strong>';
          } },
        { key: 'act', label: '', align: 'right', width: '80px',
          render: function (r) { return '<button type="button" class="link-btn link-btn--danger" data-del="' + U.esc(r.id) + '">Delete</button>'; } }
      ], mine, { empty: 'Nothing taken this month.' }));
    }

    draw();

    U.on(body, 'click', '[data-del]', function (e, btn) {
      UI.confirm('Delete this entry?', 'It will stop counting against the salary.', 'Delete', true)
        .then(function (yes) {
          if (!yes) return;
          Store.removeStaffLedger(btn.dataset.del)
            .then(load)
            .then(function () { draw(); UI.ok('Entry deleted.'); });
        });
    });

    UI.modal({
      title: emp.name + ' — kharcha khata',
      size: 'lg',
      body: body,
      actions: [
        { label: 'Close', value: null },
        { label: 'Add entry', primary: true,
          onClick: function () { quickTake(emp).then(draw); return false; } }
      ]
    });
  }

  /* ---------------------------------------------------------- list */

  function exportCSV() {
    var out = [['Date', 'Staff', 'Type', 'Amount', 'Note']];
    ledger.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; }).forEach(function (r) {
      out.push([r.date, r.empName, (Store.LEDGER_TYPES[r.type] || {}).label || r.type, r.amount, r.note || '']);
    });
    U.download('staff-kharcha-' + ym + '.csv', U.toCSV(out), 'text/csv;charset=utf-8');
    UI.ok('Exported ' + (out.length - 1) + ' entries.');
  }

  function refresh() {
    if (!root) return;
    var s = Store.settings();
    var list = Store.employees().filter(function (e) {
      if (!showInactive && e.active === false) return false;
      if (!query) return true;
      return U.match(e.name, query) || U.match(e.role || '', query) ||
        U.match(e.phone || '', query) || U.match(e.code || '', query);
    });

    var all = Store.activeEmployees();
    var monthly = all.filter(function (e) { return e.salaryType !== 'daily'; });
    var takenTotal = U.round2(U.sum(all, function (e) { return netTaken(e.id); }));

    var statsHost = root.querySelector('#staff-stats');
    statsHost.innerHTML = '';
    [
      UI.stat('Active Staff', String(all.length), Store.employees().length + ' on record', 'primary'),
      UI.stat('Monthly Wage Bill', s.currency + U.money(U.sum(monthly, function (e) { return U.num(e.salary); })),
        monthly.length + ' on monthly salary'),
      UI.stat('Taken in ' + U.monthLabel(ym), s.currency + U.money(takenTotal),
        ledger.length + ' entries', takenTotal ? 'warn' : ''),
      UI.stat('Daily Wage Staff', String(all.length - monthly.length), 'paid per day worked')
    ].forEach(function (n) { statsHost.appendChild(n); });

    var host = root.querySelector('#staff-list');
    host.innerHTML = '';
    host.appendChild(UI.table([
      { key: 'name', label: 'Staff',
        render: function (e) {
          return '<div class="who"><span class="avatar">' + U.esc(e.name.slice(0, 1).toUpperCase()) + '</span>' +
            '<div><strong>' + U.esc(e.name) + '</strong>' +
            '<div class="muted">' + U.esc(e.role || 'Staff') + (e.code ? ' • ' + U.esc(e.code) : '') + '</div></div></div>';
        } },
      { key: 'phone', label: 'Phone', width: '130px',
        render: function (e) { return U.esc(e.phone || '') || '<span class="muted">—</span>'; } },
      { key: 'salary', label: 'Salary', align: 'right', width: '130px',
        render: function (e) {
          return '<strong>' + s.currency + U.money(e.salary) + '</strong><div class="muted">' +
            (e.salaryType === 'daily' ? 'per day' : 'per month') + '</div>';
        } },
      { key: 'taken', label: 'Taken (' + U.monthLabel(ym).split(' ')[0] + ')', align: 'right', width: '130px',
        render: function (e) {
          var n = netTaken(e.id);
          var count = takenBy(e.id).length;
          if (!count) return '<span class="muted">—</span>';
          // A negative net means bonuses outweigh advances — the dhaba owes them.
          return '<strong class="' + (n < 0 ? 'is-credit' : 'is-low') + '">' +
            (n < 0 ? '+ ' : '') + s.currency + U.money(Math.abs(n)) + '</strong>' +
            '<div class="muted">' + count + ' entr' + (count === 1 ? 'y' : 'ies') + '</div>';
        },
        footer: function (rs) {
          var total = U.sum(rs, function (e) { return netTaken(e.id); });
          return '<strong class="' + (total < 0 ? 'is-credit' : 'is-low') + '">' +
            (total < 0 ? '+ ' : '') + s.currency + U.money(Math.abs(total)) + '</strong>';
        } },
      { key: 'joinDate', label: 'Joined', width: '115px',
        render: function (e) { return e.joinDate ? U.esc(U.dateLabel(e.joinDate)) : '<span class="muted">—</span>'; } },
      { key: 'active', label: 'Status', align: 'center', width: '100px',
        render: function (e) { return e.active === false ? UI.badge('Left', 'grey') : UI.badge('Working', 'green'); } },
      { key: 'act', label: '', align: 'right', width: '250px', className: 'nowrap',
        render: function (e) {
          return '<button type="button" class="btn btn--chip btn--primary" data-act="take" data-id="' + U.esc(e.id) + '">Paisa diya</button>' +
            '<button type="button" class="link-btn" data-act="ledger" data-id="' + U.esc(e.id) + '">Khata</button>' +
            '<button type="button" class="link-btn" data-act="edit" data-id="' + U.esc(e.id) + '">Edit</button>' +
            '<button type="button" class="link-btn link-btn--danger" data-act="del" data-id="' + U.esc(e.id) + '">Delete</button>';
        } }
    ], list, { empty: 'No staff added yet.', footer: true }));
  }

  function load() {
    return Store.staffLedgerForMonth(ym).then(function (rows) {
      ledger = rows;
      refresh();
    });
  }

  function render(container) {
    root = container;
    container.innerHTML = '';

    container.appendChild(UI.section('Staff', 'The team, their wages and the money they take.', [
      U.el('input', {
        class: 'input input--month', type: 'month', value: ym,
        onchange: function (e) { ym = e.target.value || U.month(); load(); }
      }),
      UI.button('Export Kharcha', exportCSV, 'btn--ghost', '⬇'),
      UI.button('Attendance', function () { App.Router.go('attendance'); }, 'btn--ghost', '📅'),
      UI.button('Add Staff', function () { editor(null); }, 'btn--primary', '＋')
    ]));

    container.appendChild(U.el('div', { id: 'staff-stats', class: 'stat-grid' }));

    container.appendChild(U.el('div', { class: 'filters card' }, [
      U.el('div', { class: 'filters__group filters__group--grow' }, [
        U.el('label', { class: 'field__label', text: 'Search' }),
        U.el('input', { class: 'input', type: 'search', placeholder: 'Name, role or phone…',
          oninput: U.debounce(function (e) { query = e.target.value.trim(); refresh(); }, 150) })
      ]),
      U.el('div', { class: 'filters__group' }, [
        U.el('label', { class: 'field__label', text: 'Show' }),
        U.el('label', { class: 'check-row' }, [
          U.el('input', { type: 'checkbox', class: 'checkbox',
            onchange: function (e) { showInactive = e.target.checked; refresh(); } }),
          U.el('span', { text: 'Include staff who left' })
        ])
      ])
    ]));

    container.appendChild(U.el('div', { id: 'staff-list', class: 'card card--flush' }));

    U.on(container, 'click', '[data-act]', function (e, btn) {
      var emp = Store.employee(btn.dataset.id);
      if (!emp) return;
      var act = btn.dataset.act;
      if (act === 'edit') editor(emp);
      else if (act === 'take') quickTake(emp);
      else if (act === 'ledger') ledgerFor(emp);
      else {
        UI.confirm('Delete ' + emp.name + '?', 'Their attendance and kharcha history stays in the database.', 'Delete', true)
          .then(function (yes) {
            if (!yes) return;
            Store.removeEmployee(emp.id).then(function () { UI.ok('Staff removed.'); refresh(); });
          });
      }
    });

    load();
  }

  App.Views = App.Views || {};
  App.Views.staff = { title: 'Staff', render: render };
})(window.App = window.App || {});
