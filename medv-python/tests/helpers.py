"""Shared set-up: a throwaway database for each test module."""
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from medv import api, db, paths  # noqa: E402


def fresh_database():
    folder = tempfile.mkdtemp(prefix="medv-test-")
    paths.configure(folder)
    db.open_db(paths.db_file())
    api.set_session(None)
    return Path(folder)


def call(channel, payload=None):
    return api.handle(channel, payload or {})
