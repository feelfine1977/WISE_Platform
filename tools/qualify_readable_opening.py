"""Qualify #65 in the built browser: a readable opening for a large map.

The service runs as its own process over an empty temporary workspace; the invented tests/fixtures/readable-opening log
(600 incidents over 45 activities with long names shortened alike, loops and a Phase column, written by
tools/make_readable_opening_fixture.py) is stored and read there over HTTP. At 1280 x 720, and again at a wider window,
the built browser opens the map of every incident: it opens readable near Start at a zoom the map library derives from
its cards, discloses how much of the map is in view, keeps every name on the screen readable at the smallest zoom and
when the map is fitted, tells activities shortened alike apart, finds an omitted low-frequency path in the list of every
path and brings it into view, returns to the opening by pointer and by keyboard, draws a loop both ways, collapses and
expands stages, selects a path, and through all of it changes no incident, count, step or identity. Arranged for what is
shown, the detail arranges the map anew and opens it again; the parent's places, kept on request, hold through the detail.
The receipt holds checks, counts and sizes only; with WISE_SCREENSHOT_DIR set, pictures are written there.

    python tools/qualify_readable_opening.py --output receipt.json --node node --playwright .../index.mjs --chrome ...

With --bpic19 PATH the same journey runs on the complete BPIC 2019 file (the public purchasing log, read with the day-first
format in the Windows-1252 encoding, its cutoff as the service proposes it), after the invented log, and the receipt holds
both; its counts are the file's own, never a record. That run uploads 527 MB and takes minutes.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "tools")]

from capacity_journey import Service, envelope  # noqa: E402
from qualify_full_sources import build_is_current, keep_awake, provenance  # noqa: E402
from qualify_local_ymd_sample import policies  # noqa: E402  (the registered policies of every role but time)

FIXTURES = ROOT / "tests/fixtures/readable-opening"

# How the public BPIC 2019 file is read: its item (the purchasing document item), activity and time columns, the day-first
# second format with fractional seconds, as recorded without a time zone, in the Windows-1252 encoding it is published in.
BPIC19 = {
    "dialect": {"encoding": "windows-1252", "delimiter": ",", "quotechar": '"', "header": "first_record"},
    "mapping": {"case_column": 15, "activity_column": 19, "timestamp_column": 21, "sequence_column": None, "context_columns": [9, 1]},
    "format": "dmy_dash_second",
    # The public file's own counts: purchasing document items (the incidents) and records; its 42 activities.
    "expected": {"incidents": 251734, "records": 1595923, "activities": 42, "colliding": [["Vendor creates invoice", "Vendor creates debit memo"]],
                 "loop": ["Record Goods Receipt", "Cancel Goods Receipt"]},
}


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 22), b""):
            digest.update(chunk)
    return digest.hexdigest()


def prepare(client, workspace_id: str, source_id: str, dialect: dict, mapping: dict, time_policy: dict | None, format_name: str, cutoff_local: str) -> dict:
    """Confirm a reading: with the explicit UTC policy of the invented log, or as recorded with the cutoff the service proposes."""
    base = policies(format_name, cutoff_local)
    if time_policy is not None:
        base = {**base, "time": time_policy}
    else:
        proposal = json.loads(json.dumps(base))
        proposal["time"]["parameters"]["snapshot_cutoff_local"] = "2999-01-01T00:00:00"
        proposed = client.post("/api/preparations/cutoff-proposal", json=envelope("confirm_mapping_request", workspace_id=workspace_id, source_id=source_id,
                               dialect=dialect, mapping=mapping, policies=proposal, accept_report_issues=False)).json()
        base["time"]["parameters"]["snapshot_cutoff_local"] = proposed["proposed_cutoff"]
    return client.post("/api/preparations", json=envelope("confirm_mapping_request", workspace_id=workspace_id, source_id=source_id,
                       dialect=dialect, mapping=mapping, policies=base, accept_report_issues=True)).json()


def journey(args, service: Service, folder: Path, name: str, config: dict, check) -> dict:
    """The browser journey over one prepared reading; returns what the browser reported."""
    path = folder / f"{name}.json"
    (folder / f"{name}-config.json").write_text(json.dumps(config))
    with (folder / f"{name}-browser.log").open("wb") as log:
        started = time.monotonic()
        code = subprocess.call([args.node, str(ROOT / "tools/qualify_readable_opening.mjs"), f"http://127.0.0.1:{service.port}", str(path),
                                args.playwright, args.chrome, str(folder / f"{name}-config.json")], stdout=log, stderr=subprocess.STDOUT, timeout=1800)
    check(f"{name}_browser_journey", code == 0, (folder / f"{name}-browser.log").read_text()[-3000:])
    reported = json.loads(path.read_text()) if path.exists() else {}
    return {"exit": code, "seconds": round(time.monotonic() - started, 1), **reported}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--node", required=True)
    parser.add_argument("--playwright", required=True)
    parser.add_argument("--chrome", required=True)
    parser.add_argument("--bpic19", type=Path, help="the complete BPIC 2019 CSV, for the full-source scenario after the invented one")
    args = parser.parse_args()
    if not build_is_current():
        print(json.dumps({"status": "refused", "reason": "the browser build is older than the web sources; run npm run build"}))
        return 1
    keep_awake()
    folder = Path(tempfile.mkdtemp(prefix="wise-readable-opening-")).resolve()
    workspace = folder / "workspace"
    workspace.mkdir()
    expected = json.loads((FIXTURES / "expected.json").read_text(encoding="utf-8"))
    checks: list[dict] = []

    def check(name: str, passed: bool, detail=None) -> None:
        checks.append({"check": name, "passed": bool(passed), **({} if passed else {"detail": detail})})

    receipt = {"format": "wise.readable_opening_receipt.v1", "provenance": provenance(), "checks": checks,
               "fixtures_sha256": {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in sorted(FIXTURES.iterdir())},
               "map_library": json.loads((ROOT / "vendor/manifest.json").read_text(encoding="utf-8"))["artifacts"][0]}
    service = Service(workspace, folder / "service.log")
    service.start()
    try:
        client = service.client
        wid = client.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(workspace))).json()["workspace_id"]
        # The invented log.
        source = client.put("/api/sources", params=envelope("upload_source_metadata", workspace_id=wid, filename=expected["file"]),
                            content=(FIXTURES / expected["file"]).read_bytes(), headers={"Content-Type": "application/octet-stream"}).json()["source"]
        utc = {"id": "incident.time.explicit_format_timezone_utc.v1",
               "parameters": {"format": "iso8601", "timezone": {"mode": "from_values"}, "snapshot_cutoff_utc": expected["cutoff_utc"]}}
        prepared = prepare(client, wid, source["source_id"], {"encoding": "utf-8", "delimiter": ",", "quotechar": '"', "header": "first_record"},
                           expected["mapping"], utc, "iso8601", "2026-12-31T00:00:00")
        check("invented_reading_prepared", prepared.get("state") == "ready", prepared.get("state") or prepared.get("code"))
        receipt["invented"] = journey(args, service, folder, "invented", {"expected": expected, "preparation_id": prepared["preparation"]["preparation_id"],
                                                                           "label": "invented", "phase_column": "Phase"}, check)
        # The complete BPIC 2019 file, where given. A failure of this part is a failed check, not a lost receipt.
        if args.bpic19 is not None:
            try:
                bpic = args.bpic19.expanduser()
                started = time.monotonic()
                with bpic.open("rb") as handle:
                    source = client.put("/api/sources", params=envelope("upload_source_metadata", workspace_id=wid, filename="bpic2019.csv"),
                                        content=handle, headers={"Content-Type": "application/octet-stream"}).json()["source"]
                check("bpic19_source_identity", source["source_id"] == "source.v1:sha256:" + file_sha256(bpic), source["source_id"])
                inspected = client.post("/api/sources/inspect", json=envelope("inspect_csv_request", workspace_id=wid, source_id=source["source_id"])).json()
                check("bpic19_record_count", inspected.get("record_count") == BPIC19["expected"]["records"], inspected.get("record_count"))
                check("bpic19_dialect_offered", BPIC19["dialect"] in inspected.get("dialect_candidates", []), inspected.get("dialect_candidates"))
                prepared = prepare(client, wid, source["source_id"], BPIC19["dialect"], BPIC19["mapping"], None, BPIC19["format"], "2999-01-01T00:00:00")
                check("bpic19_reading_prepared", prepared.get("state") == "ready", prepared.get("state") or prepared.get("code"))
                summary = prepared.get("preparation", {})
                full = {**BPIC19["expected"], "file": "bpic2019.csv", "source_sha256": file_sha256(bpic)}
                receipt["bpic19"] = {"reading_seconds": round(time.monotonic() - started, 1), "incidents": full["incidents"], "records": full["records"],
                                     "cutoff_proposed": summary.get("policies", {}).get("time", {}).get("parameters", {}).get("snapshot_cutoff_local"),
                                     **journey(args, service, folder, "bpic19", {"expected": full, "preparation_id": summary.get("preparation_id"), "label": "bpic19"}, check)}
            except Exception as error:  # noqa: BLE001  (the receipt says what went wrong; nothing of the source is in the message)
                check("bpic19_journey_ran", False, f"{type(error).__name__}: {error}"[:500])
    finally:
        receipt["service_exit"] = service.stop()
    receipt["status"] = "passed" if checks and all(entry["passed"] for entry in checks) else "failed"
    # A failure's detail quotes the browser's log, which may name the temporary folder, this checkout or the source; all are named generically.
    text = json.dumps(receipt, indent=1).replace(json.dumps(str(folder))[1:-1], "<temporary folder>").replace(json.dumps(str(ROOT))[1:-1], "<repository>")
    if args.bpic19 is not None:
        text = text.replace(json.dumps(str(args.bpic19.expanduser()))[1:-1], "<bpic19 source>")
    assert str(folder) not in text and str(ROOT) not in text, "the receipt must not hold a path"
    args.output.write_text(text + "\n")
    print(json.dumps({"status": receipt["status"], "receipt": str(args.output)}))
    return 0 if receipt["status"] == "passed" else 1


if __name__ == "__main__":
    sys.exit(main())
