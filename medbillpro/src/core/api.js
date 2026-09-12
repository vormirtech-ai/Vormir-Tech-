'use strict';

const db = require('./db');
const paths = require('./paths');
const auth = require('./services/auth');
const audit = require('./services/audit');
const settings = require('./services/settings');
const setup = require('./services/setup');
const products = require('./services/products');
const parties = require('./services/parties');
const purchases = require('./services/purchases');
const sales = require('./services/sales');
const returns = require('./services/returns');
const payments = require('./services/payments');
const ledger = require('./services/ledger');
const gst = require('./services/gst');
const reports = require('./services/reports');
const reminders = require('./services/reminders');
const importer = require('./services/importer');
const backup = require('./services/backup');
const { AppError } = require('./util/errors');
const { today } = require('./util/dates');

/**
 * The single entry point the user interface talks to. The signed-in user is
 * held here in the main process, so the renderer cannot claim a role it was
 * not given.
 */
let session = null;

function currentUser() {
  return session;
}

function requireSession() {
  if (!session) throw new AppError('Your session has ended. Please sign in again.', 'NO_SESSION');
  return session;
}

const open = (fn) => (payload) => fn(payload ?? {});
const guarded = (fn) => (payload) => fn(requireSession(), payload ?? {});

const handlers = {
  // ---- session & setup -------------------------------------------------
  'app.info': open(() => ({
    productName: 'MedV',
    version: require('../../package.json').version,
    paths: paths.paths(),
    dbOpen: db.isOpen(),
    setup: setup.status(),
    user: session,
    today: today()
  })),
  'auth.login': open((payload) => {
    session = auth.login(payload);
    return { user: session, setup: setup.status(), settings: settings.all() };
  }),
  'auth.logout': open(() => {
    if (session) audit.log(session, 'logout', 'user', session.id);
    session = null;
    return { ok: true };
  }),
  'auth.session': open(() => ({ user: session })),
  'auth.users': guarded((user) => { auth.requireAdmin(user); return auth.list(); }),
  'auth.createUser': guarded((user, payload) => auth.create(user, payload)),
  'auth.updateUser': guarded((user, payload) => auth.update(user, payload)),
  'auth.removeUser': guarded((user, payload) => auth.remove(user, payload)),
  'auth.changePassword': guarded((user, payload) => auth.changePassword(user, payload)),
  'setup.status': open(() => setup.status()),
  'setup.complete': open((payload) => setup.complete(session, payload)),
  'setup.sampleData': guarded((user) => { auth.requireAdmin(user); return setup.loadSampleData(user); }),

  // ---- settings --------------------------------------------------------
  'settings.all': open(() => settings.all()),
  'settings.save': guarded((user, payload) => settings.save(user, payload)),
  'settings.store': open(() => settings.storeProfile()),

  // ---- masters ---------------------------------------------------------
  'products.list': open((payload) => products.list(payload)),
  'products.get': open((payload) => products.byId(payload.id)),
  'products.search': open((payload) => products.search(payload)),
  'products.save': guarded((user, payload) => products.save(user, payload)),
  'products.remove': guarded((user, payload) => products.remove(user, payload)),
  'products.meta': open(() => ({ categories: products.CATEGORIES, schedules: products.SCHEDULES })),
  'batches.list': open((payload) => products.batchesFor(payload.product_id, payload)),
  'batches.save': guarded((user, payload) => products.saveBatch(user, payload)),
  'batches.remove': guarded((user, payload) => products.deleteBatch(user, payload)),
  'batches.adjust': guarded((user, payload) => products.adjustStock(user, payload)),
  'stock.allocate': open((payload) => products.allocate(payload.product_id, payload.qty_units)),
  'stock.expiry': open((payload) => products.expiryReport(payload)),
  'stock.low': open(() => products.lowStockReport()),

  'customers.list': open((payload) => parties.listCustomers(payload)),
  'customers.get': open((payload) => parties.customerById(payload.id)),
  'customers.save': guarded((user, payload) => parties.saveCustomer(user, payload)),
  'customers.history': open((payload) => parties.customerHistory(payload)),
  'doctors.list': open((payload) => parties.listDoctors(payload)),
  'doctors.save': guarded((user, payload) => parties.saveDoctor(user, payload)),
  'doctors.commissions': open((payload) => parties.doctorCommissions(payload)),
  'doctors.settleCommission': guarded((user, payload) => parties.settleCommission(user, payload)),
  'suppliers.list': open((payload) => parties.listSuppliers(payload)),
  'suppliers.get': open((payload) => parties.supplierById(payload.id)),
  'suppliers.save': guarded((user, payload) => parties.saveSupplier(user, payload)),
  'suppliers.history': open((payload) => parties.supplierHistory(payload)),
  'parties.deactivate': guarded((user, payload) => parties.deactivate(user, payload)),

  // ---- billing ---------------------------------------------------------
  'sales.create': guarded((user, payload) => sales.create(user, payload)),
  'sales.get': open((payload) => sales.byId(payload.id)),
  'sales.byNumber': open((payload) => sales.byNumber(payload.no)),
  'sales.list': open((payload) => sales.list(payload)),
  'sales.remove': guarded((user, payload) => sales.remove(user, payload)),
  'sales.collect': guarded((user, payload) => sales.collect(user, payload)),
  'sales.summary': open((payload) => sales.summary(payload)),
  'sales.meta': open(() => ({ paymentModes: sales.PAYMENT_MODES })),

  // ---- purchases -------------------------------------------------------
  'purchases.create': guarded((user, payload) => purchases.create(user, payload)),
  'purchases.get': open((payload) => purchases.byId(payload.id)),
  'purchases.list': open((payload) => purchases.list(payload)),
  'purchases.remove': guarded((user, payload) => purchases.remove(user, payload)),
  'purchases.pay': guarded((user, payload) => purchases.pay(user, payload)),
  'purchases.lastRate': open((payload) => purchases.lastRate(payload.product_id)),
  'import.preview': guarded((user, payload) => importer.preview(payload)),
  'import.materialise': guarded((user, payload) => importer.materialise(user, payload)),
  'import.products': guarded((user, payload) => importer.importProducts(user, payload)),

  // ---- returns ---------------------------------------------------------
  'returns.saleLookup': open((payload) => returns.returnableSale(payload)),
  'returns.createSale': guarded((user, payload) => returns.createSaleReturn(user, payload)),
  'returns.getSale': open((payload) => returns.saleReturnById(payload.id)),
  'returns.listSale': open((payload) => returns.listSaleReturns(payload)),
  'returns.removeSale': guarded((user, payload) => returns.removeSaleReturn(user, payload)),
  'returns.createPurchase': guarded((user, payload) => returns.createPurchaseReturn(user, payload)),
  'returns.getPurchase': open((payload) => returns.purchaseReturnById(payload.id)),
  'returns.listPurchase': open((payload) => returns.listPurchaseReturns(payload)),
  'returns.removePurchase': guarded((user, payload) => returns.removePurchaseReturn(user, payload)),

  // ---- money -----------------------------------------------------------
  'payments.record': guarded((user, payload) => payments.record(user, payload)),
  'payments.list': open((payload) => payments.list(payload)),
  'payments.remove': guarded((user, payload) => payments.remove(user, payload)),
  'expenses.save': guarded((user, payload) => payments.saveExpense(user, payload)),
  'expenses.list': open((payload) => payments.listExpenses(payload)),
  'expenses.remove': guarded((user, payload) => payments.removeExpense(user, payload)),
  'expenses.meta': open(() => ({ categories: payments.CATEGORIES })),
  'accounts.transfer': guarded((user, payload) => payments.transfer(user, payload)),
  'accounts.balances': open(() => ledger.balances()),
  'accounts.entries': open((payload) => ledger.entries(payload)),

  // ---- reports & GST ---------------------------------------------------
  'reports.dashboard': open((payload) => reports.dashboard(payload)),
  'reports.sales': open((payload) => reports.salesRegister(payload)),
  'reports.purchases': open((payload) => reports.purchaseRegister(payload)),
  'reports.items': open((payload) => reports.itemMovement(payload)),
  'reports.stock': open(() => reports.stockValuation()),
  'reports.daybook': open((payload) => reports.dayBook(payload)),
  'reports.profit': open((payload) => reports.profitLoss(payload)),
  'reports.outstanding': open(() => reports.outstanding()),
  'gst.gstr1': open((payload) => gst.gstr1(payload)),
  'gst.gstr2': open((payload) => gst.gstr2(payload)),
  'gst.gstr3b': open((payload) => gst.gstr3b(payload)),
  'gst.reconcile': open((payload) => gst.reconcile(payload)),

  // ---- reminders -------------------------------------------------------
  'reminders.list': open((payload) => reminders.list(payload)),
  'reminders.save': guarded((user, payload) => reminders.save(user, payload)),
  'reminders.status': guarded((user, payload) => reminders.setStatus(user, payload)),
  'reminders.remove': guarded((user, payload) => reminders.remove(user, payload)),
  'reminders.suggestions': open((payload) => reminders.suggestions(payload)),

  // ---- data safety -----------------------------------------------------
  'backup.status': open(() => backup.status()),
  'backup.create': guarded((user, payload) => backup.create(user, payload)),
  'backup.list': open(() => backup.list()),
  'backup.inspect': guarded((user, payload) => backup.inspect(payload)),
  'backup.restore': guarded((user, payload) => backup.restore(user, payload)),
  'backup.suggestedName': open(() => ({ name: backup.suggestedName() })),
  'data.clear': guarded((user, payload) => backup.clearTransactions(user, payload)),
  'audit.list': guarded((user, payload) => { auth.requireAdmin(user); return audit.list(payload); })
};

/** Dispatches one call. Errors always come back as a plain, printable shape. */
async function handle(channel, payload) {
  const fn = handlers[channel];
  if (!fn) throw new AppError(`Unknown action: ${channel}`, 'UNKNOWN_CHANNEL');
  return fn(payload);
}

function channels() {
  return Object.keys(handlers);
}

function setSession(user) {
  session = user;
}

module.exports = { handle, channels, currentUser, setSession };
