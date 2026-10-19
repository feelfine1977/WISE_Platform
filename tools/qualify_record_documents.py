"""Qualify #132 in the built browser: the invented documents through the real service and the built screen.

The invented log, documents and attachments of apps/api/tests/record_document_fixture.py are written to a temporary
folder. The service runs with an attachment recorder, so no program is ever started; it records one digest per opened
attachment and no path. The browser reads the documents by keyboard, opens a stated and a mismatched attachment and
times the largest allowed document. The service is then stopped, a new process started over the same workspace, and a
fresh browser reads the same document. The receipt holds checks, timings and identities only: no path or content.

    python tools/qualify_record_documents.py --output receipt.json --node node --playwright .../index.mjs --chrome ...
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "tools"), str(ROOT / "apps/api/tests"), str(ROOT / "packages/analytics/tests")]

from capacity_journey import Service  # noqa: E402
from qualify_full_sources import build_is_current, keep_awake, provenance  # noqa: E402
from import_requests import envelope  # noqa: E402
from record_document_fixture import prepare, write_folder  # noqa: E402

SAVED_NAME = "Invented documents"


def browse(args, folder: Path, service: Service, phase: str) -> dict:
    output = folder / f"browser-{phase}.json"
    with (folder / f"browser-{phase}.log").open("wb") as log:
        code = subprocess.call([args.node, str(ROOT / "tools/qualify_record_documents.mjs"), f"http://127.0.0.1:{service.port}",
                                str(folder / "workspace"), SAVED_NAME, str(output), args.playwright, args.chrome, phase],
                               stdout=log, stderr=subprocess.STDOUT, timeout=600)
    return {"exit": code, "pid": service.process.pid, **(json.loads(output.read_text()) if code == 0 else {})}


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
    folder = Path(tempfile.mkdtemp(prefix="wise-record-documents-"))
    documents = write_folder(folder)
    (folder / "workspace").mkdir()
    record = folder / "opened.txt"
    os.environ["WISE_ATTACHMENT_OPEN_RECORD"] = str(record)
    checks: list[dict] = []

    def check(name: str, passed: bool, detail=None) -> None:
        checks.append({"check": name, "passed": bool(passed), **({} if passed else {"detail": detail})})

    receipt = {"format": "wise.record_documents_receipt.v1", "provenance": provenance(), "checks": checks}
    service = Service(folder / "workspace", folder / "service.log")
    service.start()
    try:
        client = service.client
        wid, identity, preparation = prepare(client, folder / "workspace")
        folder_answer = client.post("/api/workspaces/document-folder", json=envelope("document_folder_request", workspace_id=wid,
                                                                                       change={"folder": str(documents)})).json()
        check("folder_set", folder_answer.get("state") == "available", folder_answer.get("state"))
        selected = client.post("/api/investigations/select-cases", json=envelope("select_cases_request", workspace_id=wid, identity=identity,
                                                                                 parent_case_ids=None, predicates=[])).json()
        saved = client.post("/api/investigations/save", json=envelope("save_investigation_request", workspace_id=wid, investigation_id=None,
            expected_revision_id=None, name=SAVED_NAME, base_identity=identity, selection_identity=selected["identity"],
            selection_recipe={"parent_case_ids": selected["parent"]["case_ids"], "predicates": []},
            context_policy="incident.context.first_record_in_declared_order.v1", comparison=None, notes="", bookmarks=[]))
        check("saved_without_the_folder", saved.status_code == 200 and str(documents) not in saved.text, saved.status_code)
        review = browse(args, folder, service, "review")
        check("browser_review", review["exit"] == 0, (folder / "browser-review.log").read_text()[-2000:])
        lines = record.read_text().splitlines() if record.exists() else []
        check("exactly_the_stated_attachment_was_handed_to_the_system", len(lines) == 1 and all(len(line) == 64 for line in lines), len(lines))
        first = service.process.pid
        receipt["service_exits"] = [service.stop()]
        service.start()
        check("restart_is_a_new_process", service.process.pid != first, [first, service.process.pid])
        reopen = browse(args, folder, service, "reopen")
        check("browser_reopen", reopen["exit"] == 0, (folder / "browser-reopen.log").read_text()[-2000:])
        receipt.update(review=review, reopen=reopen, preparation_id=preparation, saved_revision_id=saved.json()["revision"]["saved_revision_id"])
    finally:
        receipt.setdefault("service_exits", []).append(service.stop())
    receipt["status"] = "passed" if checks and all(entry["passed"] for entry in checks) else "failed"
    text = json.dumps(receipt, indent=1)
    assert str(folder) not in text, "the receipt must not hold a path"
    args.output.write_text(text + "\n")
    print(json.dumps({"status": receipt["status"], "receipt": str(args.output)}))
    return 0 if receipt["status"] == "passed" else 1


if __name__ == "__main__":
    sys.exit(main())
