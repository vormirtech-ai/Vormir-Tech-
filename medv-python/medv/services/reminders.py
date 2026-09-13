"""
Refill reminders.

They live entirely in the local database. MedV never sends anything by itself —
it prepares the message and hands it to WhatsApp only when the operator clicks.
"""

from __future__ import annotations
from .. import db
from ..util.dates import add_days, now_stamp, today
from ..util.errors import assert_that
from ..util import validate as v
from . import audit, auth, settings


def compose_message(reminder) -> str:
    template = settings.get("whatsapp_template")
    return (template
            .replace("{name}", reminder.get("customer_name") or "there")
            .replace("{store}", settings.get("store_name"))
            .replace("{medicines}", reminder.get("medicines") or "your regular medicines")
            .replace("{phone}", settings.get("store_phone"))
            .replace("{date}", reminder.get("due_date") or ""))


def listing(status="pending", from_date=None, to_date=None, limit=300, **kwargs):
    from_date = from_date or kwargs.get("from")
    to_date = to_date or kwargs.get("to")
    where, params = [], []
    if status:
        where.append("r.status = ?")
        params.append(status)
    if from_date:
        where.append("r.due_date >= ?")
        params.append(from_date)
    if to_date:
        where.append("r.due_date <= ?")
        params.append(to_date)
    clause = f"WHERE {' AND '.join(where)}" if where else ""
    rows = db.all_rows(
        f"""SELECT r.*, c.name AS customer_name, c.phone, s.no AS invoice_no
            FROM rx_reminders r JOIN customers c ON c.id = r.customer_id
            LEFT JOIN sales s ON s.id = r.sale_id
            {clause} ORDER BY r.due_date, r.id LIMIT ?""",
        (*params, min(int(limit or 300), 2000)))
    reference = today()
    return [{**row, "due": row["due_date"] <= reference, "message": compose_message(row)} for row in rows]


def save(actor, payload):
    auth.require_role(actor, ("admin", "pharmacist", "cashier"))
    customer_id = v.integer(payload.get("customer_id"), "Customer", required=True, minimum=1)
    assert_that(db.one_row("SELECT id FROM customers WHERE id = ?", (customer_id,)),
                "That customer no longer exists.")
    due_date = (v.iso_date(payload.get("due_date"), "Due date", required=False)
                or add_days(today(), int(settings.num("rx_reminder_days", 25))))
    medicines = v.text(payload.get("medicines"), "Medicines", max_len=300)
    note = v.text(payload.get("note"), "Note", max_len=200)
    reminder_id = v.integer(payload.get("id"), "Reminder", minimum=1) if payload.get("id") else None
    if reminder_id:
        db.run("UPDATE rx_reminders SET due_date = ?, medicines = ?, note = ? WHERE id = ?",
               (due_date, medicines, note, reminder_id))
        audit.log(actor, "reminder.update", "rx_reminder", reminder_id)
        return {"id": reminder_id}
    info = db.run(
        """INSERT INTO rx_reminders (customer_id, sale_id, due_date, medicines, note, status, created_at)
           VALUES (?, ?, ?, ?, ?, 'pending', ?)""",
        (customer_id, int(payload["sale_id"]) if payload.get("sale_id") else None,
         due_date, medicines, note, now_stamp()))
    audit.log(actor, "reminder.create", "rx_reminder", info["lastrowid"])
    return {"id": int(info["lastrowid"])}


def set_status(actor, payload):
    auth.require_role(actor, ("admin", "pharmacist", "cashier"))
    reminder_id = v.integer(payload.get("id"), "Reminder", required=True, minimum=1)
    status = v.one_of(payload.get("status"), "Status", ("pending", "sent", "done", "cancelled"), "sent")
    db.run("UPDATE rx_reminders SET status = ?, sent_at = ? WHERE id = ?",
           (status, now_stamp() if status == "sent" else None, reminder_id))
    audit.log(actor, "reminder.status", "rx_reminder", reminder_id, status)
    return {"ok": True}


def remove(actor, payload):
    auth.require_role(actor, ("admin", "pharmacist"))
    reminder_id = v.integer(payload.get("id"), "Reminder", required=True, minimum=1)
    db.run("DELETE FROM rx_reminders WHERE id = ?", (reminder_id,))
    audit.log(actor, "reminder.delete", "rx_reminder", reminder_id)
    return {"ok": True}


def suggestions(days=30, limit=40, **_):
    """Patients who have not been back, taken from their own buying history."""
    gap = max(7, int(days or 30))
    return db.all_rows(
        """SELECT c.id AS customer_id, c.name AS customer_name, c.phone,
              MAX(s.date) AS last_visit,
              (SELECT GROUP_CONCAT(x.name, ', ') FROM (
                 SELECT DISTINCT si.name FROM sale_items si
                 JOIN sales s2 ON s2.id = si.sale_id
                 WHERE s2.customer_id = c.id ORDER BY si.id DESC LIMIT 4) x) AS medicines
           FROM customers c JOIN sales s ON s.customer_id = c.id
           WHERE c.active = 1 AND c.phone <> ''
             AND NOT EXISTS (SELECT 1 FROM rx_reminders r
                             WHERE r.customer_id = c.id AND r.status = 'pending')
           GROUP BY c.id
           HAVING julianday('now') - julianday(MAX(s.date)) >= ?
           ORDER BY last_visit DESC LIMIT ?""",
        (gap, min(int(limit or 40), 200)))
