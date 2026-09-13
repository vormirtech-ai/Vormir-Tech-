"""
The database: one SQLite file on this computer, opened with the standard
library. Every document is written inside a transaction, so a failure leaves
no half-saved invoice behind.
"""

from __future__ import annotations
import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path

from .migrations import MIGRATIONS
from .util.dates import now_stamp

DEFAULT_SETTINGS = {
    "setup_complete": "0",
    "store_name": "My Medical Store",
    "store_tagline": "Chemist & Druggist",
    "store_address": "",
    "store_city": "",
    "store_state": "Maharashtra",
    "store_pincode": "",
    "store_phone": "",
    "store_email": "",
    "store_gstin": "",
    "store_dl_no": "",
    "store_fssai": "",
    "invoice_prefix": "INV",
    "purchase_prefix": "PUR",
    "sale_return_prefix": "SR",
    "purchase_return_prefix": "PR",
    "expiry_alert_days": "90",
    "low_stock_enabled": "1",
    "default_gst_rate": "12",
    "price_includes_gst": "0",
    "round_off_invoice": "1",
    "print_format": "a5",
    "print_copies": "1",
    "invoice_terms": "Goods once sold will not be taken back without a valid reason. Subject to local jurisdiction.",
    "invoice_footer": "Get well soon — thank you for visiting!",
    "rx_reminder_days": "25",
    "whatsapp_template": ("Hello {name}, this is a friendly reminder from {store} that your medicines "
                          "({medicines}) are due for a refill. Reply to reserve your order."),
    "theme": "light",
    "currency_symbol": "₹",
    "backup_reminder_days": "7",
    "last_backup_at": "",
}

_conn: sqlite3.Connection | None = None
_path: Path | None = None
_depth = 0
_lock = threading.RLock()


def _row_to_dict(cursor, row):
    return {column[0]: row[index] for index, column in enumerate(cursor.description)}


def open_db(path) -> dict:
    """Opens (creating if needed) the database and brings it up to date."""
    global _conn, _path
    if _conn is not None:
        close()
    _path = Path(path)
    _path.parent.mkdir(parents=True, exist_ok=True)
    _conn = sqlite3.connect(str(_path), check_same_thread=False, isolation_level=None)
    _conn.row_factory = _row_to_dict
    _conn.execute("PRAGMA journal_mode = WAL")
    _conn.execute("PRAGMA synchronous = FULL")
    _conn.execute("PRAGMA foreign_keys = ON")
    _conn.execute("PRAGMA busy_timeout = 5000")
    migration = migrate()
    seed_defaults()
    return {"file": str(_path), **migration}


def get() -> sqlite3.Connection:
    if _conn is None:
        raise RuntimeError("Database is not open. Call open_db(path) first.")
    return _conn


def file() -> str:
    return str(_path) if _path else ""


def is_open() -> bool:
    return _conn is not None


def close():
    global _conn
    if _conn is not None:
        try:
            _conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        except sqlite3.Error:
            pass
        _conn.close()
    _conn = None


# --------------------------------------------------------------- statements
def all_rows(sql: str, params=()) -> list[dict]:
    with _lock:
        return list(get().execute(sql, params))


def one_row(sql: str, params=()):
    with _lock:
        cursor = get().execute(sql, params)
        return cursor.fetchone()


def run(sql: str, params=()) -> dict:
    with _lock:
        cursor = get().execute(sql, params)
        return {"lastrowid": cursor.lastrowid, "changes": cursor.rowcount}


def script(sql: str):
    with _lock:
        get().executescript(sql)


def scalar(sql: str, params=(), default=None):
    row = one_row(sql, params)
    if not row:
        return default
    value = next(iter(row.values()), default)
    return default if value is None else value


@contextmanager
def tx():
    """
    Everything inside commits together, or nothing does. Nested blocks use a
    savepoint so an inner failure does not abandon the outer document.
    """
    global _depth
    with _lock:
        conn = get()
        nested = _depth > 0
        name = f"sp_{_depth}"
        conn.execute(f"SAVEPOINT {name}" if nested else "BEGIN IMMEDIATE")
        _depth += 1
        try:
            yield conn
        except BaseException:
            _depth -= 1
            try:
                if nested:
                    conn.execute(f"ROLLBACK TO {name}")
                    conn.execute(f"RELEASE {name}")
                else:
                    conn.execute("ROLLBACK")
            except sqlite3.Error:
                pass
            raise
        else:
            _depth -= 1
            conn.execute(f"RELEASE {name}" if nested else "COMMIT")


# ---------------------------------------------------------------- migrations
def migrate() -> dict:
    current = int(scalar("PRAGMA user_version", default=0) or 0)
    pending = [m for m in MIGRATIONS if m["version"] > current]
    conn = get()
    for migration in sorted(pending, key=lambda m: m["version"]):
        # executescript() commits whatever is open before it runs, so the
        # transaction has to live inside the script itself.
        conn.executescript(
            "BEGIN;\n"
            + migration["sql"]
            + f"\nPRAGMA user_version = {migration['version']};\nCOMMIT;"
        )
    return {"from": current, "to": int(scalar("PRAGMA user_version", default=0) or 0), "applied": len(pending)}


def seed_defaults():
    """Default settings, document counters and the initial Admin account."""
    from .util.hashing import hash_password

    with tx() as conn:
        for key, value in DEFAULT_SETTINGS.items():
            conn.execute("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)", (key, value))
        for name in ("invoice", "purchase", "sale_return", "purchase_return"):
            conn.execute("INSERT OR IGNORE INTO counters (name, value) VALUES (?, 0)", (name,))
        users = conn.execute("SELECT COUNT(*) AS n FROM users").fetchone()["n"]
        if users == 0:
            # First launch. The setup wizard makes the operator replace this.
            secret = hash_password("admin123")
            conn.execute(
                "INSERT INTO users (username, name, role, pass_hash, pass_salt, active, created_at) "
                "VALUES ('admin', 'Administrator', 'admin', ?, ?, 1, ?)",
                (secret["hash"], secret["salt"], now_stamp()),
            )
