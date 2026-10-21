"""Qualify #4 in the built browser: an invented CSV through the import wizard, from preview to evidence.

The service runs as its own process over an empty temporary workspace. The built browser, on a laptop-sized window,
reads the guide's synthetic example, then the invented file of tests/fixtures/import-journey: a wrong delimiter
corrected, roles chosen, the reading and its confirmation by keyboard, "What WISE understood", the incidents and their
complete records, a saved investigation, a corrected reading published as a new preparation, and the saved
investigation reopened on its own. A malformed file is read and never published. Every expectation comes from the
independent oracle expected.json beside the files. The service's workspace is then checked on disk through the
service: the malformed file has no preparation. The receipt holds checks and identities only: no path or cell.

    python tools/qualify_import_wizard.py --output receipt.json --node node --playwright .../index.mjs --chrome ...
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

FIXTURES = ROOT / "tests/fixtures/import-journey"


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
    folder = Path(tempfile.mkdtemp(prefix="wise-import-wizard-")).resolve()
    workspace = folder / "workspace"
    workspace.mkdir()
    expected = json.loads((FIXTURES / "expected.json").read_text(encoding="utf-8"))
    config = folder / "config.json"
    config.write_text(json.dumps({"expected": expected, "files": {key: str(FIXTURES / expected[key]["file"]) for key in ("journey", "broken")},
                                  "guide_example_file": "Synthetic example S3.csv", "saved_name": "Invented import journey",
                                  "corrected_offset_minutes": 60}))
    checks: list[dict] = []

    def check(name: str, passed: bool, detail=None) -> None:
        checks.append({"check": name, "passed": bool(passed), **({} if passed else {"detail": detail})})

    receipt = {"format": "wise.import_wizard_receipt.v1", "provenance": provenance(), "checks": checks,
               "fixtures_sha256": {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in sorted(FIXTURES.iterdir())}}
    service = Service(workspace, folder / "service.log")
    service.start()
    try:
        output = folder / "browser.json"
        with (folder / "browser.log").open("wb") as log:
            code = subprocess.call([args.node, str(ROOT / "tools/qualify_import_wizard.mjs"), f"http://127.0.0.1:{service.port}", str(output),
                                    args.playwright, args.chrome, str(config)], stdout=log, stderr=subprocess.STDOUT, timeout=900)
        browser = {"exit": code, **(json.loads(output.read_text()) if code == 0 else {})}
        check("browser_journey", code == 0, (folder / "browser.log").read_text()[-3000:])
        opened = service.client.post("/api/workspaces/open", json={"schema_version": 1, "message_type": "open_workspace_request", "request_id": "check",
                                                                    "query_revision": 1, "path": str(workspace)}).json()
        sources = {entry["source_id"]: entry for entry in opened["sources"]}
        digest = {name: "source.v1:sha256:" + hashlib.sha256((FIXTURES / expected[name]["file"]).read_bytes()).hexdigest() for name in ("journey", "broken")}
        prepared = [entry["source_id"] for entry in opened["preparations"]]
        check("both_files_stored_unchanged", set(digest.values()) <= set(sources), sorted(sources))
        check("journey_has_both_readings", browser.get("first_preparation_id") in {entry["preparation_id"] for entry in opened["preparations"]}
              and browser.get("corrected_preparation_id") in {entry["preparation_id"] for entry in opened["preparations"]}, prepared)
        check("malformed_file_has_no_preparation", digest["broken"] not in prepared, prepared)
        receipt.update(browser=browser, pid=service.process.pid)
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
