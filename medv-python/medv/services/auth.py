"""Sign-in and user accounts. Roles are enforced here, not in the interface."""

from __future__ import annotations
from .. import db
from ..util.dates import now_stamp
from ..util.errors import assert_that, fail
from ..util.hashing import hash_password, verify_password
from ..util import validate as v
from . import audit

ROLES = ("admin", "pharmacist", "cashier")


def public_user(row):
    if not row:
        return None
    return {
        "id": row["id"],
        "username": row["username"],
        "name": row["name"],
        "role": row["role"],
        "active": bool(row["active"]),
    }


def login(username=None, password=None, **_):
    name = v.text(username, "Username", required=True, max_len=40).lower()
    assert_that(bool(str(password or "")), "Password is required.")
    row = db.one_row("SELECT * FROM users WHERE lower(username) = ?", (name,))
    if not row or not row["active"] or not verify_password(password, row["pass_hash"], row["pass_salt"]):
        fail("Incorrect username or password.", "AUTH_FAILED")
    audit.log(row, "login", "user", row["id"])
    return public_user(row)


def listing(**_):
    return [public_user(r) for r in db.all_rows("SELECT * FROM users ORDER BY role, name")]


def create(actor, payload):
    require_admin(actor)
    username = v.text(payload.get("username"), "Username", required=True, max_len=40, min_len=3).lower()
    assert_that(all(c.isalnum() or c in "._-" for c in username),
                "Username may use letters, numbers, dot, dash and underscore only.")
    name = v.text(payload.get("name"), "Full name", required=True, max_len=80)
    role = v.one_of(payload.get("role"), "Role", ROLES, "cashier")
    password = str(payload.get("password") or "")
    assert_that(len(password) >= 4, "Password must be at least 4 characters.")
    assert_that(not db.one_row("SELECT id FROM users WHERE lower(username) = ?", (username,)),
                "That username is already taken.")
    secret = hash_password(password)
    info = db.run(
        "INSERT INTO users (username, name, role, pass_hash, pass_salt, active, created_at) "
        "VALUES (?, ?, ?, ?, ?, 1, ?)",
        (username, name, role, secret["hash"], secret["salt"], now_stamp()),
    )
    audit.log(actor, "user.create", "user", info["lastrowid"], {"username": username, "role": role})
    return public_user(db.one_row("SELECT * FROM users WHERE id = ?", (info["lastrowid"],)))


def update(actor, payload):
    require_admin(actor)
    user_id = v.integer(payload.get("id"), "User", required=True, minimum=1)
    row = db.one_row("SELECT * FROM users WHERE id = ?", (user_id,))
    assert_that(row, "That user no longer exists.")
    name = v.text(payload.get("name"), "Full name", required=True, max_len=80)
    role = v.one_of(payload.get("role"), "Role", ROLES, row["role"])
    active = v.flag(payload.get("active", 1))
    if row["role"] == "admin" and (role != "admin" or not active):
        remaining = db.scalar(
            "SELECT COUNT(*) FROM users WHERE role = 'admin' AND active = 1 AND id <> ?", (user_id,), 0)
        assert_that(remaining > 0, "At least one active administrator must remain.")
    db.run("UPDATE users SET name = ?, role = ?, active = ? WHERE id = ?", (name, role, active, user_id))
    if payload.get("password"):
        assert_that(len(str(payload["password"])) >= 4, "Password must be at least 4 characters.")
        secret = hash_password(payload["password"])
        db.run("UPDATE users SET pass_hash = ?, pass_salt = ? WHERE id = ?",
               (secret["hash"], secret["salt"], user_id))
    audit.log(actor, "user.update", "user", user_id, {"name": name, "role": role, "active": active})
    return public_user(db.one_row("SELECT * FROM users WHERE id = ?", (user_id,)))


def change_password(actor, payload):
    assert_that(actor and actor.get("id"), "You must be signed in.")
    row = db.one_row("SELECT * FROM users WHERE id = ?", (actor["id"],))
    assert_that(row, "That user no longer exists.")
    assert_that(verify_password(str(payload.get("currentPassword") or ""), row["pass_hash"], row["pass_salt"]),
                "Current password is incorrect.")
    new_password = str(payload.get("newPassword") or "")
    assert_that(len(new_password) >= 4, "New password must be at least 4 characters.")
    secret = hash_password(new_password)
    db.run("UPDATE users SET pass_hash = ?, pass_salt = ? WHERE id = ?",
           (secret["hash"], secret["salt"], actor["id"]))
    audit.log(actor, "user.password", "user", actor["id"])
    return {"ok": True}


def set_admin_password(password):
    """Used by the setup wizard to replace the default credentials."""
    assert_that(len(str(password or "")) >= 4, "Password must be at least 4 characters.")
    row = db.one_row("SELECT * FROM users WHERE role = 'admin' ORDER BY id LIMIT 1")
    assert_that(row, "No administrator account exists.")
    secret = hash_password(password)
    db.run("UPDATE users SET pass_hash = ?, pass_salt = ? WHERE id = ?",
           (secret["hash"], secret["salt"], row["id"]))
    return public_user(row)


def remove(actor, payload):
    require_admin(actor)
    user_id = v.integer(payload.get("id"), "User", required=True, minimum=1)
    assert_that(user_id != actor.get("id"), "You cannot delete the account you are signed in with.")
    row = db.one_row("SELECT * FROM users WHERE id = ?", (user_id,))
    assert_that(row, "That user no longer exists.")
    if row["role"] == "admin":
        remaining = db.scalar(
            "SELECT COUNT(*) FROM users WHERE role = 'admin' AND active = 1 AND id <> ?", (user_id,), 0)
        assert_that(remaining > 0, "At least one active administrator must remain.")
    db.run("UPDATE users SET active = 0 WHERE id = ?", (user_id,))
    audit.log(actor, "user.deactivate", "user", user_id)
    return {"ok": True}


def require_admin(actor):
    assert_that(actor and actor.get("role") == "admin", "Only an administrator can do that.", "FORBIDDEN")


def require_role(actor, roles):
    assert_that(actor and actor.get("role") in roles,
                "You do not have permission for that action.", "FORBIDDEN")
