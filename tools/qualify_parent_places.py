"""Qualify #56 in the built browser: activities keep the places of one arrangement of the parent.

The service runs as its own process over an empty temporary workspace; the invented tests/fixtures/variants file (a
branching map) and tests/fixtures/pinned file are stored and read there over HTTP. The built browser reads the places
of the activities on the map and checks that a preview, a cancel, an applied step, Undo, the detail, an activity that is
removed and comes back, and an incident read beside the map move none of them; that Rearrange and the way back are
explicit, by keyboard, and ask for no incident; that another parent is arranged anew; and that the direction is named.
Screenshots of the map are written beside the receipt when --screenshots names a folder. The receipt holds checks only.

    python tools/qualify_parent_places.py --output receipt.json --node node --playwright .../index.mjs --chrome ... [--screenshots DIR]
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

FIXTURES = [ROOT / "tests/fixtures/variants", ROOT / "tests/fixtures/pinned"]


def envelope(kind: str, **fields) -> dict:
    return {"schema_version": 1, "message_type": kind, "request_id": f"{kind}-1", "query_revision": 1, **fields}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--node", required=True)
    parser.add_argument("--playwright", required=True)
    parser.add_argument("--chrome", required=True)
    parser.add_argument("--screenshots", type=Path)
    args = parser.parse_args()
    if not build_is_current():
        print(json.dumps({"status": "refused", "reason": "the browser build is older than the web sources; run npm run build"}))
        return 1
    keep_awake()
    folder = Path(tempfile.mkdtemp(prefix="wise-parent-places-")).resolve()
    workspace = folder / "workspace"
    workspace.mkdir()
    checks: list[dict] = []

    def check(name: str, passed: bool, detail=None) -> None:
        checks.append({"check": name, "passed": bool(passed), **({} if passed else {"detail": detail})})

    receipt = {"format": "wise.parent_places_receipt.v1", "provenance": provenance(), "checks": checks,
               "fixtures_sha256": {f"{fixtures.name}/{path.name}": hashlib.sha256(path.read_bytes()).hexdigest()
                                   for fixtures in FIXTURES for path in sorted(fixtures.iterdir())}}
    service = Service(workspace, folder / "service.log")
    service.start()
    try:
        client = service.client
        wid = client.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(workspace))).json()["workspace_id"]
        readings = []
        for fixtures in FIXTURES:
            expected = json.loads((fixtures / "expected.json").read_text(encoding="utf-8"))
            raw = (fixtures / expected["file"]).read_bytes()
            source = client.put("/api/sources", params=envelope("upload_source_metadata", workspace_id=wid, filename=expected["file"]), content=raw,
                                headers={"Content-Type": "application/octet-stream"}).json()["source"]
            time = {"id": "incident.time.explicit_format_timezone_utc.v1",
                    "parameters": {"format": "iso8601", "timezone": {"mode": "from_values"}, "snapshot_cutoff_utc": expected["cutoff_utc"]}}
            prepared = client.post("/api/preparations", json=envelope("confirm_mapping_request", workspace_id=wid, source_id=source["source_id"],
                dialect={"encoding": "utf-8", "delimiter": ",", "quotechar": '"', "header": "first_record"}, mapping=expected["mapping"],
                policies={**policies("iso8601", "2026-12-31T00:00:00"), "time": time}, accept_report_issues=True)).json()
            check(f"{fixtures.name}_reading_prepared", prepared.get("state") == "ready", prepared.get("state") or prepared.get("code"))
            readings.append({"preparation_id": prepared["preparation"]["preparation_id"], "incidents": expected["incidents"], "expected": expected})
        config = folder / "config.json"
        config.write_text(json.dumps({"readings": readings}))
        output = folder / "browser.json"
        shots = args.screenshots.resolve() if args.screenshots else folder / "screenshots"
        shots.mkdir(parents=True, exist_ok=True)
        with (folder / "browser.log").open("wb") as log:
            code = subprocess.call([args.node, str(ROOT / "tools/qualify_parent_places.mjs"), f"http://127.0.0.1:{service.port}", str(output),
                                    args.playwright, args.chrome, str(config), str(shots)], stdout=log, stderr=subprocess.STDOUT, timeout=900)
        check("browser_journey", code == 0, (folder / "browser.log").read_text()[-3000:])
        receipt["browser"] = {"exit": code, **(json.loads(output.read_text()) if code == 0 else {})}
    finally:
        receipt["service_exit"] = service.stop()
    receipt["status"] = "passed" if checks and all(entry["passed"] for entry in checks) else "failed"
    # A failure's detail quotes the browser's log, which may name the temporary folder or this checkout; both are named generically.
    text = json.dumps(receipt, indent=1).replace(json.dumps(str(folder))[1:-1], "<temporary folder>").replace(json.dumps(str(ROOT))[1:-1], "<repository>")
    if args.screenshots:
        text = text.replace(json.dumps(str(args.screenshots.resolve()))[1:-1], "<screenshots>")
    assert str(folder) not in text and str(ROOT) not in text, "the receipt must not hold a path"
    args.output.write_text(text + "\n")
    print(json.dumps({"status": receipt["status"], "receipt": str(args.output)}))
    return 0 if receipt["status"] == "passed" else 1


if __name__ == "__main__":
    sys.exit(main())
