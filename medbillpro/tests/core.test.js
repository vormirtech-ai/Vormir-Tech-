'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'medv-test-'));
const paths = require('../src/core/paths');
paths.configure(root);

const db = require('../src/core/db');
const api = require('../src/core/api');
const { today, addMonths, addDays } = require('../src/core/util/dates');
const money = require('../src/core/util/money');

db.open(paths.dbFile());

const call = (channel, payload) => api.handle(channel, payload);
const exp = (months) => addMonths(today(), months).slice(0, 7);

test('money helpers', () => {
  assert.equal(money.r2(0.1 + 0.2), 0.3);
  assert.equal(money.r2(-2.345), -2.35);
  const line = money.lineTotals({ qty: 10, rate: 10, discPct: 10, gstRate: 12 });
  assert.deepEqual(
    { taxable: line.taxable, cgst: line.cgst, sgst: line.sgst, total: line.total },
    { taxable: 90, cgst: 5.4, sgst: 5.4, total: 100.8 }
  );
  const incl = money.lineTotals({ qty: 1, rate: 112, gstRate: 12, gstInclusive: true });
  assert.equal(incl.taxable, 100);
  assert.equal(incl.total, 112);
  assert.equal(money.amountInWords(1234.5), 'One Thousand Two Hundred Thirty Four Rupees and Fifty Paise Only');
});

test('first launch creates an admin account and default settings', async () => {
  const info = await call('app.info');
  assert.equal(info.setup.complete, false);
  assert.equal(info.setup.users, 1);
  const login = await call('auth.login', { username: 'admin', password: 'admin123' });
  assert.equal(login.user.role, 'admin');
  await assert.rejects(() => call('auth.login', { username: 'admin', password: 'wrong' }), /Incorrect username or password/);
});

test('setup wizard stores the shop profile and replaces the default password', async () => {
  const res = await call('setup.complete', {
    store_name: 'Vormir Medicals',
    store_address: 'Itwari Road',
    store_city: 'Nagpur',
    store_state: 'Maharashtra',
    store_phone: '9226406057',
    store_gstin: '27ABCDE1234F1Z5',
    store_dl_no: 'MH-NAG-20B-9988',
    invoice_prefix: 'VM',
    admin_password: 'shop@2026',
    print_format: 'a5'
  });
  assert.equal(res.settings.store_name, 'Vormir Medicals');
  assert.equal(res.settings.setup_complete, '1');
  await assert.rejects(() => call('auth.login', { username: 'admin', password: 'admin123' }));
  const login = await call('auth.login', { username: 'admin', password: 'shop@2026' });
  assert.equal(login.user.username, 'admin');
});

test('the offline acceptance scenario from the requirements', async () => {
  // 4. create medicine
  const product = await call('products.save', {
    name: 'Paracetamol 500mg Tablet',
    generic: 'Paracetamol',
    manufacturer: 'Cipla',
    category: 'Tablet',
    pack_size: 10,
    gst_rate: 12,
    reorder_level: 20,
    hsn: '3004'
  });
  assert.ok(product.id);
  assert.equal(product.stock_units, 0);

  // 5 + 6. add batch through a purchase
  const supplier = await call('suppliers.save', { name: 'Nagpur Distributors', gstin: '27ABCDE1234F1Z5' });
  const purchase = await call('purchases.create', {
    supplier_id: supplier.id,
    ref_no: 'SB-1001',
    payment_mode: 'Credit',
    items: [{
      product_id: product.id,
      batch_no: 'PCM101',
      expiry: exp(18),
      mrp: 24.5,
      qty_units: 100,
      free_units: 10,
      rate_per_unit: 1.6,
      disc_pct: 5,
      gst_rate: 12
    }]
  });
  assert.equal(purchase.items.length, 1);
  assert.equal(money.r2(purchase.subtotal), 152);
  assert.equal(money.r2(purchase.gst_amount), 18.24);
  assert.equal(purchase.total, 170);

  // 7. verify stock — 100 bought + 10 free
  const afterPurchase = await call('products.get', { id: product.id });
  assert.equal(afterPurchase.stock_units, 110);
  assert.equal(afterPurchase.stock_label, '11 Strip');

  // 8. create customer
  const customer = await call('customers.save', { name: 'Ramesh Patil', phone: '9822012345' });
  const doctor = await call('doctors.save', { name: 'Dr. Deshmukh', commission_pct: 2 });
  assert.equal(doctor[0].name, 'Dr. Deshmukh');

  // 9. create sale — 2 strips and 3 loose tablets
  const batch = (await call('batches.list', { product_id: product.id }))[0];
  const sale = await call('sales.create', {
    customer_id: customer.id,
    doctor_id: doctor[0].id,
    payment_mode: 'Cash',
    reminder_days: 25,
    items: [{ product_id: product.id, batch_id: batch.id, qty_units: 23, rate_per_unit: 2.45, disc_pct: 0, gst_rate: 12 }]
  });
  assert.equal(sale.no, 'VM-0001');
  assert.equal(sale.items[0].qty_units, 23);
  // 23 x 2.45 = 56.35 taxable, GST 12% = 6.76, total 63.11 -> rounded 63
  assert.equal(sale.subtotal, 56.35);
  assert.equal(sale.gst_amount, 6.76);
  assert.equal(sale.total, 63);
  assert.equal(sale.balance, 0);

  // 10. invoice is printable — the payload carries everything the layout needs
  assert.equal(sale.store.name, 'Vormir Medicals');
  assert.ok(sale.gst_summary.length === 1 && sale.gst_summary[0].rate === 12);

  // stock deducted, cash received
  assert.equal((await call('products.get', { id: product.id })).stock_units, 87);
  assert.equal((await call('accounts.balances')).cash, 63);

  // 14. data is present after a close/reopen cycle (step 11-13)
  db.close();
  db.open(paths.dbFile());
  const reopened = await call('sales.get', { id: sale.id });
  assert.equal(reopened.total, 63);
  assert.equal((await call('products.get', { id: product.id })).stock_units, 87);

  // 15. another sale, this time on credit
  await call('auth.login', { username: 'admin', password: 'shop@2026' });
  const credit = await call('sales.create', {
    customer_id: customer.id,
    payment_mode: 'Credit',
    items: [{ product_id: product.id, batch_id: batch.id, qty_units: 10, rate_per_unit: 2.45, gst_rate: 12 }]
  });
  assert.equal(credit.paid, 0);
  assert.equal(credit.balance, credit.total);
  assert.equal((await call('customers.get', { id: customer.id })).balance, credit.total);

  // 16. sales report
  const register = await call('reports.sales', { from: today(), to: today() });
  assert.equal(register.totals.bills, 2);
  assert.equal(register.totals.total, money.r2(sale.total + credit.total));
  const dash = await call('reports.dashboard', {});
  assert.equal(dash.day.bills, 2);
  assert.equal(dash.counts.products, 1);
  assert.equal(dash.pendingRxCount, 1);

  // 17. local backup
  const backup = await call('backup.create', {});
  assert.ok(fs.existsSync(backup.path));
  assert.ok(backup.size > 0);

  // 18. delete test data
  await call('data.clear', { confirm: true });
  assert.equal((await call('sales.list', {})).rows.length, 0);
  assert.equal((await call('products.get', { id: product.id })).stock_units, 0);

  // 19 + 20. restore and verify
  const inspected = await call('backup.inspect', { sourcePath: backup.path });
  assert.equal(inspected.counts.sales, 2);
  const restored = await call('backup.restore', { sourcePath: backup.path, confirm: true });
  assert.equal(restored.ok, true);
  assert.ok(fs.existsSync(restored.safetyCopy));
  api.setSession({ id: 1, username: 'admin', role: 'admin', name: 'Administrator' });
  assert.equal((await call('sales.list', {})).rows.length, 2);
  assert.equal((await call('products.get', { id: product.id })).stock_units, 77);
  assert.equal((await call('accounts.balances')).cash, 63);
});

test('a restore refuses to run without confirmation and rejects foreign files', async () => {
  const backup = await call('backup.create', {});
  await assert.rejects(() => call('backup.restore', { sourcePath: backup.path }), /Please confirm/);
  const junk = path.join(root, 'not-a-backup.db');
  fs.writeFileSync(junk, 'this is not a database');
  await assert.rejects(() => call('backup.restore', { sourcePath: junk, confirm: true }), /could not be opened|not a MedV backup/);
  // The live database is untouched after a failed restore.
  assert.equal((await call('sales.list', {})).rows.length, 2);
});

test('stock can never go negative and a failed sale rolls back completely', async () => {
  const product = (await call('products.list', {}))[0];
  const batch = (await call('batches.list', { product_id: product.id }))[0];
  const before = (await call('products.get', { id: product.id })).stock_units;
  const bills = (await call('sales.list', {})).rows.length;

  await assert.rejects(
    () => call('sales.create', {
      payment_mode: 'Cash',
      items: [
        { product_id: product.id, batch_id: batch.id, qty_units: 5, rate_per_unit: 2.45, gst_rate: 12 },
        { product_id: product.id, batch_id: batch.id, qty_units: 99999, rate_per_unit: 2.45, gst_rate: 12 }
      ]
    }),
    /Not enough stock/
  );
  assert.equal((await call('products.get', { id: product.id })).stock_units, before);
  assert.equal((await call('sales.list', {})).rows.length, bills);
  assert.equal((await call('accounts.balances')).cash, 63);
});

test('expired batches cannot be billed', async () => {
  const product = (await call('products.list', {}))[0];
  const batch = await call('batches.save', {
    product_id: product.id,
    batch_no: 'OLD001',
    expiry: addMonths(today(), -3).slice(0, 7),
    mrp: 24.5,
    rate_per_unit: 1.6,
    qty_units: 50
  });
  await assert.rejects(
    () => call('sales.create', { payment_mode: 'Cash', items: [{ product_id: product.id, batch_id: batch.id, qty_units: 1, rate_per_unit: 2.45, gst_rate: 12 }] }),
    /has expired/
  );
  const allocation = await call('stock.allocate', { product_id: product.id, qty_units: 999 });
  assert.ok(allocation.picks.every((p) => p.batch_no !== 'OLD001'));
  const expiryList = await call('stock.expiry', { withinDays: 30 });
  assert.ok(expiryList.some((e) => e.batch_no === 'OLD001' && e.expired));
});

test('loose sale of a pack-only medicine is refused', async () => {
  const product = await call('products.save', {
    name: 'Sealed Syrup 60ml', pack_size: 6, allow_loose: 0, gst_rate: 12, pack_label: 'Box', unit_label: 'Bottle'
  });
  const batch = await call('batches.save', {
    product_id: product.id, batch_no: 'SY01', expiry: exp(12), mrp: 600, rate_per_unit: 70, qty_units: 12
  });
  await assert.rejects(
    () => call('sales.create', { payment_mode: 'Cash', items: [{ product_id: product.id, batch_id: batch.id, qty_units: 4, rate_per_unit: 100, gst_rate: 12 }] }),
    /multiples of 6/
  );
  const ok = await call('sales.create', {
    payment_mode: 'Cash',
    items: [{ product_id: product.id, batch_id: batch.id, qty_units: 6, rate_per_unit: 100, gst_rate: 12 }]
  });
  assert.equal(ok.items[0].qty_units, 6);
});

test('bill-level discount keeps GST consistent with the amount charged', async () => {
  const product = (await call('products.list', { search: 'Paracetamol' }))[0];
  const batch = (await call('batches.list', { product_id: product.id })).find((b) => !b.expired);
  const sale = await call('sales.create', {
    payment_mode: 'Cash',
    bill_discount: 10,
    items: [{ product_id: product.id, batch_id: batch.id, qty_units: 20, rate_per_unit: 2.45, gst_rate: 12 }]
  });
  assert.equal(sale.subtotal, 39);       // 49 - 10
  assert.equal(sale.gst_amount, 4.68);   // 12% of 39
  const lineSum = money.r2(sale.items.reduce((s, i) => s + i.taxable, 0));
  assert.equal(lineSum, sale.subtotal);
});

test('sales return restores stock, refunds cash and blocks over-returning', async () => {
  const product = (await call('products.list', { search: 'Paracetamol' }))[0];
  const batch = (await call('batches.list', { product_id: product.id })).find((b) => !b.expired);
  const sale = await call('sales.create', {
    payment_mode: 'Cash',
    items: [{ product_id: product.id, batch_id: batch.id, qty_units: 10, rate_per_unit: 2.45, gst_rate: 12 }]
  });
  const stockAfterSale = (await call('products.get', { id: product.id })).stock_units;
  const cashAfterSale = (await call('accounts.balances')).cash;

  const lookup = await call('returns.saleLookup', { id: sale.id });
  assert.equal(lookup.items[0].returnable_units, 10);
  const ret = await call('returns.createSale', {
    sale_id: sale.id,
    refund_mode: 'Cash',
    items: [{ sale_item_id: lookup.items[0].id, qty_units: 4, restock: 1 }]
  });
  assert.equal(ret.items[0].qty_units, 4);
  assert.equal((await call('products.get', { id: product.id })).stock_units, stockAfterSale + 4);
  assert.equal((await call('accounts.balances')).cash, money.r2(cashAfterSale - ret.total));

  await assert.rejects(
    () => call('returns.createSale', {
      sale_id: sale.id, refund_mode: 'Cash',
      items: [{ sale_item_id: lookup.items[0].id, qty_units: 7 }]
    }),
    /only 6 of/
  );
});

test('purchase return reduces stock and cannot exceed what is on hand', async () => {
  const product = (await call('products.list', { search: 'Paracetamol' }))[0];
  const batch = (await call('batches.list', { product_id: product.id })).find((b) => !b.expired);
  const supplier = (await call('suppliers.list', {}))[0];
  const before = batch.qty_units;
  const ret = await call('returns.createPurchase', {
    supplier_id: supplier.id,
    reason: 'Damaged in transit',
    items: [{ batch_id: batch.id, qty_units: 5, rate_per_unit: batch.rate_per_unit, gst_rate: 12 }]
  });
  assert.ok(ret.total > 0);
  const after = (await call('batches.list', { product_id: product.id })).find((b) => b.id === batch.id);
  assert.equal(after.qty_units, before - 5);
  await assert.rejects(
    () => call('returns.createPurchase', {
      supplier_id: supplier.id,
      items: [{ batch_id: batch.id, qty_units: 999999 }]
    }),
    /are in stock/
  );
});

test('credit collection, supplier payment and cash book all agree', async () => {
  const unpaid = (await call('sales.list', { unpaidOnly: true })).rows[0];
  assert.ok(unpaid, 'expected a credit bill from the earlier scenario');
  const due = money.r2(unpaid.total - unpaid.paid);
  const cashBefore = (await call('accounts.balances')).cash;
  await assert.rejects(() => call('sales.collect', { id: unpaid.id, amount: due + 50 }), /outstanding amount/);
  const collected = await call('sales.collect', { id: unpaid.id, amount: due, mode: 'Cash' });
  assert.equal(collected.balance, 0);
  assert.equal((await call('accounts.balances')).cash, money.r2(cashBefore + due));

  const purchase = (await call('purchases.list', { unpaidOnly: true })).rows[0];
  const bankBefore = (await call('accounts.balances')).bank;
  await call('purchases.pay', { id: purchase.id, amount: 100, mode: 'Bank Transfer' });
  assert.equal((await call('accounts.balances')).bank, money.r2(bankBefore - 100));

  const daybook = await call('reports.daybook', { date: today() });
  assert.equal(daybook.closing, (await call('accounts.balances')).total);
});

test('expenses and cash/bank transfer post to the ledger', async () => {
  const before = await call('accounts.balances');
  await call('expenses.save', { category: 'Electricity', amount: 250, account: 'cash', payee: 'MSEDCL' });
  const after = await call('accounts.balances');
  assert.equal(after.cash, money.r2(before.cash - 250));
  const list = await call('expenses.list', { from: today(), to: today() });
  assert.equal(list.total, 250);

  await call('accounts.transfer', { from: 'cash', to: 'bank', amount: 100 });
  const moved = await call('accounts.balances');
  assert.equal(moved.cash, money.r2(after.cash - 100));
  assert.equal(moved.bank, money.r2(after.bank + 100));
  assert.equal(moved.total, after.total);
});

test('GST reports add up and reconcile', async () => {
  const r1 = await call('gst.gstr1', { from: today(), to: today() });
  const bills = await call('sales.list', { from: today(), to: today() });
  const taxable = money.r2(bills.rows.reduce((s, r) => s + r.subtotal, 0));
  assert.equal(r1.totals.taxable, taxable);
  assert.equal(money.r2(r1.totals.cgst + r1.totals.sgst), money.r2(bills.totals.gst));
  assert.ok(r1.hsn.length >= 1);

  const r2report = await call('gst.gstr2', { from: today(), to: today() });
  assert.ok(r2report.totals.gst > 0);
  const r3b = await call('gst.gstr3b', { from: today(), to: today() });
  assert.equal(r3b.outward.taxable, r1.net.taxable);
  const recon = await call('gst.reconcile', { from: today(), to: today() });
  assert.equal(recon.clean, true, JSON.stringify(recon.mismatches));
});

test('spreadsheet import maps a distributor bill onto purchase lines', async () => {
  const csv = [
    'Sr,Product Name,Pack,Batch No,Exp Date,Qty,Free,MRP,Rate,Disc%,GST%',
    '1,Paracetamol 500mg Tablet,10x10,PCM777,06/2028,50,5,24.50,1.60,5,12',
    '2,Brand New Medicine 250mg,1x15,BN900,Jan-29,30,0,90.00,5.20,0,12',
    '3,Total,,,,,,,,'
  ].join('\n');
  const preview = await call('import.preview', { filename: 'bill.csv', text: csv });
  assert.equal(preview.lines.length, 2);
  assert.equal(preview.summary.newProducts, 1);
  assert.equal(preview.lines[0].expiry, '2028-06');
  assert.equal(preview.lines[1].expiry, '2029-01');
  assert.equal(preview.lines[0].product_id !== null, true);

  const lines = await call('import.materialise', { lines: preview.lines });
  const supplier = (await call('suppliers.list', {}))[0];
  const purchase = await call('purchases.create', {
    supplier_id: supplier.id, ref_no: 'IMP-778', payment_mode: 'Credit', items: lines
  });
  assert.equal(purchase.items.length, 2);
  assert.ok((await call('products.list', { search: 'Brand New Medicine' })).length === 1);
  const batches = await call('batches.list', { product_id: lines[0].product_id });
  assert.ok(batches.some((b) => b.batch_no === 'PCM777' && b.qty_units === 55));
});

test('duplicate supplier bill numbers are rejected', async () => {
  const supplier = (await call('suppliers.list', {}))[0];
  const product = (await call('products.list', { search: 'Paracetamol' }))[0];
  await assert.rejects(
    () => call('purchases.create', {
      supplier_id: supplier.id,
      ref_no: 'IMP-778',
      items: [{ product_id: product.id, batch_no: 'X1', expiry: exp(12), mrp: 10, qty_units: 1, rate_per_unit: 1, gst_rate: 12 }]
    }),
    /already entered/
  );
});

test('roles are enforced in the main process', async () => {
  await call('auth.login', { username: 'admin', password: 'shop@2026' });
  await call('auth.createUser', { username: 'cashier1', name: 'Counter Staff', role: 'cashier', password: 'pass123' });
  await call('auth.login', { username: 'cashier1', password: 'pass123' });
  await assert.rejects(() => call('products.save', { name: 'Sneaky Product' }), /permission/);
  await assert.rejects(() => call('auth.users'), /administrator/);
  await assert.rejects(() => call('sales.remove', { id: 1 }), /permission/);
  // A cashier can still bill and take payments.
  const product = (await call('products.list', { search: 'Paracetamol' }))[0];
  const batch = (await call('batches.list', { product_id: product.id })).find((b) => !b.expired && b.qty_units > 0);
  const sale = await call('sales.create', {
    payment_mode: 'Cash',
    items: [{ product_id: product.id, batch_id: batch.id, qty_units: 1, rate_per_unit: 2.45, gst_rate: 12 }]
  });
  assert.ok(sale.id);
  await call('auth.login', { username: 'admin', password: 'shop@2026' });
});

test('deleting a bill returns stock and clears its money trail', async () => {
  const product = (await call('products.list', { search: 'Paracetamol' }))[0];
  const batch = (await call('batches.list', { product_id: product.id })).find((b) => !b.expired && b.qty_units > 0);
  const sale = await call('sales.create', {
    payment_mode: 'Cash',
    items: [{ product_id: product.id, batch_id: batch.id, qty_units: 3, rate_per_unit: 2.45, gst_rate: 12 }]
  });
  const stock = (await call('products.get', { id: product.id })).stock_units;
  const cash = (await call('accounts.balances')).cash;
  await call('sales.remove', { id: sale.id, reason: 'entered twice' });
  assert.equal((await call('products.get', { id: product.id })).stock_units, stock + 3);
  assert.equal((await call('accounts.balances')).cash, money.r2(cash - sale.total));
  assert.equal(await call('sales.get', { id: sale.id }), null);
});

test('reminders compose a message without contacting anything', async () => {
  const customer = (await call('customers.list', {}))[0];
  await call('reminders.save', { customer_id: customer.id, medicines: 'Paracetamol 500mg', due_date: addDays(today(), -1) });
  const list = await call('reminders.list', { status: 'pending' });
  const mine = list.find((r) => r.customer_id === customer.id);
  assert.ok(mine.message.includes(customer.name));
  assert.ok(mine.message.includes('Vormir Medicals'));
  await call('reminders.status', { id: mine.id, status: 'sent' });
  assert.equal((await call('reminders.list', { status: 'sent' })).some((r) => r.id === mine.id), true);
});

test('audit log records who did what', async () => {
  const rows = await call('audit.list', {});
  assert.ok(rows.length > 10);
  assert.ok(rows.some((r) => r.action === 'sale.create'));
  assert.ok(rows.some((r) => r.action === 'backup.restore.done'));
});

test('unknown channels fail loudly', async () => {
  await assert.rejects(() => call('does.not.exist', {}), /Unknown action/);
});

test.after(() => {
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
});
