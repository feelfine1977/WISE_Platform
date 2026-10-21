"""Qualify #26 in the built browser: a workspace backed up, the service restarted, the backup restored and its finding reopened.

The service runs as its own process over an empty temporary workspace; the invented tests/fixtures/frozen-parent file is
stored, read and a question on it saved there over HTTP. In the first browser phase the analyst backs the workspace up
from the Data area into a new folder. The service is stopped and started again as a new process on another empty
workspace. In the second phase the analyst restores the backup into a new folder, opens it, finds the same workspace and
its saved investigation, reopens it and reads an incident's complete history. The original folder is unchanged. Paths
are passed to the browser and never written into the receipt, which holds checks only.

    python tools/qualify_backup_restore.py --output receipt.json --node node --playwright .../index.mjs --chrome ...
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

FIXTURES = ROOT / "tests/fixtures/frozen-parent"
NAME = "Backed up finding"
POLICY = "incident.context.first_record_in_declared_order.v1"


def file_hashes(folder: Path) -> dict[str, str]:
    return {str(path.relative_to(folder)): hashlib.sha256(path.read_bytes()).hexdigest() for path in sorted(folder.rglob("*"))
            if path.is_file() and not path.name.startswith(".")}


def save_question(client, wid: str, preparation_id: str) -> dict:
    """A saved, unscored question: the incidents that begin with Opened and contain Resolved."""
    base = client.post("/api/investigations/open-population", json=envelope("open_population_request", workspace_id=wid, preparation_id=preparation_id)).json()
    expected = json.loads((FIXTURES / "expected.json").read_text(encoding="utf-8"))
    steps = [expected["retained"], expected["resolution"]["clause"]]
    selected = client.post("/api/investigations/select-cases", json=envelope("select_cases_request", workspace_id=wid, identity=base["identity"],
                           parent_case_ids=None, predicates=steps)).json()
    return client.post("/api/investigations/save", json=envelope("save_investigation_request", workspace_id=wid, investigation_id=None, expected_revision_id=None,
        name=NAME, base_identity=base["identity"], selection_identity=selected["identity"],
        selection_recipe={"parent_case_ids": selected["parent"]["case_ids"], "predicates": steps}, context_policy=POLICY, comparison=None,
        notes="Question: Is it still there after a restore?", bookmarks=[])).json()


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
    folder = Path(tempfile.mkdtemp(prefix="wise-backup-restore-")).resolve()
    workspace = folder / "workspace"
    workspace.mkdir()
    expected = json.loads((FIXTURES / "expected.json").read_text(encoding="utf-8"))
    raw = (FIXTURES / expected["file"]).read_bytes()
    checks: list[dict] = []

    def check(name: str, passed: bool, detail=None) -> None:
        checks.append({"check": name, "passed": bool(passed), **({} if passed else {"detail": detail})})

    def read(client, wid: str, content: bytes) -> str:
        source = client.put("/api/sources", params=envelope("upload_source_metadata", workspace_id=wid, filename=expected["file"]), content=content,
                            headers={"Content-Type": "application/octet-stream"}).json()["source"]
        time = {"id": "incident.time.explicit_format_timezone_utc.v1",
                "parameters": {"format": "iso8601", "timezone": {"mode": "from_values"}, "snapshot_cutoff_utc": expected["cutoff_utc"]}}
        prepared = client.post("/api/preparations", json=envelope("confirm_mapping_request", workspace_id=wid, source_id=source["source_id"],
            dialect={"encoding": "utf-8", "delimiter": ",", "quotechar": '"', "header": "first_record"}, mapping=expected["mapping"],
            policies={**policies("iso8601", "2026-12-31T00:00:00"), "time": time}, accept_report_issues=True)).json()
        check(f"reading_prepared_{len(content)}", prepared.get("state") == "ready", prepared.get("state") or prepared.get("code"))
        return prepared["preparation"]["preparation_id"]

    def browse(phase: str, **extra) -> dict:
        config = folder / f"config-{phase}.json"
        config.write_text(json.dumps({"expected": expected, **extra}))
        output = folder / f"browser-{phase}.json"
        with (folder / f"browser-{phase}.log").open("wb") as log:
            code = subprocess.call([args.node, str(ROOT / "tools/qualify_backup_restore.mjs"), f"http://127.0.0.1:{service.port}", str(output),
                                    args.playwright, args.chrome, str(config), phase], stdout=log, stderr=subprocess.STDOUT, timeout=900)
        check(f"browser_{phase}", code == 0, (folder / f"browser-{phase}.log").read_text()[-3000:])
        return {"exit": code, **(json.loads(output.read_text()) if code == 0 else {})}

    receipt = {"format": "wise.backup_restore_receipt.v1", "provenance": provenance(), "checks": checks,
               "fixtures_sha256": {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in sorted(FIXTURES.iterdir())}}
    service = Service(workspace, folder / "service.log")
    service.start()
    try:
        client = service.client
        wid = client.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(workspace))).json()["workspace_id"]
        preparation = read(client, wid, raw)
        saved = save_question(client, wid, preparation)
        check("question_saved_over_http", saved.get("message_type") == "save_investigation_answer", saved.get("code"))
        before = file_hashes(workspace)
        first = browse("first", backup=str(folder / "backup"))
        pid = service.process.pid
        receipt["service_exits"] = [service.stop()]
        # The new process starts on another, empty workspace: the restored one is opened from the browser.
        other = folder / "other"
        other.mkdir()
        service = Service(other, folder / "service-2.log")
        service.start()
        check("restart_is_a_new_process", service.process.pid != pid, [pid, service.process.pid])
        again = browse("again", backup=str(folder / "backup"), restored=str(folder / "restored"), workspace_id=wid, name=NAME) if first["exit"] == 0 else {"exit": None}
        check("original_unchanged", file_hashes(workspace) == before, None)
        receipt.update(first=first, again=again)
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
