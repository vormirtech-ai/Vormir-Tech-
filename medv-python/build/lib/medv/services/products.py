"""Medicines, batches and stock movement."""

from __future__ import annotations
from .. import db
from ..util.dates import add_days, expiry_end_date, now_stamp, today
from ..util.errors import assert_that
from ..util.money import as_int, r2, r3
from ..util import validate as v
from . import audit, auth, settings

CATEGORIES = ["Medicine", "Tablet", "Syrup", "Injection", "Ointment", "Drops",
              "Surgical", "Cosmetic", "General", "Other"]
SCHEDULES = ["General", "Schedule H", "Schedule H1", "Schedule X", "OTC", "Narcotic"]
GST_RATES = (0, 5, 12, 18, 28)

STOCK_SELECT = """
  SELECT p.*,
         COALESCE(s.qty_units, 0)   AS stock_units,
         COALESCE(s.batch_count, 0) AS batch_count,
         s.min_expiry,
         s.mrp  AS last_mrp,
         s.rate AS last_rate
  FROM products p
  LEFT JOIN (
    SELECT b.product_id,
           SUM(b.qty_units)     AS qty_units,
           COUNT(*)             AS batch_count,
           MIN(b.expiry)        AS min_expiry,
           MAX(b.mrp)           AS mrp,
           MAX(b.rate_per_unit) AS rate
    FROM batches b
    WHERE b.qty_units > 0
    GROUP BY b.product_id
  ) s ON s.product_id = p.id"""


def decorate(row):
    if not row:
        return row
    out = dict(row)
    pack = max(1, as_int(out.get("pack_size"), 1))
    units = as_int(out.get("stock_units"), 0)
    packs, loose = divmod(units, pack)
    out["active"] = bool(out.get("active"))
    out["allow_loose"] = bool(out.get("allow_loose"))
    out["pack_size"] = pack
    out["stock_units"] = units
    out["stock_packs"] = packs
    out["stock_loose"] = loose
    if pack > 1:
        label = f"{packs} {out['pack_label']}"
        if loose:
            label += f" + {loose} {out['unit_label']}"
    else:
        label = f"{units} {out['unit_label']}"
    out["stock_label"] = label
    out["low_stock"] = bool(out.get("reorder_level") and units <= out["reorder_level"])
    return out


def listing(search="", category="", onlyActive=True, lowStock=False, limit=500, **_):
    where, params = [], []
    if onlyActive:
        where.append("p.active = 1")
    if search:
        where.append("(p.name LIKE ? OR p.generic LIKE ? OR p.manufacturer LIKE ?)")
        params += [f"%{search}%"] * 3
    if category:
        where.append("p.category = ?")
        params.append(category)
    clause = f"WHERE {' AND '.join(where)}" if where else ""
    params.append(min(int(limit or 500), 5000))
    rows = [decorate(r) for r in db.all_rows(f"{STOCK_SELECT} {clause} ORDER BY p.name LIMIT ?", params)]
    if lowStock:
        rows = [r for r in rows if r["low_stock"] or r["stock_units"] == 0]
    return rows


def by_id(product_id):
    return decorate(db.one_row(f"{STOCK_SELECT} WHERE p.id = ?", (int(product_id),)))


def search(q="", limit=12, inStockOnly=False, **_):
    """Type-ahead for the billing screen; batches come along for the ride."""
    term = str(q or "").strip()
    if not term:
        return []
    like, contains = f"{term}%", f"%{term}%"
    rows = db.all_rows(
        f"""{STOCK_SELECT}
        WHERE p.active = 1 AND (p.name LIKE ? OR p.generic LIKE ? OR p.name LIKE ? OR p.generic LIKE ?)
        ORDER BY CASE WHEN p.name LIKE ? THEN 0 ELSE 1 END, p.name LIMIT ?""",
        (like, like, contains, contains, like, min(int(limit or 12), 50)),
    )
    out = []
    for row in (decorate(r) for r in rows):
        if inStockOnly and row["stock_units"] <= 0:
            continue
        row["batches"] = batches_for(row["id"], only_in_stock=True)
        out.append(row)
    return out


def save(actor, payload):
    auth.require_role(actor, ("admin", "pharmacist"))
    product_id = v.integer(payload.get("id"), "Product", minimum=1) if payload.get("id") else None
    data = {
        "name": v.text(payload.get("name"), "Medicine name", required=True, max_len=120),
        "generic": v.text(payload.get("generic"), "Salt / generic name", max_len=160),
        "manufacturer": v.text(payload.get("manufacturer"), "Manufacturer", max_len=120),
        "category": v.one_of(payload.get("category"), "Category", CATEGORIES, "Medicine"),
        "hsn": v.text(payload.get("hsn"), "HSN code", max_len=12),
        "gst_rate": v.number(payload.get("gst_rate"), "GST %", minimum=0, maximum=28,
                             fallback=settings.num("default_gst_rate", 12)),
        "pack_size": v.integer(payload.get("pack_size"), "Units per pack", minimum=1, maximum=10000, fallback=1) or 1,
        "pack_label": v.text(payload.get("pack_label"), "Pack label", max_len=20) or "Strip",
        "unit_label": v.text(payload.get("unit_label"), "Unit label", max_len=20) or "Tablet",
        "allow_loose": v.flag(payload.get("allow_loose", 1)),
        "rack": v.text(payload.get("rack"), "Rack", max_len=30),
        "schedule_type": v.one_of(payload.get("schedule_type"), "Drug schedule", SCHEDULES, "General"),
        "reorder_level": v.integer(payload.get("reorder_level"), "Reorder level", minimum=0,
                                   maximum=1000000, fallback=0),
        "active": v.flag(payload.get("active", 1)),
    }
    assert_that(int(data["gst_rate"]) in GST_RATES, "GST % must be 0, 5, 12, 18 or 28.")
    duplicate = db.one_row("SELECT id FROM products WHERE lower(name) = lower(?) AND id <> ?",
                           (data["name"], product_id or 0))
    assert_that(not duplicate, f"\"{data['name']}\" already exists in the medicine master.")

    if product_id:
        db.run(
            """UPDATE products SET name=:name, generic=:generic, manufacturer=:manufacturer,
               category=:category, hsn=:hsn, gst_rate=:gst_rate, pack_size=:pack_size,
               pack_label=:pack_label, unit_label=:unit_label, allow_loose=:allow_loose, rack=:rack,
               schedule_type=:schedule_type, reorder_level=:reorder_level, active=:active,
               updated_at=:updated_at WHERE id=:id""",
            {**data, "id": product_id, "updated_at": now_stamp()},
        )
        audit.log(actor, "product.update", "product", product_id, data["name"])
        return by_id(product_id)

    info = db.run(
        """INSERT INTO products (name, generic, manufacturer, category, hsn, gst_rate, pack_size,
              pack_label, unit_label, allow_loose, rack, schedule_type, reorder_level, active,
              created_at, updated_at)
           VALUES (:name, :generic, :manufacturer, :category, :hsn, :gst_rate, :pack_size,
              :pack_label, :unit_label, :allow_loose, :rack, :schedule_type, :reorder_level,
              :active, :created_at, :created_at)""",
        {**data, "created_at": now_stamp()},
    )
    audit.log(actor, "product.create", "product", info["lastrowid"], data["name"])
    return by_id(info["lastrowid"])


def remove(actor, payload):
    auth.require_role(actor, ("admin", "pharmacist"))
    product_id = v.integer(payload.get("id"), "Product", required=True, minimum=1)
    stock = db.scalar("SELECT COALESCE(SUM(qty_units),0) FROM batches WHERE product_id = ?", (product_id,), 0)
    sold = db.scalar("SELECT COUNT(*) FROM sale_items WHERE product_id = ?", (product_id,), 0)
    if stock > 0 or sold > 0:
        db.run("UPDATE products SET active = 0, updated_at = ? WHERE id = ?", (now_stamp(), product_id))
        audit.log(actor, "product.deactivate", "product", product_id)
        return {"ok": True, "deactivated": True}
    db.run("DELETE FROM products WHERE id = ?", (product_id,))
    audit.log(actor, "product.delete", "product", product_id)
    return {"ok": True, "deleted": True}


# ------------------------------------------------------------------ batches
def batches_for(product_id, only_in_stock=False, **_):
    clause = "AND b.qty_units > 0" if only_in_stock else ""
    rows = db.all_rows(
        f"""SELECT b.*, p.pack_size, p.pack_label, p.unit_label
            FROM batches b JOIN products p ON p.id = b.product_id
            WHERE b.product_id = ? {clause} ORDER BY b.expiry, b.batch_no""",
        (int(product_id),),
    )
    reference = today()
    soon = add_days(reference, int(settings.num("expiry_alert_days", 90)))
    out = []
    for row in rows:
        item = dict(row)
        pack = max(1, as_int(item["pack_size"], 1))
        end = expiry_end_date(item["expiry"])
        item["pack_size"] = pack
        item["qty_packs"], item["qty_loose"] = divmod(item["qty_units"], pack)
        item["expired"] = bool(end and end < reference)
        item["expiring_soon"] = bool(end and reference <= end <= soon)
        out.append(item)
    return out


def save_batch(actor, payload):
    auth.require_role(actor, ("admin", "pharmacist"))
    product_id = v.integer(payload.get("product_id"), "Medicine", required=True, minimum=1)
    product = db.one_row("SELECT * FROM products WHERE id = ?", (product_id,))
    assert_that(product, "Select a valid medicine first.")
    batch_no = v.text(payload.get("batch_no"), "Batch number", required=True, max_len=40).upper()
    expiry = v.expiry(payload.get("expiry"), "Expiry")
    mrp = v.number(payload.get("mrp"), "MRP", required=True, minimum=0, maximum=1000000)
    rate = v.number(payload.get("rate_per_unit"), "Purchase rate per unit", minimum=0, maximum=1000000)
    batch_id = v.integer(payload.get("id"), "Batch", minimum=1) if payload.get("id") else None
    qty = v.integer(payload.get("qty_units"), "Quantity", minimum=0, maximum=10000000, fallback=0)

    if batch_id:
        assert_that(db.one_row("SELECT id FROM batches WHERE id = ?", (batch_id,)),
                    "That batch no longer exists.")
        db.run("UPDATE batches SET batch_no = ?, expiry = ?, mrp = ?, rate_per_unit = ? WHERE id = ?",
               (batch_no, expiry, r2(mrp), r3(rate), batch_id))
        audit.log(actor, "batch.update", "batch", batch_id, {"product": product["name"], "batchNo": batch_no})
        return next((b for b in batches_for(product_id) if b["id"] == batch_id), None)

    info = db.run(
        """INSERT INTO batches (product_id, batch_no, expiry, mrp, rate_per_unit, qty_units, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(product_id, batch_no, expiry) DO UPDATE SET
             mrp = excluded.mrp, rate_per_unit = excluded.rate_per_unit,
             qty_units = batches.qty_units + excluded.qty_units""",
        (product_id, batch_no, expiry, r2(mrp), r3(rate), qty, now_stamp()),
    )
    audit.log(actor, "batch.create", "batch", info["lastrowid"],
              {"product": product["name"], "batchNo": batch_no, "qtyUnits": qty})
    return db.one_row("SELECT * FROM batches WHERE product_id = ? AND batch_no = ? AND expiry = ?",
                      (product_id, batch_no, expiry))


def upsert_batch(product_id, batch_no, expiry, mrp, rate_per_unit) -> int:
    """Finds or creates the batch for a purchase line, inside its transaction."""
    existing = db.one_row("SELECT id FROM batches WHERE product_id = ? AND batch_no = ? AND expiry = ?",
                          (product_id, batch_no, expiry))
    if existing:
        db.run("UPDATE batches SET mrp = ?, rate_per_unit = ? WHERE id = ?",
               (r2(mrp), r3(rate_per_unit), existing["id"]))
        return existing["id"]
    info = db.run(
        "INSERT INTO batches (product_id, batch_no, expiry, mrp, rate_per_unit, qty_units, created_at) "
        "VALUES (?, ?, ?, ?, ?, 0, ?)",
        (product_id, batch_no, expiry, r2(mrp), r3(rate_per_unit), now_stamp()),
    )
    return int(info["lastrowid"])


def move_stock(batch_id, delta, allow_negative=False) -> int:
    """Positive adds stock, negative removes it. Never goes below zero."""
    batch = db.one_row(
        "SELECT b.*, p.name FROM batches b JOIN products p ON p.id = b.product_id WHERE b.id = ?",
        (int(batch_id),))
    assert_that(batch, "That batch no longer exists.")
    nxt = as_int(batch["qty_units"]) + as_int(delta)
    assert_that(
        allow_negative or nxt >= 0,
        f"Not enough stock for {batch['name']} (batch {batch['batch_no']}). "
        f"Available: {batch['qty_units']}, needed: {abs(as_int(delta))}.",
        "INSUFFICIENT_STOCK",
    )
    db.run("UPDATE batches SET qty_units = ? WHERE id = ?", (nxt, batch_id))
    return nxt


def adjust_stock(actor, payload):
    auth.require_role(actor, ("admin", "pharmacist"))
    batch_id = v.integer(payload.get("batch_id"), "Batch", required=True, minimum=1)
    qty = v.integer(payload.get("qty_units"), "Quantity", required=True, minimum=-10000000, maximum=10000000)
    assert_that(qty != 0, "Enter a quantity to add or remove.")
    reason = v.text(payload.get("reason"), "Reason", required=True, max_len=160)
    with db.tx():
        batch = db.one_row("SELECT * FROM batches WHERE id = ?", (batch_id,))
        assert_that(batch, "That batch no longer exists.")
        move_stock(batch_id, qty)
        db.run(
            "INSERT INTO stock_adjustments (date, batch_id, product_id, qty_units, reason, created_at, created_by) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (today(), batch_id, batch["product_id"], qty, reason, now_stamp(), (actor or {}).get("username", "")),
        )
        audit.log(actor, "stock.adjust", "batch", batch_id, {"qty": qty, "reason": reason})
        return {"ok": True, "stock": by_id(batch["product_id"])}


def delete_batch(actor, payload):
    auth.require_role(actor, ("admin", "pharmacist"))
    batch_id = v.integer(payload.get("id"), "Batch", required=True, minimum=1)
    used = db.scalar(
        "SELECT (SELECT COUNT(*) FROM sale_items WHERE batch_id = ?) "
        "     + (SELECT COUNT(*) FROM purchase_items WHERE batch_id = ?)", (batch_id, batch_id), 0)
    assert_that(used == 0,
                "This batch appears on saved bills and cannot be deleted. Adjust its stock instead.")
    db.run("DELETE FROM batches WHERE id = ?", (batch_id,))
    audit.log(actor, "batch.delete", "batch", batch_id)
    return {"ok": True}


def allocate(product_id, qty_units, **_):
    """First-expiry-first-out picking, skipping anything already expired."""
    rows = db.all_rows("SELECT * FROM batches WHERE product_id = ? AND qty_units > 0 ORDER BY expiry, id",
                       (int(product_id),))
    reference = today()
    remaining = as_int(qty_units)
    picks = []
    for batch in rows:
        if remaining <= 0:
            break
        end = expiry_end_date(batch["expiry"])
        if end and end < reference:
            continue
        take = min(remaining, batch["qty_units"])
        picks.append({
            "batch_id": batch["id"], "batch_no": batch["batch_no"], "expiry": batch["expiry"],
            "mrp": batch["mrp"], "rate_per_unit": batch["rate_per_unit"], "qty_units": take,
        })
        remaining -= take
    return {"picks": picks, "shortfall": remaining}


def expiry_report(withinDays=90, includeExpired=True, **_):
    limit = add_days(today(), int(withinDays or 90))
    rows = db.all_rows(
        """SELECT b.*, p.name, p.pack_size, p.pack_label, p.unit_label, p.manufacturer
           FROM batches b JOIN products p ON p.id = b.product_id
           WHERE b.qty_units > 0 ORDER BY b.expiry""")
    reference = today()
    out = []
    for row in rows:
        item = dict(row)
        end = expiry_end_date(item["expiry"])
        item["end"] = end
        item["value"] = r2(item["qty_units"] * item["rate_per_unit"])
        item["expired"] = bool(end and end < reference)
        if item["expired"]:
            if includeExpired:
                out.append(item)
        elif end and end <= limit:
            out.append(item)
    return out


def low_stock_report(**_):
    rows = [p for p in listing(onlyActive=True, limit=5000)
            if p["stock_units"] == 0 or (p["reorder_level"] and p["stock_units"] <= p["reorder_level"])]
    return sorted(rows, key=lambda p: p["stock_units"])
