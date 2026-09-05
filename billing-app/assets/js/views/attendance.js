/*  views/attendance.js — daily marking, a month sheet and the payroll it feeds. */
(function (App) {
  'use strict';

  var U = App.U, UI = App.UI, Store = App.Store;

  var ym = U.month();
  var day = U.today();
  var tab = 'daily';
  var rows = [];          // attendance rows for the selected month
  var root = null;

  var CYCLE = ['present', 'half', 'absent', 'leave', 'off'];

  function rowFor(empId, date) {
    return rows.filter(function (r) { return r.empId === empId && r.date === date; })[0];
  }

  function statusOf(empId, date) {
    var r = rowFor(empId, date);
    if (r) return r.status;
    return U.isWeekOff(date, Store.settings().weekOff) ? 'off' : '';
  }

  function load() {
    return Store.attendanceForMonth(ym).then(function (list) {
      rows = list;
      return list;
    });
  }

  function setStatus(empId, date, status) {
    var apply = status
      ? Store.markAttendance(empId, date, { status: status })
      : Store.clearAttendance(empId, date);
    return apply.then(load).then(refresh);
  }

  function cycle(empId, date) {
    var current = statusOf(empId, date);
    var i = CYCLE.indexOf(current);
    var next = i === -1 ? CYCLE[0] : (i + 1 < CYCLE.length ? CYCLE[i + 1] : '');
    return setStatus(empId, date, next);
  }

  /* ------------------------------------------------------ daily view */

  function renderDaily() {
    var host = root.querySelector('#att-body');
    var staff = Store.activeEmployees();
    host.innerHTML = '';

    host.appendChild(U.el('div', { class: 'filters filters--inline' }, [
      U.el('div', { class: 'filters__group' }, [
        U.el('label', { class: 'field__label', text: 'Date' }),
        U.el('input', { class: 'input', type: 'date', value: day, max: U.today(),
          onchange: function (e) {
            day = e.target.value || U.today();
            var m = day.slice(0, 7);
            if (m !== ym) { ym = m; load().then(refresh); } else refresh();
          } })
      ]),
      U.el('div', { class: 'filters__presets' }, [
        UI.button('All Present', function () {
          Promise.all(staff.map(function (e) { return Store.markAttendance(e.id, day, { status: 'present' }); }))
            .then(load).then(refresh)
            .then(function () { UI.ok('Marked ' + staff.length + ' staff present.'); });
        }, 'btn--chip', '✓'),
        UI.button('Clear Day', function () {
          UI.confirm('Clear attendance?', 'Remove every mark for ' + U.dateLabel(day) + '.', 'Clear', true)
            .then(function (yes) {
              if (!yes) return;
              return Promise.all(staff.map(function (e) { return Store.clearAttendance(e.id, day); }))
                .then(load).then(refresh);
            });
        }, 'btn--chip', '↺')
      ])
    ]));

    if (!staff.length) {
      host.appendChild(UI.empty('👥', 'No staff yet',
        'Add your team first, then attendance can be marked here.',
        UI.button('Go to Staff', function () { App.Router.go('staff'); }, 'btn--primary')));
      return;
    }

    var list = U.el('div', { class: 'att-list' });
    staff.forEach(function (emp) {
      var current = statusOf(emp.id, day);
      var record = rowFor(emp.id, day) || {};

      var buttons = U.el('div', { class: 'att-status' });
      ['present', 'half', 'absent', 'leave', 'paidleave', 'off'].forEach(function (st) {
        var meta = Store.STATUS_META[st];
        buttons.appendChild(U.el('button', {
          type: 'button',
          class: 'att-btn ' + meta.cls + (current === st ? ' is-on' : ''),
          title: meta.label,
          onclick: function () { setStatus(emp.id, day, current === st ? '' : st); }
        }, [U.el('span', { text: meta.short })]));
      });

      list.appendChild(U.el('div', { class: 'att-row' }, [
        U.el('div', { class: 'att-row__who' }, [
          U.el('span', { class: 'avatar', text: emp.name.slice(0, 1).toUpperCase() }),
          U.el('div', {}, [
            U.el('div', { class: 'att-row__name', text: emp.name }),
            U.el('div', { class: 'muted', text: (emp.role || 'Staff') + ' • ' + (emp.salaryType === 'daily' ? '₹' + U.moneyShort(emp.salary) + '/day' : '₹' + U.moneyShort(emp.salary) + '/month') })
          ])
        ]),
        buttons,
        U.el('div', { class: 'att-row__times' }, [
          U.el('input', { class: 'input input--time', type: 'time', value: record.inTime || '', title: 'In time',
            onchange: function (e) { Store.markAttendance(emp.id, day, { inTime: e.target.value, status: statusOf(emp.id, day) || 'present' }).then(load); } }),
          U.el('span', { class: 'muted', text: '→' }),
          U.el('input', { class: 'input input--time', type: 'time', value: record.outTime || '', title: 'Out time',
            onchange: function (e) { Store.markAttendance(emp.id, day, { outTime: e.target.value, status: statusOf(emp.id, day) || 'present' }).then(load); } }),
          U.el('input', { class: 'input input--ot', type: 'number', min: '0', step: '0.5', value: record.overtime || '', placeholder: 'OT hrs', title: 'Overtime hours',
            onchange: function (e) { Store.markAttendance(emp.id, day, { overtime: U.num(e.target.value), status: statusOf(emp.id, day) || 'present' }).then(load); } })
        ])
      ]));
    });
    host.appendChild(list);

    host.appendChild(U.el('div', { class: 'legend' }, Object.keys(Store.STATUS_META).map(function (k) {
      var m = Store.STATUS_META[k];
      return U.el('span', { class: 'legend__item' }, [
        U.el('span', { class: 'legend__dot ' + m.cls, text: m.short }),
        U.el('span', { text: m.label })
      ]);
    })));
  }

  /* ------------------------------------------------- month sheet */

  function renderSheet() {
    var host = root.querySelector('#att-body');
    var staff = Store.activeEmployees();
    var days = U.daysInMonth(ym);
    host.innerHTML = '';

    if (!staff.length) {
      host.appendChild(UI.empty('👥', 'No staff yet', 'Add your team to build the month sheet.'));
      return;
    }

    var table = U.el('table', { class: 'table sheet' });
    var htr = U.el('tr', {}, [U.el('th', { class: 'sheet__name', text: 'Staff' })]);
    for (var d = 1; d <= days; d++) {
      var iso = ym + '-' + U.pad2(d);
      htr.appendChild(U.el('th', { class: 'sheet__day', title: U.dateLabel(iso) }, [
        U.el('span', { text: String(d) }),
        U.el('small', { text: U.DAY_NAMES[U.parseDate(iso).getDay()] })
      ]));
    }
    htr.appendChild(U.el('th', { class: 'ta-center', text: 'P' }));
    htr.appendChild(U.el('th', { class: 'ta-center', text: 'A' }));
    htr.appendChild(U.el('th', { class: 'ta-center', text: 'Paid Days' }));

    var tbody = U.el('tbody');
    staff.forEach(function (emp) {
      var tr = U.el('tr');
      tr.appendChild(U.el('td', { class: 'sheet__name' }, [
        U.el('strong', { text: emp.name }),
        U.el('div', { class: 'muted', text: emp.role || 'Staff' })
      ]));
      var present = 0, absent = 0, paid = 0;
      for (var i = 1; i <= days; i++) {
        var iso2 = ym + '-' + U.pad2(i);
        var st = statusOf(emp.id, iso2);
        var meta = st ? Store.STATUS_META[st] : null;
        if (st === 'present' || st === 'paidleave') { present++; paid += 1; }
        else if (st === 'half') { present++; paid += 0.5; }
        else if (st === 'absent') absent++;

        var cellFuture = iso2 > U.today();
        tr.appendChild(U.el('td', { class: 'sheet__cell' + (cellFuture ? ' is-future' : '') }, [
          U.el('button', {
            type: 'button',
            class: 'cell-btn ' + (meta ? meta.cls : 'is-blank'),
            dataset: { emp: emp.id, date: iso2 },
            title: emp.name + ' • ' + U.dateLabel(iso2) + (meta ? ' • ' + meta.label : ' • not marked'),
            text: meta ? meta.short : '·'
          })
        ]));
      }
      tr.appendChild(U.el('td', { class: 'ta-center', text: String(present) }));
      tr.appendChild(U.el('td', { class: 'ta-center', text: String(absent) }));
      tr.appendChild(U.el('td', { class: 'ta-center' }, [U.el('strong', { text: String(paid) })]));
      tbody.appendChild(tr);
    });

    table.appendChild(U.el('thead', {}, [htr]));
    table.appendChild(tbody);
    host.appendChild(U.el('div', { class: 'table-wrap table-wrap--sheet' }, [table]));
    host.appendChild(U.el('p', { class: 'muted hint', text: 'Tip: tap a box to cycle Present → Half → Absent → Leave → Week Off → blank.' }));
  }

  /* ----------------------------------------------------- payroll */

  function payslip(emp, pay) {
    var s = Store.settings();
    UI.print('<!doctype html><html><head><meta charset="utf-8"><title>Payslip</title><style>' +
      '@page{size:A4;margin:16mm}body{font-family:"Segoe UI",Arial,sans-serif;color:#14181f}' +
      'h1{font-size:22px;color:#1d2b45;margin:0}.tag{color:#b0311f;font-weight:600}' +
      'h2{font-size:13px;letter-spacing:2px;text-transform:uppercase;color:#5a6472;margin:20px 0 8px}' +
      'table{width:100%;border-collapse:collapse;font-size:13px}td{padding:7px 10px;border-bottom:1px solid #e6e9ee}' +
      '.r{text-align:right}.total td{border-top:2px solid #1d2b45;font-weight:800;font-size:16px;color:#1d2b45}' +
      '.sign{margin-top:60px;display:flex;justify-content:space-between;font-size:12px;color:#5a6472}' +
      '</style></head><body>' +
      '<h1>' + U.esc(s.name) + '</h1><div class="tag">' + U.esc(s.tagline) + '</div>' +
      '<h2>Salary Slip — ' + U.esc(U.monthLabel(ym)) + '</h2>' +
      '<table>' +
      '<tr><td>Employee</td><td class="r"><strong>' + U.esc(emp.name) + '</strong></td></tr>' +
      '<tr><td>Role</td><td class="r">' + U.esc(emp.role || 'Staff') + '</td></tr>' +
      '<tr><td>Salary basis</td><td class="r">' + (emp.salaryType === 'daily' ? 'Daily wage' : 'Monthly') + ' — ₹' + U.money(emp.salary) + '</td></tr>' +
      '<tr><td>Days paid</td><td class="r">' + pay.worked + ' of ' + U.daysInMonth(ym) + '</td></tr>' +
      '<tr><td>Present / Half / Absent / Leave</td><td class="r">' + pay.counts.present + ' / ' + pay.counts.half + ' / ' + pay.counts.absent + ' / ' + (pay.counts.leave + pay.counts.paidleave) + '</td></tr>' +
      '<tr><td>Day rate</td><td class="r">₹' + U.money(pay.dayRate) + '</td></tr>' +
      '<tr><td>Basic earned</td><td class="r">₹' + U.money(pay.base) + '</td></tr>' +
      '<tr><td>Overtime (' + pay.overtime + ' hrs)</td><td class="r">₹' + U.money(pay.otPay) + '</td></tr>' +
      '<tr><td>Advance / deduction</td><td class="r">− ₹' + U.money(pay.advance) + '</td></tr>' +
      '<tr class="total"><td>Net Payable</td><td class="r">₹' + U.money(pay.payable) + '</td></tr>' +
      '</table>' +
      '<p style="font-size:12px;color:#5a6472">Amount in words: ' + U.esc(U.words(pay.payable)) + '</p>' +
      '<div class="sign"><span>Employee signature</span><span>For ' + U.esc(s.name) + '</span></div>' +
      '</body></html>', 'Payslip');
  }

  function renderPayroll() {
    var host = root.querySelector('#att-body');
    var staff = Store.activeEmployees();
    host.innerHTML = '';

    var data = staff.map(function (emp) {
      return { emp: emp, pay: Store.payrollFor(emp, rows, ym) };
    });

    host.appendChild(UI.table([
      { key: 'name', label: 'Staff',
        render: function (r) { return '<strong>' + U.esc(r.emp.name) + '</strong><div class="muted">' + U.esc(r.emp.role || 'Staff') + '</div>'; } },
      { key: 'basis', label: 'Salary', align: 'right', width: '130px',
        render: function (r) { return '₹' + U.money(r.emp.salary) + '<div class="muted">' + (r.emp.salaryType === 'daily' ? 'per day' : 'per month') + '</div>'; } },
      { key: 'days', label: 'Paid Days', align: 'center', width: '110px',
        render: function (r) { return '<strong>' + r.pay.worked + '</strong><div class="muted">of ' + U.daysInMonth(ym) + '</div>'; } },
      { key: 'pa', label: 'P / H / A', align: 'center', width: '110px',
        render: function (r) { return r.pay.counts.present + ' / ' + r.pay.counts.half + ' / ' + r.pay.counts.absent; } },
      { key: 'ot', label: 'Overtime', align: 'right', width: '110px',
        render: function (r) { return r.pay.overtime + ' hrs<div class="muted">₹' + U.money(r.pay.otPay) + '</div>'; } },
      { key: 'base', label: 'Earned', align: 'right', width: '110px',
        render: function (r) { return '₹' + U.money(r.pay.base); } },
      { key: 'advance', label: 'Advance', align: 'right', width: '110px',
        render: function (r) { return r.pay.advance ? '− ₹' + U.money(r.pay.advance) : '<span class="muted">—</span>'; } },
      { key: 'payable', label: 'Net Payable', align: 'right', width: '130px',
        render: function (r) { return '<strong>₹' + U.money(r.pay.payable) + '</strong>'; },
        footer: function (rs) { return '<strong>₹' + U.money(U.sum(rs, function (r) { return r.pay.payable; })) + '</strong>'; } },
      { key: 'act', label: '', align: 'right', width: '90px',
        render: function (r) { return '<button type="button" class="link-btn" data-slip="' + U.esc(r.emp.id) + '">Payslip</button>'; } }
    ], data, { empty: 'Add staff to see payroll.', footer: true }));

    host.appendChild(U.el('p', { class: 'muted hint', text: 'Monthly salaries are pro-rated over the calendar month; daily wages are paid per day worked. Overtime is paid at the day rate ÷ 8 per hour. Set an advance on the staff record to deduct it here.' }));

    U.on(host, 'click', '[data-slip]', function (e, btn) {
      var row = data.filter(function (r) { return r.emp.id === btn.dataset.slip; })[0];
      if (row) payslip(row.emp, row.pay);
    });
  }

  /* ------------------------------------------------------ shell */

  function renderStats() {
    var host = root.querySelector('#att-stats');
    var staff = Store.activeEmployees();
    var todayRows = rows.filter(function (r) { return r.date === day; });
    var present = todayRows.filter(function (r) { return r.status === 'present' || r.status === 'paidleave'; }).length;
    var half = todayRows.filter(function (r) { return r.status === 'half'; }).length;
    var absent = todayRows.filter(function (r) { return r.status === 'absent'; }).length;
    var payable = U.sum(staff, function (e) { return Store.payrollFor(e, rows, ym).payable; });

    host.innerHTML = '';
    [
      UI.stat('Team Size', String(staff.length), 'active staff', 'primary'),
      UI.stat('Present on ' + U.dateLabel(day), present + (half ? ' + ' + half + ' half' : ''), absent + ' absent', absent ? 'warn' : ''),
      UI.stat('Marked This Month', String(rows.length), 'attendance entries'),
      UI.stat('Payroll ' + U.monthLabel(ym), '₹' + U.money(payable), 'net payable so far')
    ].forEach(function (n) { host.appendChild(n); });
  }

  function exportCSV() {
    var staff = Store.activeEmployees();
    var days = U.daysInMonth(ym);
    var header = ['Staff', 'Role'];
    for (var d = 1; d <= days; d++) header.push(String(d));
    header.push('Present', 'Half', 'Absent', 'Leave', 'Paid Days', 'Net Payable');

    var out = [header];
    staff.forEach(function (emp) {
      var pay = Store.payrollFor(emp, rows, ym);
      var line = [emp.name, emp.role || ''];
      for (var i = 1; i <= days; i++) {
        var st = statusOf(emp.id, ym + '-' + U.pad2(i));
        line.push(st ? Store.STATUS_META[st].short : '');
      }
      line.push(pay.counts.present, pay.counts.half, pay.counts.absent,
        pay.counts.leave + pay.counts.paidleave, pay.worked, pay.payable);
      out.push(line);
    });
    U.download('attendance-' + ym + '.csv', U.toCSV(out), 'text/csv;charset=utf-8');
    UI.ok('Attendance exported.');
  }

  function refresh() {
    if (!root) return;
    renderStats();
    if (tab === 'daily') renderDaily();
    else if (tab === 'sheet') renderSheet();
    else renderPayroll();
  }

  function render(container) {
    root = container;
    container.innerHTML = '';

    container.appendChild(UI.section('Attendance & Payroll', 'Mark the day, review the month, pay the team.', [
      U.el('input', {
        class: 'input input--month', type: 'month', value: ym,
        onchange: function (e) {
          ym = e.target.value || U.month();
          if (day.slice(0, 7) !== ym) day = ym + '-01';
          load().then(refresh);
        }
      }),
      UI.button('Export CSV', exportCSV, 'btn--ghost', '⬇'),
      UI.button('Manage Staff', function () { App.Router.go('staff'); }, 'btn--primary', '👥')
    ]));

    container.appendChild(U.el('div', { id: 'att-stats', class: 'stat-grid' }));

    var tabs = U.el('div', { class: 'subtabs' });
    [['daily', 'Mark Attendance'], ['sheet', 'Month Sheet'], ['payroll', 'Payroll']].forEach(function (t) {
      tabs.appendChild(U.el('button', {
        type: 'button', class: 'subtab' + (tab === t[0] ? ' is-active' : ''), text: t[1],
        onclick: function (e) {
          tab = t[0];
          U.qsa('.subtab', tabs).forEach(function (b) { b.classList.remove('is-active'); });
          e.target.classList.add('is-active');
          refresh();
        }
      }));
    });
    container.appendChild(tabs);
    container.appendChild(U.el('div', { id: 'att-body', class: 'card' }));

    U.on(container, 'click', '.cell-btn', function (e, btn) {
      cycle(btn.dataset.emp, btn.dataset.date);
    });

    load().then(refresh);
  }

  App.Views = App.Views || {};
  App.Views.attendance = { title: 'Attendance', render: render };
})(window.App = window.App || {});
