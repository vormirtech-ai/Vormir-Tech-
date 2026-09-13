"""Input checks that produce messages a shopkeeper can act on."""

from __future__ import annotations
import re

from .dates import is_expiry_month, is_iso_date, today
from .errors import assert_that

GSTIN_RE = re.compile(r"^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[A-Z0-9]{1}Z{1}[A-Z0-9]{1}$")
PHONE_RE = re.compile(r"^[0-9+\-\s()]{6,20}$")


def text(value, field, required=False, max_len=200, min_len=0) -> str:
    out = "" if value is None else str(value).strip()
    assert_that(not (required and not out), f"{field} is required.")
    assert_that(len(out) <= max_len, f"{field} must be {max_len} characters or fewer.")
    assert_that(not out or len(out) >= min_len, f"{field} must be at least {min_len} characters.")
    return out


def number(value, field, required=False, minimum=-1e12, maximum=1e12, fallback=0.0) -> float:
    if value is None or value == "":
        assert_that(not required, f"{field} is required.")
        return fallback
    try:
        out = float(value)
    except (TypeError, ValueError):
        raise_invalid(field)
    assert_that(out == out and abs(out) != float("inf"), f"{field} must be a number.")
    assert_that(out >= minimum, f"{field} cannot be less than {minimum}.")
    assert_that(out <= maximum, f"{field} cannot be more than {maximum}.")
    return out


def raise_invalid(field):
    assert_that(False, f"{field} must be a number.")


def integer(value, field, required=False, minimum=-10**12, maximum=10**12, fallback=0) -> int:
    out = number(value, field, required=required, minimum=minimum, maximum=maximum, fallback=fallback)
    assert_that(float(out).is_integer(), f"{field} must be a whole number.")
    return int(out)


def iso_date(value, field, required=True, fallback=None):
    if not value:
        assert_that(not required, f"{field} is required.")
        return today() if fallback == "today" else fallback
    out = str(value)[:10]
    assert_that(is_iso_date(out), f"{field} must be a valid date.")
    return out


def expiry(value, field, required=True):
    """Accepts 06/2028, 6/28 or 2028-06 and normalises to 'YYYY-MM'."""
    if not value:
        assert_that(not required, f"{field} is required.")
        return None
    raw = str(value).strip()
    slash = re.match(r"^(\d{1,2})\s*[/-]\s*(\d{2}|\d{4})$", raw)
    if slash:
        month = slash.group(1).zfill(2)
        year = f"20{slash.group(2)}" if len(slash.group(2)) == 2 else slash.group(2)
        raw = f"{year}-{month}"
    assert_that(is_expiry_month(raw), f"{field} must be a month like 06/2027.")
    return raw


def one_of(value, field, allowed, fallback=None):
    out = fallback if value in (None, "") else str(value)
    assert_that(out in allowed, f"{field} must be one of: {', '.join(str(a) for a in allowed)}.")
    return out


def phone(value, field, required=False) -> str:
    out = text(value, field, required=required, max_len=20)
    if out:
        assert_that(bool(PHONE_RE.match(out)), f"{field} must be a valid phone number.")
    return out


def gstin(value, field="GSTIN") -> str:
    out = text(value, field, max_len=15).upper()
    if out:
        assert_that(bool(GSTIN_RE.match(out)), f"{field} must be a valid 15-character GST number.")
    return out


def flag(value) -> int:
    return 1 if value in (True, 1, "1", "true", "True") else 0
