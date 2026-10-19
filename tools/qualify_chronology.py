"""Qualify #5 in the built browser: the chronology of an invented source, from its reading to its evidence and back.

The service runs as its own process over an empty temporary workspace. In the phase "review" the built browser reads
tests/fixtures/chronology/chronology.csv with a sequence number, checks what the summary says of clock, order,
cutoff and policy versions, reads the evidence of a tie whose sequence numbers disagree with the times, of missing
labels and of a date-only time by keyboard, checks the map's path over missing labels and that no end follows an
unlabelled last record, returns to the preparation control, and publishes a reading without the sequence number after
comparing it with the first. The service is then stopped and a new process started over the same workspace; in the
phase "reopen" a fresh browser opens the first preparation, which keeps its order. Every expectation comes from the
independent oracle expected.json beside the file. The receipt holds checks and identities only: no path or cell.

    python tools/qualify_chronology.py --output receipt.json --node node --playwright .../index.mjs --chrome ...
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

FIXTURES = ROOT / "tests/fixtures/chronology"


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
    folder = Path(tempfile.mkdtemp(prefix="wise-chronology-")).resolve()
    workspace = folder / "workspace"
    workspace.mkdir()
    expected = json.loads((FIXTURES / "expected.json").read_text(encoding="utf-8"))
    checks: list[dict] = []

    def check(name: str, passed: bool, detail=None) -> None:
        checks.append({"check": name, "passed": bool(passed), **({} if passed else {"detail": detail})})

    def browse(phase: str, **extra) -> dict:
        config = folder / f"config-{phase}.json"
        config.write_text(json.dumps({"expected": expected, "file": str(FIXTURES / expected["file"]), **extra}))
        output = folder / f"browser-{phase}.json"
        with (folder / f"browser-{phase}.log").open("wb") as log:
            code = subprocess.call([args.node, str(ROOT / "tools/qualify_chronology.mjs"), f"http://127.0.0.1:{service.port}", str(output),
                                    args.playwright, args.chrome, str(config), phase], stdout=log, stderr=subprocess.STDOUT, timeout=900)
        check(f"browser_{phase}", code == 0, (folder / f"browser-{phase}.log").read_text()[-3000:])
        return {"exit": code, "pid": service.process.pid, **(json.loads(output.read_text()) if code == 0 else {})}

    receipt = {"format": "wise.chronology_receipt.v1", "provenance": provenance(), "checks": checks,
               "fixtures_sha256": {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in sorted(FIXTURES.iterdir())}}
    service = Service(workspace, folder / "service.log")
    service.start()
    try:
        review = browse("review")
        first_pid = service.process.pid
        receipt["service_exits"] = [service.stop()]
        service.start()
        check("restart_is_a_new_process", service.process.pid != first_pid, [first_pid, service.process.pid])
        reopen = browse("reopen", first_preparation_id=review.get("first_preparation_id")) if review["exit"] == 0 else {"exit": None}
        receipt.update(review=review, reopen=reopen)
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
