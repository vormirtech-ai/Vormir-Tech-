"""
Money and GST arithmetic.

Every amount is rounded half-up to the paisa, the way a shop does it — not
with Python's default banker's rounding, which would turn 2.675 into 2.67.
The figures here match the JavaScript edition exactly, so a database moved
between the two adds up the same.
"""

from __future__ import annotations
from decimal import Decimal, ROUND_HALF_UP

_CENT = Decimal("0.01")
_MILLI = Decimal("0.001")


def _dec(value) -> Decimal:
    if isinstance(value, Decimal):
        return value
    try:
        return Decimal(str(value if value is not None else 0))
    except Exception:
        return Decimal(0)


def r2(value) -> float:
    """Round to 2 decimals, half away from zero."""
    return float(_dec(value).quantize(_CENT, rounding=ROUND_HALF_UP))


def r3(value) -> float:
    """Round to 3 decimals — per-unit rates derived from a pack rate."""
    return float(_dec(value).quantize(_MILLI, rounding=ROUND_HALF_UP))


def num(value, fallback: float = 0.0) -> float:
    try:
        out = float(value)
    except (TypeError, ValueError):
        return fallback
    return out if out == out and abs(out) != float("inf") else fallback


def as_int(value, fallback: int = 0) -> int:
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return fallback


def split_gst(taxable, rate, inter_state: bool = False) -> dict:
    """Splits tax into CGST/SGST halves, or IGST for an inter-state supply."""
    tax = r2(num(taxable) * num(rate) / 100)
    if inter_state:
        return {"cgst": 0.0, "sgst": 0.0, "igst": tax, "total": tax}
    cgst = r2(tax / 2)
    sgst = r2(tax - cgst)
    return {"cgst": cgst, "sgst": sgst, "igst": 0.0, "total": r2(cgst + sgst)}


def line_totals(qty, rate, disc_pct=0, gst_rate=0, inter_state=False, gst_inclusive=False) -> dict:
    """The line maths shared by sales, purchases and returns."""
    gross = r2(num(qty) * num(rate))
    discount = r2(gross * num(disc_pct) / 100)
    taxable = r2(gross - discount)
    if gst_inclusive:
        taxable = r2(taxable * 100 / (100 + num(gst_rate)))
    gst = split_gst(taxable, gst_rate, inter_state)
    return {
        "gross": gross,
        "discount": discount,
        "taxable": taxable,
        "cgst": gst["cgst"],
        "sgst": gst["sgst"],
        "igst": gst["igst"],
        "gst_amount": gst["total"],
        "total": r2(taxable + gst["total"]),
    }


def round_off(total) -> dict:
    """Nearest-rupee round off for the invoice total."""
    value = r2(total)
    rounded = float(Decimal(str(value)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    return {"total": rounded, "round_off": r2(rounded - value)}


_ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
         "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen",
         "Eighteen", "Nineteen"]
_TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"]


def _two_digit(n: int) -> str:
    if n < 20:
        return _ONES[n]
    tens, ones = _TENS[n // 10], _ONES[n % 10]
    return f"{tens} {ones}" if ones else tens


def amount_in_words(amount) -> str:
    """Indian-system amount in words, for the invoice footer."""
    value = r2(abs(num(amount)))
    rupees = int(value)
    paise = int(round((value - rupees) * 100))
    if rupees == 0 and paise == 0:
        return "Zero Rupees Only"
    chunks = []
    for divisor, label in ((10000000, "Crore"), (100000, "Lakh"), (1000, "Thousand"), (100, "Hundred")):
        count = rupees // divisor
        if count:
            head = _two_digit(count) if count < 100 else amount_in_words(count).replace(" Rupees Only", "")
            chunks.append(f"{head} {label}")
            rupees -= count * divisor
    if rupees:
        chunks.append(_two_digit(rupees))
    out = " ".join(chunks).strip() + " Rupees"
    if paise:
        out += f" and {_two_digit(paise)} Paise"
    prefix = "Minus " if num(amount) < 0 else ""
    return f"{prefix}{out} Only".replace("  ", " ")
