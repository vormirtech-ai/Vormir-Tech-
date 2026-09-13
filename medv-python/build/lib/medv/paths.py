"""
Where MedV keeps its data on this computer.

Windows : %APPDATA%\\MedBillPro
macOS   : ~/Library/Application Support/MedBillPro
Linux   : ~/.config/MedBillPro

Never a temporary directory — the database has to survive a restart.
"""

from __future__ import annotations
import os
import sys
from pathlib import Path

APP_DIR_NAME = "MedBillPro"
_root: Path | None = None


def default_root() -> Path:
    if sys.platform == "win32":
        base = os.environ.get("APPDATA") or (Path.home() / "AppData" / "Roaming")
        return Path(base) / APP_DIR_NAME
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / APP_DIR_NAME
    base = os.environ.get("XDG_CONFIG_HOME") or (Path.home() / ".config")
    return Path(base) / APP_DIR_NAME


def configure(directory=None) -> dict:
    global _root
    _root = Path(directory) if directory else default_root()
    for folder in (data_dir(), backup_dir(), export_dir()):
        folder.mkdir(parents=True, exist_ok=True)
    return paths()


def base() -> Path:
    if _root is None:
        configure()
    return _root


def data_dir() -> Path:
    return base() / "data"


def backup_dir() -> Path:
    return base() / "backups"


def export_dir() -> Path:
    return base() / "exports"


def db_file() -> Path:
    return data_dir() / "medbill.db"


def documents_dir() -> Path:
    """Where a backup goes by default — somewhere the user can find it."""
    candidate = Path.home() / "Documents"
    return candidate if candidate.is_dir() else Path.home()


def paths() -> dict:
    return {
        "root": str(base()),
        "data": str(data_dir()),
        "backups": str(backup_dir()),
        "exports": str(export_dir()),
        "db": str(db_file()),
    }
