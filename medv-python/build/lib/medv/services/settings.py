"""Shop profile, invoice preferences and document numbering."""

from __future__ import annotations
from .. import db
from ..util.errors import assert_that
from ..util import validate as v
from . import audit, auth

EDITABLE = set(db.DEFAULT_SETTINGS)


def all_settings() -> dict:
    out = dict(db.DEFAULT_SETTINGS)
    for row in db.all_rows("SELECT key, value FROM settings"):
        out[row["key"]] = row["value"]
    return out


def get(key: str, fallback: str = "") -> str:
    row = db.one_row("SELECT value FROM settings WHERE key = ?", (key,))
    if row:
        return row["value"]
    return db.DEFAULT_SETTINGS.get(key, fallback)


def num(key: str, fallback: float = 0) -> float:
    try:
        return float(get(key, str(fallback)))
    except (TypeError, ValueError):
        return fallback


def flag(key: str) -> bool:
    return get(key) == "1"


def put(key: str, value):
    db.run(
        "INSERT INTO settings (key, value) VALUES (?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, "" if value is None else str(value)),
    )


def save(actor, payload: dict) -> dict:
    auth.require_role(actor, ("admin", "pharmacist"))
    assert_that(isinstance(payload, dict) and payload, "Nothing to save.")
    if payload.get("store_gstin"):
        v.gstin(payload["store_gstin"])
    if payload.get("store_phone"):
        v.phone(payload["store_phone"], "Phone")
    written = 0
    with db.tx():
        for key, value in payload.items():
            if key in EDITABLE:
                put(key, value)
                written += 1
    audit.log(actor, "settings.save", "settings", None, ",".join(payload))
    return {"saved": written, "settings": all_settings()}


def store_profile() -> dict:
    s = all_settings()
    return {
        "name": s["store_name"],
        "tagline": s["store_tagline"],
        "address": s["store_address"],
        "city": s["store_city"],
        "state": s["store_state"],
        "pincode": s["store_pincode"],
        "phone": s["store_phone"],
        "email": s["store_email"],
        "gstin": s["store_gstin"],
        "dl_no": s["store_dl_no"],
        "fssai": s["store_fssai"],
        "currency": s["currency_symbol"],
        "terms": s["invoice_terms"],
        "footer": s["invoice_footer"],
        "printFormat": s["print_format"],
    }


def next_number(counter: str, prefix_key: str) -> str:
    """Allocates the next document number inside the caller's transaction."""
    db.run("INSERT OR IGNORE INTO counters (name, value) VALUES (?, 0)", (counter,))
    db.run("UPDATE counters SET value = value + 1 WHERE name = ?", (counter,))
    value = db.scalar("SELECT value FROM counters WHERE name = ?", (counter,), 1)
    return f"{get(prefix_key, 'DOC')}-{int(value):04d}"
