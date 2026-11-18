from pathlib import Path
import types
import unittest

source = Path("contracts/riverwindow.py").read_text()
rules = types.ModuleType("rules")
exec(source.split("@allow_storage")[0].replace("from genlayer import *", ""), rules.__dict__)


class RulesTest(unittest.TestCase):
    def test_window_crosses_month(self):
        self.assertEqual(rules.window_days("2024-02-28"), ["2024-02-28", "2024-02-29", "2024-03-01"])

    def test_invalid_date(self):
        with self.assertRaises(ValueError):
            rules.window_days("2025-02-29")

    def test_inclusive_and_consecutive(self):
        self.assertEqual(rules.outcome([999, 1000, 1001], 1), "REVIEW_REQUIRED")
        self.assertEqual(rules.outcome([1000, 999, 1001], 1), "RULE_NOT_MET")
        self.assertEqual(rules.outcome([1000, None, 1001], 1), "AWAITING_DATA")

    def test_rejects_ambiguous_rows(self):
        row = {"properties": dict(time="2025-07-01", monitoring_location_id="USGS-01646500",
                                    parameter_code="00060", statistic_id="00003",
                                    unit_of_measure="ft^3/s", approval_status="Approved",
                                    qualifier=None, value="9360.1")}
        payload = dict(type="FeatureCollection", features=[row])
        days = rules.window_days("2025-07-01")
        self.assertEqual(rules.normalize(payload, "01646500", days), [9360100, None, None])
        payload["features"].append(row)
        with self.assertRaises(ValueError):
            rules.normalize(payload, "01646500", days)
