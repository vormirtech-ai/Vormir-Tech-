import { el, mount } from '../dom.js';
import { icon } from '../icons.js';
import * as fmt from '../format.js';
import { call } from '../api.js';
import { card, dataTable, emptyState, badge, stat, tabs, dateRange, exportCsv, lineChart, barChart, toast } from '../ui.js';
import { reportMarkup, printMarkup } from '../print.js';
import * as router from '../router.js';

const TABS = [
  { key: 'sales', label: 'Sales register' },
  { key: 'purchases', label: 'Purchase register' },
  { key: 'items', label: 'Item movement' },
  { key: 'profit', label: 'Profit & loss' },
  { key: 'daybook', label: 'Day book' },
  { key: 'outstanding', label: 'Outstanding' }
];

export async function render({ query }) {
  let tab = query?.tab || 'sales';
  const range = { from: fmt.monthStart(), to: fmt.today() };
  let day = fmt.today();
  const host = el('div');
  const panel = el('div');

  async function printReport(title, columns, rows, totals) {
    const store = await call('settings.store');
    await printMarkup(reportMarkup({
      title,
      subtitle: `${fmt.date(range.from)} to ${fmt.date(range.to)}`,
      store,
      columns,
      rows,
      totals,
      format: 'a4'
    }), 'a4');
  }

  async function salesPanel() {
    const data = await call('reports.sales', range);
    return el('div.col', { style: { gap: '16px' } },
      el('div.grid.cols-4',
        stat({ label: 'Bills', value: String(data.totals.bills), iconName: 'list', accent: 'blue' }),
        stat({ label: 'Sales', value: fmt.money(data.totals.total), sub: `Taxable ${fmt.money(data.totals.taxable)}`, iconName: 'trending', accent: 'green' }),
        stat({ label: 'GST', value: fmt.money(data.totals.gst), sub: `Discount ${fmt.money(data.totals.discount)}`, iconName: 'gst', accent: 'purple' }),
        stat({ label: 'Gross margin', value: fmt.money(data.totals.profit), sub: data.totals.taxable ? `${fmt.pct(data.totals.profit * 100 / data.totals.taxable)} of taxable` : '', iconName: 'report', accent: 'orange' })),
      data.rows.length ? card({ title: 'Daily sales', body: lineChart(data.rows, { valueKey: 'total', labelKey: 'date' }) }) : null,
      card({
        title: 'Sales register',
        subtitle: `${fmt.date(range.from)} — ${fmt.date(range.to)}`,
        actions: el('div.row.tight',
          el('button.btn.sm', {
            onclick: () => exportCsv([
              ['Date', 'Bills', 'Taxable', 'GST', 'Discount', 'Total', 'Collected', 'Margin'],
              ...data.rows.map((r) => [r.date, r.bills, r.taxable, r.gst, r.discount, r.total, r.collected, r.profit])
            ], `sales-register-${range.from}.csv`)
          }, icon('download'), 'Export'),
          el('button.btn.sm', {
            onclick: () => printReport('Sales register', [
              { label: 'Date', value: (r) => fmt.date(r.date) },
              { label: 'Bills', value: (r) => String(r.bills), align: 'num' },
              { label: 'Taxable', value: (r) => fmt.money(r.taxable, { symbol: false }), align: 'num' },
              { label: 'GST', value: (r) => fmt.money(r.gst, { symbol: false }), align: 'num' },
              { label: 'Total', value: (r) => fmt.money(r.total, { symbol: false }), align: 'num' },
              { label: 'Margin', value: (r) => fmt.money(r.profit, { symbol: false }), align: 'num' }
            ], data.rows, ['Total', String(data.totals.bills), fmt.money(data.totals.taxable, { symbol: false }), fmt.money(data.totals.gst, { symbol: false }), fmt.money(data.totals.total, { symbol: false }), fmt.money(data.totals.profit, { symbol: false })])
          }, icon('print'), 'Print')),
        flush: true,
        body: dataTable({
          rows: data.rows,
          columns: [
            { key: 'date', label: 'Date', render: (r) => fmt.dateLong(r.date) },
            { key: 'bills', label: 'Bills', align: 'num' },
            { key: 'taxable', label: 'Taxable', align: 'num', render: (r) => fmt.money(r.taxable) },
            { key: 'gst', label: 'GST', align: 'num', render: (r) => fmt.money(r.gst) },
            { key: 'discount', label: 'Discount', align: 'num', render: (r) => fmt.money(r.discount) },
            { key: 'total', label: 'Total', align: 'num', render: (r) => el('b', fmt.money(r.total)) },
            { key: 'collected', label: 'Collected', align: 'num', render: (r) => fmt.money(r.collected) },
            { key: 'profit', label: 'Margin', align: 'num', render: (r) => fmt.money(r.profit) }
          ],
          footer: ['Total', String(data.totals.bills), fmt.money(data.totals.taxable), fmt.money(data.totals.gst), fmt.money(data.totals.discount), fmt.money(data.totals.total), fmt.money(data.totals.collected), fmt.money(data.totals.profit)],
          empty: emptyState({ title: 'No sales in this period', iconName: 'trending' })
        })
      }));
  }

  async function purchasePanel() {
    const data = await call('reports.purchases', range);
    return el('div.col', { style: { gap: '16px' } },
      el('div.grid.cols-4',
        stat({ label: 'Purchase bills', value: String(data.totals.bills), iconName: 'truck', accent: 'blue' }),
        stat({ label: 'Purchase value', value: fmt.money(data.totals.total), iconName: 'package', accent: 'purple' }),
        stat({ label: 'Input GST', value: fmt.money(data.totals.gst), iconName: 'gst', accent: 'green' }),
        stat({ label: 'Paid', value: fmt.money(data.totals.paid), sub: `Balance ${fmt.money(data.totals.total - data.totals.paid)}`, iconName: 'wallet', accent: 'orange' })),
      card({
        title: 'Purchase register',
        actions: el('button.btn.sm', {
          onclick: () => exportCsv([
            ['Date', 'Bills', 'Taxable', 'GST', 'Total', 'Paid'],
            ...data.rows.map((r) => [r.date, r.bills, r.taxable, r.gst, r.total, r.paid])
          ], `purchase-register-${range.from}.csv`)
        }, icon('download'), 'Export'),
        flush: true,
        body: dataTable({
          rows: data.rows,
          columns: [
            { key: 'date', label: 'Date', render: (r) => fmt.dateLong(r.date) },
            { key: 'bills', label: 'Bills', align: 'num' },
            { key: 'taxable', label: 'Taxable', align: 'num', render: (r) => fmt.money(r.taxable) },
            { key: 'gst', label: 'GST', align: 'num', render: (r) => fmt.money(r.gst) },
            { key: 'total', label: 'Total', align: 'num', render: (r) => el('b', fmt.money(r.total)) },
            { key: 'paid', label: 'Paid', align: 'num', render: (r) => fmt.money(r.paid) }
          ],
          footer: ['Total', String(data.totals.bills), fmt.money(data.totals.taxable), fmt.money(data.totals.gst), fmt.money(data.totals.total), fmt.money(data.totals.paid)],
          empty: emptyState({ title: 'No purchases in this period', iconName: 'truck' })
        })
      }));
  }

  async function itemsPanel() {
    const data = await call('reports.items', range);
    return el('div.col', { style: { gap: '16px' } },
      data.rows.length ? card({ title: 'Top sellers by value', body: barChart(data.rows.slice(0, 10), { valueKey: 'value', labelKey: 'name' }) }) : null,
      card({
        title: 'Item movement',
        subtitle: `${data.rows.length} medicines sold · margin ${fmt.money(data.totals.profit)}`,
        actions: el('button.btn.sm', {
          onclick: () => exportCsv([
            ['Medicine', 'Units sold', 'Bills', 'Taxable', 'Sales value', 'Margin', 'Margin %', 'Stock now'],
            ...data.rows.map((r) => [r.name, r.units, r.bills, r.taxable, r.value, r.profit, r.margin_pct, r.stock_units])
          ], `item-movement-${range.from}.csv`)
        }, icon('download'), 'Export'),
        flush: true,
        body: dataTable({
          rows: data.rows,
          onRowClick: (r) => router.navigate(`#/products?q=${encodeURIComponent(r.name)}`),
          columns: [
            { key: 'name', label: 'Medicine', render: (r) => el('b', r.name) },
            { key: 'units', label: 'Units sold', align: 'num', render: (r) => fmt.number(r.units) },
            { key: 'bills', label: 'Bills', align: 'num' },
            { key: 'value', label: 'Sales value', align: 'num', render: (r) => fmt.money(r.value) },
            { key: 'profit', label: 'Margin', align: 'num', render: (r) => fmt.money(r.profit) },
            { key: 'margin_pct', label: 'Margin %', align: 'num', render: (r) => fmt.pct(r.margin_pct) },
            { key: 'stock_label', label: 'Stock now' }
          ],
          footer: ['Total', fmt.number(data.totals.units), '', fmt.money(data.totals.value), fmt.money(data.totals.profit), '', ''],
          empty: emptyState({ title: 'Nothing sold in this period', iconName: 'package' })
        })
      }));
  }

  async function profitPanel() {
    const data = await call('reports.profit', range);
    return el('div.col', { style: { gap: '16px' } },
      el('div.grid.cols-4',
        stat({ label: 'Sales (taxable)', value: fmt.money(data.sales.taxable), sub: `${data.sales.bills} bills`, iconName: 'trending', accent: 'blue' }),
        stat({ label: 'Cost of goods sold', value: fmt.money(data.sales.cost), iconName: 'package', accent: 'purple' }),
        stat({ label: 'Gross profit', value: fmt.money(data.grossProfit), sub: `${fmt.pct(data.marginPct)} margin`, iconName: 'report', accent: 'green' }),
        stat({ label: 'Net profit', value: fmt.money(data.netProfit), sub: `After ${fmt.money(data.expenseTotal)} expenses`, iconName: 'money', accent: data.netProfit >= 0 ? 'green' : 'red' })),
      el('div.grid.cols-2',
        card({
          title: 'Profit & loss',
          body: el('dl.kv',
            el('dt', 'Sales (taxable value)'), el('dd', fmt.money(data.sales.taxable)),
            el('dt', 'Less: sales returns'), el('dd', fmt.money(data.returns.taxable)),
            el('dt', 'Less: cost of goods sold'), el('dd', fmt.money(data.sales.cost)),
            el('dt', el('b', 'Gross profit')), el('dd', el('b', fmt.money(data.grossProfit))),
            el('dt', 'Less: expenses'), el('dd', fmt.money(data.expenseTotal)),
            el('dt', 'Less: doctor commission'), el('dd', fmt.money(data.commissions)),
            el('dt', el('b', 'Net profit')), el('dd', el('b', { class: data.netProfit >= 0 ? 'ok-text' : 'danger-text' }, fmt.money(data.netProfit))))
        }),
        card({
          title: 'Expenses by category',
          flush: true,
          body: data.expenses.length
            ? dataTable({
              compact: true,
              rows: data.expenses,
              columns: [
                { key: 'category', label: 'Category' },
                { key: 'amount', label: 'Amount', align: 'num', render: (r) => fmt.money(r.amount) }
              ],
              footer: ['Total', fmt.money(data.expenseTotal)]
            })
            : emptyState({ title: 'No expenses in this period', iconName: 'wallet' })
        })));
  }

  async function daybookPanel() {
    const data = await call('reports.daybook', { date: day });
    const dayInput = el('input', { type: 'date', value: day, style: { width: '160px' } });
    dayInput.addEventListener('change', () => { day = dayInput.value; draw(); });
    return el('div.col', { style: { gap: '16px' } },
      el('div.row', el('span.fs-13.muted', 'Day'), dayInput,
        el('div.spacer'),
        el('button.btn.sm', {
          onclick: () => exportCsv([
            ['Date', 'Account', 'In/Out', 'Amount', 'Particulars'],
            ...data.rows.map((r) => [r.date, r.account, r.direction, r.amount, r.description])
          ], `daybook-${day}.csv`)
        }, icon('download'), 'Export')),
      el('div.grid.cols-4',
        stat({ label: 'Opening balance', value: fmt.money(data.opening), iconName: 'wallet', accent: 'blue' }),
        stat({ label: 'Received', value: fmt.money(data.inflow), iconName: 'download', accent: 'green' }),
        stat({ label: 'Paid out', value: fmt.money(data.outflow), iconName: 'upload', accent: 'orange' }),
        stat({ label: 'Closing balance', value: fmt.money(data.closing), sub: `Cash ${fmt.money(data.balances.cash)} · Bank ${fmt.money(data.balances.bank)}`, iconName: 'bank', accent: 'purple' })),
      card({
        title: `Day book — ${fmt.dateLong(day)}`,
        flush: true,
        body: dataTable({
          rows: data.rows,
          columns: [
            { key: 'description', label: 'Particulars', render: (r) => el('div', r.description || '—', el('div.fs-12.muted', r.source_type)) },
            { key: 'account', label: 'Account', render: (r) => badge(r.account === 'cash' ? 'Cash' : 'Bank') },
            { key: 'in', label: 'Received', align: 'num', render: (r) => (r.direction === 'in' ? el('span.ok-text', fmt.money(r.amount)) : '—') },
            { key: 'out', label: 'Paid', align: 'num', render: (r) => (r.direction === 'out' ? el('span.danger-text', fmt.money(r.amount)) : '—') }
          ],
          footer: ['Totals', '', fmt.money(data.inflow), fmt.money(data.outflow)],
          empty: emptyState({ title: 'No money moved on this day', iconName: 'wallet' })
        })
      }),
      el('div.grid.cols-2',
        card({
          title: "Today's bills",
          flush: true,
          body: dataTable({
            compact: true,
            rows: data.sales,
            columns: [
              { key: 'no', label: 'Bill', render: (r) => el('b', r.no) },
              { key: 'patient_name', label: 'Patient', render: (r) => r.patient_name || 'Walk-in' },
              { key: 'payment_mode', label: 'Mode' },
              { key: 'total', label: 'Total', align: 'num', render: (r) => fmt.money(r.total) }
            ],
            empty: emptyState({ title: 'No bills on this day', iconName: 'billing' })
          })
        }),
        card({
          title: "Today's expenses",
          flush: true,
          body: dataTable({
            compact: true,
            rows: data.expenses,
            columns: [
              { key: 'category', label: 'Category' },
              { key: 'payee', label: 'Paid to', render: (r) => r.payee || '—' },
              { key: 'account', label: 'From' },
              { key: 'amount', label: 'Amount', align: 'num', render: (r) => fmt.money(r.amount) }
            ],
            empty: emptyState({ title: 'No expenses on this day', iconName: 'wallet' })
          })
        })));
  }

  async function outstandingPanel() {
    const data = await call('reports.outstanding');
    const table = (rows, kind) => dataTable({
      rows,
      onRowClick: kind === 'in' ? (r) => router.navigate(`#/sales/${r.id}`) : null,
      rowClass: (r) => (r.age_days > 30 ? 'row-danger' : (r.age_days > 15 ? 'row-warn' : '')),
      columns: [
        { key: 'no', label: kind === 'in' ? 'Bill' : 'Purchase', render: (r) => el('div', el('b', r.no), el('div.fs-12.muted', fmt.date(r.date))) },
        { key: 'party', label: kind === 'in' ? 'Patient' : 'Supplier', render: (r) => el('div', r.party || '—', r.phone ? el('div.fs-12.muted', r.phone) : null) },
        { key: 'age_days', label: 'Age', align: 'num', render: (r) => `${r.age_days} d` },
        { key: 'total', label: 'Bill value', align: 'num', render: (r) => fmt.money(r.total) },
        { key: 'paid', label: 'Paid', align: 'num', render: (r) => fmt.money(r.paid) },
        { key: 'due', label: 'Outstanding', align: 'num', render: (r) => el('b', fmt.money(r.due)) }
      ],
      footer: ['Total', '', '', '', '', fmt.money(rows.reduce((s, r) => s + r.due, 0))],
      empty: emptyState({ title: kind === 'in' ? 'Nothing to collect' : 'Nothing to pay', iconName: 'check' })
    });
    return el('div.col', { style: { gap: '16px' } },
      el('div.grid.cols-2',
        stat({ label: 'Receivable from patients', value: fmt.money(data.totals.receivable), iconName: 'download', accent: data.totals.receivable > 0 ? 'orange' : 'green' }),
        stat({ label: 'Payable to suppliers', value: fmt.money(data.totals.payable), iconName: 'upload', accent: data.totals.payable > 0 ? 'red' : 'green' })),
      card({
        title: 'Receivable — credit bills',
        actions: el('button.btn.sm', {
          onclick: () => exportCsv([
            ['Bill', 'Date', 'Patient', 'Phone', 'Total', 'Paid', 'Outstanding', 'Age (days)'],
            ...data.receivables.map((r) => [r.no, r.date, r.party, r.phone, r.total, r.paid, r.due, r.age_days])
          ], 'receivables.csv')
        }, icon('download'), 'Export'),
        flush: true,
        body: table(data.receivables, 'in')
      }),
      card({
        title: 'Payable — supplier bills',
        flush: true,
        body: table(data.payables, 'out')
      }));
  }

  async function draw() {
    mount(host,
      el('div.row.mb-16',
        tabs({ items: TABS, active: tab, onChange: (k) => { tab = k; draw(); } })),
      tab === 'daybook' ? null : el('div.row.mb-16', dateRange({ from: range.from, to: range.to, onChange: (r) => { Object.assign(range, r); draw(); } })),
      panel);
    mount(panel, el('div.skeleton', { style: { height: '140px' } }));
    const builders = {
      sales: salesPanel, purchases: purchasePanel, items: itemsPanel, profit: profitPanel, daybook: daybookPanel, outstanding: outstandingPanel
    };
    mount(panel, await builders[tab]());
  }

  await draw();
  return host;
}
