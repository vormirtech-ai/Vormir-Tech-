"""Supplier bills: stock in, payable up."""

from __future__ import annotations
from .. import db
from ..util.dates import now_stamp, today
from ..util.errors import assert_that
from ..util.money import line_totals, r2, r3, round_off
from ..util import validate as v
from . import audit, auth, ledger, parties, products, settings


def create(actor, payload):
    auth.require_role(actor, ("admin", "pharmacist"))
    date = v.iso_date(payload.get("date"), "Purchase date", required=False, fallback="today") or today()
    ref_no = v.text(payload.get("ref_no"), "Supplier bill number", max_len=60)
    inter_state = bool(v.flag(payload.get("inter_state")))
    notes = v.text(payload.get("notes"), "Notes", max_len=300)
    mode = v.one_of(payload.get("payment_mode"), "Payment mode", ledger.MODES, "Credit")
    items = payload.get("items")
    assert_that(isinstance(items, list) and items, "Add at least one item to the purchase.")
    assert_that(len(items) <= 300, "A single purchase can hold up to 300 lines.")

    with db.tx():
        supplier_id = v.integer(payload.get("supplier_id"), "Supplier", required=True, minimum=1)
        supplier = parties.supplier_by_id(supplier_id)
        assert_that(supplier, "Select a valid supplier.")

        if ref_no:
            duplicate = db.one_row("SELECT no FROM purchases WHERE supplier_id = ? AND ref_no = ?",
                                   (supplier_id, ref_no))
            assert_that(not duplicate,
                        f"Bill {ref_no} from {supplier['name']} is already entered as "
                        f"{duplicate['no'] if duplicate else ''}.")

        lines = []
        for index, raw in enumerate(items):
            at = f"Line {index + 1}"
            product_id = v.integer(raw.get("product_id"), f"{at}: medicine", required=True, minimum=1)
            product = db.one_row("SELECT * FROM products WHERE id = ?", (product_id,))
            assert_that(product, f"{at}: that medicine no longer exists.")
            batch_no = v.text(raw.get("batch_no"), f"{at}: batch number", required=True, max_len=40).upper()
            expiry = v.expiry(raw.get("expiry"), f"{at}: expiry")
            mrp = v.number(raw.get("mrp"), f"{at}: MRP", required=True, minimum=0, maximum=1000000)
            qty = v.integer(raw.get("qty_units"), f"{at}: quantity", required=True, minimum=1, maximum=10000000)
            free = v.integer(raw.get("free_units"), f"{at}: free quantity", minimum=0,
                             maximum=10000000, fallback=0)
            rate = v.number(raw.get("rate_per_unit"), f"{at}: purchase rate", required=True,
                            minimum=0, maximum=1000000)
            disc = v.number(raw.get("disc_pct"), f"{at}: discount %", minimum=0, maximum=100)
            gst_rate = v.number(raw.get("gst_rate", product["gst_rate"]), f"{at}: GST %",
                                minimum=0, maximum=28)
            totals = line_totals(qty, rate, disc, gst_rate, inter_state)
            # Free goods dilute the landed cost, which is what stock is valued at.
            landed = r3(totals["taxable"] / (qty + free)) if (qty + free) else 0.0
            lines.append({
                "product_id": product_id, "name": product["name"], "batch_no": batch_no, "expiry": expiry,
                "mrp": r2(mrp), "qty_units": qty, "free_units": free, "rate_per_unit": r3(rate),
                "disc_pct": disc, "gst_rate": gst_rate, "taxable": totals["taxable"],
                "gst_amount": totals["gst_amount"], "total": totals["total"], "landed_cost": landed,
            })

        subtotal = r2(sum(line["taxable"] for line in lines))
        gst_amount = r2(sum(line["gst_amount"] for line in lines))
        discount = r2(sum(line["qty_units"] * line["rate_per_unit"] * line["disc_pct"] / 100 for line in lines))
        rounded = round_off(r2(subtotal + gst_amount))
        total = rounded["total"]
        paid = r2(v.number(payload.get("paid"), "Amount paid", minimum=0, maximum=1e9, fallback=0))
        assert_that(paid <= total + 0.01, "Amount paid cannot be more than the bill total.")

        number = settings.next_number("purchase", "purchase_prefix")
        info = db.run(
            """INSERT INTO purchases (no, date, supplier_id, ref_no, inter_state, subtotal, discount,
                  gst_amount, round_off, total, paid, notes, created_at, created_by)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (number, date, supplier_id, ref_no, 1 if inter_state else 0, subtotal, discount, gst_amount,
             rounded["round_off"], total, paid, notes, now_stamp(), (actor or {}).get("username", "")))
        purchase_id = int(info["lastrowid"])

        for line in lines:
            batch_id = products.upsert_batch(line["product_id"], line["batch_no"], line["expiry"],
                                             line["mrp"], line["landed_cost"])
            db.run(
                """INSERT INTO purchase_items (purchase_id, product_id, batch_id, name, batch_no, expiry,
                      mrp, qty_units, free_units, rate_per_unit, disc_pct, gst_rate, taxable,
                      gst_amount, total)
                   VALUES (:purchase_id, :product_id, :batch_id, :name, :batch_no, :expiry, :mrp,
                      :qty_units, :free_units, :rate_per_unit, :disc_pct, :gst_rate, :taxable,
                      :gst_amount, :total)""",
                {k: line[k] for k in ("product_id", "name", "batch_no", "expiry", "mrp", "qty_units",
                                      "free_units", "rate_per_unit", "disc_pct", "gst_rate", "taxable",
                                      "gst_amount", "total")}
                | {"purchase_id": purchase_id, "batch_id": batch_id})
            products.move_stock(batch_id, line["qty_units"] + line["free_units"])

        if paid > 0:
            pay_mode = "Cash" if mode == "Credit" else mode
            account = ledger.account_for_mode(pay_mode)
            db.run(
                """INSERT INTO payments (date, party_type, party_id, party_name, direction, amount, mode,
                      account, ref_no, purchase_id, notes, created_at, created_by)
                   VALUES (?, 'supplier', ?, ?, 'out', ?, ?, ?, ?, ?, 'Against purchase', ?, ?)""",
                (date, supplier_id, supplier["name"], paid, pay_mode, account, ref_no or number,
                 purchase_id, now_stamp(), (actor or {}).get("username", "")))
            ledger.post(date, account, "out", paid, "purchase", purchase_id,
                        f"Purchase {number} — {supplier['name']}")

        audit.log(actor, "purchase.create", "purchase", purchase_id,
                  {"no": number, "total": total, "items": len(lines)})
        return by_id(purchase_id)


def by_id(purchase_id, **_):
    purchase = db.one_row(
        """SELECT p.*, s.name AS supplier_name, s.gstin AS supplier_gstin, s.phone AS supplier_phone,
              s.dl_no AS supplier_dl
           FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id WHERE p.id = ?""",
        (int(purchase_id),))
    if not purchase:
        return None
    return {
        **purchase,
        "items": db.all_rows("SELECT * FROM purchase_items WHERE purchase_id = ? ORDER BY id",
                             (purchase["id"],)),
        "balance": r2(purchase["total"] - purchase["paid"]),
        "store": settings.store_profile(),
    }


def listing(from_date=None, to_date=None, supplierId=None, search="", unpaidOnly=False, limit=300, **kwargs):
    from_date = from_date or kwargs.get("from")
    to_date = to_date or kwargs.get("to")
    where, params = [], []
    if from_date:
        where.append("p.date >= ?")
        params.append(from_date)
    if to_date:
        where.append("p.date <= ?")
        params.append(to_date)
    if supplierId:
        where.append("p.supplier_id = ?")
        params.append(int(supplierId))
    if unpaidOnly:
        where.append("p.total - p.paid > 0.01")
    if search:
        where.append("(p.no LIKE ? OR p.ref_no LIKE ? OR s.name LIKE ?)")
        params += [f"%{search}%"] * 3
    clause = f"WHERE {' AND '.join(where)}" if where else ""
    rows = db.all_rows(
        f"""SELECT p.*, s.name AS supplier_name,
              (SELECT COUNT(*) FROM purchase_items pi WHERE pi.purchase_id = p.id) AS line_count
            FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id
            {clause} ORDER BY p.date DESC, p.id DESC LIMIT ?""",
        (*params, min(int(limit or 300), 5000)))
    totals = {
        "count": len(rows),
        "total": r2(sum(r["total"] for r in rows)),
        "paid": r2(sum(r["paid"] for r in rows)),
        "due": r2(sum(r["total"] - r["paid"] for r in rows)),
        "gst": r2(sum(r["gst_amount"] for r in rows)),
    }
    return {"rows": rows, "totals": totals}


def remove(actor, payload):
    auth.require_admin(actor)
    purchase_id = v.integer(payload.get("id"), "Purchase", required=True, minimum=1)
    with db.tx():
        purchase = db.one_row("SELECT * FROM purchases WHERE id = ?", (purchase_id,))
        assert_that(purchase, "That purchase no longer exists.")
        returned = db.scalar("SELECT COUNT(*) FROM purchase_returns WHERE purchase_id = ?", (purchase_id,), 0)
        assert_that(returned == 0, "This purchase has a return against it. Delete the return first.")
        for item in db.all_rows("SELECT * FROM purchase_items WHERE purchase_id = ?", (purchase_id,)):
            if not item["batch_id"]:
                continue
            batch = db.one_row("SELECT * FROM batches WHERE id = ?", (item["batch_id"],))
            back = item["qty_units"] + item["free_units"]
            assert_that(
                batch and batch["qty_units"] >= back,
                f"{item['name']} batch {item['batch_no']} has already been sold. Cannot delete this "
                "purchase — raise a purchase return instead.", "STOCK_CONSUMED")
            products.move_stock(item["batch_id"], -back)
        ledger.reverse_source("purchase", purchase_id)
        db.run("DELETE FROM payments WHERE purchase_id = ?", (purchase_id,))
        db.run("DELETE FROM purchase_items WHERE purchase_id = ?", (purchase_id,))
        db.run("DELETE FROM purchases WHERE id = ?", (purchase_id,))
        audit.log(actor, "purchase.delete", "purchase", purchase_id,
                  {"no": purchase["no"], "reason": payload.get("reason", "")})
        return {"ok": True}


def pay(actor, payload):
    auth.require_role(actor, ("admin", "pharmacist"))
    purchase_id = v.integer(payload.get("id"), "Purchase", required=True, minimum=1)
    amount = r2(v.number(payload.get("amount"), "Amount", required=True, minimum=0.01, maximum=1e9))
    mode = v.one_of(payload.get("mode"), "Payment mode",
                    [m for m in ledger.MODES if m != "Credit"], "Cash")
    when = v.iso_date(payload.get("date"), "Date", required=False, fallback="today") or today()
    with db.tx():
        purchase = db.one_row("SELECT * FROM purchases WHERE id = ?", (purchase_id,))
        assert_that(purchase, "That purchase no longer exists.")
        due = r2(purchase["total"] - purchase["paid"])
        assert_that(due > 0, "This purchase is already fully paid.")
        assert_that(amount <= due + 0.01, f"The outstanding amount on this bill is only ₹{due:.2f}.")
        supplier = parties.supplier_by_id(purchase["supplier_id"])
        db.run("UPDATE purchases SET paid = ? WHERE id = ?", (r2(purchase["paid"] + amount), purchase_id))
        account = ledger.account_for_mode(mode)
        db.run(
            """INSERT INTO payments (date, party_type, party_id, party_name, direction, amount, mode,
                  account, ref_no, purchase_id, notes, created_at, created_by)
               VALUES (?, 'supplier', ?, ?, 'out', ?, ?, ?, ?, ?, 'Bill payment', ?, ?)""",
            (when, purchase["supplier_id"], (supplier or {}).get("name", ""), amount, mode, account,
             purchase["ref_no"] or purchase["no"], purchase_id, now_stamp(),
             (actor or {}).get("username", "")))
        ledger.post(when, account, "out", amount, "purchase", purchase_id,
                    f"Payment for purchase {purchase['no']}")
        audit.log(actor, "purchase.pay", "purchase", purchase_id, {"amount": amount, "mode": mode})
        return by_id(purchase_id)


def last_rate(product_id=None, **_):
    """Last purchase rate / MRP, prefilled during purchase entry."""
    return db.one_row(
        """SELECT pi.rate_per_unit, pi.mrp, pi.disc_pct, pi.gst_rate, p.date
           FROM purchase_items pi JOIN purchases p ON p.id = pi.purchase_id
           WHERE pi.product_id = ? ORDER BY p.date DESC, pi.id DESC LIMIT 1""", (int(product_id),))
