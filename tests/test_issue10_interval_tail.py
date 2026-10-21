"""#10: one supported interval, its distribution over a frozen parent, and its tail as a strict or inclusive step.

Against hand-written oracles: tests/fixtures/intervals (repeats, measured zero, a response tied with its start, a
response only before it, missing endpoints, an unknown order, a long interval) and the exact four-hour fixture of
tests/fixtures/incidents, whose strict and inclusive readings differ only at exactly four hours. The step keeps whole
incidents; saving and reopening keep its definition.
"""

import json
from pathlib import Path

from fastapi.testclient import TestClient
import pytest

from test_import_acceptance import envelope, evidence, policies, population, prepare, upload
from wise_platform_api.app import create_app

ROOT = Path(__file__).resolve().parents[1]
EXPECTED = json.loads((ROOT / "tests/fixtures/intervals/expected.json").read_text(encoding="utf-8"))
THRESHOLD = json.loads((ROOT / "tests/fixtures/incidents/threshold_expected.json").read_text(encoding="utf-8"))


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(static_dir=tmp_path / "unbuilt")) as active:
        yield active


def read(client, tmp_path, raw, filename, mapping, cutoff):
    folder = tmp_path / filename.replace(".", "-")
    folder.mkdir()
    workspace = client.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(folder))).json()
    source = upload(client, workspace, raw, filename)
    chosen = policies()
    chosen["time"]["parameters"]["snapshot_cutoff_utc"] = cutoff
    request = envelope("confirm_mapping_request", workspace_id=workspace["workspace_id"], source_id=source["source_id"],
                       dialect={"encoding": "utf-8", "delimiter": ",", "quotechar": '"', "header": "first_record"},
                       mapping=mapping, policies=chosen, accept_report_issues=True)
    return workspace, population(client, workspace, prepare(client, request))


@pytest.fixture
def intervals(client, tmp_path):
    return read(client, tmp_path, (ROOT / "tests/fixtures/intervals" / EXPECTED["file"]).read_bytes(), EXPECTED["file"], dict(EXPECTED["mapping"]), EXPECTED["cutoff_utc"])


def step(interval, operator, hours, negate=False):
    return {"kind": "interval_threshold", "interval": interval, "operator": operator, "hours": hours, "negate": negate}


def select(client, workspace, base, predicates):
    response = client.post("/api/investigations/select-cases", json=envelope("select_cases_request", "select-1", 2, workspace_id=workspace["workspace_id"],
                           identity=base["identity"], parent_case_ids=None, predicates=predicates))
    assert response.status_code == 200, response.text
    return response.json()


def distribution(client, workspace, identity, interval, edges, case_limit=100):
    return client.post("/api/investigations/interval-distribution", json=envelope("interval_distribution_request", "interval-1", 3,
                       workspace_id=workspace["workspace_id"], identity=identity, interval=interval, edges_hours=edges, case_limit=case_limit))


def test_the_distribution_measures_each_incident_and_names_every_missing_reason(client, intervals):
    workspace, base = intervals
    response = distribution(client, workspace, base["identity"], EXPECTED["interval"], EXPECTED["edges_hours"])
    assert response.status_code == 200, response.text
    answer = response.json()
    assert (answer["unit"], answer["clock"]["duration_basis"], answer["interval"]) == ("hours", "elapsed_utc", EXPECTED["interval"])
    assert [item["parent_case_count"] for item in answer["bins"]] == EXPECTED["bins"]
    assert [item["kept_case_count"] for item in answer["bins"]] == EXPECTED["bins"]
    assert {item["reason"]: item["parent_case_count"] for item in answer["unavailable"]} == EXPECTED["unavailable"]
    cases = {item["case_id"]: item for item in answer["cases"]}
    assert {case: item["hours"] for case, item in cases.items() if item["hours"] is not None} == EXPECTED["hours"]
    assert {case: item["reason"] for case, item in cases.items() if item["reason"] is not None} == EXPECTED["reasons"]
    # A missing endpoint is never zero: the measured zeros are measured, the missing have no value.
    assert all(item["hours"] is None for item in cases.values() if item["reason"] is not None)
    # The witness of an interval names its two rows; they are the start and the response of the oracle.
    witness = EXPECTED["witness"]
    rows = {row["row_id"]: row["source_position"] for row in evidence(client, workspace, base, witness["case"])["records"]}
    assert (rows[cases[witness["case"]]["start_row_id"]], rows[cases[witness["case"]]["response_row_id"]]) == (witness["start_position"], witness["response_position"])
    assert (cases[witness["case"]]["start_source_position"], cases[witness["case"]]["response_source_position"]) == (witness["start_position"], witness["response_position"])


@pytest.mark.parametrize("name", ["strict_4", "inclusive_4"])
def test_a_tail_keeps_whole_incidents_strictly_or_inclusively(client, intervals, name):
    workspace, base = intervals
    expected = EXPECTED[name]
    selected = select(client, workspace, base, [step(EXPECTED["interval"], expected["operator"], expected["hours"])])
    assert (selected["kept"]["case_ids"], selected["removed"]["case_ids"], selected["unevaluable"]["case_ids"]) == (expected["kept"], expected["removed"], expected["unevaluable"])
    # Whole incidents: every record of a kept incident remains.
    for case in expected["kept"]:
        assert len(evidence(client, workspace, selected, case)["records"]) == len(evidence(client, workspace, base, case)["records"])
    # Bins stay those of the frozen parent; the kept counts follow the step.
    answer = distribution(client, workspace, selected["identity"], EXPECTED["interval"], EXPECTED["edges_hours"]).json()
    assert [item["parent_case_count"] for item in answer["bins"]] == EXPECTED["bins"]
    assert answer["measured"]["kept_case_count"] == len(expected["kept"])
    # Negated, the unevaluable stay unevaluable: missing evidence is never a negated match.
    negated = select(client, workspace, base, [step(EXPECTED["interval"], expected["operator"], expected["hours"], True)])
    assert (negated["kept"]["case_ids"], negated["unevaluable"]["case_ids"]) == (expected["removed"], expected["unevaluable"])


def test_the_exact_four_hour_fixture_separates_strict_from_inclusive(client, tmp_path):
    raw = (ROOT / "tests/fixtures/incidents" / THRESHOLD["fixture"]).read_bytes()
    workspace, base = read(client, tmp_path, raw, THRESHOLD["fixture"], {"case_column": 0, "activity_column": 3, "timestamp_column": 4,
                           "sequence_column": 2, "context_columns": []}, "2026-10-02T00:00:00Z")
    interval = {**EXPECTED["interval"], "start_activity": "Opened", "response_activity": "Resolved"}
    for reading in ("strict", "inclusive"):
        expected = THRESHOLD[reading]
        selected = select(client, workspace, base, [step(interval, expected["operator"], expected["hours"])])
        assert (selected["kept"]["case_ids"], sorted(selected["removed"]["case_ids"]), selected["unevaluable"]["case_ids"]) == (
            expected["true_ids"], sorted(expected["false_ids"]), expected["unevaluable_ids"])
    measured = {item["case_id"]: item["hours"] for item in distribution(client, workspace, base["identity"], interval, [0, 4]).json()["cases"]}
    assert measured == THRESHOLD["measured_hours"]


def test_refusals_and_a_saved_tail_reopen_with_its_definition(client, intervals):
    workspace, base = intervals
    bad = distribution(client, workspace, base["identity"], EXPECTED["interval"], [1, 4])
    assert (bad.status_code, bad.json()["code"], bad.json()["field"]) == (400, "invalid_parameter", "edges_hours")
    other = distribution(client, workspace, base["identity"], {**EXPECTED["interval"], "policy": "incident.interval.last_start.v1"}, EXPECTED["edges_hours"])
    assert (other.status_code, other.json()["code"]) == (400, "unsupported_policy")
    refused = client.post("/api/investigations/select-cases", json=envelope("select_cases_request", "select-x", 2, workspace_id=workspace["workspace_id"],
                          identity=base["identity"], parent_case_ids=None, predicates=[step(EXPECTED["interval"], "gte", 4)]))
    assert refused.status_code in (400, 422) and refused.json()["field"].startswith("predicates.0")
    tail = [step(EXPECTED["interval"], "gt", 4)]
    selected = select(client, workspace, base, tail)
    saved = client.post("/api/investigations/save", json=envelope("save_investigation_request", workspace_id=workspace["workspace_id"], investigation_id=None,
        expected_revision_id=None, name="Invented interval tail", base_identity=base["identity"], selection_identity=selected["identity"],
        selection_recipe={"parent_case_ids": selected["parent"]["case_ids"], "predicates": tail},
        context_policy="incident.context.first_record_in_declared_order.v1", comparison=None, notes="", bookmarks=[]))
    assert saved.status_code == 200, saved.text
    reopened = client.post("/api/investigations/reopen", json=envelope("reopen_investigation_request", workspace_id=workspace["workspace_id"],
                           saved_revision_id=saved.json()["revision"]["saved_revision_id"])).json()
    assert reopened["restored_selection"]["identity"] == selected["identity"]
    assert reopened["revision"]["content"]["selection_recipe"]["predicates"] == tail
