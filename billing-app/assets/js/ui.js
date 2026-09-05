/*  ui.js — the shared widget kit: toasts, modals, forms, tables and the
 *  hand-rolled bar chart. Deliberately dependency-free.
 */
(function (App) {
  'use strict';

  var U = App.U;
  var UI = {};

  /* ------------------------------------------------------------ toast */

  var toastHost = null;

  UI.toast = function (message, kind, ms) {
    if (!toastHost) {
      toastHost = U.el('div', { class: 'toast-host', role: 'status', 'aria-live': 'polite' });
      document.body.appendChild(toastHost);
    }
    var node = U.el('div', { class: 'toast toast--' + (kind || 'info') }, [
      U.el('span', { class: 'toast__icon', text: kind === 'error' ? '⚠' : kind === 'success' ? '✓' : 'ℹ' }),
      U.el('span', { class: 'toast__msg', text: message })
    ]);
    toastHost.appendChild(node);
    setTimeout(function () { node.classList.add('is-in'); }, 10);
    setTimeout(function () {
      node.classList.remove('is-in');
      setTimeout(function () { if (node.parentNode) node.parentNode.removeChild(node); }, 250);
    }, ms || (kind === 'error' ? 4200 : 2400));
  };

  UI.ok = function (m) { UI.toast(m, 'success'); };
  UI.err = function (m) { UI.toast(m instanceof Error ? m.message : m, 'error'); };

  /* ------------------------------------------------------------ modal */

  var openModals = [];

  /*  UI.modal({ title, body, size, actions:[{label, kind, value, primary}] })
   *  Resolves with the chosen action's `value`, or null when dismissed.
   *  `onSubmit` (if given) may return false to keep the dialog open.
   */
  UI.modal = function (opts) {
    return new Promise(function (resolve) {
      var settled = false;
      var overlay = U.el('div', { class: 'modal-overlay' });
      var dialog = U.el('div', {
        class: 'modal modal--' + (opts.size || 'md'),
        role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.title || 'Dialog'
      });

      function close(value) {
        if (settled) return;
        settled = true;
        overlay.classList.remove('is-in');
        document.removeEventListener('keydown', onKey, true);
        var i = openModals.indexOf(overlay);
        if (i >= 0) openModals.splice(i, 1);
        if (!openModals.length) document.body.classList.remove('is-modal-open');
        setTimeout(function () { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }, 180);
        resolve(value === undefined ? null : value);
      }

      function onKey(e) {
        if (openModals[openModals.length - 1] !== overlay) return;
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(null); }
        if (e.key === 'Enter' && opts.submitOnEnter !== false) {
          var tag = (e.target.tagName || '').toLowerCase();
          if (tag === 'textarea' || tag === 'button' || tag === 'select') return;
          var primary = dialog.querySelector('[data-primary="1"]');
          if (primary) { e.preventDefault(); primary.click(); }
        }
      }

      var header = U.el('div', { class: 'modal__head' }, [
        U.el('h3', { class: 'modal__title', text: opts.title || '' }),
        U.el('button', {
          class: 'icon-btn', type: 'button', 'aria-label': 'Close',
          onclick: function () { close(null); }
        }, [U.el('span', { html: '&times;' })])
      ]);

      var body = U.el('div', { class: 'modal__body' });
      if (typeof opts.body === 'string') body.innerHTML = opts.body;
      else if (opts.body) body.appendChild(opts.body);

      var footer = U.el('div', { class: 'modal__foot' });
      var actions = opts.actions || [{ label: 'Close', value: null }];
      actions.forEach(function (a) {
        var btn = U.el('button', {
          type: 'button',
          class: 'btn ' + (a.primary ? 'btn--primary' : a.kind === 'danger' ? 'btn--danger' : 'btn--ghost'),
          text: a.label,
          dataset: a.primary ? { primary: '1' } : {},
          onclick: function () {
            if (a.onClick) {
              var res = a.onClick(close);
              if (res === false) return;
              if (res && typeof res.then === 'function') {
                btn.disabled = true;
                res.then(function (r) { btn.disabled = false; if (r !== false) close(a.value); })
                   .catch(function (e) { btn.disabled = false; UI.err(e); });
                return;
              }
            }
            close(a.value);
          }
        });
        footer.appendChild(btn);
      });

      dialog.appendChild(header);
      dialog.appendChild(body);
      if (actions.length) dialog.appendChild(footer);
      overlay.appendChild(dialog);
      overlay.addEventListener('mousedown', function (e) {
        if (e.target === overlay && opts.dismissible !== false) close(null);
      });

      document.body.appendChild(overlay);
      document.body.classList.add('is-modal-open');
      openModals.push(overlay);
      document.addEventListener('keydown', onKey, true);
      setTimeout(function () {
        overlay.classList.add('is-in');
        var focus = dialog.querySelector('[data-autofocus], input:not([type=hidden]), select, textarea, button');
        if (focus) focus.focus();
      }, 20);
    });
  };

  UI.confirm = function (title, message, confirmLabel, danger) {
    return UI.modal({
      title: title,
      size: 'sm',
      body: U.el('p', { class: 'modal__text', text: message }),
      actions: [
        { label: 'Cancel', value: false },
        { label: confirmLabel || 'Confirm', value: true, primary: !danger, kind: danger ? 'danger' : '' }
      ]
    }).then(function (v) { return v === true; });
  };

  UI.alert = function (title, message) {
    return UI.modal({
      title: title, size: 'sm',
      body: U.el('p', { class: 'modal__text', text: message }),
      actions: [{ label: 'OK', value: true, primary: true }]
    });
  };

  /* ------------------------------------------------------------- form */

  /*  Builds a form from a field spec and returns { node, values, focus }.
   *  field: { name, label, type, value, options, required, min, max, step,
   *           hint, placeholder, width: 'full'|'half'|'third' }
   */
  UI.form = function (fields) {
    var grid = U.el('div', { class: 'form-grid' });
    var inputs = {};

    fields.forEach(function (f) {
      if (!f) return;
      var wrap = U.el('div', { class: 'field field--' + (f.width || 'full') });
      var id = 'f-' + f.name + '-' + Math.random().toString(36).slice(2, 6);
      var input;

      if (f.type === 'select') {
        input = U.el('select', { id: id, class: 'input' });
        (f.options || []).forEach(function (o) {
          var opt = U.el('option', { value: o.value, text: o.label });
          if (String(o.value) === String(f.value)) opt.selected = true;
          input.appendChild(opt);
        });
      } else if (f.type === 'textarea') {
        input = U.el('textarea', { id: id, class: 'input', rows: f.rows || 3, placeholder: f.placeholder || '' });
        input.value = f.value === undefined || f.value === null ? '' : f.value;
      } else if (f.type === 'checkbox') {
        input = U.el('input', { id: id, type: 'checkbox', class: 'checkbox' });
        input.checked = !!f.value;
      } else {
        input = U.el('input', {
          id: id, class: 'input', type: f.type || 'text',
          placeholder: f.placeholder || '',
          min: f.min, max: f.max, step: f.step,
          inputmode: f.type === 'number' ? 'decimal' : null,
          autocomplete: 'off'
        });
        input.value = f.value === undefined || f.value === null ? '' : f.value;
      }

      if (f.required) input.required = true;
      if (f.autofocus) input.setAttribute('data-autofocus', '1');
      if (f.onInput) input.addEventListener('input', f.onInput);
      inputs[f.name] = input;

      if (f.type === 'checkbox') {
        wrap.appendChild(U.el('label', { class: 'check-row', for: id }, [
          input, U.el('span', { text: f.label })
        ]));
      } else {
        wrap.appendChild(U.el('label', { class: 'field__label', for: id, text: f.label }));
        wrap.appendChild(input);
      }
      if (f.hint) wrap.appendChild(U.el('div', { class: 'field__hint', text: f.hint }));
      grid.appendChild(wrap);
    });

    return {
      node: grid,
      inputs: inputs,
      values: function () {
        var out = {};
        fields.forEach(function (f) {
          if (!f) return;
          var input = inputs[f.name];
          if (f.type === 'checkbox') out[f.name] = input.checked;
          else if (f.type === 'number') out[f.name] = input.value === '' ? '' : U.num(input.value);
          else out[f.name] = input.value.trim ? input.value.trim() : input.value;
        });
        return out;
      },
      validate: function () {
        var bad = null;
        fields.forEach(function (f) {
          if (!f || !f.required || bad) return;
          var input = inputs[f.name];
          var v = f.type === 'checkbox' ? input.checked : String(input.value).trim();
          if (!v && v !== 0) { bad = f; }
        });
        if (bad) {
          inputs[bad.name].focus();
          UI.err(bad.label + ' is required.');
          return false;
        }
        return true;
      }
    };
  };

  /* ------------------------------------------------------------ table */

  /*  UI.table(columns, rows, opts)
   *  column: { key, label, align, width, className, render(row, index), footer }
   */
  UI.table = function (columns, rows, opts) {
    opts = opts || {};
    var table = U.el('table', { class: 'table ' + (opts.className || '') });
    var thead = U.el('thead');
    var htr = U.el('tr');
    columns.forEach(function (c) {
      htr.appendChild(U.el('th', {
        class: (c.align ? 'ta-' + c.align : '') + (c.className ? ' ' + c.className : ''),
        style: c.width ? 'width:' + c.width : null,
        text: c.label
      }));
    });
    thead.appendChild(htr);
    table.appendChild(thead);

    var tbody = U.el('tbody');
    if (!rows.length) {
      tbody.appendChild(U.el('tr', {}, [
        U.el('td', { class: 'table__empty', colspan: columns.length, text: opts.empty || 'Nothing here yet.' })
      ]));
    } else {
      rows.forEach(function (row, i) {
        var tr = U.el('tr', {
          class: opts.rowClass ? opts.rowClass(row, i) : null,
          dataset: opts.rowId ? { id: opts.rowId(row) } : {}
        });
        columns.forEach(function (c) {
          var td = U.el('td', {
            class: (c.align ? 'ta-' + c.align : '') + (c.className ? ' ' + c.className : '')
          });
          var content = c.render ? c.render(row, i) : row[c.key];
          if (content === null || content === undefined) content = '';
          if (typeof content === 'object' && content.nodeType) td.appendChild(content);
          else td.innerHTML = String(content);
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
    }
    table.appendChild(tbody);

    if (opts.footer) {
      var tfoot = U.el('tfoot');
      var ftr = U.el('tr');
      columns.forEach(function (c) {
        var content = c.footer ? c.footer(rows) : '';
        ftr.appendChild(U.el('td', { class: c.align ? 'ta-' + c.align : '', html: String(content) }));
      });
      tfoot.appendChild(ftr);
      table.appendChild(tfoot);
    }

    return U.el('div', { class: 'table-wrap' }, [table]);
  };

  /* -------------------------------------------------------- fragments */

  UI.empty = function (icon, title, text, action) {
    return U.el('div', { class: 'empty' }, [
      U.el('div', { class: 'empty__icon', text: icon }),
      U.el('h3', { class: 'empty__title', text: title }),
      text ? U.el('p', { class: 'empty__text', text: text }) : null,
      action || null
    ]);
  };

  UI.stat = function (label, value, sub, tone) {
    return U.el('div', { class: 'stat' + (tone ? ' stat--' + tone : '') }, [
      U.el('div', { class: 'stat__label', text: label }),
      U.el('div', { class: 'stat__value', text: value }),
      sub ? U.el('div', { class: 'stat__sub', text: sub }) : null
    ]);
  };

  UI.badge = function (text, tone) {
    return '<span class="badge badge--' + (tone || 'grey') + '">' + U.esc(text) + '</span>';
  };

  UI.section = function (title, subtitle, actions) {
    return U.el('div', { class: 'section-head' }, [
      U.el('div', {}, [
        U.el('h2', { class: 'section-head__title', text: title }),
        subtitle ? U.el('p', { class: 'section-head__sub', text: subtitle }) : null
      ]),
      actions ? U.el('div', { class: 'section-head__actions' }, actions) : null
    ]);
  };

  UI.button = function (label, onClick, kind, icon) {
    return U.el('button', { type: 'button', class: 'btn ' + (kind || 'btn--ghost'), onclick: onClick }, [
      icon ? U.el('span', { class: 'btn__icon', text: icon }) : null,
      U.el('span', { text: label })
    ]);
  };

  /*  A small column chart built from plain elements — no library, and no
   *  aspect-ratio distortion when a range has only a handful of bars.
   *  Values: [{label, value, highlight}].
   */
  UI.barChart = function (data, opts) {
    opts = opts || {};
    var max = Math.max.apply(null, data.map(function (d) { return d.value; }).concat([0]));
    var plot = U.el('div', { class: 'chart', role: 'img', 'aria-label': opts.label || 'Chart' });

    data.forEach(function (d) {
      var pct = max > 0 ? (d.value / max) * 100 : 0;
      var col = U.el('div', {
        class: 'chart__col',
        title: d.label + ': ' + (opts.format ? opts.format(d.value) : d.value)
      }, [
        U.el('div', {
          class: 'chart__bar' + (d.highlight ? ' is-hot' : ''),
          style: 'height:' + Math.max(pct, d.value > 0 ? 2 : 0.6) + '%'
        })
      ]);
      plot.appendChild(col);
    });

    if (!data.length) plot.appendChild(U.el('p', { class: 'muted', text: 'No data for this period.' }));
    return U.el('div', { class: 'chart-wrap' }, [plot]);
  };

  /* ------------------------------------------------------------ print */

  /*  Prints an HTML fragment through a hidden iframe. Using an iframe (rather
   *  than window.open) keeps it working when pop-ups are blocked and leaves the
   *  POS screen untouched.
   */
  UI.print = function (html, title) {
    var frame = document.getElementById('print-frame');
    if (!frame) {
      frame = U.el('iframe', { id: 'print-frame', 'aria-hidden': 'true', tabindex: '-1' });
      document.body.appendChild(frame);
    }
    var doc = frame.contentWindow.document;
    doc.open();
    doc.write(html);
    doc.close();
    var run = function () {
      try {
        frame.contentWindow.focus();
        frame.contentWindow.print();
      } catch (e) {
        UI.err('Printing was blocked by the browser.');
      }
    };
    if (doc.readyState === 'complete') setTimeout(run, 120);
    else frame.onload = function () { setTimeout(run, 120); };
    if (title) doc.title = title;
  };

  App.UI = UI;
})(window.App = window.App || {});
