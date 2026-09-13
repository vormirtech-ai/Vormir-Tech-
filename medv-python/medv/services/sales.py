"""Counter billing: the invoice, the stock it consumes and the money it brings in."""

from __future__ import annotations
from .. import db
from ..util.dates import add_days, is_expired, now_stamp, today
from ..util.errors import assert_that
from ..util.money import as_int, line_totals, r2, r3, round_off, split_gst
from ..util import validate as v
from . import audit, auth, ledger, parties, products, settings

PAYMENT_MODES = ("Cash", "UPI", "Card", "Cheque", "Bank Transfer", "Credit")


def prepare_lines(raw_items, inter_state: bool, gst_inclusive: bool) -> list[dict]:
    assert_that(isinstance(raw_items, list) and raw_items, "Add at least one medicine to the bill.")
    assert_that(len(raw_items) <= 200, "A single bill can hold up to 200 lines.")
    lines = []
    for index, raw in enumerate(raw_items):
        at = f"Line {index + 1}"
        product_id = v.integer(raw.get("product_id"), f"{at}: medicine", required=True, minimum=1)
        product = db.one_row("SELECT * FROM products WHERE id = ?", (product_id,))
        assert_that(product, f"{at}: that medicine no longer exists.")
        batch_id = v.integer(raw.get("batch_id"), f"{at}: batch", required=True, minimum=1)
        batch = db.one_row("SELECT * FROM batches WHERE id = ?", (batch_id,))
        assert_that(batch, f"{at}: select a batch for {product['name']}.")
        assert_that(batch["product_id"] == product_id,
                    f"{at}: that batch does not belong to {product['name']}.")
        assert_that(not is_expired(batch["expiry"]),
                    f"{at}: batch {batch['batch_no']} of {product['name']} has expired ({batch['expiry']}).")
        qty = v.integer(raw.get("qty_units"), f"{at}: quantity", required=True, minimum=1, maximum=1000000)
        if not product["allow_loose"] and product["pack_size"] > 1:
            assert_that(qty % product["pack_size"] == 0,
                        f"{at}: {product['name']} cannot be sold loose — enter quantity in multiples "
                        f"of {product['pack_size']}.")
        rate = v.number(raw.get("rate_per_unit"), f"{at}: rate", required=True, minimum=0, maximum=1000000)
        disc = v.number(raw.get("disc_pct"), f"{at}: discount %", minimum=0, maximum=100)
        gst_rate = v.number(raw.get("gst_rate", product["gst_rate"]), f"{at}: GST %", minimum=0, maximum=28)
        totals = line_totals(qty, rate, disc, gst_rate, inter_state, gst_inclusive)
        lines.append({
            "product_id": product_id, "batch_id": batch_id, "name": product["name"], "hsn": product["hsn"],
            "batch_no": batch["batch_no"], "expiry": batch["expiry"], "mrp": batch["mrp"],
            "qty_units": qty, "rate_per_unit": r3(rate), "disc_pct": disc, "gst_rate": gst_rate,
            "taxable": totals["taxable"], "cgst": totals["cgst"], "sgst": totals["sgst"],
            "igst": totals["igst"], "total": totals["total"],
            "cost_per_unit": r3(batch["rate_per_unit"]),
        })
    return lines


def apply_bill_discount(lines, bill_discount, inter_state):
    """
    Spreads a bill-level discount across lines in proportion to their taxable
    value, then recomputes GST so the tax always matches the amount charged.
    """
    discount = r2(bill_discount)
    base = r2(sum(line["taxable"] for line in lines))
    if discount <= 0 or base <= 0:
        return lines
    assert_that(discount <= base, "The bill discount cannot be more than the bill value.")
    allocated = 0.0
    for index, line in enumerate(lines):
        share = r2(discount - allocated) if index == len(lines) - 1 else r2(discount * line["taxable"] / base)
        allocated = r2(allocated + share)
        taxable = r2(line["taxable"] - share)
        gst = split_gst(taxable, line["gst_rate"], inter_state)
        line.update({
            "bill_disc": share, "taxable": taxable, "cgst": gst["cgst"], "sgst": gst["sgst"],
            "igst": gst["igst"], "total": r2(taxable + gst["total"]),
        })
    return lines


def create(actor, payload):
    auth.require_role(actor, ("admin", "pharmacist", "cashier"))
    date = v.iso_date(payload.get("date"), "Bill date", required=False, fallback="today") or today()
    inter_state = bool(v.flag(payload.get("inter_state")))
    gst_inclusive = (settings.flag("price_includes_gst")
                     if payload.get("price_includes_gst") is None
                     else bool(payload["price_includes_gst"]))
    payment_mode = v.one_of(payload.get("payment_mode"), "Payment mode", PAYMENT_MODES, "Cash")
    notes = v.text(payload.get("notes"), "Notes", max_len=300)
    patient_name = v.text(payload.get("patient_name"), "Patient name", max_len=120)
    patient_phone = v.phone(payload.get("patient_phone"), "Patient phone")
    rx_no = v.text(payload.get("rx_no"), "Prescription number", max_len=40)
    reminder_days = v.integer(payload.get("reminder_days"), "Refill reminder (days)",
                              minimum=0, maximum=365, fallback=0)

    with db.tx():
        customer_id = v.integer(payload.get("customer_id"), "Customer", minimum=1) if payload.get("customer_id") else None
        new_customer = payload.get("new_customer") or {}
        if not customer_id and str(new_customer.get("name", "")).strip():
            customer_id = parties.save_customer(actor, new_customer)["id"]
        customer = parties.customer_by_id(customer_id) if customer_id else None
        assert_that(not customer_id or customer, "That customer no longer exists.")

        doctor_id = v.integer(payload.get("doctor_id"), "Doctor", minimum=1) if payload.get("doctor_id") else None
        doctor = db.one_row("SELECT * FROM doctors WHERE id = ?", (doctor_id,)) if doctor_id else None
        assert_that(not doctor_id or doctor, "That doctor no longer exists.")

        lines = prepare_lines(payload.get("items"), inter_state, gst_inclusive)
        bill_discount = r2(v.number(payload.get("bill_discount"), "Bill discount", minimum=0, maximum=1e9))
        apply_bill_discount(lines, bill_discount, inter_state)

        subtotal = r2(sum(line["taxable"] for line in lines))
        gst_amount = r2(sum(line["cgst"] + line["sgst"] + line["igst"] for line in lines))
        line_discount = r2(sum(line["qty_units"] * line["rate_per_unit"] * line["disc_pct"] / 100
                               for line in lines))
        gross = r2(subtotal + gst_amount)
        rounded = round_off(gross) if settings.flag("round_off_invoice") else {"total": gross, "round_off": 0.0}
        total = rounded["total"]
        cost_total = r2(sum(line["qty_units"] * line["cost_per_unit"] for line in lines))

        default_paid = 0 if payment_mode == "Credit" else total
        paid = r2(v.number(payload.get("paid"), "Amount paid", minimum=0, maximum=1e9, fallback=default_paid))
        if payment_mode == "Credit":
            assert_that(customer_id, "A credit bill needs a customer so the balance can be tracked.")
            paid = 0.0
        assert_that(paid <= total + 0.01, "Amount paid cannot be more than the bill total.")
        if paid < total:
            assert_that(customer_id, "A partly paid bill needs a customer so the balance can be tracked.")

        number = settings.next_number("invoice", "invoice_prefix")
        info = db.run(
            """INSERT INTO sales (no, date, customer_id, doctor_id, patient_name, patient_phone, rx_no,
                  inter_state, subtotal, discount, gst_amount, round_off, total, paid, payment_mode,
                  cost_total, notes, created_at, created_by)
               VALUES (:no, :date, :customer_id, :doctor_id, :patient_name, :patient_phone, :rx_no,
                  :inter_state, :subtotal, :discount, :gst_amount, :round_off, :total, :paid,
                  :payment_mode, :cost_total, :notes, :created_at, :created_by)""",
            {
                "no": number, "date": date, "customer_id": customer_id, "doctor_id": doctor_id,
                "patient_name": patient_name or (customer or {}).get("name", "") or "",
                "patient_phone": patient_phone or (customer or {}).get("phone", "") or "",
                "rx_no": rx_no, "inter_state": 1 if inter_state else 0, "subtotal": subtotal,
                "discount": r2(line_discount + bill_discount), "gst_amount": gst_amount,
                "round_off": rounded["round_off"], "total": total, "paid": paid,
                "payment_mode": payment_mode, "cost_total": cost_total, "notes": notes,
                "created_at": now_stamp(), "created_by": (actor or {}).get("username", ""),
            })
        sale_id = int(info["lastrowid"])

        for line in lines:
            db.run(
                """INSERT INTO sale_items (sale_id, product_id, batch_id, name, batch_no, expiry, hsn,
                      mrp, qty_units, rate_per_unit, disc_pct, gst_rate, taxable, cgst, sgst, igst,
                      total, cost_per_unit)
                   VALUES (:sale_id, :product_id, :batch_id, :name, :batch_no, :expiry, :hsn, :mrp,
                      :qty_units, :rate_per_unit, :disc_pct, :gst_rate, :taxable, :cgst, :sgst, :igst,
                      :total, :cost_per_unit)""",
                {k: line[k] for k in ("product_id", "batch_id", "name", "batch_no", "expiry", "hsn",
                                      "mrp", "qty_units", "rate_per_unit", "disc_pct", "gst_rate",
                                      "taxable", "cgst", "sgst", "igst", "total", "cost_per_unit")}
                | {"sale_id": sale_id})
            products.move_stock(line["batch_id"], -line["qty_units"])

        if paid > 0:
            account = ledger.account_for_mode(payment_mode)
            db.run(
                """INSERT INTO payments (date, party_type, party_id, party_name, direction, amount,
                      mode, account, ref_no, sale_id, notes, created_at, created_by)
                   VALUES (?, 'customer', ?, ?, 'in', ?, ?, ?, ?, ?, 'Against bill', ?, ?)""",
                (date, customer_id, (customer or {}).get("name") or patient_name or "Walk-in", paid,
                 payment_mode, account, number, sale_id, now_stamp(), (actor or {}).get("username", "")))
            ledger.post(date, account, "in", paid, "sale", sale_id,
                        f"Bill {number}" + (f" — {customer['name']}" if customer else ""))

        if doctor and doctor["commission_pct"] > 0:
            commission = r2(subtotal * doctor["commission_pct"] / 100)
            if commission > 0:
                db.run(
                    """INSERT INTO doctor_commissions (date, doctor_id, sale_id, base_amount, pct,
                          amount, paid, created_at)
                       VALUES (?, ?, ?, ?, ?, ?, 0, ?)""",
                    (date, doctor["id"], sale_id, subtotal, doctor["commission_pct"], commission, now_stamp()))

        if reminder_days > 0 and customer_id:
            medicines = ", ".join(line["name"] for line in lines[:6])
            db.run(
                """INSERT INTO rx_reminders (customer_id, sale_id, due_date, medicines, note, status, created_at)
                   VALUES (?, ?, ?, ?, 'Refill reminder', 'pending', ?)""".replace(
                    "note, status", "note, status"),
                (customer_id, sale_id, add_days(date, reminder_days), medicines, now_stamp()))

        audit.log(actor, "sale.create", "sale", sale_id,
                  {"no": number, "total": total, "items": len(lines)})
        return by_id(sale_id)


def by_id(sale_id, **_):
    sale = db.one_row(
        """SELECT s.*, c.name AS customer_name, c.phone AS customer_phone, c.address AS customer_address,
              c.gstin AS customer_gstin, d.name AS doctor_name, d.reg_no AS doctor_reg
           FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
           LEFT JOIN doctors d ON d.id = s.doctor_id WHERE s.id = ?""", (int(sale_id),))
    if not sale:
        return None
    items = db.all_rows(
        """SELECT si.*, p.pack_size, p.pack_label, p.unit_label
           FROM sale_items si LEFT JOIN products p ON p.id = si.product_id
           WHERE si.sale_id = ? ORDER BY si.id""", (sale["id"],))
    buckets: dict[str, dict] = {}
    for item in items:
        key = str(item["gst_rate"])
        bucket = buckets.setdefault(key, {"rate": item["gst_rate"], "taxable": 0.0,
                                          "cgst": 0.0, "sgst": 0.0, "igst": 0.0})
        for field in ("taxable", "cgst", "sgst", "igst"):
            bucket[field] = r2(bucket[field] + item[field])
    return {
        **sale,
        "items": items,
        "gst_summary": sorted(buckets.values(), key=lambda b: b["rate"]),
        "balance": r2(sale["total"] - sale["paid"]),
        "store": settings.store_profile(),
    }


def by_number(no=None, **_):
    row = db.one_row("SELECT id FROM sales WHERE no = ?", (str(no),))
    return by_id(row["id"]) if row else None


def listing(from_date=None, to_date=None, customerId=None, search="", paymentMode="",
            unpaidOnly=False, limit=300, **kwargs):
    from_date = from_date or kwargs.get("from")
    to_date = to_date or kwargs.get("to")
    where, params = [], []
    if from_date:
        where.append("s.date >= ?")
        params.append(from_date)
    if to_date:
        where.append("s.date <= ?")
        params.append(to_date)
    if customerId:
        where.append("s.customer_id = ?")
        params.append(int(customerId))
    if paymentMode:
        where.append("s.payment_mode = ?")
        params.append(paymentMode)
    if unpaidOnly:
        where.append("s.total - s.paid > 0.01")
    if search:
        where.append("(s.no LIKE ? OR s.patient_name LIKE ? OR c.name LIKE ? OR s.rx_no LIKE ?)")
        params += [f"%{search}%"] * 4
    clause = f"WHERE {' AND '.join(where)}" if where else ""
    rows = db.all_rows(
        f"""SELECT s.*, c.name AS customer_name, d.name AS doctor_name,
              (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id = s.id) AS line_count
            FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
            LEFT JOIN doctors d ON d.id = s.doctor_id
            {clause} ORDER BY s.date DESC, s.id DESC LIMIT ?""",
        (*params, min(int(limit or 300), 5000)))
    totals = {
        "count": len(rows),
        "total": r2(sum(r["total"] for r in rows)),
        "paid": r2(sum(r["paid"] for r in rows)),
        "due": r2(sum(r["total"] - r["paid"] for r in rows)),
        "gst": r2(sum(r["gst_amount"] for r in rows)),
        "profit": r2(sum(r["subtotal"] - r["cost_total"] for r in rows)),
    }
    return {"rows": rows, "totals": totals}


def remove(actor, payload):
    """Deleting a bill restores stock and removes its money trail, atomically."""
    auth.require_admin(actor)
    sale_id = v.integer(payload.get("id"), "Bill", required=True, minimum=1)
    reason = payload.get("reason", "")
    with db.tx():
        sale = db.one_row("SELECT * FROM sales WHERE id = ?", (sale_id,))
        assert_that(sale, "That bill no longer exists.")
        returned = db.scalar("SELECT COUNT(*) FROM sale_returns WHERE sale_id = ?", (sale_id,), 0)
        assert_that(returned == 0, "This bill has a sales return against it. Delete the return first.")
        for item in db.all_rows("SELECT * FROM sale_items WHERE sale_id = ?", (sale_id,)):
            if item["batch_id"]:
                products.move_stock(item["batch_id"], item["qty_units"], allow_negative=True)
        ledger.reverse_source("sale", sale_id)
        for table in ("payments", "doctor_commissions", "rx_reminders", "sale_items"):
            db.run(f"DELETE FROM {table} WHERE sale_id = ?", (sale_id,))
        db.run("DELETE FROM sales WHERE id = ?", (sale_id,))
        audit.log(actor, "sale.delete", "sale", sale_id,
                  {"no": sale["no"], "total": sale["total"], "reason": reason})
        return {"ok": True}


def collect(actor, payload):
    """Adds a receipt against an existing credit bill."""
    auth.require_role(actor, ("admin", "pharmacist", "cashier"))
    sale_id = v.integer(payload.get("id"), "Bill", required=True, minimum=1)
    amount = r2(v.number(payload.get("amount"), "Amount", required=True, minimum=0.01, maximum=1e9))
    mode = v.one_of(payload.get("mode"), "Payment mode",
                    [m for m in PAYMENT_MODES if m != "Credit"], "Cash")
    when = v.iso_date(payload.get("date"), "Date", required=False, fallback="today") or today()
    with db.tx():
        sale = db.one_row("SELECT * FROM sales WHERE id = ?", (sale_id,))
        assert_that(sale, "That bill no longer exists.")
        due = r2(sale["total"] - sale["paid"])
        assert_that(due > 0, "This bill is already fully paid.")
        assert_that(amount <= due + 0.01, f"The outstanding amount on this bill is only ₹{due:.2f}.")
        db.run("UPDATE sales SET paid = ? WHERE id = ?", (r2(sale["paid"] + amount), sale_id))
        account = ledger.account_for_mode(mode)
        db.run(
            """INSERT INTO payments (date, party_type, party_id, party_name, direction, amount, mode,
                  account, ref_no, sale_id, notes, created_at, created_by)
               VALUES (?, 'customer', ?, ?, 'in', ?, ?, ?, ?, ?, 'Bill collection', ?, ?)""",
            (when, sale["customer_id"], sale["patient_name"] or "", amount, mode, account,
             sale["no"], sale_id, now_stamp(), (actor or {}).get("username", "")))
        ledger.post(when, account, "in", amount, "sale", sale_id,
                    f"Collection against bill {sale['no']}")
        audit.log(actor, "sale.collect", "sale", sale_id, {"amount": amount, "mode": mode})
        return by_id(sale_id)


def summary(date=None, **_):
    """The numbers behind the dashboard tiles."""
    day_iso = date or today()
    day = db.one_row(
        """SELECT COUNT(*) AS bills, COALESCE(SUM(total),0) AS total, COALESCE(SUM(paid),0) AS paid,
              COALESCE(SUM(gst_amount),0) AS gst, COALESCE(SUM(subtotal - cost_total),0) AS profit
           FROM sales WHERE date = ?""", (day_iso,))
    month = db.one_row(
        """SELECT COUNT(*) AS bills, COALESCE(SUM(total),0) AS total,
              COALESCE(SUM(subtotal - cost_total),0) AS profit
           FROM sales WHERE date >= ? AND date <= ?""", (f"{day_iso[:7]}-01", day_iso))
    outstanding = db.one_row(
        "SELECT COALESCE(SUM(total - paid),0) AS due, COUNT(*) AS bills FROM sales WHERE total - paid > 0.01")
    trend = db.all_rows(
        """SELECT date, COALESCE(SUM(total),0) AS total, COUNT(*) AS bills
           FROM sales WHERE date >= ? AND date <= ? GROUP BY date ORDER BY date""",
        (add_days(day_iso, -13), day_iso))
    top_items = db.all_rows(
        """SELECT si.name, SUM(si.qty_units) AS units, ROUND(SUM(si.total),2) AS value
           FROM sale_items si JOIN sales s ON s.id = si.sale_id
           WHERE s.date >= ? AND s.date <= ? GROUP BY si.name ORDER BY value DESC LIMIT 8""",
        (add_days(day_iso, -29), day_iso))
    payment_split = db.all_rows(
        "SELECT payment_mode, COALESCE(SUM(total),0) AS total FROM sales WHERE date = ? GROUP BY payment_mode",
        (day_iso,))
    return {
        "date": day_iso,
        "day": {**day, "total": r2(day["total"]), "paid": r2(day["paid"]),
                "gst": r2(day["gst"]), "profit": r2(day["profit"])},
        "month": {**month, "total": r2(month["total"]), "profit": r2(month["profit"])},
        "outstanding": {"due": r2(outstanding["due"]), "bills": outstanding["bills"]},
        "trend": [{**t, "total": r2(t["total"])} for t in trend],
        "topItems": top_items,
        "paymentSplit": payment_split,
    }
