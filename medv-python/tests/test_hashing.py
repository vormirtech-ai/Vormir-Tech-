"""Passwords must hash identically in every edition of MedV."""
import unittest

from tests.helpers import sys  # noqa: F401

from medv.util.hashing import ITERATIONS, derive, hash_password, verify_password


class HashingTests(unittest.TestCase):
    def test_known_vector_matches_the_javascript_editions(self):
        # Same PBKDF2-HMAC-SHA256 parameters as the Electron and web builds, so
        # a database moved between them still accepts the same passwords.
        self.assertEqual(ITERATIONS, 15000)
        self.assertEqual(
            derive("shop@2026", "a1b2c3d4e5f60718293a4b5c6d7e8f90"),
            "5a981d0a48565e5a217df936174e8f34d4b40a6914b1661dfdaa6b6de73aebfd",
        )

    def test_round_trip(self):
        secret = hash_password("shop@2026")
        self.assertEqual(len(secret["hash"]), 64)
        self.assertEqual(len(secret["salt"]), 32)
        self.assertTrue(verify_password("shop@2026", secret["hash"], secret["salt"]))
        self.assertFalse(verify_password("shop@2025", secret["hash"], secret["salt"]))
        self.assertFalse(verify_password("", secret["hash"], secret["salt"]))

    def test_salt_makes_every_hash_different(self):
        self.assertNotEqual(hash_password("same")["hash"], hash_password("same")["hash"])

    def test_a_damaged_record_is_rejected_rather_than_crashing(self):
        self.assertFalse(verify_password("x", "not-hex", "also-not-hex"))
        self.assertFalse(verify_password("x", "", ""))


if __name__ == "__main__":
    unittest.main()
