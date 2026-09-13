"""Customers, doctors and suppliers. Balances are derived, never stored."""

from __future__ import annotations
from .. import db
from ..util.dates import now_stamp
from ..util.errors import assert_that
from ..util.money import r2
from ..util import validate as v
from . import audit, auth

CUSTOMER_BALANCE = """
  c.opening_balance
  + COALESCE((SELECT SUM(s.total) FROM sales s WHERE s.customer_id = c.id), 0)
  - COALESCE((SELECT SUM(r.total) FROM sale_returns r WHERE r.customer_id = c.id), 0)
  - COALESCE((SELECT SUM(p.amount) FROM payments p
              WHERE p.party_type = 'customer' AND p.party_id = c.id AND p.direction = 'in'), 0)
  + COALESCE((SELECT SUM(p.amount) FROM payments p
              WHERE p.party_type = 'customer' AND p.party_id = c.id AND p.direction = 'out'), 0)"""

SUPPLIER_BALANCE = """
  s.opening_balance
  + COALESCE((SELECT SUM(p.total) FROM purchases p WHERE p.supplier_id = s.id), 0)
  - COALESCE((SELECT SUM(r.total) FROM purchase_returns r WHERE r.supplier_id = s.id), 0)
  - COALESCE((SELECT SUM(p.amount) FROM payments p
              WHERE p.party_type = 'supplier' AND p.party_id = s.id AND p.direction = 'out'), 0)
  + COALESCE((SELECT SUM(p.amount) FROM payments p
              WHERE p.party_type = 'supplier' AND p.party_id = s.id AND p.direction = 'in'), 0)"""


# ---------------------------------------------------------------- customers
def list_customers(search="", limit=500, onlyActive=True, **_):
    where, params = [], []
    if onlyActive:
        where.append("c.active = 1")
    if search:
        where.append("(c.name LIKE ? OR c.phone LIKE ?)")
        params += [f"%{search}%", f"%{search}%"]
    clause = f"WHERE {' AND '.join(where)}" if where else ""
    params.append(min(int(limit or 500), 5000))
    return db.all_rows(
        f"""SELECT c.*, ROUND({CUSTOMER_BALANCE}, 2) AS balance,
              (SELECT COUNT(*) FROM sales s WHERE s.customer_id = c.id) AS bill_count,
              (SELECT MAX(s.date) FROM sales s WHERE s.customer_id = c.id) AS last_visit
            FROM customers c {clause} ORDER BY c.name LIMIT ?""",
        params,
    )


def customer_by_id(customer_id):
    return db.one_row(
        f"SELECT c.*, ROUND({CUSTOMER_BALANCE}, 2) AS balance FROM customers c WHERE c.id = ?",
        (int(customer_id),))


def save_customer(actor, payload):
    auth.require_role(actor, ("admin", "pharmacist", "cashier"))
    customer_id = v.integer(payload.get("id"), "Customer", minimum=1) if payload.get("id") else None
    data = {
        "name": v.text(payload.get("name"), "Patient / customer name", required=True, max_len=120),
        "phone": v.phone(payload.get("phone"), "Phone"),
        "email": v.text(payload.get("email"), "Email", max_len=120),
        "address": v.text(payload.get("address"), "Address", max_len=300),
        "gstin": v.gstin(payload["gstin"]) if payload.get("gstin") else "",
        "dob": v.iso_date(payload.get("dob"), "Date of birth", required=False),
        "notes": v.text(payload.get("notes"), "Notes", max_len=500),
        "opening_balance": r2(v.number(payload.get("opening_balance"), "Opening balance",
                                       minimum=-1e9, maximum=1e9)),
        "active": v.flag(payload.get("active", 1)),
    }
    if customer_id:
        db.run(
            """UPDATE customers SET name=:name, phone=:phone, email=:email, address=:address,
               gstin=:gstin, dob=:dob, notes=:notes, opening_balance=:opening_balance,
               active=:active WHERE id=:id""",
            {**data, "id": customer_id})
        audit.log(actor, "customer.update", "customer", customer_id, data["name"])
        return customer_by_id(customer_id)
    info = db.run(
        """INSERT INTO customers (name, phone, email, address, gstin, dob, notes,
              opening_balance, active, created_at)
           VALUES (:name, :phone, :email, :address, :gstin, :dob, :notes,
              :opening_balance, :active, :created_at)""",
        {**data, "created_at": now_stamp()})
    audit.log(actor, "customer.create", "customer", info["lastrowid"], data["name"])
    return customer_by_id(info["lastrowid"])


def customer_history(id=None, limit=100, **_):
    customer_id = v.integer(id, "Customer", required=True, minimum=1)
    cap = min(int(limit or 100), 1000)
    return {
        "customer": customer_by_id(customer_id),
        "sales": db.all_rows(
            """SELECT s.*, d.name AS doctor_name FROM sales s
               LEFT JOIN doctors d ON d.id = s.doctor_id
               WHERE s.customer_id = ? ORDER BY s.date DESC, s.id DESC LIMIT ?""", (customer_id, cap)),
        "payments": db.all_rows(
            "SELECT * FROM payments WHERE party_type = 'customer' AND party_id = ? "
            "ORDER BY date DESC, id DESC LIMIT ?", (customer_id, cap)),
        "items": db.all_rows(
            """SELECT si.name, SUM(si.qty_units) AS units, MAX(s.date) AS last_date
               FROM sale_items si JOIN sales s ON s.id = si.sale_id
               WHERE s.customer_id = ? GROUP BY si.name ORDER BY units DESC LIMIT 20""", (customer_id,)),
    }


# ------------------------------------------------------------------ doctors
def list_doctors(search="", onlyActive=True, **_):
    where, params = [], []
    if onlyActive:
        where.append("d.active = 1")
    if search:
        where.append("d.name LIKE ?")
        params.append(f"%{search}%")
    clause = f"WHERE {' AND '.join(where)}" if where else ""
    return db.all_rows(
        f"""SELECT d.*,
              (SELECT COUNT(*) FROM sales s WHERE s.doctor_id = d.id) AS referrals,
              COALESCE((SELECT SUM(c.amount) FROM doctor_commissions c WHERE c.doctor_id = d.id), 0)
                AS commission_total,
              COALESCE((SELECT SUM(c.amount) FROM doctor_commissions c
                        WHERE c.doctor_id = d.id AND c.paid = 0), 0) AS commission_due
            FROM doctors d {clause} ORDER BY d.name""", params)


def save_doctor(actor, payload):
    auth.require_role(actor, ("admin", "pharmacist"))
    doctor_id = v.integer(payload.get("id"), "Doctor", minimum=1) if payload.get("id") else None
    data = {
        "name": v.text(payload.get("name"), "Doctor name", required=True, max_len=120),
        "phone": v.phone(payload.get("phone"), "Phone"),
        "clinic": v.text(payload.get("clinic"), "Clinic / hospital", max_len=160),
        "reg_no": v.text(payload.get("reg_no"), "Registration number", max_len=40),
        "commission_pct": v.number(payload.get("commission_pct"), "Commission %", minimum=0, maximum=100),
        "active": v.flag(payload.get("active", 1)),
    }
    if doctor_id:
        db.run("""UPDATE doctors SET name=:name, phone=:phone, clinic=:clinic, reg_no=:reg_no,
                  commission_pct=:commission_pct, active=:active WHERE id=:id""",
               {**data, "id": doctor_id})
        audit.log(actor, "doctor.update", "doctor", doctor_id, data["name"])
    else:
        info = db.run(
            """INSERT INTO doctors (name, phone, clinic, reg_no, commission_pct, active, created_at)
               VALUES (:name, :phone, :clinic, :reg_no, :commission_pct, :active, :created_at)""",
            {**data, "created_at": now_stamp()})
        audit.log(actor, "doctor.create", "doctor", info["lastrowid"], data["name"])
    return list_doctors()


def doctor_commissions(doctorId=None, from_date=None, to_date=None, unpaidOnly=False, **kwargs):
    from_date = from_date or kwargs.get("from")
    to_date = to_date or kwargs.get("to")
    where, params = [], []
    if doctorId:
        where.append("c.doctor_id = ?")
        params.append(int(doctorId))
    if from_date:
        where.append("c.date >= ?")
        params.append(from_date)
    if to_date:
        where.append("c.date <= ?")
        params.append(to_date)
    if unpaidOnly:
        where.append("c.paid = 0")
    clause = f"WHERE {' AND '.join(where)}" if where else ""
    return db.all_rows(
        f"""SELECT c.*, d.name AS doctor_name, s.no AS invoice_no
            FROM doctor_commissions c JOIN doctors d ON d.id = c.doctor_id
            LEFT JOIN sales s ON s.id = c.sale_id
            {clause} ORDER BY c.date DESC, c.id DESC LIMIT 1000""", params)


def settle_commission(actor, payload):
    auth.require_role(actor, ("admin", "pharmacist"))
    ids = payload.get("ids") or []
    assert_that(isinstance(ids, list) and ids, "Select at least one commission entry.")
    paid = 1 if payload.get("paid", 1) else 0
    with db.tx():
        for entry in ids:
            db.run("UPDATE doctor_commissions SET paid = ? WHERE id = ?", (paid, int(entry)))
        audit.log(actor, "doctor.commission.settle", "doctor_commission",
                  ",".join(str(i) for i in ids), {"paid": paid})
        return {"ok": True, "updated": len(ids)}


# ---------------------------------------------------------------- suppliers
def list_suppliers(search="", onlyActive=True, **_):
    where, params = [], []
    if onlyActive:
        where.append("s.active = 1")
    if search:
        where.append("(s.name LIKE ? OR s.phone LIKE ?)")
        params += [f"%{search}%", f"%{search}%"]
    clause = f"WHERE {' AND '.join(where)}" if where else ""
    params.append(2000)
    return db.all_rows(
        f"""SELECT s.*, ROUND({SUPPLIER_BALANCE}, 2) AS balance,
              (SELECT COUNT(*) FROM purchases p WHERE p.supplier_id = s.id) AS bill_count,
              (SELECT MAX(p.date) FROM purchases p WHERE p.supplier_id = s.id) AS last_purchase
            FROM suppliers s {clause} ORDER BY s.name LIMIT ?""", params)


def supplier_by_id(supplier_id):
    return db.one_row(
        f"SELECT s.*, ROUND({SUPPLIER_BALANCE}, 2) AS balance FROM suppliers s WHERE s.id = ?",
        (int(supplier_id),))


def save_supplier(actor, payload):
    auth.require_role(actor, ("admin", "pharmacist"))
    supplier_id = v.integer(payload.get("id"), "Supplier", minimum=1) if payload.get("id") else None
    data = {
        "name": v.text(payload.get("name"), "Supplier name", required=True, max_len=120),
        "phone": v.phone(payload.get("phone"), "Phone"),
        "email": v.text(payload.get("email"), "Email", max_len=120),
        "address": v.text(payload.get("address"), "Address", max_len=300),
        "gstin": v.gstin(payload["gstin"]) if payload.get("gstin") else "",
        "dl_no": v.text(payload.get("dl_no"), "Drug licence number", max_len=60),
        "opening_balance": r2(v.number(payload.get("opening_balance"), "Opening balance",
                                       minimum=-1e9, maximum=1e9)),
        "active": v.flag(payload.get("active", 1)),
    }
    if supplier_id:
        db.run("""UPDATE suppliers SET name=:name, phone=:phone, email=:email, address=:address,
                  gstin=:gstin, dl_no=:dl_no, opening_balance=:opening_balance, active=:active
                  WHERE id=:id""", {**data, "id": supplier_id})
        audit.log(actor, "supplier.update", "supplier", supplier_id, data["name"])
        return supplier_by_id(supplier_id)
    info = db.run(
        """INSERT INTO suppliers (name, phone, email, address, gstin, dl_no, opening_balance,
              active, created_at)
           VALUES (:name, :phone, :email, :address, :gstin, :dl_no, :opening_balance,
              :active, :created_at)""", {**data, "created_at": now_stamp()})
    audit.log(actor, "supplier.create", "supplier", info["lastrowid"], data["name"])
    return supplier_by_id(info["lastrowid"])


def supplier_history(id=None, limit=100, **_):
    supplier_id = v.integer(id, "Supplier", required=True, minimum=1)
    cap = min(int(limit or 100), 1000)
    return {
        "supplier": supplier_by_id(supplier_id),
        "purchases": db.all_rows(
            "SELECT * FROM purchases WHERE supplier_id = ? ORDER BY date DESC, id DESC LIMIT ?",
            (supplier_id, cap)),
        "payments": db.all_rows(
            "SELECT * FROM payments WHERE party_type = 'supplier' AND party_id = ? "
            "ORDER BY date DESC, id DESC LIMIT ?", (supplier_id, cap)),
    }


def deactivate(actor, payload):
    auth.require_role(actor, ("admin", "pharmacist"))
    table = {"customer": "customers", "doctor": "doctors", "supplier": "suppliers"}.get(payload.get("type"))
    assert_that(table, "Unknown record type.")
    record_id = v.integer(payload.get("id"), "Record", required=True, minimum=1)
    db.run(f"UPDATE {table} SET active = 0 WHERE id = ?", (record_id,))
    audit.log(actor, f"{payload['type']}.deactivate", payload["type"], record_id)
    return {"ok": True}
