"""Qualify #60 in the built browser: keeping long incidents by recorded span, through Save and a restart.

The service runs as its own process over an empty temporary workspace; the invented tests/fixtures/intervals file is
stored and read there over HTTP. In the phase "review" the built browser keeps the incidents of at least four hours
from the chart of spans by keyboard, checks the incident list ordered by span, undoes, takes the same threshold from
the typed filter, compares kept against removed and saves. The service is stopped and a new process started; in the
phase "reopen" a fresh browser reopens the same step and identity. Every expectation comes from the hand-written
tests/fixtures/intervals/long-incidents.json. The receipt holds checks only.

    python tools/qualify_long_incidents.py --output receipt.json --node node --playwright .../index.mjs --chrome ...
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

EXPECTED = ROOT / "tests/fixtures/intervals/long-incidents.json"


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
    folder = Path(tempfile.mkdtemp(prefix="wise-long-incidents-")).resolve()
    workspace = folder / "workspace"
    workspace.mkdir()
    expected = json.loads(EXPECTED.read_text(encoding="utf-8"))
    raw = (ROOT / expected["source"]).read_bytes()
    checks: list[dict] = []

    def check(name: str, passed: bool, detail=None) -> None:
        checks.append({"check": name, "passed": bool(passed), **({} if passed else {"detail": detail})})

    receipt = {"format": "wise.long_incidents_receipt.v1", "provenance": provenance(), "checks": checks,
               "fixtures_sha256": {"source": hashlib.sha256(raw).hexdigest(), "expected": hashlib.sha256(EXPECTED.read_bytes()).hexdigest()}}
    service = Service(workspace, folder / "service.log")
    service.start()
    try:
        client = service.client
        wid = client.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(workspace))).json()["workspace_id"]
        source = client.put("/api/sources", params=envelope("upload_source_metadata", workspace_id=wid, filename="Invented core.csv"), content=raw,
                            headers={"Content-Type": "application/octet-stream"}).json()["source"]
        time = {"id": "incident.time.explicit_format_timezone_utc.v1",
                "parameters": {"format": "iso8601", "timezone": {"mode": "from_values"}, "snapshot_cutoff_utc": "2026-10-06T00:00:00Z"}}
        chosen = {**policies("iso8601", "2026-10-06T00:00:00"), "time": time}
        prepared = client.post("/api/preparations", json=envelope("confirm_mapping_request", workspace_id=wid, source_id=source["source_id"],
            dialect={"encoding": "utf-8", "delimiter": ",", "quotechar": '"', "header": "first_record"},
            mapping={"case_column": 0, "activity_column": 1, "timestamp_column": 2, "sequence_column": 3, "context_columns": [4]},
            policies=chosen, accept_report_issues=True)).json()
        check("reading_prepared", prepared.get("state") == "ready", prepared.get("state") or prepared.get("code"))
        settings = {"expected": expected, "preparation_id": prepared["preparation"]["preparation_id"], "saved_name": "Invented long incidents"}

        def browse(phase: str, **extra) -> dict:
            config = folder / f"config-{phase}.json"
            config.write_text(json.dumps({**settings, **extra}))
            output = folder / f"browser-{phase}.json"
            with (folder / f"browser-{phase}.log").open("wb") as log:
                code = subprocess.call([args.node, str(ROOT / "tools/qualify_long_incidents.mjs"), f"http://127.0.0.1:{service.port}", str(output),
                                        args.playwright, args.chrome, str(config), phase], stdout=log, stderr=subprocess.STDOUT, timeout=900)
            check(f"browser_{phase}", code == 0, (folder / f"browser-{phase}.log").read_text()[-3000:])
            return {"exit": code, "pid": service.process.pid, **(json.loads(output.read_text()) if code == 0 else {})}

        review = browse("review")
        first = service.process.pid
        receipt["service_exits"] = [service.stop()]
        service.start()
        check("restart_is_a_new_process", service.process.pid != first, [first, service.process.pid])
        reopen = browse("reopen", identity=review.get("identity"), chips=review.get("chips")) if review["exit"] == 0 else {"exit": None}
        receipt.update(review={key: value for key, value in review.items() if key not in ("identity", "chips")}, reopen=reopen)
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
