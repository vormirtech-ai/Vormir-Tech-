"""
The single entry point the interface talks to.

The signed-in user is held here, in the server process, so the browser cannot
claim a role it was not given. Channel names match the JavaScript editions, so
the same interface files work unchanged.
"""

from __future__ import annotations
from . import db, paths
from .services import (audit, auth, backup, gst, importer, ledger, parties, payments,
                       products, purchases, reminders, reports, returns, sales, settings, setup)
from .util.dates import today
from .util.errors import AppError

_session = None


def current_user():
    return _session


def set_session(user):
    global _session
    _session = user


def _require_session():
    if not _session:
        raise AppError("Your session has ended. Please sign in again.", "NO_SESSION")
    return _session


def _app_info(**_):
    from . import __version__
    return {
        "productName": "MedV",
        "version": __version__,
        "paths": paths.paths(),
        "dbOpen": db.is_open(),
        "setup": setup.status(),
        "user": _session,
        "today": today(),
        "edition": "python",
    }


def _login(**payload):
    global _session
    _session = auth.login(**payload)
    return {"user": _session, "setup": setup.status(), "settings": settings.all_settings()}


def _logout(**_):
    global _session
    if _session:
        audit.log(_session, "logout", "user", _session.get("id"))
    _session = None
    return {"ok": True}


def _open(fn):
    """A channel anyone signed in (or not yet) may call."""
    return ("open", fn)


def _guarded(fn):
    """A channel that acts on behalf of the signed-in user."""
    return ("guarded", fn)


HANDLERS = {
    # ---- session & setup -------------------------------------------------
    "app.info": _open(_app_info),
    "auth.login": _open(_login),
    "auth.logout": _open(_logout),
    "auth.session": _open(lambda **_: {"user": _session}),
    "auth.users": _guarded(lambda user, payload: (auth.require_admin(user), auth.listing())[1]),
    "auth.createUser": _guarded(auth.create),
    "auth.updateUser": _guarded(auth.update),
    "auth.removeUser": _guarded(auth.remove),
    "auth.changePassword": _guarded(auth.change_password),
    "setup.status": _open(setup.status),
    "setup.complete": _open(lambda **payload: setup.complete(_session, payload)),
    "setup.sampleData": _guarded(lambda user, payload: (auth.require_admin(user),
                                                        setup.load_sample_data(user))[1]),

    # ---- settings --------------------------------------------------------
    "settings.all": _open(lambda **_: settings.all_settings()),
    "settings.save": _guarded(settings.save),
    "settings.store": _open(lambda **_: settings.store_profile()),

    # ---- masters ---------------------------------------------------------
    "products.list": _open(products.listing),
    "products.get": _open(lambda id=None, **_: products.by_id(id)),
    "products.search": _open(products.search),
    "products.save": _guarded(products.save),
    "products.remove": _guarded(products.remove),
    "products.meta": _open(lambda **_: {"categories": products.CATEGORIES, "schedules": products.SCHEDULES}),
    "batches.list": _open(lambda product_id=None, onlyInStock=False, **_:
                          products.batches_for(product_id, only_in_stock=onlyInStock)),
    "batches.save": _guarded(products.save_batch),
    "batches.remove": _guarded(products.delete_batch),
    "batches.adjust": _guarded(products.adjust_stock),
    "stock.allocate": _open(lambda product_id=None, qty_units=0, **_:
                            products.allocate(product_id, qty_units)),
    "stock.expiry": _open(products.expiry_report),
    "stock.low": _open(products.low_stock_report),

    "customers.list": _open(parties.list_customers),
    "customers.get": _open(lambda id=None, **_: parties.customer_by_id(id)),
    "customers.save": _guarded(parties.save_customer),
    "customers.history": _open(parties.customer_history),
    "doctors.list": _open(parties.list_doctors),
    "doctors.save": _guarded(parties.save_doctor),
    "doctors.commissions": _open(parties.doctor_commissions),
    "doctors.settleCommission": _guarded(parties.settle_commission),
    "suppliers.list": _open(parties.list_suppliers),
    "suppliers.get": _open(lambda id=None, **_: parties.supplier_by_id(id)),
    "suppliers.save": _guarded(parties.save_supplier),
    "suppliers.history": _open(parties.supplier_history),
    "parties.deactivate": _guarded(parties.deactivate),

    # ---- billing ---------------------------------------------------------
    "sales.create": _guarded(sales.create),
    "sales.get": _open(lambda id=None, **_: sales.by_id(id)),
    "sales.byNumber": _open(sales.by_number),
    "sales.list": _open(sales.listing),
    "sales.remove": _guarded(sales.remove),
    "sales.collect": _guarded(sales.collect),
    "sales.summary": _open(sales.summary),
    "sales.meta": _open(lambda **_: {"paymentModes": list(sales.PAYMENT_MODES)}),

    # ---- purchases -------------------------------------------------------
    "purchases.create": _guarded(purchases.create),
    "purchases.get": _open(lambda id=None, **_: purchases.by_id(id)),
    "purchases.list": _open(purchases.listing),
    "purchases.remove": _guarded(purchases.remove),
    "purchases.pay": _guarded(purchases.pay),
    "purchases.lastRate": _open(purchases.last_rate),
    "import.preview": _guarded(lambda user, payload: importer.preview(**payload)),
    "import.materialise": _guarded(importer.materialise),
    "import.products": _guarded(importer.import_products),

    # ---- returns ---------------------------------------------------------
    "returns.saleLookup": _open(returns.returnable_sale),
    "returns.createSale": _guarded(returns.create_sale_return),
    "returns.getSale": _open(returns.sale_return_by_id),
    "returns.listSale": _open(returns.list_sale_returns),
    "returns.removeSale": _guarded(returns.remove_sale_return),
    "returns.createPurchase": _guarded(returns.create_purchase_return),
    "returns.getPurchase": _open(returns.purchase_return_by_id),
    "returns.listPurchase": _open(returns.list_purchase_returns),
    "returns.removePurchase": _guarded(returns.remove_purchase_return),

    # ---- money -----------------------------------------------------------
    "payments.record": _guarded(payments.record),
    "payments.list": _open(payments.listing),
    "payments.remove": _guarded(payments.remove),
    "expenses.save": _guarded(payments.save_expense),
    "expenses.list": _open(payments.list_expenses),
    "expenses.remove": _guarded(payments.remove_expense),
    "expenses.meta": _open(lambda **_: {"categories": payments.CATEGORIES}),
    "accounts.transfer": _guarded(payments.transfer),
    "accounts.balances": _open(lambda **_: ledger.balances()),
    "accounts.entries": _open(ledger.entries),

    # ---- reports & GST ---------------------------------------------------
    "reports.dashboard": _open(reports.dashboard),
    "reports.sales": _open(reports.sales_register),
    "reports.purchases": _open(reports.purchase_register),
    "reports.items": _open(reports.item_movement),
    "reports.stock": _open(reports.stock_valuation),
    "reports.daybook": _open(reports.day_book),
    "reports.profit": _open(reports.profit_loss),
    "reports.outstanding": _open(reports.outstanding),
    "gst.gstr1": _open(gst.gstr1),
    "gst.gstr2": _open(gst.gstr2),
    "gst.gstr3b": _open(gst.gstr3b),
    "gst.reconcile": _open(gst.reconcile),

    # ---- reminders -------------------------------------------------------
    "reminders.list": _open(reminders.listing),
    "reminders.save": _guarded(reminders.save),
    "reminders.status": _guarded(reminders.set_status),
    "reminders.remove": _guarded(reminders.remove),
    "reminders.suggestions": _open(reminders.suggestions),

    # ---- data safety -----------------------------------------------------
    "backup.status": _open(backup.status),
    "backup.create": _guarded(backup.create),
    "backup.list": _open(backup.listing),
    "backup.inspect": _guarded(lambda user, payload: backup.inspect(**payload)),
    "backup.restore": _guarded(backup.restore),
    "backup.suggestedName": _open(backup.suggested_name),
    "data.clear": _guarded(backup.clear_transactions),
    "audit.list": _guarded(lambda user, payload: (auth.require_admin(user), audit.listing(**payload))[1]),
}


def handle(channel: str, payload: dict | None = None):
    """Dispatches one call. Unknown channels fail loudly rather than silently."""
    entry = HANDLERS.get(channel)
    if entry is None:
        raise AppError(f"Unknown action: {channel}", "UNKNOWN_CHANNEL")
    kind, fn = entry
    data = payload or {}
    if kind == "guarded":
        return fn(_require_session(), data)
    return fn(**data)


def channels():
    return sorted(HANDLERS)
