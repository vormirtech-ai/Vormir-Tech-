"""Registers, margins, the day book and everything the dashboard shows."""

from __future__ import annotations
from .. import db
from ..util.dates import add_days, month_start, today
from ..util.money import r2
from . import ledger, products


def _period(from_date=None, to_date=None, **kwargs):
    return {
        "from": from_date or kwargs.get("from") or month_start(today()),
        "to": to_date or kwargs.get("to") or today(),
    }


def sales_register(**params):
    span = _period(**params)
    rows = db.all_rows(
        """SELECT s.date, COUNT(*) AS bills,
              ROUND(SUM(s.subtotal),2) AS taxable, ROUND(SUM(s.gst_amount),2) AS gst,
              ROUND(SUM(s.discount),2) AS discount, ROUND(SUM(s.total),2) AS total,
              ROUND(SUM(s.paid),2) AS collected, ROUND(SUM(s.subtotal - s.cost_total),2) AS profit
           FROM sales s WHERE s.date >= ? AND s.date <= ? GROUP BY s.date ORDER BY s.date""",
        (span["from"], span["to"]))
    totals = {key: 0 for key in ("bills", "taxable", "gst", "discount", "total", "collected", "profit")}
    for row in rows:
        totals["bills"] += row["bills"]
        for key in ("taxable", "gst", "discount", "total", "collected", "profit"):
            totals[key] = r2(totals[key] + row[key])
    return {"period": span, "rows": rows, "totals": totals}


def purchase_register(**params):
    span = _period(**params)
    rows = db.all_rows(
        """SELECT p.date, COUNT(*) AS bills, ROUND(SUM(p.subtotal),2) AS taxable,
              ROUND(SUM(p.gst_amount),2) AS gst, ROUND(SUM(p.total),2) AS total,
              ROUND(SUM(p.paid),2) AS paid
           FROM purchases p WHERE p.date >= ? AND p.date <= ? GROUP BY p.date ORDER BY p.date""",
        (span["from"], span["to"]))
    totals = {key: 0 for key in ("bills", "taxable", "gst", "total", "paid")}
    for row in rows:
        totals["bills"] += row["bills"]
        for key in ("taxable", "gst", "total", "paid"):
            totals[key] = r2(totals[key] + row[key])
    return {"period": span, "rows": rows, "totals": totals}


def item_movement(**params):
    span = _period(**params)
    rows = db.all_rows(
        """SELECT si.product_id, si.name, SUM(si.qty_units) AS units,
              ROUND(SUM(si.taxable),2) AS taxable, ROUND(SUM(si.total),2) AS value,
              ROUND(SUM(si.taxable - si.qty_units * si.cost_per_unit),2) AS profit,
              COUNT(DISTINCT si.sale_id) AS bills
           FROM sale_items si JOIN sales s ON s.id = si.sale_id
           WHERE s.date >= ? AND s.date <= ?
           GROUP BY si.product_id, si.name ORDER BY value DESC LIMIT 500""",
        (span["from"], span["to"]))
    stock = {p["id"]: p for p in products.listing(limit=5000)}
    enriched = []
    for row in rows:
        item = stock.get(row["product_id"])
        enriched.append({
            **row,
            "stock_units": item["stock_units"] if item else 0,
            "stock_label": item["stock_label"] if item else "—",
            "margin_pct": r2(row["profit"] * 100 / row["taxable"]) if row["taxable"] else 0.0,
        })
    return {
        "period": span,
        "rows": enriched,
        "totals": {
            "units": sum(r["units"] for r in rows),
            "value": r2(sum(r["value"] for r in rows)),
            "profit": r2(sum(r["profit"] for r in rows)),
        },
    }


def stock_valuation(**_):
    rows = db.all_rows(
        """SELECT p.id, p.name, p.manufacturer, p.category, p.pack_size, p.pack_label, p.unit_label,
              p.rack, p.reorder_level,
              COALESCE(SUM(b.qty_units),0) AS units,
              ROUND(COALESCE(SUM(b.qty_units * b.rate_per_unit),0),2) AS cost_value,
              ROUND(COALESCE(SUM(b.qty_units * b.mrp / NULLIF(p.pack_size,0)),0),2) AS mrp_value,
              COUNT(b.id) AS batches
           FROM products p LEFT JOIN batches b ON b.product_id = p.id AND b.qty_units > 0
           WHERE p.active = 1 GROUP BY p.id ORDER BY cost_value DESC""")
    totals = {
        "units": sum(r["units"] for r in rows),
        "cost_value": r2(sum(r["cost_value"] for r in rows)),
        "mrp_value": r2(sum(r["mrp_value"] for r in rows)),
    }
    return {"rows": rows, "totals": totals}


def day_book(date=None, **_):
    day = date or today()
    opening_row = db.one_row(
        """SELECT COALESCE(SUM(CASE WHEN direction='in'  THEN amount ELSE 0 END),0) AS credit,
                  COALESCE(SUM(CASE WHEN direction='out' THEN amount ELSE 0 END),0) AS debit
           FROM ledger WHERE date < ?""", (day,))
    opening = r2(opening_row["credit"] - opening_row["debit"])
    rows = db.all_rows("SELECT * FROM ledger WHERE date = ? ORDER BY id", (day,))
    inflow = r2(sum(r["amount"] for r in rows if r["direction"] == "in"))
    outflow = r2(sum(r["amount"] for r in rows if r["direction"] == "out"))
    return {
        "date": day,
        "opening": opening,
        "rows": rows,
        "inflow": inflow,
        "outflow": outflow,
        "closing": r2(opening + inflow - outflow),
        "balances": ledger.balances(upto=day),
        "sales": db.all_rows(
            "SELECT no, patient_name, payment_mode, total, paid FROM sales WHERE date = ? ORDER BY id", (day,)),
        "expenses": db.all_rows(
            "SELECT category, payee, amount, account FROM expenses WHERE date = ? ORDER BY id", (day,)),
    }


def profit_loss(**params):
    span = _period(**params)
    sales = db.one_row(
        """SELECT ROUND(COALESCE(SUM(subtotal),0),2) AS taxable,
              ROUND(COALESCE(SUM(cost_total),0),2) AS cost,
              ROUND(COALESCE(SUM(total),0),2) AS gross, COUNT(*) AS bills
           FROM sales WHERE date >= ? AND date <= ?""", (span["from"], span["to"]))
    returns = db.one_row(
        "SELECT ROUND(COALESCE(SUM(subtotal),0),2) AS taxable FROM sale_returns WHERE date >= ? AND date <= ?",
        (span["from"], span["to"]))
    expenses = db.all_rows(
        """SELECT category, ROUND(SUM(amount),2) AS amount FROM expenses
           WHERE date >= ? AND date <= ? GROUP BY category ORDER BY amount DESC""",
        (span["from"], span["to"]))
    expense_total = r2(sum(e["amount"] for e in expenses))
    commissions = db.scalar(
        "SELECT ROUND(COALESCE(SUM(amount),0),2) FROM doctor_commissions WHERE date >= ? AND date <= ?",
        (span["from"], span["to"]), 0.0)
    gross_profit = r2(sales["taxable"] - returns["taxable"] - sales["cost"])
    return {
        "period": span,
        "sales": sales,
        "returns": returns,
        "grossProfit": gross_profit,
        "expenses": expenses,
        "expenseTotal": expense_total,
        "commissions": commissions,
        "netProfit": r2(gross_profit - expense_total - commissions),
        "marginPct": r2(gross_profit * 100 / sales["taxable"]) if sales["taxable"] else 0.0,
    }


def outstanding(**_):
    receivables = db.all_rows(
        """SELECT s.id, s.no, s.date, s.total, s.paid, ROUND(s.total - s.paid, 2) AS due,
              COALESCE(c.name, s.patient_name, 'Walk-in') AS party, c.phone,
              CAST(julianday('now') - julianday(s.date) AS INTEGER) AS age_days
           FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
           WHERE s.total - s.paid > 0.01 ORDER BY s.date""")
    payables = db.all_rows(
        """SELECT p.id, p.no, p.ref_no, p.date, p.total, p.paid, ROUND(p.total - p.paid, 2) AS due,
              s.name AS party, s.phone,
              CAST(julianday('now') - julianday(p.date) AS INTEGER) AS age_days
           FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id
           WHERE p.total - p.paid > 0.01 ORDER BY p.date""")
    return {
        "receivables": receivables,
        "payables": payables,
        "totals": {
            "receivable": r2(sum(r["due"] for r in receivables)),
            "payable": r2(sum(r["due"] for r in payables)),
        },
    }


def dashboard(date=None, **_):
    """Everything the dashboard needs, in one round trip."""
    from . import sales as sales_service
    from . import settings

    day = date or today()
    summary = sales_service.summary(date=day)
    expiry = products.expiry_report(withinDays=90)
    low = products.low_stock_report()
    expired = [e for e in expiry if e["expired"]]
    expiring = [e for e in expiry if not e["expired"]]
    pending_rx = db.all_rows(
        """SELECT r.*, c.name AS customer_name, c.phone
           FROM rx_reminders r JOIN customers c ON c.id = r.customer_id
           WHERE r.status = 'pending' AND r.due_date <= ? ORDER BY r.due_date LIMIT 25""",
        (add_days(day, 3),))
    stock = stock_valuation()
    out = outstanding()
    return {
        **summary,
        "balances": ledger.balances(),
        "expiring": expiring[:20],
        "expired": expired[:20],
        "expiringCount": len(expiring),
        "expiredCount": len(expired),
        "lowStock": low[:20],
        "lowStockCount": len(low),
        "pendingRx": pending_rx,
        "pendingRxCount": db.scalar("SELECT COUNT(*) FROM rx_reminders WHERE status = 'pending'", (), 0),
        "stockValue": stock["totals"],
        "outstanding": {**summary["outstanding"], **out["totals"]},
        "expensesToday": db.scalar(
            "SELECT ROUND(COALESCE(SUM(amount),0),2) FROM expenses WHERE date = ?", (day,), 0.0),
        "counts": {
            "products": db.scalar("SELECT COUNT(*) FROM products WHERE active = 1", (), 0),
            "customers": db.scalar("SELECT COUNT(*) FROM customers WHERE active = 1", (), 0),
            "suppliers": db.scalar("SELECT COUNT(*) FROM suppliers WHERE active = 1", (), 0),
            "doctors": db.scalar("SELECT COUNT(*) FROM doctors WHERE active = 1", (), 0),
        },
        "settings": {"expiry_alert_days": settings.get("expiry_alert_days")},
    }
