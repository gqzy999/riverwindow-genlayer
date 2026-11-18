# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *
from datetime import date, timedelta
import json
import re

STATIONS = {"01646500", "01491000", "01638500"}
BASE = "https://api.waterdata.usgs.gov/ogcapi/v1/collections/daily/items"


def window_days(start):
    if not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", start):
        raise ValueError("INVALID_DATE")
    first = date.fromisoformat(start)
    return [(first + timedelta(days=i)).isoformat() for i in range(3)]


def source_url(station, days):
    return (BASE + "?f=json&monitoring_location_id=USGS-" + station
            + "&parameter_code=00060&statistic_id=00003&datetime="
            + days[0] + "%2F" + days[-1] + "&limit=20")


def milliflow(raw):
    if not isinstance(raw, str) or not re.fullmatch(r"[0-9]{1,8}(\.[0-9]{1,3})?", raw):
        raise ValueError("INVALID_FLOW")
    whole, _, fractional = raw.partition(".")
    return 1000 * int(whole) + int(fractional.ljust(3, "0"))


def normalize(payload, station, days):
    if payload.get("type") != "FeatureCollection":
        raise ValueError("INVALID_SOURCE")
    if any(link.get("rel") == "next" for link in payload.get("links", [])):
        raise ValueError("PAGINATED_SOURCE")
    rows = {}
    for item in payload["features"]:
        p = item["properties"]
        day = p["time"]
        if day not in days:
            continue
        if (day in rows or p["monitoring_location_id"] != "USGS-" + station
                or p["parameter_code"] != "00060" or p["statistic_id"] != "00003"
                or p["unit_of_measure"] != "ft^3/s"):
            raise ValueError("AMBIGUOUS_SOURCE")
        rows[day] = None
        if p["approval_status"] == "Approved" and not p.get("qualifier"):
            rows[day] = milliflow(p["value"])
    return [rows.get(day) for day in days]


def outcome(values, threshold):
    if any(value is None for value in values):
        return "AWAITING_DATA"
    hits = [value >= threshold * 1000 for value in values]
    return "REVIEW_REQUIRED" if (hits[0] and hits[1]) or (hits[1] and hits[2]) else "RULE_NOT_MET"


@allow_storage
class RiverWindow(gl.Contract):
    records: TreeMap[str, str]

    def __init__(self):
        pass

    @gl.public.view
    def get_window(self, key: str) -> str:
        return self.records.get(key, "")

    @gl.public.write
    def register(self, slug: str, station: str, start: str, threshold: u32, reviewer: str) -> None:
        owner = str(gl.message.sender_address).lower()
        if not re.fullmatch(r"[a-z0-9-]{3,40}", slug) or station not in STATIONS:
            raise gl.vm.UserError("INVALID_WINDOW")
        if not 0 < int(threshold) <= 1000000:
            raise gl.vm.UserError("INVALID_THRESHOLD")
        reviewer = reviewer.lower()
        if not re.fullmatch(r"0x[0-9a-f]{40}", reviewer) or reviewer in (owner, "0x" + "0" * 40):
            raise gl.vm.UserError("DISTINCT_REVIEWER_REQUIRED")
        try:
            days = window_days(start)
        except (ValueError, OverflowError):
            raise gl.vm.UserError("INVALID_DATE")
        key = owner + "/" + slug
        if key in self.records:
            raise gl.vm.UserError("WINDOW_EXISTS")
        record = dict(key=key, owner=owner, station=station, days=days,
                      threshold=int(threshold), source=source_url(station, days),
                      status="AWAITING_DATA", readings=None, reviewer=reviewer, note=None,
                      evaluated_by=None, acknowledged_by=None)
        self.records[key] = json.dumps(record)

    @gl.public.write
    def evaluate(self, key: str) -> None:
        record = json.loads(self.records.get(key, "null"))
        if record is None or record["status"] != "AWAITING_DATA":
            raise gl.vm.UserError("WINDOW_NOT_PENDING")

        def retrieve():
            response = gl.nondet.web.get(record["source"])
            if response.status != 200:
                return "SOURCE_UNAVAILABLE"
            try:
                return json.dumps(normalize(json.loads(response.body), record["station"], record["days"]))
            except (ValueError, KeyError, TypeError):
                return "SOURCE_INVALID"

        def validate(leader):
            return gl.vm.unpack_result(leader) == retrieve()

        result = gl.vm.run_nondet_unsafe(retrieve, validate)
        if result in ("SOURCE_UNAVAILABLE", "SOURCE_INVALID"):
            raise gl.vm.UserError(result)
        values = json.loads(result)
        record["status"] = outcome(values, record["threshold"])
        if record["status"] == "AWAITING_DATA":
            raise gl.vm.UserError("APPROVED_DATA_INCOMPLETE")
        record["readings"] = values
        record["evaluated_by"] = str(gl.message.sender_address).lower()
        self.records[key] = json.dumps(record)

    @gl.public.write
    def acknowledge(self, key: str, note: str) -> None:
        record = json.loads(self.records.get(key, "null"))
        reviewer = str(gl.message.sender_address).lower()
        if record is None or record["status"] != "REVIEW_REQUIRED":
            raise gl.vm.UserError("NO_REVIEW_REQUIRED")
        if reviewer != record["reviewer"] or not 10 <= len(note.strip()) <= 300:
            raise gl.vm.UserError("INDEPENDENT_REVIEW_NOTE_REQUIRED")
        record.update(status="ACKNOWLEDGED", note=note.strip(), acknowledged_by=reviewer)
        self.records[key] = json.dumps(record)
