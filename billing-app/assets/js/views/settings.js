/*  views/settings.js — shop details, tax, printing and the backup tools. */
(function (App) {
  'use strict';

  var U = App.U, UI = App.UI, Store = App.Store, DB = App.DB;
  var root = null;

  function group(title, subtitle, fields, onSave) {
    var form = UI.form(fields);
    var node = U.el('section', { class: 'card panel' }, [
      U.el('div', { class: 'panel__head' }, [
        U.el('div', {}, [
          U.el('h3', { text: title }),
          subtitle ? U.el('p', { class: 'muted', text: subtitle }) : null
        ])
      ]),
      form.node,
      U.el('div', { class: 'panel__foot' }, [
        UI.button('Save changes', function () {
          if (!form.validate()) return;
          onSave(form.values());
        }, 'btn--primary')
      ])
    ]);
    return node;
  }

  function backupNow() {
    return DB.exportAll().then(function (payload) {
      var name = 'lavi-backup-' + U.today() + '-' + U.pad2(new Date().getHours()) + U.pad2(new Date().getMinutes()) + '.json';
      U.download(name, JSON.stringify(payload, null, 2), 'application/json');
      return Store.saveSettings({ lastBackup: Date.now() });
    }).then(function () {
      UI.ok('Backup file saved to this device.');
      render(root);
    }).catch(UI.err);
  }

  function restore() {
    var input = U.el('input', { type: 'file', accept: '.json,application/json' });
    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        var payload;
        try { payload = JSON.parse(reader.result); }
        catch (e) { return UI.err('That file is not a valid backup.'); }

        var counts = Object.keys(payload.data || {}).map(function (k) {
          return k + ': ' + (payload.data[k] || []).length;
        }).join(', ');

        UI.confirm('Restore this backup?',
          'Everything currently stored will be replaced. Backup contains — ' + counts, 'Restore', true)
          .then(function (yes) {
            if (!yes) return;
            DB.importAll(payload)
              .then(function () { return Store.boot(); })
              .then(function () {
                UI.ok('Backup restored.');
                App.Router.go('reports');
              })
              .catch(UI.err);
          });
      };
      reader.readAsText(file);
    });
    input.click();
  }

  function dangerZone() {
    return U.el('section', { class: 'card panel panel--danger' }, [
      U.el('div', { class: 'panel__head' }, [
        U.el('div', {}, [
          U.el('h3', { text: 'Danger zone' }),
          U.el('p', { class: 'muted', text: 'These actions cannot be undone — take a backup first.' })
        ])
      ]),
      U.el('div', { class: 'danger-list' }, [
        U.el('div', { class: 'danger-row' }, [
          U.el('div', {}, [
            U.el('strong', { text: 'Reset menu to the printed card' }),
            U.el('p', { class: 'muted', text: 'Restores all items and prices exactly as they appear on the restaurant menu.' })
          ]),
          UI.button('Reset menu', function () {
            UI.confirm('Reset the menu?', 'Your own items and price changes will be lost.', 'Reset', true)
              .then(function (yes) {
                if (!yes) return;
                Store.resetMenu().then(function () { UI.ok('Menu restored from the printed card.'); });
              });
          }, 'btn--danger')
        ]),
        U.el('div', { class: 'danger-row' }, [
          U.el('div', {}, [
            U.el('strong', { text: 'Clear all bills' }),
            U.el('p', { class: 'muted', text: 'Deletes every bill. Menu, staff and inventory stay.' })
          ]),
          UI.button('Clear bills', function () {
            UI.confirm('Delete every bill?', 'Sales history will be gone for good.', 'Delete bills', true)
              .then(function (yes) {
                if (!yes) return;
                DB.clear('bills').then(function () { UI.ok('All bills deleted.'); });
              });
          }, 'btn--danger')
        ]),
        U.el('div', { class: 'danger-row' }, [
          U.el('div', {}, [
            U.el('strong', { text: 'Factory reset' }),
            U.el('p', { class: 'muted', text: 'Erases everything on this device and starts fresh.' })
          ]),
          UI.button('Erase everything', function () {
            UI.confirm('Erase all data?', 'Bills, staff, attendance, inventory and settings will all be deleted.', 'Erase everything', true)
              .then(function (yes) {
                if (!yes) return;
                DB.wipe().then(function () {
                  try { localStorage.removeItem('lavi_pos.draft'); } catch (e) {}
                  location.reload();
                });
              });
          }, 'btn--danger')
        ])
      ])
    ]);
  }

  function render(container) {
    root = container;
    var s = Store.settings();
    container.innerHTML = '';

    container.appendChild(UI.section('Settings', 'Everything here is stored on this device only.'));

    container.appendChild(U.el('div', { class: 'grid-2' }, [
      group('Restaurant details', 'Printed at the top of every bill.', [
        { name: 'name', label: 'Restaurant name', type: 'text', value: s.name, required: true },
        { name: 'tagline', label: 'Tagline', type: 'text', value: s.tagline },
        { name: 'address', label: 'Address', type: 'textarea', rows: 2, value: s.address },
        { name: 'phone', label: 'Phone', type: 'tel', value: s.phone, width: 'half' },
        { name: 'billPrefix', label: 'Bill number prefix', type: 'text', value: s.billPrefix, width: 'half' },
        { name: 'gstin', label: 'GSTIN', type: 'text', value: s.gstin, width: 'half' },
        { name: 'fssai', label: 'FSSAI licence', type: 'text', value: s.fssai, width: 'half' },
        { name: 'footerNote', label: 'Bill footer message', type: 'text', value: s.footerNote }
      ], function (v) {
        Store.saveSettings(v).then(function () {
          UI.ok('Details saved.');
          App.Shell.refreshBrand();
        });
      }),

      group('Billing & tax', 'Applied to new bills as they are created.', [
        { name: 'gstEnabled', label: 'Charge GST on bills', type: 'checkbox', value: s.gstEnabled, width: 'half' },
        { name: 'gstRate', label: 'GST rate (%)', type: 'number', value: s.gstRate, min: 0, max: 28, step: '0.5', width: 'half' },
        { name: 'serviceChargeEnabled', label: 'Add service charge', type: 'checkbox', value: s.serviceChargeEnabled, width: 'half' },
        { name: 'serviceChargeRate', label: 'Service charge (%)', type: 'number', value: s.serviceChargeRate, min: 0, max: 20, step: '0.5', width: 'half' },
        { name: 'roundOff', label: 'Round the total to the nearest rupee', type: 'checkbox', value: s.roundOff },
        { name: 'tables', label: 'Number of tables', type: 'number', value: s.tables, min: 0, max: 99, step: '1', width: 'half' },
        { name: 'printFormat', label: 'Default print format', type: 'select', value: s.printFormat, width: 'half',
          options: [{ value: '80mm', label: '80 mm thermal receipt' }, { value: 'a4', label: 'A4 invoice' }] },
        { name: 'weekOff', label: 'Staff weekly off', type: 'select', value: s.weekOff, width: 'half',
          options: [{ value: '', label: 'No fixed off day' }].concat(
            ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map(function (d, i) {
              return { value: String(i), label: d };
            })) }
      ], function (v) {
        Store.saveSettings(v).then(function () { UI.ok('Billing settings saved.'); });
      })
    ]));

    // ---- data & backup ----
    var lastBackup = s.lastBackup ? U.dateTimeLabel(s.lastBackup) : 'never';
    container.appendChild(U.el('section', { class: 'card panel' }, [
      U.el('div', { class: 'panel__head' }, [
        U.el('div', {}, [
          U.el('h3', { text: 'Data & backup' }),
          U.el('p', { class: 'muted', text: 'Storage engine: ' + DB.engine + ' • Last backup: ' + lastBackup })
        ])
      ]),
      U.el('p', { class: 'note' }, [
        U.el('strong', { text: 'Your data never leaves this device. ' }),
        U.el('span', { text: 'It lives in this browser’s local database. Clearing the browser’s site data, or switching to a different browser or computer, means starting empty — so download a backup regularly and keep it on a pen drive.' })
      ]),
      U.el('div', { class: 'panel__foot panel__foot--split' }, [
        UI.button('Download backup', backupNow, 'btn--primary', '⬇'),
        UI.button('Restore from backup', restore, 'btn--ghost', '⬆'),
        UI.button('Export everything as CSV', function () {
          Promise.all([DB.all('bills'), DB.all('attendance'), DB.all('moves')]).then(function (r) {
            var zipless = [
              ['bills', r[0]], ['attendance', r[1]], ['stock-moves', r[2]],
              ['menu', Store.menu()], ['staff', Store.employees()], ['inventory', Store.inventory()]
            ];
            zipless.forEach(function (pair, idx) {
              var name = pair[0], list = pair[1];
              if (!list.length) return;
              var keys = Object.keys(list.reduce(function (acc, row) {
                Object.keys(row).forEach(function (k) { acc[k] = 1; });
                return acc;
              }, {}));
              var rowsOut = [keys].concat(list.map(function (row) {
                return keys.map(function (k) {
                  var v = row[k];
                  return v && typeof v === 'object' ? JSON.stringify(v) : v;
                });
              }));
              // Stagger the downloads so the browser does not drop them.
              setTimeout(function () {
                U.download(name + '-' + U.today() + '.csv', U.toCSV(rowsOut), 'text/csv;charset=utf-8');
              }, idx * 400);
            });
            UI.ok('CSV files are downloading.');
          });
        }, 'btn--ghost', '📄')
      ])
    ]));

    container.appendChild(dangerZone());

    container.appendChild(U.el('section', { class: 'card panel' }, [
      U.el('div', { class: 'panel__head' }, [U.el('div', {}, [U.el('h3', { text: 'Keyboard shortcuts' })])]),
      U.el('div', { class: 'shortcuts' }, [
        ['F2', 'Search the menu'], ['F4', 'Settle & print the current bill'], ['F6', 'Hold the current order'],
        ['Alt + 1…8', 'Jump between screens'], ['Esc', 'Close a dialog'], ['Enter', 'Confirm a dialog']
      ].map(function (k) {
        return U.el('div', { class: 'shortcut' }, [
          U.el('kbd', { text: k[0] }), U.el('span', { text: k[1] })
        ]);
      }))
    ]));
  }

  App.Views = App.Views || {};
  App.Views.settings = { title: 'Settings', render: render };
})(window.App = window.App || {});
