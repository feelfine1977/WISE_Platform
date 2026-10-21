"""Qualify #50 in the built browser: Compare and Expectation are actionable during first use.

The service starts over an empty workspace, and the built browser reads the packaged example S0 through the ordinary
operations. At 1366 x 768, while the example's incidents are opened, both areas say so and offer the investigation; then a
reviewed timing expectation is checked and scored by the method library and kept and removed incidents are compared, on
that exact workspace, preparation and population, as tests/fixtures/first-use/expected.json says; a failed new score or
comparison keeps the previous one and says so. A second synthetic file (tests/fixtures/comparisons) is then read over HTTP,
and at 760 x 900, by the keyboard alone, a failure to open the incidents is named with a working Try again, the example is
scored again and two start periods of the second file are compared. The receipt holds checks only.

    python tools/qualify_first_use_areas.py --output receipt.json --node node --playwright .../index.mjs --chrome ...
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "tools")]

from capacity_journey import Service  # noqa: E402
from qualify_full_sources import build_is_current, keep_awake, provenance  # noqa: E402
from qualify_local_ymd_sample import policies  # noqa: E402  (the registered policies of every role but time)

EXPECTED = ROOT / "tests/fixtures/first-use/expected.json"
PERIODS = ROOT / "tests/fixtures/comparisons"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--node", required=True)
    parser.add_argument("--playwright", required=True)
    parser.add_argument("--chrome", required=True)
    args = parser.parse_args()
    if not build_is_current():
        print(json.dumps({"status": "refused", "reason": "the browser build is older than the web sources; run npm run build"}))
        return 1
    keep_awake()
    folder = Path(tempfile.mkdtemp(prefix="wise-first-use-areas-")).resolve()
    workspace = folder / "workspace"
    workspace.mkdir()
    expected = json.loads(EXPECTED.read_text(encoding="utf-8"))
    checks: list[dict] = []

    def check(name: str, passed: bool, detail=None) -> None:
        checks.append({"check": name, "passed": bool(passed), **({} if passed else {"detail": detail})})

    def browse(phase: str, **extra) -> dict:
        config = folder / f"config-{phase}.json"
        config.write_text(json.dumps({"expected": expected, **extra}))
        output = folder / f"browser-{phase}.json"
        with (folder / f"browser-{phase}.log").open("wb") as log:
            code = subprocess.call([args.node, str(ROOT / "tools/qualify_first_use_areas.mjs"), f"http://127.0.0.1:{service.port}", str(output),
                                    args.playwright, args.chrome, str(config), phase], stdout=log, stderr=subprocess.STDOUT, timeout=900)
        check(f"browser_{phase}", code == 0, (folder / f"browser-{phase}.log").read_text()[-3000:])
        return {"exit": code, "pid": service.process.pid, **(json.loads(output.read_text()) if code == 0 else {})}

    receipt = {"format": "wise.first_use_areas_receipt.v1", "provenance": provenance(), "checks": checks,
               "fixtures_sha256": {"expected": hashlib.sha256(EXPECTED.read_bytes()).hexdigest(), **{name: hashlib.sha256((PERIODS / name).read_bytes()).hexdigest() for name in ("groups-and-periods.csv", "expected.json")}}}
    service = Service(workspace, folder / "service.log")
    service.start()
    try:
        desktop = browse("desktop")
        receipt["desktop"] = {"exit": desktop["exit"], "checks": desktop.get("checks")}
        if desktop["exit"] == 0:
            # A second synthetic file, read over HTTP into the same workspace, for two start periods.
            client = service.client
            wid = desktop["workspace_id"]
            raw = (PERIODS / "groups-and-periods.csv").read_bytes()
            source = client.put("/api/sources", params={"schema_version": 1, "message_type": "upload_source_metadata", "request_id": "upload-1", "query_revision": 1,
                                "workspace_id": wid, "filename": "groups-and-periods.csv"}, content=raw, headers={"Content-Type": "application/octet-stream"}).json()["source"]
            time = {"id": "incident.time.explicit_format_timezone_utc.v1",
                    "parameters": {"format": "iso8601", "timezone": {"mode": "from_values"}, "snapshot_cutoff_utc": "2026-10-10T12:00:00Z"}}
            prepared = client.post("/api/preparations", json={"schema_version": 1, "message_type": "confirm_mapping_request", "request_id": "confirm-1", "query_revision": 1,
                "workspace_id": wid, "source_id": source["source_id"], "dialect": {"encoding": "utf-8", "delimiter": ",", "quotechar": '"', "header": "first_record"},
                "mapping": {"case_column": 0, "activity_column": 1, "timestamp_column": 2, "sequence_column": None, "context_columns": [3, 4, 5]},
                "policies": {**policies("iso8601", "2026-12-31T00:00:00"), "time": time}, "accept_report_issues": True}).json()
            check("periods_reading_prepared", prepared.get("state") == "ready", prepared.get("state") or prepared.get("code"))
            periods = json.loads((PERIODS / "expected.json").read_text(encoding="utf-8"))["periods"]
            narrow = browse("narrow", example_preparation_id=desktop["example_preparation_id"], periods_preparation_id=prepared["preparation"]["preparation_id"],
                            periods={**periods, "case_count": 8})
            receipt["narrow"] = {"exit": narrow["exit"], "checks": narrow.get("checks")}
    finally:
        receipt.setdefault("service_exits", []).append(service.stop())
    receipt["status"] = "passed" if checks and all(entry["passed"] for entry in checks) else "failed"
    # A failure's detail quotes the browser's log, which may name the temporary folder or this checkout; both are named generically.
    text = json.dumps(receipt, indent=1).replace(json.dumps(str(folder))[1:-1], "<temporary folder>").replace(json.dumps(str(ROOT))[1:-1], "<repository>")
    assert str(folder) not in text and str(ROOT) not in text, "the receipt must not hold a path"
    args.output.write_text(text + "\n")
    print(json.dumps({"status": receipt["status"], "receipt": str(args.output)}))
    return 0 if receipt["status"] == "passed" else 1


if __name__ == "__main__":
    sys.exit(main())
