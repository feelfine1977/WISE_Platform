"""Measure the incident journey for the first supported capacity tier on this machine (#29).

An invented incident log is generated in memory at the tier's size and at a quarter of it: incidents walking forward
through 30 activities, with three context columns. The real service runs as its own process over an empty temporary
workspace, and every stage of the incident journey is one HTTP request, measured for wall time, peak and retained service
memory and reply size, with exact answers checked alongside: upload, inspection, cutoff proposal, confirmation, opening
the incidents, the opening context, the start trend, the process graph, the transition matrix, the variants, a step with
its exact membership, three complete histories, Save, the workspace's bytes on disk, an actual restart and a cold reopen.
Then, at the tier's size: an abandoned request and the same request answered again; a confirmation interrupted by
killing the service, after which nothing half-published is listed; and, with a memory budget too small for the input,
a refusal that says what to do, with nothing written.

    python tools/qualify_incident_capacity.py --output receipt.json [--incidents 50000]
        [--node node --playwright .../index.mjs --chrome ...]

With the browser arguments, the built browser also shows the tier and the service's memory beside the import, and the
refusal of a file whose reading would not fit that memory (tools/qualify_capacity_screen.mjs).

The receipt names the machine and runtime, holds the measurements and checks, and no path. No dataset is read.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import platform
import random
import shutil
import subprocess
import sys
import tempfile
import threading
import time

import httpx

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "tools")]

from capacity_journey import MemorySampler, Service  # noqa: E402
from qualify_full_sources import keep_awake, provenance  # noqa: E402
from qualify_local_ymd_sample import policies  # noqa: E402  (the registered policies of every role but time)

ACTIVITIES = [f"Activity {number:02d}" for number in range(1, 31)]
DESKS, PRIORITIES, CATEGORIES = ["North", "South", "East", "West", "Central"], ["High", "Medium", "Low"], [f"Category {n}" for n in range(1, 11)]
CUTOFF = "2027-12-31T00:00:00Z"
MAPPING = {"case_column": 0, "activity_column": 1, "timestamp_column": 2, "sequence_column": 3, "context_columns": [4, 5, 6]}
STEP_ACTIVITY = "Activity 05"


def envelope(kind: str, request_id: str = "capacity-1", revision: int = 1, **fields) -> dict:
    return {"schema_version": 1, "message_type": kind, "request_id": request_id, "query_revision": revision, **fields}


def generate(incidents: int, seed: int = 29) -> tuple[bytes, dict]:
    """The invented log and what is known of it by construction: every incident's activities, and who has the step's activity."""
    chance = random.Random(seed)
    lines = ["Ticket,Status,At,Seq,Desk,Priority,Category"]
    traces: dict[str, list[str]] = {}
    start = datetime(2026, 1, 1, 8, tzinfo=timezone.utc)
    for number in range(1, incidents + 1):
        case = f"I{number:07d}"
        at = start + timedelta(minutes=number * 7)
        desk, priority, category = chance.choice(DESKS), chance.choice(PRIORITIES), chance.choice(CATEGORIES)
        place, seq, trace = 0, 1, []
        while place < len(ACTIVITIES):
            activity = ACTIVITIES[place]
            trace.append(activity)
            lines.append(f"{case},{activity},{at.strftime('%Y-%m-%dT%H:%M:%SZ')},{seq},{desk},{priority},{category}")
            if seq >= 4 and chance.random() < 0.18:
                break
            place += chance.choice((1, 1, 2, 3, 4))
            at += timedelta(minutes=chance.randint(5, 600))
            seq += 1
        traces[case] = trace
    raw = ("\n".join(lines) + "\n").encode("utf-8")
    truth = {
        "incidents": incidents,
        "records": len(lines) - 1,
        "with_step_activity": sorted(case for case, trace in traces.items() if STEP_ACTIVITY in trace),
        "variant_count": len({tuple(trace) for trace in traces.values()}),
        "activities": len({activity for trace in traces.values() for activity in trace}),
        "witnesses": {case: traces[case] for case in (f"I{1:07d}", f"I{incidents // 2:07d}", f"I{incidents:07d}")},
    }
    return raw, truth


def folder_bytes(folder: Path) -> int:
    return sum(path.stat().st_size for path in folder.rglob("*") if path.is_file())


class Run:
    """One service over one workspace, with every request measured as a stage."""

    def __init__(self, folder: Path, checks: list, label: str) -> None:
        self.folder, self.checks, self.label = folder, checks, label
        self.workspace = folder / "workspace"
        self.workspace.mkdir(parents=True)
        self.service = Service(self.workspace, folder / "service.log")
        self.stages: list[dict] = []
        self.sampler: MemorySampler | None = None

    def start(self, env: dict | None = None) -> None:
        self.service.start(env=env)
        self.sampler = MemorySampler(self.service.process.pid)
        self.sampler.start()

    def stop(self) -> None:
        if self.sampler:
            self.sampler.stop()
        self.service.stop()

    def check(self, name: str, passed: bool, detail=None) -> None:
        self.checks.append({"check": f"{self.label}_{name}", "passed": bool(passed), **({} if passed else {"detail": str(detail)[:1500]})})

    def stage(self, name: str, send) -> dict:
        self.sampler.mark()
        started = time.perf_counter()
        response = send(self.service.client)
        seconds = time.perf_counter() - started
        peak, retained = self.sampler.settled(3 * self.sampler.interval)
        self.stages.append({"stage": name, "seconds": round(seconds, 3), "peak_rss_bytes": peak, "retained_rss_bytes": retained,
                            "reply_bytes": len(response.content), "status": response.status_code})
        self.check(f"{name}_succeeds", response.status_code == 200, response.text[:1500])
        return response.json()


def journey(folder: Path, incidents: int, checks: list, label: str, extras: bool) -> dict:
    raw, truth = generate(incidents)
    run = Run(folder, checks, label)
    run.start()
    result: dict = {"incidents": truth["incidents"], "records": truth["records"], "source_bytes": len(raw)}
    try:
        wid = run.service.client.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(run.workspace))).json()["workspace_id"]
        source = run.stage("upload", lambda c: c.put("/api/sources", params=envelope("upload_source_metadata", workspace_id=wid, filename="invented-incidents.csv"),
                                                       content=raw, headers={"Content-Type": "application/octet-stream"}))["source"]
        dialect = {"encoding": "utf-8", "delimiter": ",", "quotechar": '"', "header": "first_record"}
        run.stage("inspection", lambda c: c.post("/api/sources/inspect", json=envelope("inspect_csv_request", workspace_id=wid, source_id=source["source_id"], hints={})))
        time_policy = {"id": "incident.time.explicit_format_timezone_utc.v1", "parameters": {"format": "iso8601", "timezone": {"mode": "from_values"}, "snapshot_cutoff_utc": CUTOFF}}
        chosen = {**policies("iso8601", "2027-12-31T00:00:00"), "time": time_policy}
        confirm = envelope("confirm_mapping_request", workspace_id=wid, source_id=source["source_id"], dialect=dialect, mapping=MAPPING, policies=chosen, accept_report_issues=True)
        prepared = run.stage("confirmation", lambda c: c.post("/api/preparations", json=confirm))
        run.check("reading_ready", prepared.get("state") == "ready", prepared.get("state"))
        result["disk_after_import_bytes"] = folder_bytes(run.workspace)
        preparation_id = prepared["preparation"]["preparation_id"]
        population = run.stage("open_incidents", lambda c: c.post("/api/investigations/open-population", json=envelope("open_population_request", workspace_id=wid, preparation_id=preparation_id)))
        identity = population["identity"]
        run.check("every_incident_and_record", (population["population"]["case_count"], population["population"]["record_count"]) == (truth["incidents"], truth["records"]), population["population"])
        run.stage("opening_context", lambda c: c.post("/api/investigations/opening-context", json=envelope("opening_context_request", workspace_id=wid, identity=identity)))
        run.stage("start_trend", lambda c: c.post("/api/investigations/start-trend", json=envelope("start_trend_request", workspace_id=wid, identity=identity,
            definition={"policy_id": "incident.start_trend.first_raw_declared_order_half_open.v1", "binning": {"kind": "parent_observed_range", "max_bin_count": 32}})))
        graph = run.stage("process_graph", lambda c: c.post("/api/investigations/process-graph", json=envelope("process_graph_request", workspace_id=wid, identity=identity)))["graph"]
        run.check("graph_has_every_activity", len(graph["nodes"]) == truth["activities"], len(graph["nodes"]))
        run.stage("transition_matrix", lambda c: c.post("/api/investigations/transition-matrix", json=envelope("transition_matrix_request", workspace_id=wid, identity=identity, witness_limit=50)))
        variants = run.stage("variants", lambda c: c.post("/api/investigations/variants", json=envelope("variants_request", workspace_id=wid, identity=identity)))["variants"]
        run.check("variants_exact", variants["variant_count"] == truth["variant_count"], [variants["variant_count"], truth["variant_count"]])
        step = [{"kind": "contains_activity", "activity": STEP_ACTIVITY, "negate": False}]
        selected = run.stage("step", lambda c: c.post("/api/investigations/select-cases", json=envelope("select_cases_request", workspace_id=wid, identity=identity, parent_case_ids=None, predicates=step)))
        run.check("step_membership_exact", selected["kept"]["case_ids"] == truth["with_step_activity"], len(selected["kept"]["case_ids"]))
        for number, (case, trace) in enumerate(truth["witnesses"].items(), start=1):
            evidence = run.stage(f"history_{number}", lambda c, case=case: c.post("/api/investigations/case-evidence",
                                 json=envelope("imported_case_evidence_request", workspace_id=wid, identity=identity, case_id=case)))
            run.check(f"history_{number}_complete", [record["activity"] for record in evidence["records"]] == trace, case)
        save = envelope("save_investigation_request", workspace_id=wid, investigation_id=None, expected_revision_id=None, name="Capacity", base_identity=identity,
                        selection_identity=selected["identity"], selection_recipe={"parent_case_ids": selected["parent"]["case_ids"], "predicates": step},
                        context_policy="incident.context.first_record_in_declared_order.v1", comparison=None, notes="", bookmarks=[])
        saved = run.stage("save", lambda c: c.post("/api/investigations/save", json=save))
        result["disk_after_save_bytes"] = folder_bytes(run.workspace)
        revision_id = saved["revision"]["saved_revision_id"]
        run.sampler.stop()
        run.service.stop()
        run.start()
        run.service.client.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(run.workspace)))
        reopened = run.stage("cold_reopen", lambda c: c.post("/api/investigations/reopen", json=envelope("reopen_investigation_request", workspace_id=wid, saved_revision_id=revision_id)))
        restored = reopened.get("restored_selection") or {}
        run.check("reopened_exactly", restored.get("identity") == selected["identity"] and (restored.get("kept") or {}).get("case_ids") == truth["with_step_activity"], reopened.get("message"))
        if extras:
            result["behaviour"] = behaviour(run, wid, identity, raw, confirm, source)
        result["overall_peak_rss_bytes"] = max(stage["peak_rss_bytes"] for stage in run.stages)
    finally:
        result["stages"] = run.stages
        run.stop()
    return result


def behaviour(run: Run, wid: str, identity: dict, raw: bytes, confirm: dict, source: dict) -> dict:
    """Cancellation, publication and refusal at the tier's size."""
    found: dict = {}
    # An abandoned request: the client gives up at once; the same request is answered afterwards, and memory settles.
    before = run.sampler.current
    try:
        httpx.Client(base_url=run.service.client.base_url, timeout=0.02, trust_env=False).post("/api/investigations/transition-matrix",
            json=envelope("transition_matrix_request", "abandoned-1", 9, workspace_id=wid, identity=identity, witness_limit=50))
        abandoned = False
    except httpx.TimeoutException:
        abandoned = True
    again = run.service.client.post("/api/investigations/transition-matrix", json=envelope("transition_matrix_request", "again-1", 10, workspace_id=wid, identity=identity, witness_limit=50))
    time.sleep(1)
    found["abandoned_request"] = {"abandoned_by_the_client": abandoned, "answered_again": again.status_code == 200,
                                  "retained_before_bytes": before, "retained_after_bytes": run.sampler.current}
    run.check("abandoned_request_then_answered", abandoned and again.status_code == 200, found["abandoned_request"])
    # A confirmation interrupted by killing the service: after a restart nothing half-published is listed.
    listed_before = len(run.service.client.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(run.workspace))).json()["preparations"])
    other = {**confirm, "policies": {**confirm["policies"], "time": {**confirm["policies"]["time"], "parameters": {**confirm["policies"]["time"]["parameters"], "snapshot_cutoff_utc": "2027-06-30T00:00:00Z"}}}}
    thread = threading.Thread(target=lambda: _quietly(lambda: httpx.Client(base_url=run.service.client.base_url, timeout=None, trust_env=False).post("/api/preparations", json=other)), daemon=True)
    thread.start()
    time.sleep(0.4)
    run.sampler.stop()
    run.service.kill()
    thread.join(timeout=30)
    run.start()
    workspace = run.service.client.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(run.workspace))).json()
    listed = workspace["preparations"]
    reopened = run.service.client.post("/api/investigations/open-population", json=envelope("open_population_request", workspace_id=wid, preparation_id=identity["preparation_id"]))
    found["interrupted_confirmation"] = {"listed_before": listed_before, "listed_after": len(listed), "first_reading_opens": reopened.status_code == 200}
    run.check("interrupted_confirmation_publishes_nothing_half", len(listed) in (listed_before, listed_before + 1) and reopened.status_code == 200
              and all(item.get("preparation_id") for item in listed), found["interrupted_confirmation"])
    # Input beyond what the memory budget admits: refused before reading, with what to do, and nothing written.
    run.sampler.stop()
    run.service.stop()
    # A budget of the source's own size: reading it needs about three times that, so the work cannot fit.
    budget = len(raw)
    run.start(env={"WISE_MEMORY_BUDGET_BYTES": str(budget)})
    run.service.client.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(run.workspace)))
    before_bytes = folder_bytes(run.workspace)
    # A reading not made before, so that the source has to be read again.
    third = {**confirm, "policies": {**confirm["policies"], "time": {**confirm["policies"]["time"], "parameters": {**confirm["policies"]["time"]["parameters"], "snapshot_cutoff_utc": "2027-03-31T00:00:00Z"}}}}
    refused = run.service.client.post("/api/preparations", json=third)
    body = refused.json()
    found["beyond_budget"] = {"status": refused.status_code, "code": body.get("code"), "message": body.get("message"), "budget_bytes": budget,
                              "workspace_unchanged": folder_bytes(run.workspace) == before_bytes}
    run.check("beyond_budget_refused_with_what_to_do", body.get("code") == "memory_unavailable" and "WISE_MEMORY_BUDGET_BYTES" in body.get("message", "")
              and found["beyond_budget"]["workspace_unchanged"], body)
    run.sampler.stop()
    run.service.stop()
    run.start()
    return found


def _quietly(send) -> None:
    try:
        send()
    except httpx.HTTPError:
        pass


def screen(folder: Path, args, checks: list) -> dict:
    """The Data area with a memory budget the size of a file, which its reading cannot fit."""
    from qualify_full_sources import build_is_current

    folder.mkdir(parents=True)
    if not build_is_current():
        checks.append({"check": "screen_build_is_current", "passed": False, "detail": "the browser build is older than the web sources"})
        return {}
    raw, _ = generate(2_000)
    file = folder / "invented-incidents.csv"
    file.write_bytes(raw)
    (folder / "workspace").mkdir()
    service = Service(folder / "workspace", folder / "service.log")
    service.start(env={"WISE_MEMORY_BUDGET_BYTES": str(len(raw))})
    try:
        config = folder / "config.json"
        config.write_text(json.dumps({"file": str(file), "budget_mib": round(len(raw) / 2 ** 20)}))
        output = folder / "browser.json"
        with (folder / "browser.log").open("wb") as log:
            code = subprocess.call([args.node, str(ROOT / "tools/qualify_capacity_screen.mjs"), f"http://127.0.0.1:{service.port}", str(output),
                                    args.playwright, args.chrome, str(config)], stdout=log, stderr=subprocess.STDOUT, timeout=600)
        checks.append({"check": "screen_browser_journey", "passed": code == 0, **({} if code == 0 else {"detail": (folder / "browser.log").read_text()[-2000:]})})
        return {"exit": code, "budget_bytes": len(raw), **(json.loads(output.read_text()) if code == 0 else {})}
    finally:
        service.stop()


def machine() -> dict:
    brand = ""
    try:
        brand = subprocess.check_output(["sysctl", "-n", "machdep.cpu.brand_string"], text=True).strip()
        memory = int(subprocess.check_output(["sysctl", "-n", "hw.memsize"], text=True).strip())
    except (OSError, subprocess.SubprocessError, ValueError):
        memory = 0
    return {"processor": brand or platform.processor(), "cores": os.cpu_count(), "memory_bytes": memory, "system": f"{platform.system()} {platform.release()} {platform.machine()}",
            "python": platform.python_version()}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--incidents", type=int, default=50_000)
    parser.add_argument("--node")
    parser.add_argument("--playwright")
    parser.add_argument("--chrome")
    args = parser.parse_args()
    keep_awake()
    folder = Path(tempfile.mkdtemp(prefix="wise-incident-capacity-")).resolve()
    checks: list[dict] = []
    receipt = {"format": "wise.incident_capacity_receipt.v1", "provenance": provenance(), "machine": machine(), "checks": checks,
               "tier": {"incidents": args.incidents, "activities": len(ACTIVITIES), "context_columns": 3}}
    try:
        quarter = journey(folder / "quarter", args.incidents // 4, checks, "quarter", extras=False)
        tier = journey(folder / "tier", args.incidents, checks, "tier", extras=True)
        receipt["sizes"] = {"quarter": quarter, "tier": tier}
        receipt["tier"].update(records=tier["records"], source_bytes=tier["source_bytes"])
        if args.node:
            receipt["screen"] = screen(folder / "screen", args, checks)
    finally:
        shutil.rmtree(folder, ignore_errors=True)
    receipt["status"] = "passed" if checks and all(entry["passed"] for entry in checks) else "failed"
    text = json.dumps(receipt, indent=1).replace(json.dumps(str(folder))[1:-1], "<temporary folder>").replace(json.dumps(str(ROOT))[1:-1], "<repository>")
    assert str(folder) not in text and str(ROOT) not in text, "the receipt must not hold a path"
    args.output.write_text(text + "\n")
    print(json.dumps({"status": receipt["status"], "receipt": str(args.output)}))
    return 0 if receipt["status"] == "passed" else 1


if __name__ == "__main__":
    sys.exit(main())
