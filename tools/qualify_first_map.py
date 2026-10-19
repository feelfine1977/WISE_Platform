"""Qualify #48 and #49 in the built browser: from a first launch over an empty workspace to the map of every incident.

The service runs as its own process over an empty temporary workspace. In the phase "first" a fresh browser reaches the
map of the packaged synthetic example, read through the ordinary operations, checks its paths and a step against the
hand-written tests/fixtures/first-map/expected.json, reaches the incidents, Compare and the Expectation, and saves. The
service is stopped and a new process started; in the phase "again" a fresh browser with a stale remembered reading opens
the reading the workspace lists, without reading the example again, and reopens the saved investigation on its view.
The receipt holds checks and identities only.

    python tools/qualify_first_map.py --output receipt.json --node node --playwright .../index.mjs --chrome ...
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

EXPECTED = ROOT / "tests/fixtures/first-map/expected.json"


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
    folder = Path(tempfile.mkdtemp(prefix="wise-first-map-")).resolve()
    workspace = folder / "workspace"
    workspace.mkdir()
    expected = json.loads(EXPECTED.read_text(encoding="utf-8"))
    checks: list[dict] = []

    def check(name: str, passed: bool, detail=None) -> None:
        checks.append({"check": name, "passed": bool(passed), **({} if passed else {"detail": detail})})

    def browse(phase: str, **extra) -> dict:
        config = folder / f"config-{phase}.json"
        config.write_text(json.dumps({"expected": expected, "saved_name": "Invented first map", **extra}))
        output = folder / f"browser-{phase}.json"
        with (folder / f"browser-{phase}.log").open("wb") as log:
            code = subprocess.call([args.node, str(ROOT / "tools/qualify_first_map.mjs"), f"http://127.0.0.1:{service.port}", str(output),
                                    args.playwright, args.chrome, str(config), phase], stdout=log, stderr=subprocess.STDOUT, timeout=900)
        check(f"browser_{phase}", code == 0, (folder / f"browser-{phase}.log").read_text()[-3000:])
        return {"exit": code, "pid": service.process.pid, **(json.loads(output.read_text()) if code == 0 else {})}

    receipt = {"format": "wise.first_map_receipt.v1", "provenance": provenance(), "checks": checks,
               "fixtures_sha256": {"expected": hashlib.sha256(EXPECTED.read_bytes()).hexdigest()}}
    service = Service(workspace, folder / "service.log")
    service.start()
    try:
        first = browse("first")
        pid = service.process.pid
        receipt["service_exits"] = [service.stop()]
        service.start()
        check("restart_is_a_new_process", service.process.pid != pid, [pid, service.process.pid])
        again = browse("again", **{key: first.get(key) for key in ("workspace_id", "preparation_id", "identity")}) if first["exit"] == 0 else {"exit": None}
        receipt.update(first={key: value for key, value in first.items() if key not in ("identity", "workspace_id")}, again=again)
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
