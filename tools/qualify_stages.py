"""Qualify #70 in the built browser: stages of a log set by the analyst.

The service runs as its own process over an empty temporary workspace; the invented tests/fixtures/stage-proposal file is
stored and read there over HTTP. In the built browser the Phase column is counted on every record of each labelled
activity of the kept incidents, as the hand-written expected.json says; values are taken into stages by the analyst, one
overridden by hand; the map draws the named stages while no incident, step or count changes; the investigation is saved
with its stages. A second investigation is saved over HTTP with stages that name an activity the log does not have, and
stages bound to another preparation are refused. After an actual restart, a browser that kept nothing reopens both: the
saved stages come back with their origins, and the activity the log does not have is said, drawn in no stage and taken
out on request. The receipt holds checks only.

    python tools/qualify_stages.py --output receipt.json --node node --playwright .../index.mjs --chrome ...
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

FIXTURES = ROOT / "tests/fixtures/stage-proposal"


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
    folder = Path(tempfile.mkdtemp(prefix="wise-stages-")).resolve()
    workspace = folder / "workspace"
    workspace.mkdir()
    expected = json.loads((FIXTURES / "expected.json").read_text(encoding="utf-8"))
    raw = (FIXTURES / expected["file"]).read_bytes()
    checks: list[dict] = []

    def check(name: str, passed: bool, detail=None) -> None:
        checks.append({"check": name, "passed": bool(passed), **({} if passed else {"detail": detail})})

    def browse(phase: str, preparation_id: str) -> dict:
        config = folder / f"config-{phase}.json"
        config.write_text(json.dumps({"expected": expected, "preparation_id": preparation_id}))
        output = folder / f"browser-{phase}.json"
        with (folder / f"browser-{phase}.log").open("wb") as log:
            code = subprocess.call([args.node, str(ROOT / "tools/qualify_stages.mjs"), f"http://127.0.0.1:{service.port}", str(output),
                                    args.playwright, args.chrome, str(config), phase], stdout=log, stderr=subprocess.STDOUT, timeout=900)
        check(f"browser_{phase}", code == 0, (folder / f"browser-{phase}.log").read_text()[-3000:])
        return {"exit": code, **(json.loads(output.read_text()) if code == 0 else {})}

    receipt = {"format": "wise.stages_receipt.v1", "provenance": provenance(), "checks": checks,
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
        preparation_id = prepared["preparation"]["preparation_id"]
        receipt["browser"] = {"define": browse("define", preparation_id)}
        define = receipt["browser"]["define"]
        if define["exit"] == 0:
            stages = define["stages"]

            def save(name: str, given: dict):
                return client.post("/api/investigations/save", json=envelope("save_investigation_request", workspace_id=wid, investigation_id=None,
                    expected_revision_id=None, name=name, base_identity=define["base_identity"], selection_identity=define["selection_identity"],
                    selection_recipe={"parent_case_ids": define["parent_case_ids"], "predicates": []},
                    context_policy="incident.context.first_record_in_declared_order.v1", comparison=None, notes="", bookmarks=[],
                    presentation_state={"active_view": "process_map", "table_sorts": [], "flow_artifact_sha256": None, "graph_positions": None, "stages": given}))

            # Stages bound to another reading are refused, so that they are never applied to this log.
            other = save("Other reading's stages", {**stages, "preparation_id": "preparation.v1:sha256:" + "0" * 64})
            check("stages_of_another_reading_refused", other.status_code == 400 and other.json().get("field") == "presentation_state.stages.preparation_id",
                  [other.status_code, other.json().get("code"), other.json().get("field")])
            # Stages that name an activity this log does not have: the service cannot know the log's activities; the screen says it.
            stale = save("Stale stages", {**stages, "assignments": stages["assignments"] + [{"activity": "Gone", "stage_id": stages["stages"][0]["id"], "origin": {"kind": "manual"}}]})
            check("stale_stages_saved_for_the_reopening", stale.status_code == 200, stale.text[-500:])
        # An actual restart: the stages come back from the saved investigations, not from the browser.
        service.stop()
        service.start()
        receipt["browser"]["reopen"] = browse("reopen", preparation_id)
        for phase in ("define", "reopen"):
            receipt["browser"][phase] = {key: value for key, value in receipt["browser"][phase].items() if key in ("exit", "checks")}
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
