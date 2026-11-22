"""Unit tests for scripts/refresh_data.py. Run: python3 -m unittest discover -s test"""
import datetime as dt
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import refresh_data as rd  # noqa: E402


def ts(y, m, d):
    return int(dt.datetime(y, m, d, 12, tzinfo=dt.timezone.utc).timestamp())


class Months(unittest.TestCase):
    def test_wraps_year(self):
        m = rd.last_12_months(dt.date(2026, 11, 21))
        self.assertEqual(len(m), 12)
        self.assertEqual(m[0], "2025-12")
        self.assertEqual(m[-1], "2026-11")

    def test_january(self):
        m = rd.last_12_months(dt.date(2027, 1, 3))
        self.assertEqual(m[0], "2026-02")
        self.assertEqual(m[-1], "2027-01")


class Revenue(unittest.TestCase):
    def test_sums_charges_minus_refunds_and_ignores_other_types(self):
        today = dt.date(2026, 11, 21)
        months = rd.last_12_months(today)
        txns = [
            {"type": "charge", "amount": 1000, "currency": "cad", "created": ts(2026, 11, 10)},
            {"type": "payment", "amount": 500, "currency": "cad", "created": ts(2026, 11, 1)},
            {"type": "refund", "amount": -300, "currency": "cad", "created": ts(2026, 11, 12)},
            {"type": "payout", "amount": -5000, "currency": "cad", "created": ts(2026, 11, 13)},
            {"type": "stripe_fee", "amount": -50, "currency": "cad", "created": ts(2026, 11, 13)},
            {"type": "charge", "amount": 700, "currency": "cad", "created": ts(2026, 3, 2)},
            {"type": "charge", "amount": 999, "currency": "cad", "created": ts(2025, 6, 2)},
        ]
        out = rd.aggregate_revenue(txns, months, today)
        by = dict(out["months"])
        self.assertEqual(out["currency"], "cad")
        self.assertEqual(by["2026-11"], 1200)
        self.assertEqual(by["2026-03"], 700)
        self.assertEqual(sum(by.values()), 1900)
        self.assertEqual(out["last30"], 1200)

    def test_empty_account(self):
        out = rd.aggregate_revenue([], rd.last_12_months(dt.date(2026, 11, 21)), dt.date(2026, 11, 21))
        self.assertEqual(out["last30"], 0)
        self.assertEqual(len(out["months"]), 12)


class Env(unittest.TestCase):
    def test_keys_by_product(self):
        env = {"STRIPE_KEY_INVITEO": "rk_x", "STRIPE_KEY_CREATORPAY": " ", "PATH": "/bin"}
        self.assertEqual(rd.stripe_keys_from_env(env), {"inviteo": "rk_x"})


class Calendar(unittest.TestCase):
    def test_flattens_weeks(self):
        cal = {"totalContributions": 3, "weeks": [
            {"contributionDays": [{"date": "2026-11-01", "contributionCount": 1}]},
            {"contributionDays": [{"date": "2026-11-08", "contributionCount": 2}]},
        ]}
        self.assertEqual(rd.contributions_from_calendar(cal),
                         {"total": 3, "days": [["2026-11-01", 1], ["2026-11-08", 2]]})


if __name__ == "__main__":
    unittest.main()
