"""Qualify one ticket's literal fixture through public HTTP and the built browser, across an actual restart.

The scenario (tools/literal_scenarios.py) imports its literal source and saves its reviewed pipeline over
HTTP. The built browser then reopens that investigation, which requests every saved action again, and must
show the scenario's expected texts and download both exports. The service process is stopped, a new one is
started, and a fresh browser must show the same texts and download byte-identical exports. The exported
manifest must equal the one the HTTP save returned.

    python tools/qualify_literal_browser.py --scenario issue107 --output receipt.json \
        --node NODE --playwright PLAYWRIGHT_INDEX_MJS --chrome CHROME

The web app is rebuilt first unless --no-build is given. The receipt names the commit, the build digest,
both service process IDs and every check.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "tools"), str(ROOT / "apps/api/tests"), str(ROOT / "packages/analytics/tests")]

from capacity_journey import Service  # noqa: E402
from qualify_full_sources import build_is_current, provenance  # noqa: E402
import literal_scenarios  # noqa: E402


def browse(args, folder: Path, service: Service, scenario: dict, phase: str) -> dict:
    expected = folder / "expected.json"
    expected.write_text(json.dumps({"texts": scenario["texts"]}))
    output = folder / f"browser-{phase}.json"
    with (folder / f"browser-{phase}.log").open("wb") as log:
        code = subprocess.call([args.node, str(ROOT / "tools/qualify_literal_browser.mjs"), f"http://127.0.0.1:{service.port}",
                                str(folder / "workspace"), scenario["name"], str(output), args.playwright, args.chrome, str(expected), phase],
                               stdout=log, stderr=subprocess.STDOUT, timeout=600)
    result = json.loads(output.read_text()) if code == 0 else {}
    exported = json.loads((folder / f"browser-{phase}.json.json").read_text()) if code == 0 else None
    return {"exit": code, "pid": service.process.pid, **result, "exported": exported}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--scenario", required=True, choices=sorted(literal_scenarios.SCENARIOS))
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--node", required=True)
    parser.add_argument("--playwright", required=True)
    parser.add_argument("--chrome", required=True)
    parser.add_argument("--no-build", action="store_true")
    args = parser.parse_args()
    if not args.no_build:
        subprocess.run(["npx", "vite", "build"], cwd=ROOT / "apps/web", check=True, capture_output=True)
    if not build_is_current():
        print(json.dumps({"status": "refused", "reason": "the browser build is older than the web sources; run npm run build"}))
        return 1
    folder = Path(tempfile.mkdtemp(prefix="wise-literal-browser-"))
    (folder / "workspace").mkdir()
    checks: list[dict] = []

    def check(name: str, passed: bool, detail=None) -> None:
        checks.append({"check": name, "passed": bool(passed), **({} if passed else {"detail": detail})})

    receipt = {"format": "wise.literal_browser_receipt.v1", "scenario": args.scenario, "provenance": provenance(), "checks": checks}
    service = Service(folder / "workspace", folder / "service.log")
    service.start()
    try:
        scenario = literal_scenarios.SCENARIOS[args.scenario](service.client, folder / "workspace")
        review = browse(args, folder, service, scenario, "review")
        check("browser_review", review["exit"] == 0, (folder / "browser-review.log").read_text()[-2000:])
        if review["exported"] is not None:
            # The browser re-ran every HTTP-saved action and saved it again: each output must be unchanged.
            exported = {(entry["operation"], entry["definition_id"]): entry for entry in review["exported"]["manifest"]["outputs"]}
            check("browser_reran_the_http_outputs", all(exported.get((entry["operation"], entry["definition_id"])) == entry
                                                         for entry in scenario["saved"]["bpic19_outputs"]["outputs"]),
                  sorted(exported))
        first = service.process.pid
        receipt["service_exits"] = [service.stop()]
        service.start()
        check("restart_is_a_new_process", service.process.pid != first, [first, service.process.pid])
        reopen = browse(args, folder, service, scenario, "reopen")
        check("browser_reopen", reopen["exit"] == 0, (folder / "browser-reopen.log").read_text()[-2000:])
        check("browser_exports_identical_after_restart", reopen.get("downloads") == review.get("downloads") and len(review.get("downloads", [])) == 2,
              [review.get("downloads"), reopen.get("downloads")])
        for result in (review, reopen):
            result.pop("exported", None)
        receipt.update(review=review, reopen=reopen, texts=scenario["texts"], saved_revision_id=scenario["saved"]["revision"]["saved_revision_id"])
    finally:
        receipt.setdefault("service_exits", []).append(service.stop())
    receipt["status"] = "passed" if checks and all(entry["passed"] for entry in checks) else "failed"
    args.output.write_text(json.dumps(receipt, indent=1) + "\n")
    print(json.dumps({"status": receipt["status"], "receipt": str(args.output)}))
    return 0 if receipt["status"] == "passed" else 1


if __name__ == "__main__":
    sys.exit(main())
