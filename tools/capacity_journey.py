"""The BPIC19 descriptive journey over a native and a prepared source, measured through the real service.

Each operation is a real HTTP request to a service started on loopback. A sampler reads the resident memory of
the service's process tree while the request runs, so every stage records its wall time, peak and retained
service memory and the size of its reply. Answers are checked against what the caller expects as they arrive.

POSIX only: the process tree's memory is read from ``ps``.
"""
from __future__ import annotations

from dataclasses import dataclass, field
import hashlib
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import threading
import time

import httpx

ROOT = Path(__file__).resolve().parents[1]
CONTEXT_POLICY = "incident.context.first_record_in_declared_order.v1"
LINEAGE_POLICY = "bpic19.same_position_category_lineage.v1"
PROFILE_POLICY = "bpic19.all_raw_case_attributes.v1"
FAR_CUTOFF = "9999-12-31T23:59:59"


def envelope(message_type: str, request_id: str = "capacity-1", revision: int = 1, **fields) -> dict:
    return {"schema_version": 1, "message_type": message_type, "request_id": request_id, "query_revision": revision, **fields}


def digest(value: object) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()


def tree_rss(root_pid: int) -> int:
    """Resident bytes of a process and all its descendants."""
    table = subprocess.check_output(["ps", "-axo", "pid=,ppid=,rss="], text=True, timeout=5)
    children: dict[int, list[int]] = {}
    rss: dict[int, int] = {}
    for line in table.splitlines():
        parts = line.split()
        if len(parts) == 3:
            pid, parent, kilobytes = map(int, parts)
            children.setdefault(parent, []).append(pid)
            rss[pid] = kilobytes * 1024
    total, pending = 0, [root_pid]
    while pending:
        pid = pending.pop()
        total += rss.get(pid, 0)
        pending.extend(children.get(pid, ()))
    return total


class MemorySampler(threading.Thread):
    """Samples the service tree's resident memory until stopped; ``mark`` starts a new peak window.

    ``limit`` stops the journey when the tree exceeds it: the breach is recorded and the service killed."""

    def __init__(self, pid: int, interval: float = 0.05, limit: int | None = None, on_breach=None) -> None:
        super().__init__(daemon=True)
        self.pid, self.interval, self.limit, self.on_breach = pid, interval, limit, on_breach
        self.current = self.peak = self.overall = 0
        self.breach: int | None = None
        self.samples = 0
        self._halt = threading.Event()
        self._lock = threading.Lock()

    def run(self) -> None:
        while not self._halt.is_set():
            try:
                value = tree_rss(self.pid)
            except (OSError, subprocess.SubprocessError, ValueError):
                value = 0
            with self._lock:
                self.current = value
                self.peak = max(self.peak, value)
                self.overall = max(self.overall, value)
                self.samples += 1
            if self.limit is not None and value > self.limit and self.breach is None:
                self.breach = value
                if self.on_breach is not None:
                    self.on_breach()
            self._halt.wait(self.interval)

    def mark(self) -> None:
        with self._lock:
            self.peak = self.current

    def settled(self, wait: float) -> tuple[int, int]:
        """Peak since ``mark`` and the current value after waiting for at least two more samples."""
        time.sleep(wait)
        with self._lock:
            return self.peak, self.current

    def stop(self) -> None:
        self._halt.set()


class Service:
    """The product service on an ephemeral loopback port, over one workspace folder, with its own log."""

    def __init__(self, workspace: Path, log: Path) -> None:
        self.workspace, self.log = workspace, log
        self.process: subprocess.Popen | None = None
        self.client: httpx.Client | None = None
        self.port = 0

    def start(self) -> None:
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            self.port = sock.getsockname()[1]
        code = ("from pathlib import Path; import uvicorn; from wise_platform_api.app import create_app; "
                f"uvicorn.run(create_app(workspace_path=Path({str(self.workspace)!r})),host='127.0.0.1',port={self.port},log_level='error')")
        env = {**os.environ, "PYTHONDONTWRITEBYTECODE": "1",
               "PYTHONPATH": os.pathsep.join(str(ROOT / part) for part in ("apps/api/src", "packages/analytics/src"))}
        with self.log.open("ab") as log:
            self.process = subprocess.Popen([sys.executable, "-B", "-c", code], env=env, stdout=log, stderr=subprocess.STDOUT)
        self.client = httpx.Client(base_url=f"http://127.0.0.1:{self.port}", timeout=None, trust_env=False)
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            if self.process.poll() is not None:
                raise RuntimeError(f"service exited during startup; see {self.log}")
            try:
                if self.client.get("/api/health").status_code == 200:
                    return
            except httpx.TransportError:
                pass
            time.sleep(0.05)
        self.stop()
        raise RuntimeError("service readiness timeout")

    def kill(self) -> None:
        if self.process is not None and self.process.poll() is None:
            self.process.kill()

    def stop(self) -> dict:
        """Stop the service, wait for it and confirm its port is closed."""
        if self.client is not None:
            self.client.close()
        process, self.process, self.client = self.process, None, None
        if process is None:
            return {}
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
        with socket.socket() as sock:
            closed = sock.connect_ex(("127.0.0.1", self.port)) != 0
        return {"pid": process.pid, "exit": process.returncode, "port_closed": closed}


@dataclass
class Origin:
    """One source of the journey: its bytes and the confirmed interpretation."""

    name: str
    raw: bytes | Path
    """The source bytes, or a file streamed on upload so the caller never holds a full source."""
    dialect: dict
    mapping: dict
    policies: dict
    hints: dict | None = None

    def sha256(self) -> str:
        if isinstance(self.raw, bytes):
            return hashlib.sha256(self.raw).hexdigest()
        digest = hashlib.sha256()
        with self.raw.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1 << 22), b""):
                digest.update(chunk)
        return digest.hexdigest()


@dataclass
class Expectations:
    """What the caller knows independently about the population; each is checked when the answer arrives."""

    case_count: int
    record_count: int
    case_ids: list[str] | None = None
    """Every case identifier, when known independently; otherwise only the counts are checked."""
    evidence: dict[str, list[list[str]]] = field(default_factory=dict)
    """Original cells of a few cases' records, in any order."""


class Failed(Exception):
    """A failed check or stage. Its message names the check only; the detail goes to the journey's private log."""


class Journey:
    """Runs the stages in order against one service and records each."""

    saved_name = "Capacity journey"

    def __init__(self, folder: Path, native: Origin, prepared: Origin, prepared_roles: dict, measure_roles: dict,
                 lineage_origin_column: int, expected: Expectations, *, limit: int | None = None, deadline: float | None = None,
                 score: bool = True, after_reopen=None) -> None:
        self.folder = folder
        self.native, self.prepared = native, prepared
        self.prepared_roles, self.measure_roles = prepared_roles, measure_roles
        self.lineage_origin_column = lineage_origin_column
        self.expected = expected
        self.limit = limit
        self.deadline = deadline
        """Seconds the whole journey may take; past it the service is killed and the journey fails."""
        self.score = score
        self.after_reopen = after_reopen
        """Called with the running service, workspace id, saved revision and a case id after the cold reopen."""
        self.timed_out = False
        self.workspace = folder / "workspace"
        self.workspace.mkdir(mode=0o700)
        self.service = Service(self.workspace, folder / "service.log")
        self.sampler: MemorySampler | None = None
        self.stages: list[dict] = []
        self.checks: list[str] = []
        self.exits: list[dict] = []

    # Mechanics -----------------------------------------------------------------------------

    def _start(self) -> None:
        self.service.start()
        self.sampler = MemorySampler(self.service.process.pid, limit=self.limit, on_breach=self.service.kill)
        self.sampler.start()
        time.sleep(0.2)

    def _stop(self) -> None:
        if self.sampler is not None:
            self.sampler.stop()
            self.sampler.join(timeout=5)
        exit_record = self.service.stop()
        if exit_record:
            self.exits.append(exit_record)

    def check(self, name: str, condition: bool, detail: object = None) -> None:
        if not condition:
            with (self.folder / "journey-detail.log").open("a") as log:
                log.write(f"{name}: {detail!r}\n")
            raise Failed(name)
        self.checks.append(name)

    def stage(self, name: str, request) -> dict:
        """Run one request as a measured stage; the reply must be a success."""
        self.sampler.mark()
        started = time.perf_counter()
        try:
            response = request(self.service.client)
        except httpx.TransportError as error:
            if self.sampler.breach is not None:
                raise Failed(f"memory_limit during {name}") from error
            if self.timed_out:
                raise Failed(f"deadline during {name}") from error
            raise
        seconds = time.perf_counter() - started
        peak, retained = self.sampler.settled(3 * self.sampler.interval)
        self.stages.append({"stage": name, "seconds": round(seconds, 4), "peak_rss_bytes": peak, "retained_rss_bytes": retained,
                            "reply_bytes": len(response.content), "status": response.status_code})
        self.check(f"{name}_succeeds", response.status_code == 200, response.text[:2000])
        return response.json() if response.headers.get("content-type", "").startswith("application/json") else {}

    def post(self, route: str, message: str, **fields):
        return lambda client: client.post("/api/" + route, json=envelope(message, **fields))

    def _expire(self) -> None:
        self.timed_out = True
        self.service.kill()

    # Journey -------------------------------------------------------------------------------

    def run(self) -> dict:
        result: dict = {"status": "failed", "stages": self.stages, "checks": self.checks, "service_exits": self.exits}
        timer = None
        if self.deadline is not None:
            timer = threading.Timer(self.deadline, self._expire)
            timer.daemon = True
            timer.start()
        try:
            self._start()
            result["idle_rss_bytes"] = self.sampler.settled(0.3)[1]
            self._journey(result)
            result["status"] = "passed"
        except Failed as error:
            result["reason"] = str(error)
        finally:
            if timer is not None:
                timer.cancel()
            self._stop()
            if self.sampler is not None and self.sampler.breach is not None:
                result.update(status="failed", reason=result.get("reason") or "memory_limit", breach_rss_bytes=self.sampler.breach)
            result["memory_limit_bytes"] = self.limit
            result["service_pids"] = [exit_record["pid"] for exit_record in self.exits]
            result["peak_rss_bytes"] = max((stage["peak_rss_bytes"] for stage in self.stages), default=0)
            result["cleanup_verified"] = all(exit_record.get("port_closed") and exit_record.get("exit") is not None
                                             for exit_record in self.exits)
        return result

    def _journey(self, result: dict) -> None:
        workspace = str(self.workspace)
        wid = self.stage("open_workspace", self.post("workspaces/open", "open_workspace_request", path=workspace))["workspace_id"]
        prepared_ids = {}
        populations = {}
        for origin in (self.native, self.prepared):
            name = origin.name
            def upload(client, origin=origin, name=name):
                content = origin.raw if isinstance(origin.raw, bytes) else origin.raw.open("rb")
                try:
                    return client.put("/api/sources", params=envelope("upload_source_metadata", workspace_id=wid, filename=f"{name}.csv"),
                                      content=content, headers={"Content-Type": "application/octet-stream"})
                finally:
                    if not isinstance(content, bytes):
                        content.close()

            uploaded = self.stage(f"{name}_upload", upload)
            source_id = uploaded["source"]["source_id"]
            self.check(f"{name}_source_identity", source_id == "source.v1:sha256:" + origin.sha256())
            hints = {} if origin.hints is None else {"hints": origin.hints}
            inspected = self.stage(f"{name}_inspection", self.post("sources/inspect", "inspect_csv_request", workspace_id=wid,
                                                                     source_id=source_id, **hints))
            self.check(f"{name}_inspection_dialect", origin.dialect in inspected["dialect_candidates"], inspected["dialect_candidates"])
            self.check(f"{name}_inspection_count", inspected["record_count"] == self.expected.record_count, inspected["record_count"])
            proposal_policies = json.loads(json.dumps(origin.policies))
            proposal_policies["time"]["parameters"][_cutoff_key(proposal_policies)] = FAR_CUTOFF + ("Z" if _utc(proposal_policies) else "")
            proposed = self.stage(f"{name}_cutoff_proposal", self.post(
                "preparations/cutoff-proposal", "confirm_mapping_request", workspace_id=wid, source_id=source_id,
                dialect=origin.dialect, mapping=origin.mapping, policies=proposal_policies, accept_report_issues=False))
            confirmed_policies = json.loads(json.dumps(origin.policies))
            confirmed_policies["time"]["parameters"][_cutoff_key(confirmed_policies)] = proposed["proposed_cutoff"]
            confirmed = self.stage(f"{name}_confirmation", self.post(
                "preparations", "confirm_mapping_request", workspace_id=wid, source_id=source_id, dialect=origin.dialect,
                mapping=origin.mapping, policies=confirmed_policies, accept_report_issues=True))
            self.check(f"{name}_ready", confirmed["state"] == "ready", confirmed["state"])
            prepared_ids[name] = confirmed["preparation"]["preparation_id"]
            opened = self.stage(f"{name}_population", self.post("investigations/open-population", "open_population_request",
                                                               workspace_id=wid, preparation_id=prepared_ids[name]))
            population = opened["population"]
            self.check(f"{name}_population_count", population["case_count"] == self.expected.case_count
                       and population["record_count"] == self.expected.record_count, population.get("case_count"))
            populations[name] = opened["identity"]
        base = populations[self.prepared.name]
        for case_id, rows in self.expected.evidence.items():
            answer = self.stage("case_evidence", self.post("investigations/case-evidence", "imported_case_evidence_request",
                                                          workspace_id=wid, identity=base, case_id=case_id))
            self.check("case_evidence_exact", sorted(entry["original_cells"] for entry in answer["records"]) == sorted(rows), case_id)
        selected = self.stage("selection", self.post("investigations/select-cases", "select_cases_request", workspace_id=wid,
                                                    identity=base, parent_case_ids=None, predicates=[]))
        kept = sorted(selected["kept"]["case_ids"])
        self.check("selection_keeps_all", kept == sorted(self.expected.case_ids) if self.expected.case_ids is not None
                   else len(kept) == self.expected.case_count)
        subset = kept[: max(1, len(kept) // 10)]
        narrowed = self.stage("selection_predicate", self.post(
            "investigations/select-cases", "select_cases_request", workspace_id=wid, identity=base, parent_case_ids=None,
            predicates=[{"kind": "case_id_in", "case_ids": subset, "negate": False}]))
        self.check("selection_predicate_exact", sorted(narrowed["kept"]["case_ids"]) == subset)
        identity = selected["identity"]
        lineage = {"policy_id": LINEAGE_POLICY, "origin_preparation_id": prepared_ids[self.native.name],
                   "origin_column_index": self.lineage_origin_column, "provenance": "Synthetic native and prepared copies of one population"}
        query = {"roles": self.prepared_roles, "profile_columns": None, "policy_id": PROFILE_POLICY}
        profiled = self.stage("attribute_profile", self.post("investigations/bpic19-profile", "bpic19_profile_request",
                                                             workspace_id=wid, identity=identity, query=query))
        self.check("profile_population", profiled["profile"]["population"]["case_count"] == self.expected.case_count)
        lineage_query = {**query, "category_lineage": lineage}
        reviewed = self.stage("lineage_profile", self.post("investigations/bpic19-profile", "bpic19_profile_request",
                                                           workspace_id=wid, identity=identity, query=lineage_query))
        recorded = reviewed["profile"]["definition"].get("category_lineage") or {}
        self.check("lineage_recorded", recorded.get("origin_preparation_id") == prepared_ids[self.native.name], recorded)
        measures_query = {"policy_id": "bpic19.source_witnessed_measures.v1", "measure_profile": "paper_v1", "roles": self.measure_roles,
                          "offset": 0, "limit": 100, "value_reducer": "unique_creation_value", "value_unit": "EUR",
                          "calibration_population": "selected", "value_band_edges": []}
        self.stage("default_measures", self.post("investigations/bpic19-measures", "bpic19_measures_request", workspace_id=wid,
                                                 identity=identity, query=measures_query))
        self.stage("process_graph", self.post("investigations/process-graph", "process_graph_request", workspace_id=wid, identity=identity))
        self.stage("variants", self.post("investigations/variants", "variants_request", workspace_id=wid, identity=identity))
        saved = self.stage("save", self.post(
            "investigations/save", "save_investigation_request", workspace_id=wid, investigation_id=None, expected_revision_id=None,
            name=self.saved_name, base_identity=base, selection_identity=identity,
            selection_recipe={"parent_case_ids": selected["parent"]["case_ids"], "predicates": []}, context_policy=CONTEXT_POLICY,
            comparison=None, notes="Synthetic capacity measurement", bookmarks=[], bpic19_pipeline={"schema_version": 1, "actions": [
                {"operation": "bpic19_profile", "identity": identity, "query": lineage_query,
                 "definition_id": reviewed["profile"]["definition_id"], "selection_prefix_length": 0}]}))
        revision = saved["revision"]["saved_revision_id"]
        saved_digest = digest({key: saved[key] for key in ("revision", "bpic19_outputs")})
        if self.score:
            self._score(wid, base)
        first_pid = self.service.process.pid
        self._stop()
        self._start()
        self.check("restart_is_a_new_process", self.service.process.pid != first_pid)
        self.stage("restart_open_workspace", self.post("workspaces/open", "open_workspace_request", path=workspace))
        reopened = self.stage("cold_reopen", self.post("investigations/reopen", "reopen_investigation_request", workspace_id=wid,
                                                      saved_revision_id=revision))
        self.check("reopen_identical", digest({key: reopened[key] for key in ("revision", "bpic19_outputs")}) == saved_digest)
        again = self.stage("cold_population", self.post("investigations/open-population", "open_population_request",
                                                        workspace_id=wid, preparation_id=prepared_ids[self.prepared.name]))
        self.check("cold_population_identity", again["identity"] == base)
        if self.after_reopen is not None:
            self.after_reopen(self, wid, revision, kept[0])
        result["identities"] = {"native": populations[self.native.name], "prepared": base}
        result["saved_payload_sha256"] = saved_digest

    def _score(self, wid: str, base: dict) -> None:
        settings = {"profile": "paper", "criteria_family": "full", "view": "Balanced", "mode": "flat", "gamma": 0,
                    "group_by": ["company", "spend_area"], "min_cases": 1, "volume": "cases", "exposure_policy": "max_absolute_p95"}
        self.sampler.mark()
        started = time.perf_counter()
        response = self.service.client.post("/api/investigations/bpic19-score", json=envelope(
            "bpic19_score_request", workspace_id=wid, base_identity=base,
            named_population={"name": "Capacity journey", "identity": base}, roles=self.measure_roles, settings=settings,
            case_offset=0, case_limit=200))
        seconds = time.perf_counter() - started
        peak, retained = self.sampler.settled(3 * self.sampler.interval)
        body = response.json()
        # Scoring has its own admission; a refusal is measured and recorded, not a journey failure.
        self.stages.append({"stage": "method_scoring", "seconds": round(seconds, 4), "peak_rss_bytes": peak, "retained_rss_bytes": retained,
                            "reply_bytes": len(response.content), "status": response.status_code,
                            "refusal": None if response.status_code == 200 else {"code": body.get("code"), "message": body.get("message")}})


def _utc(policies: dict) -> bool:
    return policies["time"]["id"] != "incident.time.wall_clock_as_recorded.v1"


def _cutoff_key(policies: dict) -> str:
    return "snapshot_cutoff_utc" if _utc(policies) else "snapshot_cutoff_local"
