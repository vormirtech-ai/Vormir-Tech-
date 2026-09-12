import { el, mount, clear } from '../dom.js';
import { icon } from '../icons.js';
import * as fmt from '../format.js';
import { call } from '../api.js';
import { store, is } from '../store.js';
import { card, dataTable, emptyState, badge, tabs, toast, modal, confirm, form, searchBox, dateRange } from '../ui.js';
import { productPicker, partyPicker } from '../pickers.js';
import { saleReturnMarkup, printMarkup } from '../print.js';
import { r2, splitGst } from '../calc.js';

export async function render({ query }) {
  let tab = query?.tab || 'sale';
  const host = el('div');

  function draw() {
    mount(host,
      el('div.row.mb-16',
        tabs({
          items: [{ key: 'sale', label: 'Sales returns' }, { key: 'purchase', label: 'Purchase returns' }],
          active: tab,
          pill: true,
          onChange: (key) => { tab = key; draw(); }
        })),
      tab === 'sale' ? el('div', saleReturnPanel(query?.bill || '')) : el('div', purchaseReturnPanel()));
  }

  // ---------------------------------------------------------- sale returns
  function saleReturnPanel(prefillBill) {
    const panel = el('div.col', { style: { gap: '16px' } });
    const lookupHost = el('div');
    const listHost = el('div');

    const billInput = el('input', { type: 'text', placeholder: 'Bill number, e.g. INV-0007', value: prefillBill, style: { maxWidth: '260px' } });
    billInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') lookup(); });

    async function lookup() {
      const no = billInput.value.trim();
      if (!no) { toast('Enter the bill number printed on the invoice.', { type: 'warn' }); return; }
      let data;
      try {
        data = await call('returns.saleLookup', { no });
      } catch { return; }
      drawLookup(data);
    }

    function drawLookup(data) {
      const picks = new Map();
      let refundMode = 'Cash';
      let notes = '';
      const totalsNode = el('div');

      function totals() {
        let taxable = 0;
        let gst = 0;
        for (const [itemId, qty] of picks) {
          const item = data.items.find((i) => i.id === itemId);
          if (!item || qty <= 0) continue;
          const perUnit = item.qty_units > 0 ? item.taxable / item.qty_units : 0;
          const t = r2(perUnit * qty);
          const g = splitGst(t, item.gst_rate, false);
          taxable = r2(taxable + t);
          gst = r2(gst + g.total);
        }
        return { taxable, gst, total: r2(taxable + gst) };
      }

      function drawTotals() {
        const t = totals();
        mount(totalsNode,
          el('div.totals-line', el('span.muted', 'Taxable value'), el('span', fmt.money(t.taxable))),
          el('div.totals-line', el('span.muted', 'GST'), el('span', fmt.money(t.gst))),
          el('div.totals-line.grand', el('span', 'Refund'), el('span', fmt.money(t.total))));
        saveBtn.disabled = t.total <= 0;
      }

      const saveBtn = el('button.btn.primary.lg', {
        onclick: async () => {
          const items = [...picks.entries()].filter(([, qty]) => qty > 0).map(([sale_item_id, qty_units]) => ({ sale_item_id, qty_units, restock: 1 }));
          if (!items.length) return;
          saveBtn.disabled = true;
          try {
            const ret = await call('returns.createSale', { sale_id: data.sale.id, refund_mode: refundMode, notes, items });
            toast(`Credit note ${ret.no} saved — ${fmt.money(ret.total)}.`, { type: 'ok' });
            const handle = modal({
              title: `Credit note ${ret.no}`,
              size: 'narrow',
              body: el('div', el('div.note.ok', icon('check'), el('div', `${fmt.money(ret.total)} ${refundMode === 'Adjust in balance' ? 'adjusted in the patient balance' : `refunded by ${refundMode}`}.`))),
              footer: [
                el('button.btn', { onclick: () => handle.close() }, 'Close'),
                el('button.btn.primary', { onclick: () => { handle.close(); printMarkup(saleReturnMarkup(ret, { format: store.settings.print_format || 'a5' }), store.settings.print_format || 'a5'); } }, icon('print'), 'Print')
              ]
            });
            clear(lookupHost);
            loadList();
          } catch {
            saveBtn.disabled = false;
          }
        }
      }, icon('save'), 'Save return');

      mount(lookupHost, card({
        title: `Bill ${data.sale.no}`,
        subtitle: `${fmt.dateLong(data.sale.date)} · ${data.customer?.name || data.sale.patient_name || 'Walk-in'} · ${fmt.money(data.sale.total)}`,
        body: el('div',
          dataTable({
            rows: data.items,
            compact: true,
            columns: [
              { key: 'name', label: 'Medicine', render: (r) => el('div', el('b', r.name), el('div.fs-12.muted', `Batch ${r.batch_no} · Exp ${fmt.expiry(r.expiry)}`)) },
              { key: 'qty_units', label: 'Sold', align: 'num' },
              { key: 'returned_units', label: 'Returned', align: 'num', render: (r) => String(r.returned_units || '—') },
              { key: 'returnable_units', label: 'Can return', align: 'num', render: (r) => el('b', String(r.returnable_units)) },
              { key: 'rate_per_unit', label: 'Rate', align: 'num', render: (r) => fmt.money(r.rate_per_unit) },
              {
                key: 'pick',
                label: 'Return qty',
                align: 'num',
                render: (r) => {
                  if (r.returnable_units <= 0) return el('span.muted', 'nothing left');
                  const input = el('input.num', {
                    type: 'number', min: 0, max: r.returnable_units, step: 1, value: 0,
                    style: { width: '84px', height: '30px' }
                  });
                  input.addEventListener('input', () => {
                    const qty = Math.max(0, Math.min(r.returnable_units, Math.round(Number(input.value) || 0)));
                    if (String(qty) !== input.value) input.value = qty;
                    picks.set(r.id, qty);
                    drawTotals();
                  });
                  return input;
                }
              }
            ]
          }),
          el('div.grid.cols-2.mt-16',
            form([
              {
                name: 'refund_mode', label: 'Refund by', type: 'select',
                options: ['Cash', 'UPI', 'Bank Transfer', 'Adjust in balance'],
                onChange: (v) => { refundMode = v; }
              },
              { name: 'notes', label: 'Reason', placeholder: 'Wrong medicine / patient returned', onInput: (v) => { notes = v; } }
            ], {}, { columns: 2 }).node,
            el('div', totalsNode, el('div.mt-8', saveBtn))))
      }));
      drawTotals();
    }

    const listState = { from: fmt.monthStart(), to: fmt.today(), search: '' };
    async function loadList() {
      const data = await call('returns.listSale', listState);
      mount(listHost, card({
        title: 'Sales returns',
        subtitle: `${data.totals.count} return(s) · ${fmt.money(data.totals.total)}`,
        actions: el('div.row.tight',
          dateRange({ from: listState.from, to: listState.to, onChange: (r) => { Object.assign(listState, r); loadList(); } })),
        flush: true,
        body: dataTable({
          rows: data.rows,
          onRowClick: async (row) => {
            const ret = await call('returns.getSale', { id: row.id });
            const handle = modal({
              title: `Credit note ${ret.no}`,
              body: el('div', { html: saleReturnMarkup(ret, { format: 'a5' }) }),
              footer: [
                is('admin')
                  ? el('button.btn.danger', {
                    onclick: async () => {
                      const ok = await confirm({ title: `Delete ${ret.no}?`, message: 'The returned stock is taken back out and the refund is reversed.', danger: true });
                      if (!ok) return;
                      await call('returns.removeSale', { id: ret.id });
                      toast('Return deleted.', { type: 'ok' });
                      handle.close();
                      loadList();
                    }
                  }, icon('trash'), 'Delete')
                  : null,
                el('div.spacer'),
                el('button.btn.primary', { onclick: () => printMarkup(saleReturnMarkup(ret, { format: 'a5' }), 'a5') }, icon('print'), 'Print')
              ]
            });
          },
          columns: [
            { key: 'no', label: 'Credit note', render: (r) => el('div', el('b', r.no), el('div.fs-12.muted', fmt.date(r.date))) },
            { key: 'sale_no', label: 'Against bill' },
            { key: 'customer_name', label: 'Patient', render: (r) => r.customer_name || 'Walk-in' },
            { key: 'refund_mode', label: 'Refund', render: (r) => badge(r.refund_mode) },
            { key: 'total', label: 'Amount', align: 'num', render: (r) => el('b', fmt.money(r.total)) }
          ],
          empty: emptyState({ title: 'No sales returns in this period', iconName: 'returns' })
        })
      }));
    }

    mount(panel,
      card({
        title: 'Start a sales return',
        body: el('div.row',
          el('div.field', el('label', 'Bill number'), billInput),
          el('button.btn.primary', { onclick: lookup, style: { marginTop: '18px' } }, icon('search'), 'Find bill'),
          el('div.spacer'),
          el('span.fs-12.muted', { style: { marginTop: '22px' } }, 'Only medicines from the original bill can be returned, and never more than were sold.'))
      }),
      lookupHost,
      listHost);
    loadList();
    if (prefillBill) lookup();
    return panel;
  }

  // ------------------------------------------------------ purchase returns
  function purchaseReturnPanel() {
    const panel = el('div.col', { style: { gap: '16px' } });
    const linesHost = el('div');
    const listHost = el('div');
    const entry = { supplier: null, reason: '', notes: '', lines: [] };

    function totals() {
      let taxable = 0;
      let gst = 0;
      for (const line of entry.lines) {
        const t = r2((Number(line.qty) || 0) * (Number(line.rate) || 0));
        const g = splitGst(t, line.gst_rate, false);
        taxable = r2(taxable + t);
        gst = r2(gst + g.total);
      }
      return { taxable, gst, total: r2(taxable + gst) };
    }

    function drawLines() {
      const t = totals();
      mount(linesHost,
        entry.lines.length
          ? dataTable({
            rows: entry.lines,
            compact: true,
            columns: [
              { key: 'name', label: 'Medicine', render: (l) => el('div', el('b', l.product.name), el('div.fs-12.muted', `Batch ${l.batch.batch_no} · Exp ${fmt.expiry(l.batch.expiry)}`)) },
              { key: 'stock', label: 'In stock', align: 'num', render: (l) => String(l.batch.qty_units) },
              {
                key: 'qty', label: 'Return qty', align: 'num',
                render: (l) => {
                  const input = el('input.num', { type: 'number', min: 1, max: l.batch.qty_units, step: 1, value: l.qty, style: { width: '84px', height: '30px' } });
                  input.addEventListener('input', () => {
                    l.qty = Math.max(0, Math.min(l.batch.qty_units, Math.round(Number(input.value) || 0)));
                    if (String(l.qty) !== input.value) input.value = l.qty;
                    drawLines();
                  });
                  return input;
                }
              },
              {
                key: 'rate', label: 'Rate / unit', align: 'num',
                render: (l) => {
                  const input = el('input.num', { type: 'number', min: 0, step: '0.001', value: l.rate, style: { width: '92px', height: '30px' } });
                  input.addEventListener('input', () => { l.rate = Number(input.value) || 0; drawLines(); });
                  return input;
                }
              },
              { key: 'gst', label: 'GST', align: 'num', render: (l) => `${l.gst_rate}%` },
              { key: 'amount', label: 'Amount', align: 'num', render: (l) => fmt.money(r2(l.qty * l.rate * (1 + l.gst_rate / 100))) },
              {
                key: 'x', label: '', align: 'center',
                render: (l, i) => el('button.icon-btn', { onclick: () => { entry.lines.splice(i, 1); drawLines(); } }, icon('trash'))
              }
            ],
            footer: ['Total', '', '', '', fmt.money(t.gst), fmt.money(t.total), '']
          })
          : emptyState({ title: 'Add the batches you are sending back', message: 'Search the medicine, then pick the batch.', iconName: 'returns' }));
      saveBtn.disabled = !entry.supplier || t.total <= 0;
    }

    async function addProduct(product) {
      const batches = (product.batches || []).filter((b) => b.qty_units > 0);
      if (!batches.length) { toast(`${product.name} has no stock to return.`, { type: 'warn' }); return; }
      const pick = batches.length === 1 ? batches[0] : await chooseBatch(product, batches);
      if (!pick) return;
      entry.lines.push({ product, batch: pick, qty: Math.min(1, pick.qty_units), rate: pick.rate_per_unit || 0, gst_rate: product.gst_rate });
      drawLines();
    }

    function chooseBatch(product, batches) {
      return new Promise((resolve) => {
        const handle = modal({
          title: `Choose a batch — ${product.name}`,
          body: dataTable({
            rows: batches,
            compact: true,
            onRowClick: (b) => { handle.close(); resolve(b); },
            columns: [
              { key: 'batch_no', label: 'Batch' },
              { key: 'expiry', label: 'Expiry', render: (b) => fmt.expiry(b.expiry) },
              { key: 'qty_units', label: 'Stock', align: 'num' },
              { key: 'rate_per_unit', label: 'Cost / unit', align: 'num', render: (b) => fmt.money(b.rate_per_unit) }
            ]
          }),
          onClose: () => resolve(null)
        });
      });
    }

    const saveBtn = el('button.btn.primary.lg', {
      onclick: async () => {
        saveBtn.disabled = true;
        try {
          const ret = await call('returns.createPurchase', {
            supplier_id: entry.supplier.id,
            reason: entry.reason,
            notes: entry.notes,
            items: entry.lines.filter((l) => l.qty > 0).map((l) => ({ batch_id: l.batch.id, qty_units: l.qty, rate_per_unit: l.rate, gst_rate: l.gst_rate }))
          });
          toast(`Purchase return ${ret.no} saved — ${fmt.money(ret.total)}.`, { type: 'ok' });
          entry.lines = [];
          drawLines();
          loadList();
        } catch { saveBtn.disabled = false; }
      }
    }, icon('save'), 'Save purchase return');

    const supplierPick = partyPicker({ type: 'supplier', onPick: (p) => { entry.supplier = p; drawLines(); } });
    const picker = productPicker({ placeholder: 'Medicine to return…', onPick: addProduct, allowCreate: false, inStockOnly: true, compact: true });

    async function loadList() {
      const data = await call('returns.listPurchase', { from: fmt.monthStart(), to: fmt.today() });
      mount(listHost, card({
        title: 'Purchase returns',
        subtitle: `${data.totals.count} return(s) · ${fmt.money(data.totals.total)}`,
        flush: true,
        body: dataTable({
          rows: data.rows,
          columns: [
            { key: 'no', label: 'Return', render: (r) => el('div', el('b', r.no), el('div.fs-12.muted', fmt.date(r.date))) },
            { key: 'supplier_name', label: 'Supplier' },
            { key: 'reason', label: 'Reason', render: (r) => r.reason || '—' },
            { key: 'total', label: 'Amount', align: 'num', render: (r) => el('b', fmt.money(r.total)) },
            {
              key: 'x', label: '', align: 'center',
              render: (r) => (is('admin')
                ? el('button.icon-btn', {
                  title: 'Delete',
                  onclick: async () => {
                    const ok = await confirm({ title: `Delete ${r.no}?`, message: 'The stock goes back into the batch.', danger: true });
                    if (!ok) return;
                    await call('returns.removePurchase', { id: r.id });
                    toast('Return deleted.', { type: 'ok' });
                    loadList();
                  }
                }, icon('trash'))
                : null)
            }
          ],
          empty: emptyState({ title: 'No purchase returns yet', iconName: 'returns' })
        })
      }));
    }

    mount(panel,
      card({
        title: 'New purchase return',
        body: el('div.grid.cols-2',
          el('div.field.required', el('label', 'Supplier'), supplierPick),
          form([
            { name: 'reason', label: 'Reason', placeholder: 'Near expiry / damaged / wrong supply', onInput: (v) => { entry.reason = v; } },
            { name: 'notes', label: 'Notes', onInput: (v) => { entry.notes = v; } }
          ], {}, { columns: 2 }).node)
      }),
      card({ title: 'Batches to return', actions: picker, flush: true, body: linesHost }),
      el('div.row.end', saveBtn),
      listHost);
    drawLines();
    loadList();
    return panel;
  }

  draw();
  return host;
}
