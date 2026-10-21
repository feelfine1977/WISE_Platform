"""Qualify #18 in the built browser: two start periods under one definition, with their follow-up exposure.

The service runs as its own process over an empty temporary workspace; the fictional
tests/fixtures/comparisons/groups-and-periods.csv is stored and read there over HTTP. The built browser compares the
early period with the period including the latest starts, to the stored cutoff with a four-hour minimum follow-up and
the recorded activity Resolved, and checks the shared definitions, the measured, missing and not fully observed supports,
the coverage that is not comparable kept as no conclusion, the declared follow-up restriction, the paired profiles, and
the cross-period incident opened with its whole history and returned from, against expected.json beside the file.

    python tools/qualify_period_followup.py --output receipt.json --node node --playwright .../index.mjs --chrome ...
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

FIXTURES = ROOT / "tests/fixtures/comparisons"


def envelope(kind: str, **fields) -> dict:
    return {"schema_version": 1, "message_type": kind, "request_id": f"{kind}-1", "query_revision": 1, **fields}


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
    folder = Path(tempfile.mkdtemp(prefix="wise-period-followup-")).resolve()
    workspace = folder / "workspace"
    workspace.mkdir()
    expected = {"file": "groups-and-periods.csv", "cutoff_utc": "2026-10-10T12:00:00Z",
                "mapping": {"case_column": 0, "activity_column": 1, "timestamp_column": 2, "sequence_column": None, "context_columns": [3, 4, 5]},
                "groups": json.loads((FIXTURES / "expected.json").read_text(encoding="utf-8")),
                "strata": json.loads((FIXTURES / "strata.json").read_text(encoding="utf-8"))}
    raw = (FIXTURES / expected["file"]).read_bytes()
    checks: list[dict] = []

    def check(name: str, passed: bool, detail=None) -> None:
        checks.append({"check": name, "passed": bool(passed), **({} if passed else {"detail": detail})})

    receipt = {"format": "wise.period_followup_receipt.v1", "provenance": provenance(), "checks": checks,
               "fixtures_sha256": {name: hashlib.sha256((FIXTURES / name).read_bytes()).hexdigest() for name in ("groups-and-periods.csv", "expected.json", "strata.json")}}
    service = Service(workspace, folder / "service.log")
    service.start()
    try:
        client = service.client
        wid = client.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(workspace))).json()["workspace_id"]
        source = client.put("/api/sources", params=envelope("upload_source_metadata", workspace_id=wid, filename=expected["file"]), content=raw,
                            headers={"Content-Type": "application/octet-stream"}).json()["source"]
        time = {"id": "incident.time.explicit_format_timezone_utc.v1",
                "parameters": {"format": "iso8601", "timezone": {"mode": "from_values"}, "snapshot_cutoff_utc": expected["cutoff_utc"]}}
        prepared = client.post("/api/preparations", json=envelope("confirm_mapping_request", workspace_id=wid, source_id=source["source_id"],
            dialect={"encoding": "utf-8", "delimiter": ",", "quotechar": '"', "header": "first_record"}, mapping=expected["mapping"],
            policies={**policies("iso8601", "2026-12-31T00:00:00"), "time": time}, accept_report_issues=True)).json()
        check("reading_prepared", prepared.get("state") == "ready", prepared.get("state") or prepared.get("code"))
        config = folder / "config.json"
        config.write_text(json.dumps({"expected": expected, "preparation_id": prepared["preparation"]["preparation_id"]}))
        output = folder / "browser.json"
        with (folder / "browser.log").open("wb") as log:
            code = subprocess.call([args.node, str(ROOT / "tools/qualify_period_followup.mjs"), f"http://127.0.0.1:{service.port}", str(output),
                                    args.playwright, args.chrome, str(config)], stdout=log, stderr=subprocess.STDOUT, timeout=900)
        check("browser_journey", code == 0, (folder / "browser.log").read_text()[-3000:])
        receipt["browser"] = {"exit": code, **(json.loads(output.read_text()) if code == 0 else {})}
    finally:
        receipt["service_exit"] = service.stop()
    receipt["status"] = "passed" if checks and all(entry["passed"] for entry in checks) else "failed"
    # A failure's detail quotes the browser's log, which may name the temporary folder or this checkout; both are named generically.
    text = json.dumps(receipt, indent=1).replace(json.dumps(str(folder))[1:-1], "<temporary folder>").replace(json.dumps(str(ROOT))[1:-1], "<repository>")
    assert str(folder) not in text and str(ROOT) not in text, "the receipt must not hold a path"
    args.output.write_text(text + "\n")
    print(json.dumps({"status": receipt["status"], "receipt": str(args.output)}))
    return 0 if receipt["status"] == "passed" else 1


if __name__ == "__main__":
    sys.exit(main())
