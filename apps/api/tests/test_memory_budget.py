"""Memory-heavy work is admitted against one byte budget; what cannot fit is refused before it starts."""

import os
from pathlib import Path
import sys

from fastapi.testclient import TestClient
import pytest
from bpic_shaped_literal import MEASURE_ROLES, PREPARED_ROLES, arguments, native_arguments, native_source, source
from import_requests import envelope
from wise_platform_analytics import preparation
from wise_platform_api.app import create_app
from wise_platform_api.memory_budget import OPERATION_PEAK_PER_RECORD, READ_PEAK_PER_SOURCE_BYTE

ROOT = Path(__file__).resolve().parents[3]
ROWS = 3_000
LINEAGE = "bpic19.same_position_category_lineage.v1"


class Session:
    """The real application over one workspace with the invented native and prepared sources."""

    def __init__(self, client, folder, rows=ROWS):
        self.client = client
        opened = client.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(folder)))
        assert opened.status_code == 200, opened.text
        self.wid = opened.json()["workspace_id"]
        self.raw = {"native": native_source(rows), "prepared": source(rows)}
        self.interpretation = {"native": native_arguments(), "prepared": arguments()}
        self.source_ids, self.preparation_ids = {}, {}

    def post(self, route, message, status=200, **fields):
        response = self.client.post("/api/" + route, json=envelope(message, workspace_id=self.wid, **fields))
        assert response.status_code == status, response.text
        return response.json()

    def import_source(self, name):
        stored = self.client.put("/api/sources", params=envelope("upload_source_metadata", workspace_id=self.wid, filename=f"{name}.csv"),
                                 content=self.raw[name], headers={"Content-Type": "application/octet-stream"})
        self.source_ids[name] = stored.json()["source"]["source_id"]
        dialect, mapping, policies = self.interpretation[name]
        confirmed = self.post("preparations", "confirm_mapping_request", source_id=self.source_ids[name], dialect=dialect,
                              mapping=mapping, policies=policies, accept_report_issues=True)
        self.preparation_ids[name] = confirmed["preparation"]["preparation_id"]

    def population(self, name, status=200):
        return self.post("investigations/open-population", "open_population_request", status=status, preparation_id=self.preparation_ids[name])

    def lineage_profile(self, status=200):
        base = self.population("prepared")
        query = {"roles": PREPARED_ROLES, "profile_columns": None, "policy_id": "bpic19.all_raw_case_attributes.v1",
                 "category_lineage": {"policy_id": LINEAGE, "origin_preparation_id": self.preparation_ids["native"],
                                      "origin_column_index": 9, "provenance": "Synthetic copies of one population"}}
        return self.post("investigations/bpic19-profile", "bpic19_profile_request", status=status, identity=base["identity"], query=query)


@pytest.fixture
def session(tmp_path):
    with TestClient(create_app(static_dir=tmp_path / "unbuilt")) as client:
        folder = tmp_path / "workspace"
        folder.mkdir()
        yield Session(client, folder), client.app.state.memory


@pytest.fixture
def reads(monkeypatch):
    counted = []
    original = preparation.read_csv

    def counting(raw, *args, **kwargs):
        counted.append(preparation.source_id(raw))
        return original(raw, *args, **kwargs)

    monkeypatch.setattr(preparation, "read_csv", counting)
    return counted


def held(budget, session, name):
    return budget.footprint(("preparation", session.preparation_ids[name]))


def test_a_budget_that_fits_both_sources_keeps_both_with_unchanged_answers(session, tmp_path):
    current, budget = session
    current.import_source("native")
    current.import_source("prepared")
    unlimited = current.lineage_profile()
    budget.limit = held(budget, current, "native") + held(budget, current, "prepared") + 4 * ROWS * OPERATION_PEAK_PER_RECORD
    assert current.lineage_profile() == unlimited
    assert held(budget, current, "native") and held(budget, current, "prepared")


def test_a_budget_for_one_preparation_evicts_the_older_and_rebuilds_it_identically(session, reads):
    current, budget = session
    current.import_source("native")
    current.import_source("prepared")
    populations = {name: current.population(name) for name in ("native", "prepared")}
    native, prepared = held(budget, current, "native"), held(budget, current, "prepared")
    read_peak = {name: round(len(raw) * READ_PEAK_PER_SOURCE_BYTE) for name, raw in current.raw.items()}
    operation = ROWS * OPERATION_PEAK_PER_RECORD
    # Either preparation with an operation fits; one preparation while the other is read does not.
    lower, upper = max(native, prepared) + operation, min(native + read_peak["prepared"], prepared + read_peak["native"])
    assert lower < upper
    budget.limit = (lower + upper) // 2

    assert current.population("native") == populations["native"]
    assert held(budget, current, "native") and held(budget, current, "prepared") is None
    before = len(reads)
    assert current.population("prepared") == populations["prepared"]
    assert held(budget, current, "prepared") and held(budget, current, "native") is None
    assert current.population("native") == populations["native"]
    assert len(reads) == before + 2

    before = len(reads)
    refusal = current.lineage_profile(status=503)
    assert refusal["code"] == "memory_unavailable" and refusal["retryable"] and "Nothing was read" in refusal["message"]
    # Opening the prepared population read it again; the lineage profile itself read nothing.
    assert len(reads) == before + 1


def test_a_request_too_large_for_the_budget_is_refused_and_the_service_keeps_serving(session):
    current, budget = session
    budget.limit = 1_000_000
    stored = current.client.put("/api/sources", params=envelope("upload_source_metadata", workspace_id=current.wid, filename="prepared.csv"),
                                content=current.raw["prepared"], headers={"Content-Type": "application/octet-stream"}).json()["source"]
    refusal = current.post("sources/inspect", "inspect_csv_request", status=503, source_id=stored["source_id"])
    assert refusal["code"] == "memory_unavailable" and refusal["retryable"]
    assert "its budget is 1 MB" in refusal["message"] and "WISE_MEMORY_BUDGET_BYTES" in refusal["message"]
    small = b"Case;Event;At\r\nA;Observed;09.10.2026 08:00\r\n"
    tiny = current.client.put("/api/sources", params=envelope("upload_source_metadata", workspace_id=current.wid, filename="tiny.csv"),
                              content=small, headers={"Content-Type": "application/octet-stream"}).json()["source"]
    assert current.post("sources/inspect", "inspect_csv_request", source_id=tiny["source_id"])["record_count"] == 1
    assert current.client.get("/api/health").status_code == 200


def test_scoring_that_cannot_fit_is_refused_with_the_capacity_code(session):
    current, budget = session
    current.import_source("prepared")
    base = current.population("prepared")["identity"]
    settings = {"profile": "paper", "criteria_family": "full", "view": "Balanced", "mode": "flat", "gamma": 0,
                "group_by": ["company", "spend_area"], "min_cases": 1, "volume": "cases", "exposure_policy": "max_absolute_p95"}
    request = envelope("bpic19_score_request", workspace_id=current.wid, base_identity=base, named_population={"name": "All", "identity": base},
                       roles=MEASURE_ROLES, settings=settings, case_offset=0, case_limit=10)
    budget.limit = budget.held_bytes() + ROWS * OPERATION_PEAK_PER_RECORD
    refused = current.client.post("/api/investigations/bpic19-score", json=request)
    assert refused.status_code == 503 and refused.json()["code"] == "memory_unavailable", refused.text
    budget.limit = 10 * budget.limit
    assert current.client.post("/api/investigations/bpic19-score", json=request).status_code == 200


@pytest.mark.skipif(os.name != "posix", reason="Service memory is read from the POSIX process table.")
def test_repeated_eviction_and_rebuilding_keeps_service_memory_within_the_budget(tmp_path):
    sys.path.insert(0, str(ROOT / "tools"))
    from capacity_journey import MemorySampler, Service

    rows = 30_000
    probe = tmp_path / "probe"
    probe.mkdir()
    with TestClient(create_app(static_dir=tmp_path / "unbuilt")) as client:
        measured = Session(client, probe, rows)
        measured.import_source("native")
        measured.import_source("prepared")
        memory = client.app.state.memory
        largest = max(held(memory, measured, "native"), held(memory, measured, "prepared"))
        limit = largest + round(max(map(len, measured.raw.values())) * READ_PEAK_PER_SOURCE_BYTE) + rows * OPERATION_PEAK_PER_RECORD
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    os.environ["WISE_MEMORY_BUDGET_BYTES"] = str(limit)
    service = Service(workspace, tmp_path / "service.log")
    try:
        service.start()
    finally:
        del os.environ["WISE_MEMORY_BUDGET_BYTES"]
    sampler = MemorySampler(service.process.pid, interval=0.02)
    sampler.start()
    try:
        idle = sampler.settled(0.3)[1]
        current = Session(service.client, workspace, rows)
        current.import_source("native")
        current.import_source("prepared")
        populations = {name: current.population(name) for name in ("native", "prepared")}
        sampler.mark()
        for _ in range(3):
            for name in ("native", "prepared"):
                assert current.population(name) == populations[name]
        peak = sampler.settled(0.2)[0]
    finally:
        sampler.stop()
        sampler.join(timeout=5)
        service.stop()
    assert peak <= limit + idle, (peak, limit, idle)
