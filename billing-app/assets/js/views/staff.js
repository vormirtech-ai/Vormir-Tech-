/*  views/staff.js — the employee master record. */
(function (App) {
  'use strict';

  var U = App.U, UI = App.UI, Store = App.Store;
  var query = '', showInactive = false, root = null;

  var ROLES = ['Manager', 'Cashier', 'Chef / Cook', 'Tandoor', 'Helper', 'Waiter', 'Cleaner', 'Delivery'];

  function editor(existing) {
    var emp = existing || {
      name: '', code: '', role: 'Waiter', phone: '', address: '',
      salaryType: 'monthly', salary: '', advance: 0,
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
      { name: 'advance', label: 'Advance taken (₹)', type: 'number', value: emp.advance, min: 0, step: '1', width: 'half',
        hint: 'Deducted from this month’s payroll.' },
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
              salary: U.num(v.salary), advance: U.num(v.advance)
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

  function refresh() {
    if (!root) return;
    var list = Store.employees().filter(function (e) {
      if (!showInactive && e.active === false) return false;
      if (!query) return true;
      return U.match(e.name, query) || U.match(e.role || '', query) ||
        U.match(e.phone || '', query) || U.match(e.code || '', query);
    });

    var statsHost = root.querySelector('#staff-stats');
    var all = Store.activeEmployees();
    var monthly = all.filter(function (e) { return e.salaryType !== 'daily'; });
    statsHost.innerHTML = '';
    [
      UI.stat('Active Staff', String(all.length), Store.employees().length + ' on record', 'primary'),
      UI.stat('Monthly Wage Bill', '₹' + U.money(U.sum(monthly, function (e) { return U.num(e.salary); })), monthly.length + ' on monthly salary'),
      UI.stat('Daily Wage Staff', String(all.length - monthly.length), 'paid per day worked'),
      UI.stat('Advances Outstanding', '₹' + U.money(U.sum(all, function (e) { return U.num(e.advance); })), 'deducted at payroll')
    ].forEach(function (n) { statsHost.appendChild(n); });

    var host = root.querySelector('#staff-list');
    host.innerHTML = '';
    host.appendChild(UI.table([
      { key: 'name', label: 'Staff',
        render: function (e) {
          return '<div class="who"><span class="avatar">' + U.esc(e.name.slice(0, 1).toUpperCase()) + '</span>' +
            '<div><strong>' + U.esc(e.name) + '</strong>' +
            (e.code ? '<div class="muted">' + U.esc(e.code) + '</div>' : '') + '</div></div>';
        } },
      { key: 'role', label: 'Role', width: '140px', render: function (e) { return U.esc(e.role || 'Staff'); } },
      { key: 'phone', label: 'Phone', width: '140px',
        render: function (e) { return U.esc(e.phone || '') || '<span class="muted">—</span>'; } },
      { key: 'salary', label: 'Salary', align: 'right', width: '140px',
        render: function (e) {
          return '<strong>₹' + U.money(e.salary) + '</strong><div class="muted">' +
            (e.salaryType === 'daily' ? 'per day' : 'per month') + '</div>';
        } },
      { key: 'advance', label: 'Advance', align: 'right', width: '110px',
        render: function (e) { return U.num(e.advance) ? '₹' + U.money(e.advance) : '<span class="muted">—</span>'; } },
      { key: 'joinDate', label: 'Joined', width: '120px',
        render: function (e) { return e.joinDate ? U.esc(U.dateLabel(e.joinDate)) : '<span class="muted">—</span>'; } },
      { key: 'active', label: 'Status', align: 'center', width: '110px',
        render: function (e) { return e.active === false ? UI.badge('Left', 'grey') : UI.badge('Working', 'green'); } },
      { key: 'act', label: '', align: 'right', width: '130px',
        render: function (e) {
          return '<button type="button" class="link-btn" data-act="edit" data-id="' + U.esc(e.id) + '">Edit</button>' +
            '<button type="button" class="link-btn link-btn--danger" data-act="del" data-id="' + U.esc(e.id) + '">Delete</button>';
        } }
    ], list, { empty: 'No staff added yet.' }));
  }

  function render(container) {
    root = container;
    container.innerHTML = '';

    container.appendChild(UI.section('Staff', 'Your team, their wages and advances.', [
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
      if (btn.dataset.act === 'edit') editor(emp);
      else {
        UI.confirm('Delete ' + emp.name + '?', 'Their attendance history stays in the database.', 'Delete', true)
          .then(function (yes) {
            if (!yes) return;
            Store.removeEmployee(emp.id).then(function () { UI.ok('Staff removed.'); refresh(); });
          });
      }
    });

    refresh();
  }

  App.Views = App.Views || {};
  App.Views.staff = { title: 'Staff', render: render };
})(window.App = window.App || {});
