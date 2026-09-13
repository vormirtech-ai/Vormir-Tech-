"""Errors that are safe to show to the person at the counter."""

from __future__ import annotations


class AppError(Exception):
    """Raised for anything the operator can fix — shown verbatim in the UI."""

    expected = True

    def __init__(self, message: str, code: str = "APP_ERROR", details=None):
        super().__init__(message)
        self.message = message
        self.code = code
        self.details = details


def fail(message: str, code: str = "APP_ERROR", details=None):
    raise AppError(message, code, details)


def assert_that(condition, message: str, code: str = "VALIDATION", details=None):
    """`assert` with the meaning kept at runtime — never optimised away."""
    if not condition:
        raise AppError(message, code, details)
