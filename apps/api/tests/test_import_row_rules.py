"""The tolerant and the strict row rule through the routes, and stored preparations of either rule."""

import json

from fastapi.testclient import TestClient
from import_requests import GERMAN, envelope, german_confirmation, orphaned_confirmation, policies
from test_import_operations import (  # noqa: F401 (fixtures)
    GERMAN_ID,
    answered,
    client,
    folder,
    refused,
    stored,
    workspace_id,
)

from wise_platform_api.app import create_app

STRICT_ID = "incident.rows.missing_id_outside_invalid_time_retained.v1"
TOLERANT_ID = "incident.rows.missing_id_outside_invalid_time_retained.v2"

# Positions 0 and 2 are records; positions 1 and 3 are blank lines, the last one at the end of the file.
BLANK_LINES = (
    "Ticket,Activity,At\r\n"
    "X-1,Opened,2026-10-09T08:00:00Z\r\n"
    "\r\n"
    "X-1,Closed,2026-10-09T10:00:00Z\r\n"
    "\r\n"
).encode("utf-8")

RAGGED_TEXT = "X-99,Opened,2026-10-09T09:00:00Z,extra\r\n"


def with_ragged(good: int) -> bytes:
    """``good`` well-formed records X-01, X-02, … with one record of four cells at source position 5."""
    rows = [f"X-{number:02},Opened,2026-10-09T08:00:00Z\r\n" for number in range(1, good + 1)]
    rows.insert(5, RAGGED_TEXT)
    return ("Ticket,Activity,At\r\n" + "".join(rows)).encode("utf-8")


def confirmation(workspace_id, source_id, tolerant=True, accept=False) -> dict:
    request = orphaned_confirmation(workspace_id, source_id, accept)
    request["policies"] = policies("iso8601", None, tolerant=tolerant)
    return request


def kept_preparations(folder) -> list[str]:
    return sorted(path.name for path in (folder / "preparations").iterdir())


def test_blank_lines_are_skipped_and_counted_under_the_tolerant_rule(client, folder, workspace_id):
    source = stored(client, workspace_id, BLANK_LINES)

    answer = answered(client.post("/api/preparations", json=confirmation(workspace_id, source["source_id"])))

    assert answer["state"] == "ready"
    report = answer["report"]
    assert (report["raw_record_count"], report["blank_record_count"], report["ragged_record_count"]) == (2, 2, 0)
    assert (report["case_count"], report["issues"], report["excluded_source_records"]) == (1, [], [])
    assert answer["preparation"]["policies"]["rows"]["id"] == TOLERANT_ID
    request = envelope("open_population_request", workspace_id=workspace_id,
                       preparation_id=answer["preparation"]["preparation_id"])
    population = answered(client.post("/api/investigations/open-population", json=request))
    evidence = answered(client.post("/api/investigations/case-evidence", json=envelope(
        "imported_case_evidence_request", workspace_id=workspace_id, identity=population["identity"], case_id="X-1")))
    # The source positions keep the gap of the blank line between them.
    assert [record["source_position"] for record in evidence["records"]] == [0, 2]


def test_one_ragged_record_stays_outside_every_incident_with_its_raw_text(client, folder, workspace_id):
    source = stored(client, workspace_id, with_ragged(19))
    request = confirmation(workspace_id, source["source_id"])

    pending = answered(client.post("/api/preparations", json=request))

    assert (pending["state"], pending["preparation"]) == ("needs_confirmation", None)
    report = pending["report"]
    assert (report["raw_record_count"], report["identified_record_count"], report["unassigned_record_count"]) == (20, 19, 1)
    assert (report["ragged_record_count"], report["blank_record_count"], report["case_count"]) == (1, 0, 19)
    assert [(issue["source_position"], issue["code"], issue["severity"]) for issue in report["issues"]] == [
        (5, "ragged_record", "confirmation")
    ]
    assert report["excluded_source_records"] == [{
        "source_position": 5, "physical_line_start": 7, "physical_line_end": 7, "cell_count": 4,
        "reason": "ragged_record", "original_cells": ["X-99", "Opened", "2026-10-09T09:00:00Z", "extra"],
        "original_text": RAGGED_TEXT,
    }]
    assert kept_preparations(folder) == []

    ready = answered(client.post("/api/preparations", json=dict(request, accept_report_issues=True)))

    assert ready["state"] == "ready"
    population = answered(client.post("/api/investigations/open-population", json=envelope(
        "open_population_request", workspace_id=workspace_id, preparation_id=ready["preparation"]["preparation_id"])))
    assert population["population"]["case_ids"] == [f"X-{number:02}" for number in range(1, 20)]
    assert population["unassigned_record_count"] == 1


def test_more_ragged_records_than_the_bound_are_refused(client, folder, workspace_id):
    # One ragged record of 19 is above 5 %; nothing is repaired and nothing is kept.
    source = stored(client, workspace_id, with_ragged(18))
    request = confirmation(workspace_id, source["source_id"], accept=True)

    answer = refused(client.post("/api/preparations", json=request), "confirm_mapping", "malformed_source", "source", request)

    assert "5%" in answer["message"]
    assert kept_preparations(folder) == []


def test_the_strict_rule_still_refuses_a_blank_line_and_a_ragged_record(client, folder, workspace_id):
    for raw in (BLANK_LINES, with_ragged(19)):
        source = stored(client, workspace_id, raw)
        request = confirmation(workspace_id, source["source_id"], tolerant=False, accept=True)

        refused(client.post("/api/preparations", json=request), "confirm_mapping", "malformed_source", "source", request)

    assert kept_preparations(folder) == []


def test_a_stored_preparation_under_the_strict_rule_opens_unchanged_in_a_new_run(tmp_path, folder):
    with TestClient(create_app(static_dir=tmp_path / "unbuilt")) as first:
        opened = answered(first.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(folder))))
        workspace_id = opened["workspace_id"]
        stored(first, workspace_id, GERMAN)
        strict = answered(first.post("/api/preparations", json=german_confirmation(workspace_id, GERMAN_ID)))
        preparation_id = strict["preparation"]["preparation_id"]
        request = envelope("open_population_request", workspace_id=workspace_id, preparation_id=preparation_id)
        before = answered(first.post("/api/investigations/open-population", json=request))
    [kept] = list((folder / "preparations").iterdir())
    kept_bytes = kept.read_bytes()
    assert json.loads(kept_bytes)["preparation"]["policies"]["rows"]["id"] == STRICT_ID

    with TestClient(create_app(static_dir=tmp_path / "unbuilt")) as second:
        listed = answered(second.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(folder))))
        after = answered(second.post("/api/investigations/open-population", json=request))
        # The same source under the tolerant rule is another preparation beside the strict one.
        tolerant = german_confirmation(workspace_id, GERMAN_ID)
        tolerant["policies"] = policies(tolerant=True)
        other = answered(second.post("/api/preparations", json=tolerant))

    assert listed["preparations"] == [{"preparation_id": preparation_id, "source_id": GERMAN_ID}]
    assert after == before
    assert after["preparation"]["policies"]["rows"]["id"] == STRICT_ID
    assert other["preparation"]["preparation_id"] != preparation_id
    assert len(kept_preparations(folder)) == 2
    assert kept.read_bytes() == kept_bytes
