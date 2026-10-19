"""#5: ties, a sequence number that disagrees with the times, missing labels and a date-only time, read through the service.

Every expectation comes from tests/fixtures/chronology/expected.json, written by hand from the order policy's
definition. A date-only time is unavailable, not midnight; a cutoff without seconds or without a time is refused; a
reading without the sequence number is another preparation of the same source, and the first keeps its meaning.
"""

from copy import deepcopy
import json
from pathlib import Path

from fastapi.testclient import TestClient
import pytest

from test_import_acceptance import envelope, evidence, policies, population, prepare, upload
from wise_platform_api.app import create_app

FIXTURES = Path(__file__).resolve().parent / "fixtures/chronology"
EXPECTED = json.loads((FIXTURES / "expected.json").read_text(encoding="utf-8"))


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(static_dir=tmp_path / "unbuilt")) as active:
        yield active


@pytest.fixture
def workspace(client, tmp_path):
    path = tmp_path / "workspace"
    path.mkdir()
    return client.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(path))).json()


def reading(workspace, source, mapping=None, cutoff=None):
    chosen = policies()
    chosen["time"]["parameters"]["snapshot_cutoff_utc"] = cutoff or EXPECTED["cutoff_utc"]
    return envelope("confirm_mapping_request", workspace_id=workspace["workspace_id"], source_id=source["source_id"],
                    dialect={"encoding": "utf-8", "delimiter": ",", "quotechar": '"', "header": "first_record"},
                    mapping=deepcopy(mapping or EXPECTED["mapping"]), policies=chosen, accept_report_issues=True)


def test_ties_disagreement_missing_labels_and_a_date_only_time_follow_the_declared_order(client, workspace):
    source = upload(client, workspace, (FIXTURES / EXPECTED["file"]).read_bytes(), EXPECTED["file"])
    prepared = prepare(client, reading(workspace, source))
    report = prepared["report"]
    assert {key: report[key] for key in EXPECTED["report"]} == EXPECTED["report"]
    issues = {}
    for issue in report["issues"]:
        issues.setdefault(issue["code"], []).append(issue["source_position"])
    assert {code: sorted(positions) for code, positions in issues.items()} == EXPECTED["issues"]
    answer = population(client, workspace, prepared)
    for case_id, expected in EXPECTED["cases"].items():
        shown = evidence(client, workspace, answer, case_id)
        records = shown["records"]
        # The declared order: time first, then the sequence number, then the position; untimed records last.
        assert [record["source_position"] for record in records] == expected["order"]
        assert shown["sequence_evaluable"] is expected["sequence_evaluable"]
        assert {str(record["source_position"]): record["timestamp_status"] for record in records} == expected["timestamp_status"]
        # A time that is not usable has no instant: a date alone is never read as midnight.
        assert all((record["utc_instant"] is None) == (record["timestamp_status"] != "usable") for record in records)
        by_row = {record["row_id"]: record for record in records}
        assert [by_row[row]["activity"] for row in shown["mapped_row_ids"]] == expected["activities"]
        assert sorted(by_row[row]["source_position"] for row in shown["omitted_activity_row_ids"]) == expected["omitted"]
        # Original rows stay complete, the unlabelled ones included.
        assert all(len(record["original_cells"]) == 5 for record in records)


def test_a_cutoff_without_seconds_or_time_is_refused_and_not_guessed(client, workspace):
    source = upload(client, workspace, (FIXTURES / EXPECTED["file"]).read_bytes(), EXPECTED["file"])
    for cutoff in EXPECTED["refused_cutoffs"]:
        response = client.post("/api/preparations", json=reading(workspace, source, cutoff=cutoff))
        assert 400 <= response.status_code < 500, cutoff
        assert response.json()["code"] in {"invalid_parameter", "invalid_request"}, response.text


def test_reading_without_the_sequence_is_a_new_preparation_and_the_first_keeps_its_order(client, workspace):
    source = upload(client, workspace, (FIXTURES / EXPECTED["file"]).read_bytes(), EXPECTED["file"])
    first_prepared = prepare(client, reading(workspace, source))
    first = population(client, workspace, first_prepared)
    without = {**EXPECTED["mapping"], "sequence_column": None}
    second_prepared = prepare(client, reading(workspace, source, mapping=without))
    assert "timestamp_sequence_disagreement" not in {issue["code"] for issue in second_prepared["report"]["issues"]}
    second = population(client, workspace, second_prepared)
    assert second["identity"]["source_id"] == first["identity"]["source_id"]
    assert second["identity"]["preparation_id"] != first["identity"]["preparation_id"]
    for case_id, expected in EXPECTED["without_sequence"].items():
        assert [record["source_position"] for record in evidence(client, workspace, second, case_id)["records"]] == expected["order"]
    # The first preparation still reads the sequence number: its order has not changed.
    again = population(client, workspace, first_prepared, revision=2)
    assert again["identity"] == first["identity"]
    assert [record["source_position"] for record in evidence(client, workspace, again, "T-1")["records"]] == EXPECTED["cases"]["T-1"]["order"]
