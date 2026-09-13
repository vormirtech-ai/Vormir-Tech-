"""
Dates are stored as ISO 'YYYY-MM-DD' strings so SQLite sorts them correctly,
and batch expiry as 'YYYY-MM' (a batch expires at the end of its month).
"""

from __future__ import annotations
import re
from datetime import date, datetime, timedelta

ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
EXPIRY_MONTH = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")


def today(when: date | None = None) -> str:
    return (when or date.today()).isoformat()


def now_stamp(when: datetime | None = None) -> str:
    return (when or datetime.now()).strftime("%Y-%m-%d %H:%M:%S")


def is_iso_date(value) -> bool:
    if not isinstance(value, str) or not ISO_DATE.match(value):
        return False
    try:
        date.fromisoformat(value)
        return True
    except ValueError:
        return False


def is_expiry_month(value) -> bool:
    return isinstance(value, str) and bool(EXPIRY_MONTH.match(value))


def expiry_end_date(expiry) -> str | None:
    """Last calendar day of an expiry month, as an ISO date."""
    if not is_expiry_month(expiry):
        return None
    year, month = (int(p) for p in expiry.split("-"))
    if month == 12:
        last = date(year, 12, 31)
    else:
        last = date(year, month + 1, 1) - timedelta(days=1)
    return last.isoformat()


def is_expired(expiry, reference: str | None = None) -> bool:
    end = expiry_end_date(expiry)
    return bool(end and end < (reference or today()))


def add_days(iso: str, days: int) -> str:
    return (date.fromisoformat(iso[:10]) + timedelta(days=int(days))).isoformat()


def add_months(iso: str, months: int) -> str:
    start = date.fromisoformat(iso[:10])
    month_index = start.year * 12 + (start.month - 1) + int(months)
    year, month = divmod(month_index, 12)
    month += 1
    if month == 12:
        last_day = 31
    else:
        last_day = (date(year, month + 1, 1) - timedelta(days=1)).day
    return date(year, month, min(start.day, last_day)).isoformat()


def month_start(iso: str | None = None) -> str:
    return f"{(iso or today())[:7]}-01"


def month_end(iso: str | None = None) -> str:
    base = iso or today()
    year, month = int(base[:4]), int(base[5:7])
    if month == 12:
        return date(year, 12, 31).isoformat()
    return (date(year, month + 1, 1) - timedelta(days=1)).isoformat()


def financial_year(iso: str | None = None) -> dict:
    """The Indian financial year (April–March) containing this date."""
    base = iso or today()
    year, month = int(base[:4]), int(base[5:7])
    start = year if month >= 4 else year - 1
    return {"from": f"{start}-04-01", "to": f"{start + 1}-03-31", "label": f"{start}-{str(start + 1)[2:]}"}


def format_date(iso) -> str:
    if not iso:
        return ""
    parts = str(iso)[:10].split("-")
    return f"{parts[2]}/{parts[1]}/{parts[0]}" if len(parts) == 3 else f"{parts[1]}/{parts[0]}"
