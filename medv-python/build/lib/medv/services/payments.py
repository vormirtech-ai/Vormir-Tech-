"""Receipts, supplier payments, expenses and cash/bank transfers."""

from __future__ import annotations
from .. import db
from ..util.dates import now_stamp, today
from ..util.errors import assert_that
from ..util.money import r2
from ..util import validate as v
from . import audit, auth, ledger, parties

CATEGORIES = ["Rent", "Salary", "Electricity", "Transport", "Packing", "Telephone", "Maintenance",
              "Licence & Fees", "Tea & Refreshment", "General", "Other"]


def record(actor, payload):
    """A receipt from a customer, or a payment to a supplier."""
    auth.require_role(actor, ("admin", "pharmacist", "cashier"))
    party_type = v.one_of(payload.get("party_type"), "Party type", ("customer", "supplier"), "customer")
    label = "Customer" if party_type == "customer" else "Supplier"
    party_id = v.integer(payload.get("party_id"), label, required=True, minimum=1)
    direction = v.one_of(payload.get("direction"), "Direction", ("in", "out"),
                         "in" if party_type == "customer" else "out")
    amount = r2(v.number(payload.get("amount"), "Amount", required=True, minimum=0.01, maximum=1e9))
    mode = v.one_of(payload.get("mode"), "Payment mode",
                    [m for m in ledger.MODES if m != "Credit"], "Cash")
    date = v.iso_date(payload.get("date"), "Date", required=False, fallback="today") or today()
    ref_no = v.text(payload.get("ref_no"), "Reference", max_len=60)
    notes = v.text(payload.get("notes"), "Notes", max_len=300)
    account = ledger.account_for_mode(mode)

    party = (parties.customer_by_id(party_id) if party_type == "customer"
             else parties.supplier_by_id(party_id))
    assert_that(party, "That party no longer exists.")

    with db.tx():
        info = db.run(
            """INSERT INTO payments (date, party_type, party_id, party_name, direction, amount, mode,
                  account, ref_no, notes, created_at, created_by)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (date, party_type, party_id, party["name"], direction, amount, mode, account, ref_no,
             notes, now_stamp(), (actor or {}).get("username", "")))
        payment_id = int(info["lastrowid"])
        verb = "Received from" if direction == "in" else "Paid to"
        ledger.post(date, account, direction, amount, "payment", payment_id,
                    f"{verb} {party['name']}" + (f" ({ref_no})" if ref_no else ""))
        audit.log(actor, "payment.record", "payment", payment_id,
                  {"partyType": party_type, "partyId": party_id, "amount": amount, "mode": mode})
        refreshed = (parties.customer_by_id(party_id) if party_type == "customer"
                     else parties.supplier_by_id(party_id))
        return {"id": payment_id, "balance": refreshed["balance"]}


def remove(actor, payload):
    auth.require_admin(actor)
    payment_id = v.integer(payload.get("id"), "Payment", required=True, minimum=1)
    with db.tx():
        row = db.one_row("SELECT * FROM payments WHERE id = ?", (payment_id,))
        assert_that(row, "That payment no longer exists.")
        assert_that(not row["sale_id"] and not row["purchase_id"],
                    "This receipt was taken with a bill. Edit or delete the bill instead.")
        ledger.reverse_source("payment", payment_id)
        db.run("DELETE FROM payments WHERE id = ?", (payment_id,))
        audit.log(actor, "payment.delete", "payment", payment_id, dict(row))
        return {"ok": True}


def listing(from_date=None, to_date=None, partyType="", direction="", limit=500, **kwargs):
    from_date = from_date or kwargs.get("from")
    to_date = to_date or kwargs.get("to")
    where, params = [], []
    if from_date:
        where.append("date >= ?")
        params.append(from_date)
    if to_date:
        where.append("date <= ?")
        params.append(to_date)
    if partyType:
        where.append("party_type = ?")
        params.append(partyType)
    if direction:
        where.append("direction = ?")
        params.append(direction)
    clause = f"WHERE {' AND '.join(where)}" if where else ""
    rows = db.all_rows(f"SELECT * FROM payments {clause} ORDER BY date DESC, id DESC LIMIT ?",
                       (*params, min(int(limit or 500), 5000)))
    received = r2(sum(r["amount"] for r in rows if r["direction"] == "in"))
    paid = r2(sum(r["amount"] for r in rows if r["direction"] == "out"))
    return {"rows": rows, "totals": {"received": received, "paid": paid}}


# ------------------------------------------------------------------ expenses
def save_expense(actor, payload):
    auth.require_role(actor, ("admin", "pharmacist"))
    expense_id = v.integer(payload.get("id"), "Expense", minimum=1) if payload.get("id") else None
    date = v.iso_date(payload.get("date"), "Date", required=False, fallback="today") or today()
    category = v.text(payload.get("category"), "Category", required=True, max_len=60)
    payee = v.text(payload.get("payee"), "Paid to", max_len=120)
    amount = r2(v.number(payload.get("amount"), "Amount", required=True, minimum=0.01, maximum=1e9))
    account = v.one_of(payload.get("account"), "Account", ledger.ACCOUNTS, "cash")
    notes = v.text(payload.get("notes"), "Notes", max_len=300)

    with db.tx():
        if expense_id:
            assert_that(db.one_row("SELECT id FROM expenses WHERE id = ?", (expense_id,)),
                        "That expense no longer exists.")
            db.run("UPDATE expenses SET date=?, category=?, payee=?, amount=?, account=?, notes=? WHERE id=?",
                   (date, category, payee, amount, account, notes, expense_id))
            ledger.reverse_source("expense", expense_id)
        else:
            info = db.run(
                """INSERT INTO expenses (date, category, payee, amount, account, notes, created_at, created_by)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (date, category, payee, amount, account, notes, now_stamp(),
                 (actor or {}).get("username", "")))
            expense_id = int(info["lastrowid"])
        ledger.post(date, account, "out", amount, "expense", expense_id,
                    f"{category}" + (f" — {payee}" if payee else ""))
        audit.log(actor, "expense.update" if payload.get("id") else "expense.create", "expense",
                  expense_id, {"category": category, "amount": amount})
        return {"id": expense_id}


def list_expenses(from_date=None, to_date=None, category="", limit=500, **kwargs):
    from_date = from_date or kwargs.get("from")
    to_date = to_date or kwargs.get("to")
    where, params = [], []
    if from_date:
        where.append("date >= ?")
        params.append(from_date)
    if to_date:
        where.append("date <= ?")
        params.append(to_date)
    if category:
        where.append("category = ?")
        params.append(category)
    clause = f"WHERE {' AND '.join(where)}" if where else ""
    rows = db.all_rows(f"SELECT * FROM expenses {clause} ORDER BY date DESC, id DESC LIMIT ?",
                       (*params, min(int(limit or 500), 5000)))
    by_category: dict[str, float] = {}
    total = 0.0
    for row in rows:
        by_category[row["category"]] = r2(by_category.get(row["category"], 0) + row["amount"])
        total = r2(total + row["amount"])
    return {"rows": rows, "total": total, "byCategory": by_category}


def remove_expense(actor, payload):
    auth.require_role(actor, ("admin", "pharmacist"))
    expense_id = v.integer(payload.get("id"), "Expense", required=True, minimum=1)
    with db.tx():
        row = db.one_row("SELECT * FROM expenses WHERE id = ?", (expense_id,))
        assert_that(row, "That expense no longer exists.")
        ledger.reverse_source("expense", expense_id)
        db.run("DELETE FROM expenses WHERE id = ?", (expense_id,))
        audit.log(actor, "expense.delete", "expense", expense_id, dict(row))
        return {"ok": True}


def transfer(actor, payload):
    """Manual cash <-> bank movement (deposit or withdrawal)."""
    auth.require_role(actor, ("admin", "pharmacist"))
    amount = r2(v.number(payload.get("amount"), "Amount", required=True, minimum=0.01, maximum=1e9))
    source = v.one_of(payload.get("from"), "From account", ledger.ACCOUNTS, "cash")
    target = v.one_of(payload.get("to"), "To account", ledger.ACCOUNTS, "bank")
    assert_that(source != target, "Choose two different accounts.")
    date = v.iso_date(payload.get("date"), "Date", required=False, fallback="today") or today()
    notes = v.text(payload.get("notes"), "Notes", max_len=200)
    with db.tx():
        label = ("Cash to bank" if source == "cash" else "Bank to cash") + (f" — {notes}" if notes else "")
        out_id = ledger.post(date, source, "out", amount, "transfer", None, label)
        ledger.post(date, target, "in", amount, "transfer", out_id, label)
        audit.log(actor, "account.transfer", "ledger", out_id,
                  {"from": source, "to": target, "amount": amount})
        return {"ok": True, "balances": ledger.balances()}
