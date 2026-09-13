import { el, mount } from '../dom.js';
import { icon } from '../icons.js';
import * as fmt from '../format.js';
import { call } from '../api.js';
import { store, refreshBadges } from '../store.js';
import { card, stat, dataTable, emptyState, badge, tabs } from '../ui.js';
import { lineChart, barChart } from '../ui.js';
import * as router from '../router.js';

export async function render() {
  const [data, recent] = await Promise.all([
    call('reports.dashboard', { date: fmt.today() }),
    call('sales.list', { limit: 8 })
  ]);
  refreshBadges();

  const stats = el('div.grid.cols-4',
    stat({
      label: "Today's sales", value: fmt.money(data.day.total), iconName: 'trending', accent: 'blue',
      sub: `${data.day.bills} bill${data.day.bills === 1 ? '' : 's'} · collected ${fmt.money(data.day.paid)}`,
      onClick: () => router.navigate('#/sales')
    }),
    stat({
      label: 'Cash + bank', value: fmt.money(data.balances.total), iconName: 'wallet', accent: 'green',
      sub: `Cash ${fmt.money(data.balances.cash)} · Bank ${fmt.money(data.balances.bank)}`,
      onClick: () => router.navigate('#/money')
    }),
    stat({
      label: 'Outstanding', value: fmt.money(data.outstanding.receivable ?? data.outstanding.due), iconName: 'money', accent: 'orange',
      sub: `${data.outstanding.bills} credit bill(s) · payable ${fmt.money(data.outstanding.payable || 0)}`,
      onClick: () => router.navigate('#/reports?tab=outstanding')
    }),
    stat({
      label: "Today's margin", value: fmt.money(data.day.profit), iconName: 'report', accent: 'purple',
      sub: `This month ${fmt.money(data.month.total)} · margin ${fmt.money(data.month.profit)}`,
      onClick: () => router.navigate('#/reports')
    }));

  const alerts = el('div.grid.cols-4',
    stat({
      label: 'Pending refill reminders', value: String(data.pendingRxCount), iconName: 'bell', accent: 'blue',
      sub: data.pendingRx.length ? `${data.pendingRx.length} due now` : 'Nothing due today',
      onClick: () => router.navigate('#/reminders')
    }),
    stat({
      label: 'Low or no stock', value: String(data.lowStockCount), iconName: 'package', accent: data.lowStockCount ? 'orange' : 'green',
      sub: 'Below reorder level', onClick: () => router.navigate('#/stock')
    }),
    stat({
      label: 'Expiring soon', value: String(data.expiringCount), iconName: 'expiry', accent: data.expiringCount ? 'orange' : 'green',
      sub: `Within ${store.settings.expiry_alert_days} days`, onClick: () => router.navigate('#/stock')
    }),
    stat({
      label: 'Already expired', value: String(data.expiredCount), iconName: 'alert', accent: data.expiredCount ? 'red' : 'green',
      sub: data.expiredCount ? 'Remove from the shelf' : 'Shelf is clean', onClick: () => router.navigate('#/stock')
    }));

  const trendHost = el('div');
  let trendMode = 'sales';
  function drawTrend() {
    mount(trendHost, trendMode === 'sales'
      ? (data.trend.length
        ? lineChart(data.trend, { valueKey: 'total', labelKey: 'date' })
        : emptyState({ title: 'No sales in the last 14 days', iconName: 'trending' }))
      : (data.topItems.length
        ? barChart(data.topItems, { valueKey: 'value', labelKey: 'name' })
        : emptyState({ title: 'No items sold in the last 30 days', iconName: 'package' })));
  }
  drawTrend();

  const chartHost = el('div');
  function drawChartCard() {
    mount(chartHost, card({
      title: 'Business health',
      actions: tabs({
        items: [{ key: 'sales', label: 'Sales · 14 days' }, { key: 'items', label: 'Top items · 30 days' }],
        active: trendMode,
        pill: true,
        onChange: (key) => { trendMode = key; drawTrend(); drawChartCard(); }
      }),
      body: trendHost
    }));
  }
  drawChartCard();

  const quickActions = card({
    title: 'Quick actions',
    body: el('div.grid.cols-2', { style: { gap: '10px' } },
      el('button.btn.primary', { onclick: () => router.navigate('#/billing') }, icon('billing'), 'New bill (F2)'),
      el('button.btn', { onclick: () => router.navigate('#/purchases/new') }, icon('truck'), 'Purchase entry (F4)'),
      el('button.btn', { onclick: () => router.navigate('#/products') }, icon('pill'), 'Add medicine'),
      el('button.btn', { onclick: () => router.navigate('#/returns') }, icon('returns'), 'Sales return'),
      el('button.btn', { onclick: () => router.navigate('#/money') }, icon('wallet'), 'Receipt / expense'),
      el('button.btn', { onclick: () => router.navigate('#/backup') }, icon('backup'), 'Backup now'))
  });

  const storeCard = card({
    title: store.settings.store_name || 'Your store',
    subtitle: 'Master data',
    body: el('dl.kv',
      el('dt', 'Medicines'), el('dd', String(data.counts.products)),
      el('dt', 'Patients'), el('dd', String(data.counts.customers)),
      el('dt', 'Doctors'), el('dd', String(data.counts.doctors)),
      el('dt', 'Suppliers'), el('dd', String(data.counts.suppliers)),
      el('dt', 'Stock at cost'), el('dd', fmt.money(data.stockValue.cost_value)),
      el('dt', 'Stock at MRP'), el('dd', fmt.money(data.stockValue.mrp_value)),
      el('dt', "Today's expenses"), el('dd', fmt.money(data.expensesToday)))
  });

  const recentCard = card({
    title: 'Latest bills',
    actions: el('button.btn.sm.ghost', { onclick: () => router.navigate('#/sales') }, 'View all', icon('chevronRight')),
    flush: true,
    body: dataTable({
      compact: true,
      onRowClick: (row) => router.navigate(`#/sales/${row.id}`),
      columns: [
        { key: 'no', label: 'Bill', render: (r) => el('b', r.no) },
        { key: 'patient', label: 'Patient', render: (r) => r.customer_name || r.patient_name || 'Walk-in' },
        { key: 'mode', label: 'Mode', render: (r) => badge(r.payment_mode, r.payment_mode === 'Credit' ? 'warn' : '') },
        { key: 'total', label: 'Amount', align: 'num', render: (r) => fmt.money(r.total) }
      ],
      rows: recent.rows,
      empty: emptyState({ title: 'No bills yet', message: 'Press F2 to raise your first bill.', iconName: 'billing' })
    })
  });

  const expiryCard = card({
    title: 'Expiring / expired batches',
    actions: el('button.btn.sm.ghost', { onclick: () => router.navigate('#/stock') }, 'Stock screen', icon('chevronRight')),
    flush: true,
    body: dataTable({
      compact: true,
      rows: [...data.expired.map((e) => ({ ...e, flag: 'expired' })), ...data.expiring].slice(0, 8),
      rowClass: (r) => (r.flag === 'expired' ? 'row-danger' : ''),
      columns: [
        { key: 'name', label: 'Medicine', render: (r) => el('div', el('b', r.name), el('div.fs-12.muted', `Batch ${r.batch_no}`)) },
        { key: 'expiry', label: 'Expiry', render: (r) => el('span', fmt.expiry(r.expiry), r.flag === 'expired' ? badge('expired', 'danger') : null) },
        { key: 'qty', label: 'Qty', align: 'num', render: (r) => String(r.qty_units) },
        { key: 'value', label: 'At cost', align: 'num', render: (r) => fmt.money(r.value) }
      ],
      empty: emptyState({ title: 'No batch is close to expiry', iconName: 'check' })
    })
  });

  const lowCard = card({
    title: 'Reorder list',
    flush: true,
    body: dataTable({
      compact: true,
      rows: data.lowStock.slice(0, 8),
      columns: [
        { key: 'name', label: 'Medicine', render: (r) => el('div', el('b', r.name), el('div.fs-12.muted', r.manufacturer || '')) },
        { key: 'stock', label: 'In stock', render: (r) => (r.stock_units ? r.stock_label : badge('out of stock', 'danger')) },
        { key: 'reorder', label: 'Reorder at', align: 'num', render: (r) => String(r.reorder_level || '—') }
      ],
      empty: emptyState({ title: 'Every medicine is above its reorder level', iconName: 'check' })
    })
  });

  const rxCard = card({
    title: 'Refills due',
    actions: el('button.btn.sm.ghost', { onclick: () => router.navigate('#/reminders') }, 'Open', icon('chevronRight')),
    flush: true,
    body: dataTable({
      compact: true,
      rows: data.pendingRx.slice(0, 8),
      columns: [
        { key: 'customer_name', label: 'Patient', render: (r) => el('div', el('b', r.customer_name), el('div.fs-12.muted', r.phone || '')) },
        { key: 'medicines', label: 'Medicines', render: (r) => el('span.fs-12', r.medicines || '—') },
        { key: 'due_date', label: 'Due', render: (r) => el('span', fmt.date(r.due_date), el('div.fs-12.muted', fmt.relativeDays(r.due_date))) }
      ],
      empty: emptyState({ title: 'No refill reminder is due', iconName: 'bell' })
    })
  });

  return el('div.col', { style: { gap: '16px' } },
    stats,
    alerts,
    el('div.grid', { style: { gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)' } },
      chartHost,
      el('div.col', { style: { gap: '16px' } }, quickActions, storeCard)),
    el('div.grid.cols-2', recentCard, expiryCard),
    el('div.grid.cols-2', lowCard, rxCard));
}
