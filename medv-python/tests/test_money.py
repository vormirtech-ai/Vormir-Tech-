"""Money and GST arithmetic — the figures a shopkeeper checks by hand."""
import unittest

from tests.helpers import sys  # noqa: F401 - puts the package on the path

from medv.util.dates import add_months, expiry_end_date, financial_year, is_expired
from medv.util.money import amount_in_words, line_totals, r2, round_off, split_gst
from medv.util.validate import expiry


class MoneyTests(unittest.TestCase):
    def test_rounds_half_away_from_zero(self):
        self.assertEqual(r2(0.1 + 0.2), 0.3)
        self.assertEqual(r2(2.675), 2.68)      # not banker's rounding
        self.assertEqual(r2(-2.345), -2.35)
        self.assertEqual(r2("12.005"), 12.01)
        self.assertEqual(r2(None), 0)

    def test_line_totals_match_the_other_editions(self):
        line = line_totals(10, 12.5, 10, 12)
        self.assertEqual(line["taxable"], 112.5)
        self.assertEqual(line["cgst"], 6.75)
        self.assertEqual(line["sgst"], 6.75)
        self.assertEqual(line["total"], 126.0)

    def test_gst_inclusive_rates_are_backed_out(self):
        line = line_totals(1, 112, 0, 12, gst_inclusive=True)
        self.assertEqual(line["taxable"], 100.0)
        self.assertEqual(line["total"], 112.0)

    def test_odd_paisa_splits_without_losing_a_paisa(self):
        gst = split_gst(56.35, 12)
        self.assertEqual(gst["total"], 6.76)
        self.assertEqual(r2(gst["cgst"] + gst["sgst"]), gst["total"])

    def test_inter_state_uses_igst(self):
        gst = split_gst(100, 18, inter_state=True)
        self.assertEqual(gst, {"cgst": 0.0, "sgst": 0.0, "igst": 18.0, "total": 18.0})

    def test_round_off(self):
        self.assertEqual(round_off(63.11), {"total": 63.0, "round_off": -0.11})
        self.assertEqual(round_off(62.5), {"total": 63.0, "round_off": 0.5})

    def test_amount_in_words(self):
        self.assertEqual(amount_in_words(1234.5),
                         "One Thousand Two Hundred Thirty Four Rupees and Fifty Paise Only")
        self.assertEqual(amount_in_words(0), "Zero Rupees Only")
        self.assertEqual(amount_in_words(112345.5),
                         "One Lakh Twelve Thousand Three Hundred Forty Five Rupees and Fifty Paise Only")


class DateTests(unittest.TestCase):
    def test_expiry_runs_to_the_end_of_its_month(self):
        self.assertEqual(expiry_end_date("2027-02"), "2027-02-28")
        self.assertEqual(expiry_end_date("2028-02"), "2028-02-29")
        self.assertEqual(expiry_end_date("2027-12"), "2027-12-31")
        self.assertTrue(is_expired("2020-01"))
        self.assertFalse(is_expired("2099-01"))

    def test_typed_expiry_is_normalised(self):
        self.assertEqual(expiry("6/27", "Expiry"), "2027-06")
        self.assertEqual(expiry("06/2027", "Expiry"), "2027-06")
        with self.assertRaises(Exception):
            expiry("13/2027", "Expiry")

    def test_month_arithmetic_clamps_to_month_end(self):
        self.assertEqual(add_months("2026-01-31", 1), "2026-02-28")
        self.assertEqual(financial_year("2026-09-13")["label"], "2026-27")
        self.assertEqual(financial_year("2026-02-13")["label"], "2025-26")


if __name__ == "__main__":
    unittest.main()
