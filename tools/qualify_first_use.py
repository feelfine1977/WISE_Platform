"""Qualify #2 and #3 in the built browser: first use of the application with its own workspace.

The service starts over an empty workspace folder of its own. The built browser opens the application, which stores the
packaged synthetic example S0 there like any source and shows its incidents; an incident is opened by keyboard and
another by pointer, and the Data area names the writable workspace. Expected counts come from the independent fixture
tests/fixtures/incidents (never read by the product). The service is then stopped, a new process started over the same
workspace, and a fresh browser must show the same reading, with the same identities, without reading the example again.
The receipt holds checks, counts and identities only.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "tools")]

from capacity_journey import Service  # noqa: E402
from qualify_full_sources import build_is_current, keep_awake, provenance  # noqa: E402

FIXTURES = ROOT / "tests/fixtures/incidents"


def expectations(workspace: Path) -> dict:
    expected = json.loads((FIXTURES / "expected.json").read_text(encoding="utf-8"))["fixtures"]["S0"]
    rows = list(csv.DictReader(io.StringIO((FIXTURES / "S0.csv").read_text(encoding="utf-8"))))
    counts = {case: sum(row["incident_id"] == case for row in rows) for case in {row["incident_id"] for row in rows}}
    return {"cases": expected["base_cases"], "records": expected["base_records"], "case_records": counts,
            "keyboard_case": "INC05", "pointer_case": "INC02", "order": sorted(counts), "workspace_path": str(workspace.resolve())}


def browse(args, folder: Path, service: Service, phase: str, expected: Path) -> dict:
    output = folder / f"browser-{phase}.json"
    with (folder / f"browser-{phase}.log").open("wb") as log:
        code = subprocess.call([args.node, str(ROOT / "tools/qualify_first_use.mjs"), f"http://127.0.0.1:{service.port}", str(output),
                                args.playwright, args.chrome, str(expected), phase], stdout=log, stderr=subprocess.STDOUT, timeout=600)
    return {"exit": code, "pid": service.process.pid, **(json.loads(output.read_text()) if code == 0 else {})}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--node", required=True)
    parser.add_argument("--playwright", required=True)
    parser.add_argument("--chrome", required=True)
    parser.add_argument("--texts", default="[]", help="JSON list of texts the incident view must show")
    args = parser.parse_args()
    if not build_is_current():
        print(json.dumps({"status": "refused", "reason": "the browser build is older than the web sources; run npm run build"}))
        return 1
    keep_awake()
    folder = Path(tempfile.mkdtemp(prefix="wise-first-use-"))
    workspace = folder / "workspace"
    workspace.mkdir()
    expected = folder / "expected.json"
    expected.write_text(json.dumps({**expectations(workspace), "texts": json.loads(args.texts)}))
    checks: list[dict] = []

    def check(name: str, passed: bool, detail=None) -> None:
        checks.append({"check": name, "passed": bool(passed), **({} if passed else {"detail": detail})})

    receipt = {"format": "wise.first_use_receipt.v1", "provenance": provenance(), "checks": checks}
    service = Service(workspace, folder / "service.log")
    service.start()
    try:
        first = browse(args, folder, service, "first", expected)
        check("browser_first_use", first["exit"] == 0, (folder / "browser-first.log").read_text()[-2000:])
        pid = service.process.pid
        receipt["service_exits"] = [service.stop()]
        service.start()
        check("restart_is_a_new_process", service.process.pid != pid, [pid, service.process.pid])
        again = browse(args, folder, service, "again", expected)
        check("browser_after_restart", again["exit"] == 0, (folder / "browser-again.log").read_text()[-2000:])
        check("same_identity_and_population_after_restart", again.get("identity") == first.get("identity") and again.get("population") == first.get("population"))
        receipt.update(first={k: v for k, v in first.items() if k != "population"}, again={k: v for k, v in again.items() if k != "population"},
                       cases=first.get("population", {}).get("case_count"), records=first.get("population", {}).get("record_count"))
    finally:
        receipt.setdefault("service_exits", []).append(service.stop())
    receipt["status"] = "passed" if checks and all(entry["passed"] for entry in checks) else "failed"
    text = json.dumps(receipt, indent=1)
    assert str(folder) not in text and str(folder.resolve()) not in text, "the receipt must not hold a path"
    args.output.write_text(text + "\n")
    print(json.dumps({"status": receipt["status"], "receipt": str(args.output)}))
    return 0 if receipt["status"] == "passed" else 1


if __name__ == "__main__":
    sys.exit(main())
