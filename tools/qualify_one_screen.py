"""Qualify #54 in the built browser: the investigation fits one screen.

The service runs as its own process over an empty temporary workspace; the invented tests/fixtures/one-screen file, with
long activity names and a long file name, is stored and read there over HTTP. The built browser then goes through one
imported investigation: Map, Incidents and Variants as named views, the map's detail controls above the canvas and its
legend under it, an activity's steps and times beside the map, a step previewed and let go, taken and undone with the exact
incidents and identities of the hand-written expected.json, three steps each counted against the one frozen parent, the
complete history of an incident opened and closed with the keyboard back on its row, and a pending, a failed and a
let-go selection with the answer still shown. At 1280 x 720 and 1440 x 900 the page does not scroll and every core action
is in view and not covered, with the side panel and a history open; at 200 % zoom the page reflows without a sideways
scroll and every core action can be reached. How long each answer and view took on this fixture is recorded, without
claiming any capacity. The receipt holds checks and timings only; with WISE_SCREENSHOT_DIR set, pictures are written there.

    python tools/qualify_one_screen.py --output receipt.json --node node --playwright .../index.mjs --chrome ...
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

FIXTURES = ROOT / "tests/fixtures/one-screen"


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
    folder = Path(tempfile.mkdtemp(prefix="wise-one-screen-")).resolve()
    workspace = folder / "workspace"
    workspace.mkdir()
    expected = json.loads((FIXTURES / "expected.json").read_text(encoding="utf-8"))
    raw = (FIXTURES / expected["file"]).read_bytes()
    checks: list[dict] = []

    def check(name: str, passed: bool, detail=None) -> None:
        checks.append({"check": name, "passed": bool(passed), **({} if passed else {"detail": detail})})

    receipt = {"format": "wise.one_screen_receipt.v1", "provenance": provenance(), "checks": checks,
               "fixtures_sha256": {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in sorted(FIXTURES.iterdir())}}
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
            code = subprocess.call([args.node, str(ROOT / "tools/qualify_one_screen.mjs"), f"http://127.0.0.1:{service.port}", str(output),
                                    args.playwright, args.chrome, str(config)], stdout=log, stderr=subprocess.STDOUT, timeout=1500)
        check("browser_journey", code == 0, (folder / "browser.log").read_text()[-3000:])
        receipt["browser"] = {"exit": code, **(json.loads(output.read_text()) if code == 0 else {})}
        receipt["timings_note"] = ("Milliseconds from a click to the answer or view on screen, on this invented fixture of 10 incidents and 42 records "
                                   "on this computer; recorded as feedback, not as a capacity tier.")
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
