"""The BPIC19 descriptive journey over a native and a prepared source, measured through the real service.

Each operation is a real HTTP request to a service started on loopback. A sampler reads the resident memory of
the service's process tree while the request runs, so every stage records its wall time, peak and retained
service memory and the size of its reply. Answers are checked against what the caller expects as they arrive.

The process tree's memory is read from ``ps`` on POSIX and Windows working sets on Windows.
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

from process_memory import tree_rss

ROOT = Path(__file__).resolve().parents[1]
CONTEXT_POLICY = "incident.context.first_record_in_declared_order.v1"
LINEAGE_POLICY = "bpic19.same_position_category_lineage.v1"
PROFILE_POLICY = "bpic19.all_raw_case_attributes.v1"
FAR_CUTOFF = "9999-12-31T23:59:59"


def envelope(message_type: str, request_id: str = "capacity-1", revision: int = 1, **fields) -> dict:
    return {"schema_version": 1, "message_type": message_type, "request_id": request_id, "query_revision": revision, **fields}


def digest(value: object) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()


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
    """The product service on an ephemeral loopback port, over one workspace folder, with its own log.

    Without a workspace folder the service chooses the per-user default itself, as an installed application does.
    """

    def __init__(self, workspace: Path | None, log: Path) -> None:
        self.workspace, self.log = workspace, log
        self.process: subprocess.Popen | None = None
        self.client: httpx.Client | None = None
        self.port = 0

    def start(self, env: dict | None = None) -> None:
        """Start on a fresh port; ``env`` adds settings for this process only, such as a lower memory budget."""
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            self.port = sock.getsockname()[1]
        code = ("from pathlib import Path; import uvicorn; from wise_platform_api.app import create_app; "
                f"uvicorn.run(create_app(workspace_path={'None' if self.workspace is None else f'Path({str(self.workspace)!r})'}),"
                f"host='127.0.0.1',port={self.port},log_level='error')")
        env = {**os.environ, "PYTHONDONTWRITEBYTECODE": "1",
               "PYTHONPATH": os.pathsep.join(str(ROOT / part) for part in ("apps/api/src", "packages/analytics/src")), **(env or {})}
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
    document_count: int | None = None
    """Known purchasing documents in the profile's population, when known independently."""
    source_review: dict | None = None
    """A reviewed source interpretation to profile with, and what its review must show:
    ``{"interpretation": {...}, "raw_minimum_prefix": "1948-", "raw_maximum_prefix": "2020-"}``."""
    ranking_shared_counts: dict | None = None
    """Groups shared by the gamma-0 top ten and each other policy's top ten: ``{"mean_penalty": 6, ...}``."""
    paper_workflow: dict | None = None
    """The paper's full ten-criterion workflow and its printed targets, checked at their printed rounding:
    ``{"views": ["Balanced", ...], "reference_mean_penalty": .101358, "mean_coverage": .7876,
    "groups": [{"company": "0000", "spend_area": "Packaging", "n_cases": 109199, "mean_penalty": .117624, "PI": 1776.19}],
    "refusal_budget_bytes": 4294967296}``. The Balanced run is saved, reopened and shown in the browser."""
    historical_workflow: dict | None = None
    """The separate historical notebook profile in each of its views: ``{"views": ["Finance", ...], "gamma": 20}``.
    Every view's run is saved in the revision and read back in the browser as a retained assessment."""
    timing_exemplar: dict | None = None
    """A named item's independently known C04 interval:
    ``{"case_id": ..., "invoice_date": "2018-02-16", "clearing_date": "2018-04-26", "days": 69.040972, "deviation": 0.650683}``."""


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
        self.paper_shown: dict | None = None
        self.historical_shown: list[dict] | None = None
        """Each retained historical view's label and summary, as the browser must show them."""
        """What the browser must show of the saved paper run, rendered from its HTTP answer."""
        self.workload_refusal: dict | None = None
        self.workspace = folder / "workspace"
        self.workspace.mkdir(mode=0o700)
        self.service = Service(self.workspace, folder / "service.log")
        self.sampler: MemorySampler | None = None
        self.stages: list[dict] = []
        self.checks: list[str] = []
        self.exits: list[dict] = []

    # Mechanics -----------------------------------------------------------------------------

    def _start(self, env: dict | None = None) -> None:
        self.service.start(env)
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

    def restart(self, env: dict | None = None) -> None:
        """Stop the service, wait for its exit, and open the workspace again in a new process."""
        first_pid = self.service.process.pid
        self._stop()
        self._start(env)
        self.check("restart_is_a_new_process", self.service.process.pid != first_pid)
        self.stage("restart_open_workspace", self.post("workspaces/open", "open_workspace_request", path=str(self.workspace)))

    def check(self, name: str, condition: bool, detail: object = None) -> None:
        if not condition:
            with (self.folder / "journey-detail.log").open("a") as log:
                log.write(f"{name}: {detail!r}\n")
            raise Failed(name)
        self.checks.append(name)

    def _check_timing_exemplar(self, wid: str, base: dict, exemplar: dict) -> None:
        """The named item's independent invoice and clearing minima, their days, and the native C04 deviation."""
        selected = self.stage("exemplar_selection", self.post("investigations/select-cases", "select_cases_request", workspace_id=wid,
            identity=base, parent_case_ids=None, predicates=[{"kind": "case_id_in", "case_ids": [exemplar["case_id"]], "negate": False}]))
        identity = selected["identity"]
        query = {"policy_id": "bpic19.source_witnessed_measures.v1", "measure_profile": "paper_v1", "roles": self.measure_roles,
                 "offset": 0, "limit": 1, "calibration_population": "parent"}
        measured = self.stage("exemplar_measures", self.post("investigations/bpic19-measures", "bpic19_measures_request",
                                                             workspace_id=wid, identity=identity, query=query))
        interval = measured["cases"][0]["measures"]["invoice_to_clearing_days"]
        self.check("exemplar_c04_endpoints", (interval.get("activation_timestamp") or "")[:10] == exemplar["invoice_date"]
                   and (interval.get("response_timestamp") or "")[:10] == exemplar["clearing_date"])
        self.check("exemplar_c04_days", interval["value"] is not None and abs(interval["value"] - exemplar["days"]) < 1e-6)
        settings = {"profile": "paper", "criteria_family": "completion_timing", "view": "Balanced", "mode": "flat", "gamma": 0,
                    "group_by": ["company", "spend_area"], "min_cases": 1, "volume": "cases", "exposure_policy": "max_absolute_p95"}
        scored = self.stage("exemplar_timing_score", self.post("investigations/bpic19-score", "bpic19_score_request", workspace_id=wid,
            base_identity=base, named_population={"name": "Timing exemplar", "identity": identity}, roles=self.measure_roles,
            settings=settings, case_offset=0, case_limit=1))
        cases = scored.get("report", {}).get("case_page", {}).get("cases", [])
        c04 = next((entry for entry in cases[0]["criteria"] if entry["criterion_id"] == "C04"), {}) if cases else {}
        self.check("exemplar_c04_deviation", c04.get("deviation") is not None and abs(c04["deviation"] - exemplar["deviation"]) < 1e-6)
        if "group_values" in exemplar:
            # The group's timing exemplar: the positive item nearest the median of every C04-evaluable member.
            grouped = self.stage("exemplar_group_score", self.post("investigations/bpic19-score", "bpic19_score_request", workspace_id=wid,
                base_identity=base, named_population={"name": "Timing exemplar groups", "identity": base}, roles=self.measure_roles,
                settings={**settings, "group_by": sorted(exemplar["group_values"])}, case_offset=0, case_limit=1))
            rows = [row for row in grouped.get("report", {}).get("exemplars", [])
                    if all(row.get(key) == value for key, value in exemplar["group_values"].items())]
            chosen = rows[0] if len(rows) == 1 else {}
            self.check("exemplar_is_the_group_timing_witness", chosen.get("case_id") == exemplar["case_id"]
                       and abs((chosen.get("measurement_days") or 0) - exemplar["days"]) < 1e-6
                       and abs((chosen.get("reference_median_days") or 0) - exemplar["days"]) < 1e-6
                       and chosen.get("row_ids") == interval.get("row_ids") and len(chosen.get("row_ids", [])) == 2)

    def _check_completion_cohorts(self, wid: str, identity: dict, result: dict) -> None:
        """Completion is displayed with no exclusion chosen: every item, record and document is retained, open and
        unknown completions included."""
        clock = "utc_instant" if _utc(self.prepared.policies) else "wall_clock"
        query = {"policy_id": "bpic19.flow_completion_cohorts.v1",
                 "roles": {"item_category": self.prepared_roles["item_category"], "purchasing_document": self.prepared_roles["purchasing_document"]},
                 "inclusion": {"kind": "all_items", "timestamp_kind": clock, "start_inclusive": None, "end_exclusive": None},
                 "completion": {"recipe": "flow_presence", "receipt": "goods_only", "tie_policy": "unknown"},
                 "retain": "all_included", "horizon": {"timestamp_kind": clock, "value": None, "provenance": None},
                 "page": {"offset": 0, "limit": 20}}
        answer = self.stage("completion_cohorts", self.post("investigations/bpic19-cohorts", "bpic19_cohorts_request",
                                                            workspace_id=wid, identity=identity, query=query))
        cohorts = answer["cohorts"]
        retained = cohorts["retention"]["retained"]
        groups = {group["state"]: group["case_count"] for group in cohorts["completion_groups"]}
        summary = {"original": cohorts["original"], "retained": {key: retained[key] for key in ("case_count", "record_count", "document_count")},
                   "completion_case_counts": groups}
        result["completion_cohorts"] = summary
        expected_documents = self.expected.document_count
        self.check("completion_retains_every_item", (retained["case_count"], retained["record_count"]) == (self.expected.case_count, self.expected.record_count)
                   and (expected_documents is None or retained["document_count"] == expected_documents)
                   and cohorts["inclusion"]["excluded"]["case_count"] == 0, summary)
        self.check("completion_partitions_items", sum(groups.values()) == self.expected.case_count and cohorts["partition"]["is_disjoint"], summary)
        self.check("completion_keeps_open_and_unknown_items", groups.get("open_recorded", 0) + groups.get("unknown", 0) > 0, summary)

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

    def measured(self, name: str, request) -> httpx.Response:
        """Run one request as a measured stage and return its response, whatever its status."""
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
        return response

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
        population = profiled["profile"]["population"]
        self.check("profile_population", population["case_count"] == self.expected.case_count
                   and population["record_count"] == self.expected.record_count, population)
        if self.expected.document_count is not None:
            self.check("profile_documents", population["document_count"] == self.expected.document_count, population)
        lineage_query = {**query, "category_lineage": lineage}
        review = self.expected.source_review
        if review is not None:
            lineage_query["source_interpretation"] = review["interpretation"]
        reviewed = self.stage("lineage_profile", self.post("investigations/bpic19-profile", "bpic19_profile_request",
                                                           workspace_id=wid, identity=identity, query=lineage_query))
        recorded = reviewed["profile"]["definition"].get("category_lineage") or {}
        self.check("lineage_recorded", recorded.get("origin_preparation_id") == prepared_ids[self.native.name], recorded)
        self.check("lineage_covers_every_record", recorded.get("verified_record_count") == self.expected.record_count
                   and recorded.get("origin_source_id") == "source.v1:sha256:" + self.native.sha256(), recorded)
        result["profile_population"] = reviewed["profile"]["population"]
        if review is not None:
            self._check_source_review(reviewed["profile"]["source_review"], review, result)
        measures_query = {"policy_id": "bpic19.source_witnessed_measures.v1", "measure_profile": "paper_v1", "roles": self.measure_roles,
                          "offset": 0, "limit": 100, "value_reducer": "unique_creation_value", "value_unit": "EUR",
                          "calibration_population": "selected", "value_band_edges": []}
        self._check_completion_cohorts(wid, identity, result)
        if self.expected.timing_exemplar is not None:
            self._check_timing_exemplar(wid, base, self.expected.timing_exemplar)
        measured = self.stage("default_measures", self.post("investigations/bpic19-measures", "bpic19_measures_request", workspace_id=wid,
                                                            identity=identity, query=measures_query))
        # Showing completion excludes nothing: the paper counts after it run on every item.
        self.check("measures_after_completion_unfiltered", measured.get("population_case_count") == self.expected.case_count
                   and measured.get("population_record_count") == self.expected.record_count,
                   {key: measured.get(key) for key in ("population_case_count", "population_record_count")})
        paper = self.score and self.expected.paper_workflow is not None
        balanced = self._paper_workflow(wid, base, identity, result) if paper else None
        notebook = (self._historical_workflow(wid, base, identity, result)
                    if self.score and self.expected.historical_workflow is not None else [])
        self.stage("process_graph", self.post("investigations/process-graph", "process_graph_request", workspace_id=wid, identity=identity))
        self.stage("variants", self.post("investigations/variants", "variants_request", workspace_id=wid, identity=identity))
        saved = self.stage("save", self.post(
            "investigations/save", "save_investigation_request", workspace_id=wid, investigation_id=None, expected_revision_id=None,
            name=self.saved_name, base_identity=base, selection_identity=identity,
            selection_recipe={"parent_case_ids": selected["parent"]["case_ids"], "predicates": []}, context_policy=CONTEXT_POLICY,
            comparison=None, notes="Synthetic capacity measurement", bookmarks=[], bpic19_pipeline={"schema_version": 1, "actions": [
                {"operation": "bpic19_profile", "identity": identity, "query": lineage_query,
                 "definition_id": reviewed["profile"]["definition_id"], "selection_prefix_length": 0},
                # Retained runs first; the paper's Balanced run last, so the reopened view shows it as the current assessment.
                *[{"operation": "bpic19_score", "identity": identity, "definition_id": answer["definition_id"], "selection_prefix_length": 0,
                   "query": {"run_id": answer["run_id"], "case_offset": 0, "case_limit": 50, "group_offset": 0, "group_limit": 50}}
                  for answer in [*notebook, *([balanced] if balanced is not None else [])]]]}))
        revision = saved["revision"]["saved_revision_id"]
        saved_digest = digest({key: saved[key] for key in ("revision", "bpic19_outputs")})
        if self.score and not paper:
            self._score(wid, base)
        if getattr(self, "ranking", None) is not None:
            result["ranking_comparisons"] = self.ranking
        self.restart()
        reopened = self.stage("cold_reopen", self.post("investigations/reopen", "reopen_investigation_request", workspace_id=wid,
                                                      saved_revision_id=revision))
        self.check("reopen_identical", digest({key: reopened[key] for key in ("revision", "bpic19_outputs")}) == saved_digest)
        again = self.stage("cold_population", self.post("investigations/open-population", "open_population_request",
                                                        workspace_id=wid, preparation_id=prepared_ids[self.prepared.name]))
        self.check("cold_population_identity", again["identity"] == base)
        if self.after_reopen is not None:
            self.after_reopen(self, wid, revision, kept[0])
        if paper:
            self._workload_refusal(wid, identity, base)
            result["workload_refusal"] = self.workload_refusal
        result["identities"] = {"native": populations[self.native.name], "prepared": base}
        result["saved_payload_sha256"] = saved_digest

    def _check_source_review(self, answer: dict, review: dict, result: dict) -> None:
        """The reviewed horizon is kept apart from the raw range, and no record leaves the population for it."""
        horizon = review["interpretation"]["horizon"]
        state = "unknown" if horizon["value"] is None else "reviewed"
        self.check("source_review_horizon", answer["horizon_state"] == state and answer["interpretation"]["horizon"] == horizon, answer["interpretation"])
        self.check("source_review_raw_range", (answer["observed_raw_minimum"] or "").startswith(review["raw_minimum_prefix"])
                   and (answer["observed_raw_maximum"] or "").startswith(review["raw_maximum_prefix"]),
                   (answer["observed_raw_minimum"], answer["observed_raw_maximum"]))
        raw = answer["raw_support"]
        self.check("source_review_keeps_every_record", raw["case_count"] == self.expected.case_count and raw["record_count"] == self.expected.record_count
                   and answer["excluded"]["case_count"] == 0 and answer["retained"]["record_count"] == self.expected.record_count, raw)
        anomalies = {anomaly["state"]: anomaly["record_count"] for anomaly in answer["anomalies"]}
        if horizon["value"] is not None:
            self.check("source_review_shows_post_horizon_records", anomalies.get("after_trusted_horizon", 0) > 0, anomalies)
        for witnessed in review.get("witness_states", []):
            self.check(f"source_review_shows_{witnessed}", anomalies.get(witnessed, 0) > 0, anomalies)
        result["source_review"] = {"observed_raw_minimum": answer["observed_raw_minimum"], "observed_raw_maximum": answer["observed_raw_maximum"],
                                   "horizon": horizon, "parser_cutoff": answer["parser_cutoff"], "anomaly_record_counts": anomalies,
                                   "discrepancies": [{key: entry[key] for key in ("reference", "reported_total", "reported_subtotal", "difference", "measured_parent_case_count")}
                                                     for entry in answer["discrepancies"]]}

    def _paper_workflow(self, wid: str, base: dict, identity: dict, result: dict) -> dict:
        """The paper's ten criteria in each declared view on every item, its printed targets and the workload measured
        around it: a warm repeat, group queries, deep paging, the page limit, the native export and an abandoned request.
        Returns the Balanced run, which the journey saves, reopens and shows in the browser."""
        paper = self.expected.paper_workflow
        settings = {"profile": "paper", "criteria_family": "full", "view": "Balanced", "mode": "flat", "gamma": 0,
                    "group_by": ["company", "spend_area"], "min_cases": 1, "volume": "cases", "exposure_policy": "max_absolute_p95"}

        def score(**change):
            return self.post("investigations/bpic19-score", "bpic19_score_request", workspace_id=wid, base_identity=base,
                             named_population={"name": "Paper workflow", "identity": identity}, roles=self.measure_roles,
                             settings={**settings, **change}, case_offset=0, case_limit=50)

        def read(run_id: str, **fields):
            return self.post("investigations/bpic19-read", "bpic19_read_request", workspace_id=wid, run_id=run_id,
                             group_offset=0, group_limit=50, **{"case_offset": 0, "case_limit": 50, **fields})

        answers = {view: self.stage(f"paper_scoring_{view.lower()}", score(view=view)) for view in paper["views"]}
        for view, answer in answers.items():
            report = answer["report"]
            self.check(f"paper_{view.lower()}_keeps_every_item", report["population_case_count"] == self.expected.case_count, report["population_case_count"])
            self.check(f"paper_{view.lower()}_ten_criteria", report["requested_criterion_count"] == 10 and report["profile_complete"] is True,
                       (report["requested_criterion_count"], report["profile_complete"]))
        self.check("paper_views_are_distinct_runs", len({answer["run_id"] for answer in answers.values()}) == len(answers))
        balanced = answers["Balanced"]
        report = balanced["report"]
        self.check("paper_reference_mean_penalty", abs(1 - report["mean_score"] - paper["reference_mean_penalty"]) <= 5e-7, report["mean_score"])
        self.check("paper_mean_coverage", abs(report["mean_coverage"] - paper["mean_coverage"]) <= 5e-5, report["mean_coverage"])
        if "group_count" in paper:
            self.check("paper_group_count", report["group_page"]["total"] == paper["group_count"], report["group_page"]["total"])
        rows = {(row.get("company"), row.get("spend_area")): row for row in report["groups"]}
        exemplars = {(entry.get("company"), entry.get("spend_area")): entry for entry in report.get("exemplars", [])}
        shown = {"summary": f"{shown_number(report['scored_case_count'])} of {shown_number(report['population_case_count'])} items scored · "
                            f"mean score {shown_number(report['mean_score'])} · mean evidence coverage {shown_number(report['mean_coverage'])}",
                 "groups": []}
        summary = {"run_ids": {view: answer["run_id"] for view, answer in answers.items()}, "groups": []}
        for target in paper["groups"]:
            key = (target["company"], target["spend_area"])
            slug = "_".join(part for part in "".join(c if c.isalnum() else " " for c in target["spend_area"].lower()).split())
            row = rows.get(key)
            self.check(f"paper_group_{slug}", row is not None and row["n_cases"] == target["n_cases"]
                       and abs(1 - row["mean_score"] - target["mean_penalty"]) <= 5e-7 and abs(row["PI"] - target["PI"]) <= 5e-3,
                       None if row is None else {k: row[k] for k in ("n_cases", "mean_score", "PI")})
            members = self.stage(f"group_query_{slug}", read(balanced["run_id"], case_filter={"group_values": dict(zip(("company", "spend_area"), key))}))
            total = members["report"]["case_page"]["total"]
            self.check(f"group_query_{slug}_members", total >= row["n_cases"], total)
            exemplar = exemplars.get(key)
            shown["groups"].append({"label": " · ".join(key), "members": total, "exemplar": None if exemplar is None else exemplar["case_id"],
                                    "row": "".join(shown_number(row[column]) for column in ("company", "spend_area", "n_cases", "mean_score", "volume", "PI", "stable_PI", "global_mean"))})
            summary["groups"].append({"group": list(key), "n_cases": row["n_cases"], "members": total, "mean_penalty": 1 - row["mean_score"], "PI": row["PI"],
                                      "exemplar": None if exemplar is None else {k: exemplar[k] for k in ("case_id", "deviation", "reference_median_days")}})
        warm = self.stage("paper_scoring_warm", score())
        self.check("paper_warm_is_the_same_run", warm["run_id"] == balanced["run_id"], warm["run_id"])
        last = self.stage("case_paging_last", read(balanced["run_id"], case_offset=self.expected.case_count - 100, case_limit=200))
        self.check("case_paging_last_page", len(last["report"]["case_page"]["cases"]) == 100 and last["report"]["case_page"]["total"] == self.expected.case_count,
                   last["report"]["case_page"]["total"])
        limited = self.measured("page_limit_refusal", read(balanced["run_id"], case_limit=201))
        self.check("page_limit_refused", limited.status_code == 400 and limited.json().get("field") == "case_limit", limited.text[:500])
        exported = self.measured("native_export", lambda client: client.post("/api/investigations/bpic19-export", json=envelope(
            "bpic19_export_request", workspace_id=wid, run_id=balanced["run_id"], case_offset=0, case_limit=50)))
        import io
        import zipfile
        self.check("native_export_succeeds", exported.status_code == 200, exported.text[:500] if exported.status_code != 200 else None)
        with zipfile.ZipFile(io.BytesIO(exported.content)) as archive:
            names = archive.namelist()
        artifacts = balanced["snapshot"]["artifacts"]
        self.check("native_export_is_exactly_the_run", len(names) == 1 + len(artifacts) and "manifest.json" in names, len(names))
        summary["export"] = {"bytes": len(exported.content), "files": len(names), "artifact_bytes": sum(ref.get("byte_count", 0) for ref in artifacts)}
        # An abandoned request: the client stops waiting; the service must stay up and answer the same request later.
        abandoned = {"settings": {"view": "Operations", "gamma": 20}}
        started = time.perf_counter()
        try:
            with httpx.Client(base_url=f"http://127.0.0.1:{self.service.port}", timeout=2.0, trust_env=False) as impatient:
                impatient.post("/api/investigations/bpic19-score", json=envelope(
                    "bpic19_score_request", workspace_id=wid, base_identity=base, named_population={"name": "Paper workflow", "identity": identity},
                    roles=self.measure_roles, settings={**settings, "view": "Operations", "gamma": 20}, case_offset=0, case_limit=50))
            abandoned["client_abandoned"] = False
        except httpx.TimeoutException:
            abandoned["client_abandoned"] = True
        abandoned["abandoned_after_seconds"] = round(time.perf_counter() - started, 3)
        health = self.measured("health_after_abandon", lambda client: client.get("/api/health"))
        self.check("service_answers_after_abandon", health.status_code == 200 and self.service.process.poll() is None, health.status_code)
        repeated = self.stage("abandoned_request_repeated", score(view="Operations", gamma=20))
        abandoned["repeated_run_id"] = repeated["run_id"]
        summary["abandoned_request"] = abandoned
        if self.expected.ranking_shared_counts is not None:
            self._score(wid, base, balanced)
        result["paper_workflow"] = summary
        self.paper_shown = shown
        return balanced

    def _historical_workflow(self, wid: str, base: dict, identity: dict, result: dict) -> list[dict]:
        """The historical notebook's 29 criteria in each of its views on every item, each its own run."""
        historical = self.expected.historical_workflow
        answers = []
        for view in historical["views"]:
            settings = {"profile": "historical", "criteria_family": "full", "view": view, "mode": "layer_balanced", "gamma": historical["gamma"],
                        "group_by": ["company", "spend_area"], "min_cases": 1, "volume": "cases", "exposure_policy": "max_absolute_p95"}
            answer = self.stage(f"historical_scoring_{view.lower()}", self.post(
                "investigations/bpic19-score", "bpic19_score_request", workspace_id=wid, base_identity=base,
                named_population={"name": "Historical notebook", "identity": identity}, roles=self.measure_roles, settings=settings,
                case_offset=0, case_limit=50))
            report = answer["report"]
            self.check(f"historical_{view.lower()}_keeps_every_item", report["population_case_count"] == self.expected.case_count, report["population_case_count"])
            self.check(f"historical_{view.lower()}_all_29_admitted", report["profile_id"] == "bpic19.notebook.1.0-paper-aligned.v1"
                       and report["requested_criterion_count"] == 29 and report["admitted_criterion_count"] == 29 and report["profile_complete"] is True and not report["omissions"],
                       (report["profile_id"], report["admitted_criterion_count"], len(report["omissions"])))
            self.check(f"historical_{view.lower()}_calibrates_on_the_parent", answer["snapshot"]["workload_admission"]["includes_calibration_parent"] is True,
                       answer["snapshot"]["workload_admission"].get("includes_calibration_parent"))
            answers.append(answer)
        self.check("historical_views_are_distinct_runs", len({answer["run_id"] for answer in answers}) == len(answers))
        self.check("historical_views_share_one_calibration", len({json.dumps(answer["report"].get("exposure_calibration"), sort_keys=True) for answer in answers}) == 1)
        result["historical_workflow"] = [{"view": answer["report"]["settings"]["view"], "run_id": answer["run_id"], "definition_id": answer["definition_id"],
                                          "scored_case_count": answer["report"]["scored_case_count"], "mean_score": answer["report"]["mean_score"],
                                          "mean_coverage": answer["report"]["mean_coverage"]} for answer in answers]
        self.historical_shown = [{"label": f"Historical notebook · {answer['report']['settings']['view']} · layer balanced · gamma {shown_number(answer['report']['settings']['gamma'])} · Scored item count",
                                  "summary": f"{shown_number(answer['report']['scored_case_count'])} of {shown_number(answer['report']['population_case_count'])} items scored · "
                                             f"mean score {shown_number(answer['report']['mean_score'])} · mean evidence coverage {shown_number(answer['report']['mean_coverage'])}"}
                                 for answer in answers]
        return answers

    def _workload_refusal(self, wid: str, identity: dict, base: dict) -> None:
        """A fresh process under a lower stated memory budget must refuse new scoring explicitly and publish nothing."""
        budget = self.expected.paper_workflow["refusal_budget_bytes"]
        runs = self.workspace / "runs"
        before = sorted(path.name for path in runs.rglob("*")) if runs.exists() else []
        self.restart(env={"WISE_MEMORY_BUDGET_BYTES": str(budget)})
        settings = {"profile": "paper", "criteria_family": "full", "view": "Completion", "mode": "layer_balanced", "gamma": 20,
                    "group_by": ["company", "spend_area"], "min_cases": 1, "volume": "cases", "exposure_policy": "max_absolute_p95"}
        # A fresh process knows the opened source population, not a selection that was never replayed in it.
        refused = self.measured("workload_limit_refusal", lambda client: client.post("/api/investigations/bpic19-score", json=envelope(
            "bpic19_score_request", workspace_id=wid, base_identity=base, named_population={"name": "Paper workflow", "identity": base},
            roles=self.measure_roles, settings=settings, case_offset=0, case_limit=50)))
        body = refused.json() if refused.headers.get("content-type", "").startswith("application/json") else {}
        self.check("workload_limit_refused", refused.status_code == 503 and body.get("code") == "memory_unavailable",
                   (refused.status_code, body.get("code"), body.get("field"), body.get("message")))
        after = sorted(path.name for path in runs.rglob("*")) if runs.exists() else []
        self.check("workload_limit_published_nothing", after == before, len(after) - len(before))
        self.workload_refusal = {"budget_bytes": budget, "code": body.get("code"), "field": body.get("field"), "message": body.get("message")}

    def _score(self, wid: str, base: dict, answer: dict | None = None) -> None:
        settings = {"profile": "paper", "criteria_family": "full", "view": "Balanced", "mode": "flat", "gamma": 0,
                    "group_by": ["company", "spend_area"], "min_cases": 1, "volume": "cases", "exposure_policy": "max_absolute_p95"}
        if answer is None:
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
            succeeded = response.status_code == 200
        else:
            body, succeeded = answer, True
        if succeeded and self.expected.ranking_shared_counts is not None:
            policies = body["report"]["ranking_comparisons"]["group_policies"]
            keys = lambda rows: [tuple(row.get(key) for key in settings["group_by"]) for row in rows]
            primary = keys(policies["PI_gamma_0"])
            shared = {name: len(set(primary) & set(keys(policies[name]))) for name in self.expected.ranking_shared_counts}
            self.ranking = {"shared_with_PI_gamma_0_top_ten": shared, "same_first_rank": {name: keys(policies[name])[:1] == primary[:1] for name in shared},
                            "same_order": {name: keys(policies[name]) == primary for name in shared}, "top_ten_size": len(primary)}
            self.check("ranking_shared_counts", shared == self.expected.ranking_shared_counts, self.ranking)


def shown_number(value) -> str:
    """A number as the purchasing view shows it: en-US grouping and at most six decimals, halves away from zero."""
    from decimal import ROUND_HALF_UP, Decimal
    if value is None:
        return "Unavailable"
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return str(value)
    # The shortest decimal form, as JavaScript rounds it, not the binary value's exact expansion.
    exact = Decimal(repr(value)).quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)
    whole, _, fraction = format(abs(exact), "f").partition(".")
    fraction = fraction.rstrip("0")
    text = f"{int(whole):,}" + (f".{fraction}" if fraction else "")
    return ("-" if exact < 0 else "") + text


def _utc(policies: dict) -> bool:
    return policies["time"]["id"] != "incident.time.wall_clock_as_recorded.v1"


def _cutoff_key(policies: dict) -> str:
    return "snapshot_cutoff_utc" if _utc(policies) else "snapshot_cutoff_local"
