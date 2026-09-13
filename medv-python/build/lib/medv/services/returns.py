"""Sales returns (credit notes) and purchase returns."""

from __future__ import annotations
from .. import db
from ..util.dates import now_stamp, today
from ..util.errors import assert_that
from ..util.money import r2, r3, split_gst
from ..util import validate as v
from . import audit, auth, ledger, parties, products, settings


# ------------------------------------------------------------ sales returns
def returnable_sale(id=None, no=None, **_):
    """The lines of a bill with the quantity still available to return."""
    sale = (db.one_row("SELECT * FROM sales WHERE id = ?", (int(id),)) if id
            else db.one_row("SELECT * FROM sales WHERE no = ?", (str(no),)))
    assert_that(sale, "That bill could not be found.")
    items = db.all_rows(
        """SELECT si.*, p.pack_size, p.pack_label, p.unit_label
           FROM sale_items si LEFT JOIN products p ON p.id = si.product_id
           WHERE si.sale_id = ? ORDER BY si.id""", (sale["id"],))
    return {
        "sale": sale,
        "customer": parties.customer_by_id(sale["customer_id"]) if sale["customer_id"] else None,
        "items": [{**i, "returnable_units": i["qty_units"] - i["returned_units"]} for i in items],
    }


def create_sale_return(actor, payload):
    auth.require_role(actor, ("admin", "pharmacist"))
    date = v.iso_date(payload.get("date"), "Return date", required=False, fallback="today") or today()
    refund_mode = v.one_of(payload.get("refund_mode"), "Refund mode",
                           ("Cash", "UPI", "Bank Transfer", "Adjust in balance"), "Cash")
    notes = v.text(payload.get("notes"), "Reason / notes", max_len=300)
    items = payload.get("items")
    assert_that(isinstance(items, list) and items, "Select at least one item to return.")

    with db.tx():
        sale_id = v.integer(payload.get("sale_id"), "Bill", required=True, minimum=1)
        sale = db.one_row("SELECT * FROM sales WHERE id = ?", (sale_id,))
        assert_that(sale, "That bill no longer exists.")

        lines = []
        for index, raw in enumerate(items):
            at = f"Line {index + 1}"
            sale_item_id = v.integer(raw.get("sale_item_id"), f"{at}: bill line", required=True, minimum=1)
            item = db.one_row("SELECT * FROM sale_items WHERE id = ? AND sale_id = ?",
                              (sale_item_id, sale_id))
            assert_that(item, f"{at}: that line is not part of bill {sale['no']}.")
            qty = v.integer(raw.get("qty_units"), f"{at}: quantity", required=True,
                            minimum=1, maximum=10000000)
            available = item["qty_units"] - item["returned_units"]
            assert_that(qty <= available,
                        f"{at}: only {available} of {item['name']} can still be returned.")
            restock = 1 if raw.get("restock", 1) else 0
            # The return mirrors the original line, including the discount given.
            per_unit = r3(item["taxable"] / item["qty_units"]) if item["qty_units"] else 0.0
            taxable = r2(per_unit * qty)
            gst = split_gst(taxable, item["gst_rate"], bool(sale["inter_state"]))
            lines.append({
                "sale_item_id": sale_item_id, "product_id": item["product_id"],
                "batch_id": item["batch_id"], "name": item["name"], "batch_no": item["batch_no"],
                "expiry": item["expiry"], "qty_units": qty, "rate_per_unit": item["rate_per_unit"],
                "gst_rate": item["gst_rate"], "taxable": taxable, "gst_amount": gst["total"],
                "total": r2(taxable + gst["total"]), "restock": restock,
            })

        subtotal = r2(sum(line["taxable"] for line in lines))
        gst_amount = r2(sum(line["gst_amount"] for line in lines))
        total = r2(subtotal + gst_amount)
        assert_that(total > 0, "The return value works out to zero — nothing to record.")

        number = settings.next_number("sale_return", "sale_return_prefix")
        info = db.run(
            """INSERT INTO sale_returns (no, date, sale_id, customer_id, subtotal, gst_amount, total,
                  refund_mode, notes, created_at, created_by)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (number, date, sale_id, sale["customer_id"], subtotal, gst_amount, total, refund_mode,
             notes, now_stamp(), (actor or {}).get("username", "")))
        return_id = int(info["lastrowid"])

        for line in lines:
            db.run(
                """INSERT INTO sale_return_items (return_id, sale_item_id, product_id, batch_id, name,
                      batch_no, expiry, qty_units, rate_per_unit, gst_rate, taxable, gst_amount,
                      total, restock)
                   VALUES (:return_id, :sale_item_id, :product_id, :batch_id, :name, :batch_no,
                      :expiry, :qty_units, :rate_per_unit, :gst_rate, :taxable, :gst_amount,
                      :total, :restock)""",
                {**line, "return_id": return_id})
            db.run("UPDATE sale_items SET returned_units = returned_units + ? WHERE id = ?",
                   (line["qty_units"], line["sale_item_id"]))
            if line["restock"] and line["batch_id"]:
                products.move_stock(line["batch_id"], line["qty_units"])

        if refund_mode != "Adjust in balance":
            account = ledger.account_for_mode(refund_mode)
            db.run(
                """INSERT INTO payments (date, party_type, party_id, party_name, direction, amount, mode,
                      account, ref_no, sale_id, notes, created_at, created_by)
                   VALUES (?, 'customer', ?, ?, 'out', ?, ?, ?, ?, ?, 'Sales return refund', ?, ?)""",
                (date, sale["customer_id"], sale["patient_name"] or "", total, refund_mode, account,
                 number, sale_id, now_stamp(), (actor or {}).get("username", "")))
            ledger.post(date, account, "out", total, "sale_return", return_id,
                        f"Refund on return {number} (bill {sale['no']})")

        audit.log(actor, "sale_return.create", "sale_return", return_id, {"no": number, "total": total})
        return sale_return_by_id(return_id)


def sale_return_by_id(id=None, **_):
    row = db.one_row(
        """SELECT r.*, s.no AS sale_no, c.name AS customer_name, c.phone AS customer_phone
           FROM sale_returns r LEFT JOIN sales s ON s.id = r.sale_id
           LEFT JOIN customers c ON c.id = r.customer_id WHERE r.id = ?""", (int(id),))
    if not row:
        return None
    return {
        **row,
        "items": db.all_rows("SELECT * FROM sale_return_items WHERE return_id = ? ORDER BY id", (row["id"],)),
        "store": settings.store_profile(),
    }


def list_sale_returns(from_date=None, to_date=None, search="", limit=300, **kwargs):
    from_date = from_date or kwargs.get("from")
    to_date = to_date or kwargs.get("to")
    where, params = [], []
    if from_date:
        where.append("r.date >= ?")
        params.append(from_date)
    if to_date:
        where.append("r.date <= ?")
        params.append(to_date)
    if search:
        where.append("(r.no LIKE ? OR s.no LIKE ? OR c.name LIKE ?)")
        params += [f"%{search}%"] * 3
    clause = f"WHERE {' AND '.join(where)}" if where else ""
    rows = db.all_rows(
        f"""SELECT r.*, s.no AS sale_no, c.name AS customer_name
            FROM sale_returns r LEFT JOIN sales s ON s.id = r.sale_id
            LEFT JOIN customers c ON c.id = r.customer_id
            {clause} ORDER BY r.date DESC, r.id DESC LIMIT ?""",
        (*params, min(int(limit or 300), 5000)))
    return {"rows": rows, "totals": {"count": len(rows), "total": r2(sum(r["total"] for r in rows))}}


def remove_sale_return(actor, payload):
    auth.require_admin(actor)
    return_id = v.integer(payload.get("id"), "Return", required=True, minimum=1)
    with db.tx():
        row = db.one_row("SELECT * FROM sale_returns WHERE id = ?", (return_id,))
        assert_that(row, "That return no longer exists.")
        for item in db.all_rows("SELECT * FROM sale_return_items WHERE return_id = ?", (return_id,)):
            if item["restock"] and item["batch_id"]:
                products.move_stock(item["batch_id"], -item["qty_units"], allow_negative=True)
            if item["sale_item_id"]:
                db.run("UPDATE sale_items SET returned_units = MAX(0, returned_units - ?) WHERE id = ?",
                       (item["qty_units"], item["sale_item_id"]))
        ledger.reverse_source("sale_return", return_id)
        db.run("DELETE FROM payments WHERE sale_id = ? AND notes = 'Sales return refund' AND ref_no = ?",
               (row["sale_id"], row["no"]))
        db.run("DELETE FROM sale_return_items WHERE return_id = ?", (return_id,))
        db.run("DELETE FROM sale_returns WHERE id = ?", (return_id,))
        audit.log(actor, "sale_return.delete", "sale_return", return_id, dict(row))
        return {"ok": True}


# --------------------------------------------------------- purchase returns
def create_purchase_return(actor, payload):
    auth.require_role(actor, ("admin", "pharmacist"))
    date = v.iso_date(payload.get("date"), "Return date", required=False, fallback="today") or today()
    reason = v.text(payload.get("reason"), "Reason", max_len=120)
    notes = v.text(payload.get("notes"), "Notes", max_len=300)
    items = payload.get("items")
    assert_that(isinstance(items, list) and items, "Select at least one item to return.")

    with db.tx():
        supplier_id = v.integer(payload.get("supplier_id"), "Supplier", required=True, minimum=1)
        supplier = parties.supplier_by_id(supplier_id)
        assert_that(supplier, "Select a valid supplier.")
        purchase_id = v.integer(payload.get("purchase_id"), "Purchase", minimum=1) if payload.get("purchase_id") else None

        lines = []
        for index, raw in enumerate(items):
            at = f"Line {index + 1}"
            batch_id = v.integer(raw.get("batch_id"), f"{at}: batch", required=True, minimum=1)
            batch = db.one_row(
                "SELECT b.*, p.name, p.gst_rate FROM batches b JOIN products p ON p.id = b.product_id "
                "WHERE b.id = ?", (batch_id,))
            assert_that(batch, f"{at}: that batch no longer exists.")
            qty = v.integer(raw.get("qty_units"), f"{at}: quantity", required=True,
                            minimum=1, maximum=10000000)
            assert_that(qty <= batch["qty_units"],
                        f"{at}: only {batch['qty_units']} units of {batch['name']} "
                        f"(batch {batch['batch_no']}) are in stock.")
            rate = v.number(raw.get("rate_per_unit", batch["rate_per_unit"]), f"{at}: rate",
                            minimum=0, maximum=1000000)
            gst_rate = v.number(raw.get("gst_rate", batch["gst_rate"]), f"{at}: GST %",
                                minimum=0, maximum=28)
            taxable = r2(rate * qty)
            gst = split_gst(taxable, gst_rate, False)
            lines.append({
                "product_id": batch["product_id"], "batch_id": batch_id, "name": batch["name"],
                "batch_no": batch["batch_no"], "expiry": batch["expiry"], "qty_units": qty,
                "rate_per_unit": r3(rate), "gst_rate": gst_rate, "taxable": taxable,
                "gst_amount": gst["total"], "total": r2(taxable + gst["total"]),
            })

        subtotal = r2(sum(line["taxable"] for line in lines))
        gst_amount = r2(sum(line["gst_amount"] for line in lines))
        total = r2(subtotal + gst_amount)
        number = settings.next_number("purchase_return", "purchase_return_prefix")
        info = db.run(
            """INSERT INTO purchase_returns (no, date, purchase_id, supplier_id, subtotal, gst_amount,
                  total, reason, notes, created_at, created_by)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (number, date, purchase_id, supplier_id, subtotal, gst_amount, total, reason, notes,
             now_stamp(), (actor or {}).get("username", "")))
        return_id = int(info["lastrowid"])
        for line in lines:
            db.run(
                """INSERT INTO purchase_return_items (return_id, product_id, batch_id, name, batch_no,
                      expiry, qty_units, rate_per_unit, gst_rate, taxable, gst_amount, total)
                   VALUES (:return_id, :product_id, :batch_id, :name, :batch_no, :expiry, :qty_units,
                      :rate_per_unit, :gst_rate, :taxable, :gst_amount, :total)""",
                {**line, "return_id": return_id})
            products.move_stock(line["batch_id"], -line["qty_units"])
        audit.log(actor, "purchase_return.create", "purchase_return", return_id,
                  {"no": number, "total": total})
        return purchase_return_by_id(return_id)


def purchase_return_by_id(id=None, **_):
    row = db.one_row(
        """SELECT r.*, s.name AS supplier_name, p.no AS purchase_no
           FROM purchase_returns r LEFT JOIN suppliers s ON s.id = r.supplier_id
           LEFT JOIN purchases p ON p.id = r.purchase_id WHERE r.id = ?""", (int(id),))
    if not row:
        return None
    return {
        **row,
        "items": db.all_rows("SELECT * FROM purchase_return_items WHERE return_id = ? ORDER BY id",
                             (row["id"],)),
        "store": settings.store_profile(),
    }


def list_purchase_returns(from_date=None, to_date=None, limit=300, **kwargs):
    from_date = from_date or kwargs.get("from")
    to_date = to_date or kwargs.get("to")
    where, params = [], []
    if from_date:
        where.append("r.date >= ?")
        params.append(from_date)
    if to_date:
        where.append("r.date <= ?")
        params.append(to_date)
    clause = f"WHERE {' AND '.join(where)}" if where else ""
    rows = db.all_rows(
        f"""SELECT r.*, s.name AS supplier_name, p.no AS purchase_no
            FROM purchase_returns r LEFT JOIN suppliers s ON s.id = r.supplier_id
            LEFT JOIN purchases p ON p.id = r.purchase_id
            {clause} ORDER BY r.date DESC, r.id DESC LIMIT ?""",
        (*params, min(int(limit or 300), 5000)))
    return {"rows": rows, "totals": {"count": len(rows), "total": r2(sum(r["total"] for r in rows))}}


def remove_purchase_return(actor, payload):
    auth.require_admin(actor)
    return_id = v.integer(payload.get("id"), "Return", required=True, minimum=1)
    with db.tx():
        row = db.one_row("SELECT * FROM purchase_returns WHERE id = ?", (return_id,))
        assert_that(row, "That return no longer exists.")
        for item in db.all_rows("SELECT * FROM purchase_return_items WHERE return_id = ?", (return_id,)):
            if item["batch_id"]:
                products.move_stock(item["batch_id"], item["qty_units"])
        db.run("DELETE FROM purchase_return_items WHERE return_id = ?", (return_id,))
        db.run("DELETE FROM purchase_returns WHERE id = ?", (return_id,))
        audit.log(actor, "purchase_return.delete", "purchase_return", return_id, dict(row))
        return {"ok": True}
