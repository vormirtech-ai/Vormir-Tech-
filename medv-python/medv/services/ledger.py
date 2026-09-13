"""One cash/bank ledger. Every rupee in or out lands here, so balances tie."""

from __future__ import annotations
from .. import db
from ..util.dates import now_stamp
from ..util.money import r2

ACCOUNTS = ("cash", "bank")
MODES = ("Cash", "UPI", "Card", "Cheque", "Bank Transfer", "Credit")


def account_for_mode(mode: str) -> str:
    return "cash" if mode == "Cash" else "bank"


def post(date, account, direction, amount, source_type, source_id=None, description=""):
    """Appends a movement. Call inside a transaction."""
    value = r2(amount)
    if value == 0:
        return None
    info = db.run(
        "INSERT INTO ledger (date, account, direction, amount, source_type, source_id, description, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (date, account, direction, abs(value), source_type, source_id, description or "", now_stamp()),
    )
    return int(info["lastrowid"])


def reverse_source(source_type, source_id):
    db.run("DELETE FROM ledger WHERE source_type = ? AND source_id = ?", (source_type, int(source_id)))


def balances(upto=None, **_):
    clause = "WHERE date <= ?" if upto else ""
    params = (upto,) if upto else ()
    rows = db.all_rows(
        f"""SELECT account,
              COALESCE(SUM(CASE WHEN direction = 'in'  THEN amount ELSE 0 END), 0) AS credit,
              COALESCE(SUM(CASE WHEN direction = 'out' THEN amount ELSE 0 END), 0) AS debit
            FROM ledger {clause} GROUP BY account""", params)
    out = {"cash": 0.0, "bank": 0.0, "total": 0.0}
    for row in rows:
        out[row["account"]] = r2(row["credit"] - row["debit"])
    out["total"] = r2(out["cash"] + out["bank"])
    return out


def entries(from_date=None, to_date=None, account="", limit=500, **kwargs):
    from_date = from_date or kwargs.get("from")
    to_date = to_date or kwargs.get("to")
    where, params = [], []
    if from_date:
        where.append("date >= ?")
        params.append(from_date)
    if to_date:
        where.append("date <= ?")
        params.append(to_date)
    if account:
        where.append("account = ?")
        params.append(account)
    clause = f"WHERE {' AND '.join(where)}" if where else ""
    rows = db.all_rows(
        f"SELECT * FROM ledger {clause} ORDER BY date DESC, id DESC LIMIT ?",
        (*params, min(int(limit or 500), 5000)))

    opening = 0.0
    if from_date:
        extra = " AND account = ?" if account else ""
        row = db.one_row(
            f"""SELECT COALESCE(SUM(CASE WHEN direction='in'  THEN amount ELSE 0 END),0) AS credit,
                       COALESCE(SUM(CASE WHEN direction='out' THEN amount ELSE 0 END),0) AS debit
                FROM ledger WHERE date < ?{extra}""",
            (from_date, account) if account else (from_date,))
        opening = r2(row["credit"] - row["debit"])

    inflow = r2(sum(r["amount"] for r in rows if r["direction"] == "in"))
    outflow = r2(sum(r["amount"] for r in rows if r["direction"] == "out"))
    return {
        "rows": rows,
        "opening": opening,
        "totals": {"inflow": inflow, "outflow": outflow},
        "closing": r2(opening + inflow - outflow),
        "snapshot": balances(upto=to_date) if to_date else balances(),
    }
