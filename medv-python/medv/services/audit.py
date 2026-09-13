"""Who did what, kept on this computer."""

from __future__ import annotations
import json

from .. import db
from ..util.dates import now_stamp


def log(actor, action, entity=None, entity_id=None, detail=None):
    text = None
    if detail is not None:
        text = detail if isinstance(detail, str) else json.dumps(detail, default=str)
    db.run(
        "INSERT INTO audit_log (at, user_id, username, action, entity, entity_id, detail) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (
            now_stamp(),
            (actor or {}).get("id"),
            (actor or {}).get("username", "system"),
            action,
            entity,
            None if entity_id is None else str(entity_id),
            text,
        ),
    )


def listing(from_date=None, to_date=None, limit=300, **_):
    where, params = [], []
    if from_date:
        where.append("at >= ?")
        params.append(f"{from_date} 00:00:00")
    if to_date:
        where.append("at <= ?")
        params.append(f"{to_date} 23:59:59")
    clause = f"WHERE {' AND '.join(where)}" if where else ""
    params.append(min(int(limit or 300), 2000))
    return db.all_rows(f"SELECT * FROM audit_log {clause} ORDER BY id DESC LIMIT ?", params)
