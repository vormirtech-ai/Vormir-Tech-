"""
Password hashing.

PBKDF2-HMAC-SHA256 with the same parameters as the JavaScript edition, so a
database can move between the Python, desktop and web builds and everyone can
still sign in. Nothing here reaches the network.
"""

from __future__ import annotations
import hashlib
import hmac
import secrets

ITERATIONS = 15000
KEY_BYTES = 32


def derive(password: str, salt_hex: str, iterations: int = ITERATIONS, key_bytes: int = KEY_BYTES) -> str:
    salt = bytes.fromhex(salt_hex)
    return hashlib.pbkdf2_hmac("sha256", str(password).encode("utf-8"), salt, iterations, key_bytes).hex()


def hash_password(password: str, salt_hex: str | None = None) -> dict:
    salt = salt_hex or secrets.token_hex(16)
    return {"hash": derive(password, salt), "salt": salt}


def verify_password(password: str, expected_hash: str, salt_hex: str) -> bool:
    if not expected_hash or not salt_hex:
        return False
    try:
        candidate = derive(password, salt_hex)
    except ValueError:
        return False
    return hmac.compare_digest(candidate, str(expected_hash))
