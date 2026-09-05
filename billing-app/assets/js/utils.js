/*  utils.js — formatting, dates and tiny DOM helpers.
 *  No dependencies: everything here must work with the network switched off.
 */
(function (App) {
  'use strict';

  var U = {};

  /* ---------------------------------------------------------- numbers */

  // Currency maths is done in rupees with 2-decimal rounding applied at every
  // step, so totals never drift by a paisa on long bills.
  U.round2 = function (n) {
    return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  };

  U.num = function (v, fallback) {
    var n = parseFloat(v);
    return isFinite(n) ? n : (fallback === undefined ? 0 : fallback);
  };

  U.money = function (n) {
    var v = U.round2(U.num(n));
    var neg = v < 0;
    v = Math.abs(v);
    var parts = v.toFixed(2).split('.');
    var int = parts[0];
    // Indian digit grouping: 12,34,567.89
    var last3 = int.slice(-3);
    var rest = int.slice(0, -3);
    if (rest) last3 = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3;
    return (neg ? '-' : '') + last3 + '.' + parts[1];
  };

  U.rupee = function (n) { return '₹' + U.money(n); };

  // Drops the ".00" tail for clean menu/price chips.
  U.moneyShort = function (n) {
    var v = U.round2(U.num(n));
    return v % 1 === 0 ? String(v) : U.money(v);
  };

  U.clamp = function (n, min, max) { return Math.min(max, Math.max(min, n)); };

  /* ------------------------------------------------------------ dates */

  U.pad2 = function (n) { return (n < 10 ? '0' : '') + n; };

  // Local-time ISO date (YYYY-MM-DD). Never use toISOString(): it shifts to UTC
  // and would file a 1 AM bill under the previous day.
  U.today = function (d) {
    d = d || new Date();
    return d.getFullYear() + '-' + U.pad2(d.getMonth() + 1) + '-' + U.pad2(d.getDate());
  };

  U.month = function (d) {
    d = d || new Date();
    return d.getFullYear() + '-' + U.pad2(d.getMonth() + 1);
  };

  U.parseDate = function (iso) {
    var p = String(iso || '').split('-');
    return new Date(+p[0], (+p[1] || 1) - 1, +p[2] || 1);
  };

  U.addDays = function (iso, days) {
    var d = U.parseDate(iso);
    d.setDate(d.getDate() + days);
    return U.today(d);
  };

  U.daysInMonth = function (ym) {
    var p = String(ym).split('-');
    return new Date(+p[0], +p[1], 0).getDate();
  };

  U.MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  U.DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  U.monthLabel = function (ym) {
    var p = String(ym).split('-');
    return U.MONTH_NAMES[(+p[1] || 1) - 1] + ' ' + p[0];
  };

  U.dateLabel = function (iso) {
    var d = U.parseDate(iso);
    return U.pad2(d.getDate()) + ' ' + U.MONTH_NAMES[d.getMonth()].slice(0, 3) + ' ' + d.getFullYear();
  };

  U.timeLabel = function (ts) {
    var d = new Date(ts);
    var h = d.getHours(), m = d.getMinutes();
    var ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return h + ':' + U.pad2(m) + ' ' + ap;
  };

  U.dateTimeLabel = function (ts) {
    return U.dateLabel(U.today(new Date(ts))) + ', ' + U.timeLabel(ts);
  };

  U.isWeekOff = function (iso, weekOffDay) {
    if (weekOffDay === '' || weekOffDay === null || weekOffDay === undefined) return false;
    return U.parseDate(iso).getDay() === Number(weekOffDay);
  };

  /* -------------------------------------------------------------- ids */

  U.uid = function (prefix) {
    return (prefix || 'id') + '-' + Date.now().toString(36) + '-' +
      Math.random().toString(36).slice(2, 8);
  };

  U.slug = function (text) {
    return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  };

  /* -------------------------------------------------------------- dom */

  U.el = function (tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k === 'dataset') Object.keys(v).forEach(function (d) { node.dataset[d] = v[d]; });
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v === true ? '' : v);
      });
    }
    (children || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  };

  U.esc = function (s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };

  U.qs = function (sel, root) { return (root || document).querySelector(sel); };
  U.qsa = function (sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  };

  U.on = function (root, event, selector, handler) {
    root.addEventListener(event, function (e) {
      var target = e.target.closest(selector);
      if (target && root.contains(target)) handler(e, target);
    });
  };

  U.debounce = function (fn, wait) {
    var t;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, wait || 200);
    };
  };

  /* ------------------------------------------------------------ misc */

  // Case- and space-insensitive "does the haystack contain the needle".
  U.match = function (haystack, needle) {
    return String(haystack).toLowerCase().indexOf(String(needle).toLowerCase().trim()) !== -1;
  };

  U.sortBy = function (arr, key) {
    return arr.slice().sort(function (a, b) {
      var x = a[key], y = b[key];
      if (typeof x === 'string') return x.localeCompare(y);
      return (x || 0) - (y || 0);
    });
  };

  U.sum = function (arr, fn) {
    return arr.reduce(function (t, x) { return t + (fn ? fn(x) : x); }, 0);
  };

  U.groupBy = function (arr, fn) {
    return arr.reduce(function (acc, x) {
      var k = fn(x);
      (acc[k] = acc[k] || []).push(x);
      return acc;
    }, {});
  };

  U.download = function (filename, content, mime) {
    var blob = content instanceof Blob ? content : new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  };

  U.toCSV = function (rows) {
    return rows.map(function (row) {
      return row.map(function (cell) {
        var s = cell === null || cell === undefined ? '' : String(cell);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(',');
    }).join('\r\n');
  };

  // Amount in words for the printed bill (Indian numbering).
  var ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
    'Seventeen', 'Eighteen', 'Nineteen'];
  var TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  function twoDigits(n) {
    if (n < 20) return ONES[n];
    return TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : '');
  }

  U.words = function (amount) {
    var n = Math.floor(Math.abs(U.num(amount)));
    if (n === 0) return 'Zero Rupees Only';
    var out = [];
    var units = [[10000000, 'Crore'], [100000, 'Lakh'], [1000, 'Thousand'], [100, 'Hundred']];
    units.forEach(function (u) {
      if (n >= u[0]) {
        out.push(twoDigits(Math.floor(n / u[0])) + ' ' + u[1]);
        n = n % u[0];
      }
    });
    if (n > 0) out.push(twoDigits(n));
    return out.join(' ').replace(/\s+/g, ' ').trim() + ' Rupees Only';
  };

  App.U = U;
})(window.App = window.App || {});
