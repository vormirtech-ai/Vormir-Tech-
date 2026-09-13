"""
Backup and restore.

A backup is the whole SQLite file, written with SQLite's own online backup API
so it can be taken while the shop is billing. The file is interchangeable with
the JavaScript editions of MedV.
"""

from __future__ import annotations
import shutil
import sqlite3
from pathlib import Path

from .. import db, paths
from ..util.dates import now_stamp, today
from ..util.errors import assert_that, fail
from . import audit, auth, settings

KEEP_AUTO_BACKUPS = 10


def _stamp() -> str:
    return now_stamp().replace(":", "-").replace(" ", "-")


def suggested_name(**_) -> dict:
    return {"name": f"MedBillPro_Backup_{today()}.db"}


def _write_copy(target: Path) -> int:
    target.parent.mkdir(parents=True, exist_ok=True)
    destination = sqlite3.connect(str(target))
    try:
        db.get().backup(destination)
    finally:
        destination.close()
    return target.stat().st_size


def create(actor, payload=None):
    payload = payload or {}
    auth.require_role(actor, ("admin", "pharmacist"))
    target_path = payload.get("targetPath")
    if target_path:
        target = Path(target_path)
        if target.is_dir():
            target = target / suggested_name()["name"]
    else:
        target = paths.backup_dir() / f"MedBillPro_Backup_{_stamp()}.db"
    size = _write_copy(target)
    settings.put("last_backup_at", now_stamp())
    audit.log(actor, "backup.create", "backup", None, {"target": str(target), "size": size})
    return {"path": str(target), "name": target.name, "size": size, "at": now_stamp()}


def auto(reason: str = "auto"):
    """A rolling copy inside the app folder; the newest ten are kept."""
    target = paths.backup_dir() / f"auto_{_stamp()}.db"
    size = _write_copy(target)
    stale = sorted(paths.backup_dir().glob("auto_*.db"), reverse=True)[KEEP_AUTO_BACKUPS:]
    for old in stale:
        try:
            old.unlink()
        except OSError:
            pass
    settings.put("last_backup_at", now_stamp())
    audit.log({"username": "system"}, "backup.auto", "backup", None, {"target": str(target), "reason": reason})
    return {"path": str(target), "size": size}


def listing(**_):
    folder = paths.backup_dir()
    if not folder.exists():
        return []
    rows = []
    for item in folder.glob("*.db"):
        stat = item.stat()
        rows.append({
            "name": item.name,
            "path": str(item),
            "size": stat.st_size,
            "modified": now_stamp_from(stat.st_mtime),
            "kind": "auto" if item.name.startswith("auto_") or item.name.startswith("before_restore_") else "manual",
        })
    return sorted(rows, key=lambda r: r["modified"], reverse=True)


def now_stamp_from(epoch: float) -> str:
    from datetime import datetime
    return datetime.fromtimestamp(epoch).isoformat(timespec="seconds")


def inspect(sourcePath=None, **_):
    """Reads a candidate file and reports whether it is one of our databases."""
    assert_that(sourcePath and Path(sourcePath).exists(), "That backup file could not be found.")
    source = Path(sourcePath)
    assert_that(source.is_file() and source.stat().st_size > 0, "That backup file is empty.")
    probe = None
    try:
        probe = sqlite3.connect(f"file:{source}?mode=ro", uri=True)
        probe.row_factory = sqlite3.Row
        tables = {r[0] for r in probe.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
        missing = [t for t in ("settings", "products", "batches", "sales", "sale_items") if t not in tables]
        assert_that(not missing, f"That file is not a MedV backup (missing: {', '.join(missing)}).")
        counts = {
            "products": probe.execute("SELECT COUNT(*) FROM products").fetchone()[0],
            "sales": probe.execute("SELECT COUNT(*) FROM sales").fetchone()[0],
            "customers": probe.execute("SELECT COUNT(*) FROM customers").fetchone()[0],
        }
        store_row = probe.execute("SELECT value FROM settings WHERE key = 'store_name'").fetchone()
        last_sale = probe.execute("SELECT MAX(date) FROM sales").fetchone()[0]
        return {
            "path": str(source),
            "size": source.stat().st_size,
            "modified": now_stamp_from(source.stat().st_mtime),
            "version": probe.execute("PRAGMA user_version").fetchone()[0],
            "counts": counts,
            "storeName": store_row[0] if store_row else "",
            "lastSale": last_sale,
        }
    except sqlite3.DatabaseError:
        fail("That file could not be opened as a database. It may be damaged or not a backup file.",
             "BAD_BACKUP")
    finally:
        if probe is not None:
            probe.close()
    return None


def restore(actor, payload):
    """
    Replaces the live database with a backup. The current data is always copied
    aside first, so a restore can itself be undone.
    """
    auth.require_admin(actor)
    source = payload.get("sourcePath")
    info = inspect(sourcePath=source)
    assert_that(payload.get("confirm") is True,
                "Restoring replaces all current data. Please confirm to continue.", "CONFIRM_REQUIRED")

    safety = paths.backup_dir() / f"before_restore_{_stamp()}.db"
    _write_copy(safety)
    audit.log(actor, "backup.restore.start", "backup", None,
              {"sourcePath": source, "safety": str(safety)})

    live = paths.db_file()
    db.close()
    try:
        shutil.copyfile(source, live)
        for suffix in ("-wal", "-shm"):
            sidecar = Path(str(live) + suffix)
            if sidecar.exists():
                sidecar.unlink()
    except OSError as error:
        # Put the shop back exactly as it was before giving up.
        try:
            shutil.copyfile(safety, live)
        except OSError:
            pass
        db.open_db(live)
        fail(f"The restore could not be completed ({error}). Your existing data has been kept.",
             "RESTORE_FAILED")
    opened = db.open_db(live)
    audit.log(actor, "backup.restore.done", "backup", None,
              {"sourcePath": source, "safety": str(safety), "opened": opened})
    return {"ok": True, "restoredFrom": source, "safetyCopy": str(safety), "info": info, "db": opened}


def status(**_):
    files = listing()
    last = settings.get("last_backup_at")
    database = paths.db_file()
    size = database.stat().st_size if database.exists() else 0
    days = int(settings.num("backup_reminder_days", 7) or 7)
    overdue = True
    if last:
        try:
            from datetime import datetime
            age = (datetime.now() - datetime.fromisoformat(last.replace(" ", "T"))).days
            overdue = age >= days
        except ValueError:
            overdue = True
    return {
        "paths": paths.paths(),
        "dbSize": size,
        "lastBackupAt": last,
        "backups": files[:20],
        "count": len(files),
        "overdue": overdue,
        "documents": str(paths.documents_dir()),
    }


def clear_transactions(actor, payload):
    """Wipes transactions but keeps masters — used by 'clear test data'."""
    auth.require_admin(actor)
    assert_that(payload.get("confirm") is True, "Please confirm before clearing data.", "CONFIRM_REQUIRED")
    keep_masters = payload.get("keepMasters", True)
    with db.tx():
        # Children before parents — foreign keys stay enforced throughout.
        for table in ("payments", "doctor_commissions", "rx_reminders", "stock_adjustments",
                      "sale_return_items", "sale_returns", "purchase_return_items", "purchase_returns",
                      "sale_items", "sales", "purchase_items", "purchases", "expenses", "ledger"):
            db.run(f"DELETE FROM {table}")
        db.run("UPDATE batches SET qty_units = 0")
        if not keep_masters:
            for table in ("batches", "products", "customers", "doctors", "suppliers"):
                db.run(f"DELETE FROM {table}")
        db.run("UPDATE counters SET value = 0")
        audit.log(actor, "data.clear", "database", None, {"keepMasters": keep_masters})
        return {"ok": True}
