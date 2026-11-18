import json
from pathlib import Path
import sys
from types import ModuleType, SimpleNamespace
from unittest import TestCase
from unittest.mock import patch

OWNER = "0x" + "1" * 40
REVIEWER = "0x" + "2" * 40


class ContractTest(TestCase):
    def setUp(self):
        def identity(function):
            return function

        def consensus(leader, validator):
            value = leader()
            if not validator(value):
                raise ValueError("VALIDATORS_DISAGREE")
            return value

        self.fetches = 0
        self.payload = self.make_payload()
        self.message = SimpleNamespace(sender_address=OWNER)
        self.host = ModuleType("genlayer")
        self.host.gl = SimpleNamespace(
            Contract=object, message=self.message,
            public=SimpleNamespace(write=identity, view=identity),
            vm=SimpleNamespace(UserError=ValueError, unpack_result=identity, run_nondet_unsafe=consensus),
            nondet=SimpleNamespace(web=SimpleNamespace(get=self.fetch)),
        )
        self.host.allow_storage = identity
        self.host.TreeMap = dict
        self.host.u32 = int
        scope = {}
        with patch.dict(sys.modules, {"genlayer": self.host}):
            exec(Path("contracts/riverwindow.py").read_text(), scope)
        self.contract = scope["RiverWindow"]()
        self.contract.records = {}
        self.key = OWNER + "/test-window"
        self.contract.register("test-window", "01646500", "2025-07-01", 10000, REVIEWER)

    def make_payload(self):
        return {"type": "FeatureCollection", "features": [
            {"properties": dict(time=f"2025-07-0{i}", monitoring_location_id="USGS-01646500",
                                parameter_code="00060", statistic_id="00003", unit_of_measure="ft^3/s",
                                approval_status="Approved", qualifier=None, value=value)}
            for i, value in enumerate(("9360", "11200", "12400"), 1)
        ]}

    def fetch(self, url):
        self.fetches += 1
        self.assertIn("datetime=2025-07-01%2F2025-07-03", url)
        return SimpleNamespace(status=200, body=json.dumps(self.payload).encode())

    def status(self):
        return json.loads(self.contract.get_window(self.key))["status"]

    def test_review_requires_assigned_wallet(self):
        self.contract.evaluate(self.key)
        self.assertEqual(self.fetches, 2)
        self.assertEqual(self.status(), "REVIEW_REQUIRED")
        with self.assertRaisesRegex(ValueError, "INDEPENDENT_REVIEW"):
            self.contract.acknowledge(self.key, "Flow was reviewed")
        self.message.sender_address = REVIEWER
        self.contract.acknowledge(self.key, "Flow was reviewed")
        self.assertEqual(self.status(), "ACKNOWLEDGED")

    def test_incomplete_data_can_be_retried(self):
        self.payload["features"].pop()
        with self.assertRaisesRegex(ValueError, "APPROVED_DATA_INCOMPLETE"):
            self.contract.evaluate(self.key)
        self.assertEqual(self.status(), "AWAITING_DATA")
        self.payload = self.make_payload()
        self.contract.evaluate(self.key)
        self.assertEqual(self.status(), "REVIEW_REQUIRED")

    def test_duplicate_registration_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "WINDOW_EXISTS"):
            self.contract.register("test-window", "01646500", "2025-07-01", 10000, REVIEWER)
