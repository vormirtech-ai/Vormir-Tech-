import { el, mount } from '../dom.js';
import { icon } from '../icons.js';
import * as fmt from '../format.js';
import { call } from '../api.js';
import { store } from '../store.js';
import { card, dataTable, emptyState, badge, tabs, stat, searchBox, exportCsv, toast } from '../ui.js';
import { reportMarkup, printMarkup } from '../print.js';
import * as router from '../router.js';

export async function render({ query }) {
  let tab = query?.tab || 'valuation';
  let search = '';
  const host = el('div');

  const [valuation, expiry, low] = await Promise.all([
    call('reports.stock'),
    call('stock.expiry', { withinDays: Number(store.settings.expiry_alert_days) || 90 }),
    call('stock.low')
  ]);

  const expired = expiry.filter((e) => e.expired);
  const expiringSoon = expiry.filter((e) => !e.expired);

  const filter = (rows, keys) => (search
    ? rows.filter((r) => keys.some((k) => String(r[k] ?? '').toLowerCase().includes(search.toLowerCase())))
    : rows);

  function valuationTab() {
    const rows = filter(valuation.rows, ['name', 'manufacturer', 'category', 'rack']);
    return card({
      title: 'Stock valuation',
      subtitle: `${rows.length} medicines`,
      actions: el('div.row.tight',
        el('button.btn.sm', {
          onclick: () => exportCsv([
            ['Medicine', 'Manufacturer', 'Category', 'Rack', 'Units', 'Batches', 'Cost value', 'MRP value'],
            ...rows.map((r) => [r.name, r.manufacturer, r.category, r.rack, r.units, r.batches, r.cost_value, r.mrp_value])
          ], 'stock-valuation.csv')
        }, icon('download'), 'Export'),
        el('button.btn.sm', { onclick: () => printStock(rows) }, icon('print'), 'Print')),
      flush: true,
      body: dataTable({
        rows,
        onRowClick: (r) => router.navigate(`#/products?q=${encodeURIComponent(r.name)}`),
        columns: [
          { key: 'name', label: 'Medicine', render: (r) => el('div', el('b', r.name), el('div.fs-12.muted', [r.manufacturer, r.rack ? `Rack ${r.rack}` : null].filter(Boolean).join(' · '))) },
          { key: 'category', label: 'Category' },
          { key: 'units', label: 'Units', align: 'num', render: (r) => fmt.number(r.units) },
          { key: 'stock', label: 'On shelf', render: (r) => fmt.qtyLabel(r.units, r.pack_size, r.pack_label, r.unit_label) },
          { key: 'batches', label: 'Batches', align: 'num' },
          { key: 'cost_value', label: 'At cost', align: 'num', render: (r) => fmt.money(r.cost_value) },
          { key: 'mrp_value', label: 'At MRP', align: 'num', render: (r) => fmt.money(r.mrp_value) }
        ],
        footer: ['Total', '', fmt.number(valuation.totals.units), '', '', fmt.money(valuation.totals.cost_value), fmt.money(valuation.totals.mrp_value)],
        empty: emptyState({ title: 'No stock on hand', message: 'Enter a purchase to bring medicines into stock.', iconName: 'package' })
      })
    });
  }

  function expiryTable(rows, title, tone) {
    return dataTable({
      rows: filter(rows, ['name', 'batch_no', 'manufacturer']),
      rowClass: () => (tone === 'danger' ? 'row-danger' : (tone === 'warn' ? 'row-warn' : '')),
      columns: [
        { key: 'name', label: 'Medicine', render: (r) => el('div', el('b', r.name), el('div.fs-12.muted', r.manufacturer || '')) },
        { key: 'batch_no', label: 'Batch' },
        { key: 'expiry', label: 'Expiry', render: (r) => el('span', fmt.expiry(r.expiry), el('div.fs-12.muted', fmt.relativeDays(r.end))) },
        { key: 'qty', label: 'Quantity', align: 'num', render: (r) => fmt.qtyLabel(r.qty_units, r.pack_size, r.pack_label, r.unit_label) },
        { key: 'mrp', label: 'MRP', align: 'num', render: (r) => fmt.money(r.mrp) },
        { key: 'value', label: 'Value at cost', align: 'num', render: (r) => fmt.money(r.value) },
        {
          key: 'action', label: '', align: 'center',
          render: (r) => el('button.btn.sm', { onclick: () => router.navigate(`#/products?q=${encodeURIComponent(r.name)}`) }, 'Open')
        }
      ],
      footer: ['Total', '', '', '', '', fmt.money(rows.reduce((s, r) => s + r.value, 0)), ''],
      empty: emptyState({ title, iconName: 'check' })
    });
  }

  function expiryTab() {
    return el('div.col', { style: { gap: '16px' } },
      expired.length
        ? card({
          title: 'Already expired — remove from the shelf',
          subtitle: `${expired.length} batch(es) · ${fmt.money(expired.reduce((s, r) => s + r.value, 0))} at cost`,
          actions: el('button.btn.sm', { onclick: () => printExpiry(expired, 'Expired stock') }, icon('print'), 'Print'),
          flush: true,
          body: expiryTable(expired, 'Nothing expired', 'danger')
        })
        : null,
      card({
        title: `Expiring within ${store.settings.expiry_alert_days} days`,
        subtitle: `${expiringSoon.length} batch(es) · ${fmt.money(expiringSoon.reduce((s, r) => s + r.value, 0))} at cost`,
        actions: el('button.btn.sm', { onclick: () => printExpiry(expiringSoon, 'Near-expiry stock') }, icon('print'), 'Print'),
        flush: true,
        body: expiryTable(expiringSoon, 'No batch is close to expiry', 'warn')
      }),
      el('div.note', icon('info'), el('div',
        el('b', 'Tip: '), 'return near-expiry stock to the supplier from ',
        el('a', { href: '#/returns' }, 'Returns → Purchase return'), ' so your stock and payables both stay correct.')));
  }

  function lowTab() {
    const rows = filter(low, ['name', 'manufacturer', 'category']);
    return card({
      title: 'Reorder list',
      subtitle: `${rows.length} medicine(s) at or below reorder level`,
      actions: el('div.row.tight',
        el('button.btn.sm', {
          onclick: () => exportCsv([
            ['Medicine', 'Manufacturer', 'Stock units', 'Reorder level', 'Last MRP'],
            ...rows.map((r) => [r.name, r.manufacturer, r.stock_units, r.reorder_level, r.last_mrp || ''])
          ], 'reorder-list.csv')
        }, icon('download'), 'Export'),
        el('button.btn.sm.primary', { onclick: () => router.navigate('#/purchases/new') }, icon('truck'), 'Purchase entry')),
      flush: true,
      body: dataTable({
        rows,
        rowClass: (r) => (r.stock_units === 0 ? 'row-danger' : 'row-warn'),
        columns: [
          { key: 'name', label: 'Medicine', render: (r) => el('div', el('b', r.name), el('div.fs-12.muted', [r.generic, r.manufacturer].filter(Boolean).join(' · '))) },
          { key: 'stock', label: 'In stock', render: (r) => (r.stock_units ? r.stock_label : badge('out of stock', 'danger')) },
          { key: 'reorder_level', label: 'Reorder at', align: 'num', render: (r) => String(r.reorder_level || '—') },
          { key: 'rack', label: 'Rack', render: (r) => r.rack || '—' },
          { key: 'mrp', label: 'Last MRP', align: 'num', render: (r) => (r.last_mrp ? fmt.money(r.last_mrp) : '—') }
        ],
        empty: emptyState({ title: 'Nothing to reorder', message: 'Every medicine is above its reorder level.', iconName: 'check' })
      })
    });
  }

  async function printStock(rows) {
    await printMarkup(reportMarkup({
      title: 'Stock valuation',
      subtitle: `${rows.length} medicines`,
      store: await call('settings.store'),
      columns: [
        { label: 'Medicine', value: (r) => r.name },
        { label: 'Rack', value: (r) => r.rack || '' },
        { label: 'Units', value: (r) => String(r.units), align: 'num' },
        { label: 'At cost', value: (r) => fmt.money(r.cost_value, { symbol: false }), align: 'num' },
        { label: 'At MRP', value: (r) => fmt.money(r.mrp_value, { symbol: false }), align: 'num' }
      ],
      rows,
      totals: ['Total', '', String(valuation.totals.units), fmt.money(valuation.totals.cost_value, { symbol: false }), fmt.money(valuation.totals.mrp_value, { symbol: false })],
      format: 'a4'
    }), 'a4');
  }

  async function printExpiry(rows, title) {
    await printMarkup(reportMarkup({
      title,
      store: await call('settings.store'),
      columns: [
        { label: 'Medicine', value: (r) => r.name },
        { label: 'Batch', value: (r) => r.batch_no },
        { label: 'Expiry', value: (r) => fmt.expiry(r.expiry) },
        { label: 'Qty', value: (r) => String(r.qty_units), align: 'num' },
        { label: 'Value', value: (r) => fmt.money(r.value, { symbol: false }), align: 'num' }
      ],
      rows,
      format: 'a4'
    }), 'a4');
  }

  function draw() {
    mount(host,
      el('div.grid.cols-4.mb-16',
        stat({ label: 'Stock value at cost', value: fmt.money(valuation.totals.cost_value), iconName: 'package', accent: 'blue' }),
        stat({ label: 'Stock value at MRP', value: fmt.money(valuation.totals.mrp_value), iconName: 'money', accent: 'green' }),
        stat({ label: 'Expiring soon', value: String(expiringSoon.length), sub: fmt.money(expiringSoon.reduce((s, r) => s + r.value, 0)), iconName: 'expiry', accent: expiringSoon.length ? 'orange' : 'green' }),
        stat({ label: 'Expired', value: String(expired.length), sub: fmt.money(expired.reduce((s, r) => s + r.value, 0)), iconName: 'alert', accent: expired.length ? 'red' : 'green' })),
      el('div.row.mb-16',
        tabs({
          items: [
            { key: 'valuation', label: 'Valuation' },
            { key: 'expiry', label: 'Expiry', count: expiry.length },
            { key: 'low', label: 'Reorder', count: low.length }
          ],
          active: tab,
          pill: true,
          onChange: (key) => { tab = key; draw(); }
        }),
        el('div.spacer'),
        searchBox({ placeholder: 'Filter…', value: search, width: '260px', onInput: (v) => { search = v; draw(); } })),
      tab === 'valuation' ? valuationTab() : (tab === 'expiry' ? expiryTab() : lowTab()));
  }

  draw();
  return host;
}
