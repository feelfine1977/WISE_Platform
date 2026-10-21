"""#52: the year-first slash format through the service, on an invented ticketing log with its hand-written oracle.

The inspection reads every possible value with the new format and none with another; values without a zone need an explicit clock
(recorded wall time or a fixed offset) and keep their precision, raw text and file order; an impossible date stays as
written and unavailable; read with a wrong format, no incident has a known order and every record is still kept.
"""

import json
from pathlib import Path

from fastapi.testclient import TestClient
import pytest

from test_import_acceptance import envelope, evidence, policies, population, prepare, upload
from wise_platform_api.app import create_app

FIXTURES = Path(__file__).resolve().parent / "fixtures/ymd-slash"
EXPECTED = json.loads((FIXTURES / "expected.json").read_text(encoding="utf-8"))
RAW = (FIXTURES / EXPECTED["file"]).read_bytes()


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(static_dir=tmp_path / "unbuilt")) as active:
        yield active


@pytest.fixture
def workspace(client, tmp_path):
    path = tmp_path / "workspace"
    path.mkdir()
    return client.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(path))).json()


def reading(workspace, source, time):
    chosen = policies()
    chosen["time"] = time
    return envelope("confirm_mapping_request", workspace_id=workspace["workspace_id"], source_id=source["source_id"],
                    dialect={"encoding": "utf-8", "delimiter": ",", "quotechar": '"', "header": "first_record"},
                    mapping=dict(EXPECTED["mapping"]), policies=chosen, accept_report_issues=True)


def wall(format_name=EXPECTED["format"]):
    return {"id": "incident.time.wall_clock_as_recorded.v1",
            "parameters": {"format": format_name, "timezone": "none_as_recorded", "snapshot_cutoff_local": EXPECTED["wall"]["cutoff_local"]}}


def records(client, workspace, answer):
    return {case: evidence(client, workspace, answer, case)["records"] for case in answer["population"]["case_ids"]}


def test_inspection_reads_every_possible_value_with_the_year_first_format_only(client, workspace):
    source = upload(client, workspace, RAW, EXPECTED["file"])
    inspected = client.post("/api/sources/inspect", json=envelope("inspect_csv_request", workspace_id=workspace["workspace_id"],
                                                                  source_id=source["source_id"], hints=None)).json()
    matches = {match["format"]: match["parsed_count"] for suggestion in inspected["role_suggestions"]
               if suggestion["column_index"] == EXPECTED["mapping"]["timestamp_column"] for match in suggestion["timestamp_matches"]}
    assert matches[EXPECTED["format"]] == EXPECTED["inspection_reads"]
    assert {name: count for name, count in matches.items() if name != EXPECTED["format"]} == {name: EXPECTED["other_formats_read"] for name in matches if name != EXPECTED["format"]}


def test_recorded_wall_time_keeps_precision_raw_text_and_order(client, workspace):
    source = upload(client, workspace, RAW, EXPECTED["file"])
    prepared = prepare(client, reading(workspace, source, wall()))
    assert {key: prepared["report"][key] for key in EXPECTED["wall"]["report"]} == EXPECTED["wall"]["report"]
    by_case = records(client, workspace, population(client, workspace, prepared))
    rows = {record["source_position"]: record for history in by_case.values() for record in history}
    assert {str(position): rows[position]["local_timestamp"] for position in map(int, EXPECTED["wall"]["local"])} == EXPECTED["wall"]["local"]
    assert all(row["utc_instant"] is None for row in rows.values())  # no zone is assigned to recorded wall time
    assert [rows[position]["timestamp_status"] for position in EXPECTED["wall"]["invalid"]] == ["invalid"]
    assert {case: [row["source_position"] for row in history] for case, history in by_case.items()} == EXPECTED["wall"]["order"]
    raw_lines = RAW.decode().split("\r\n")[1:]
    assert all(",".join(row["original_cells"]) == raw_lines[position] for position, row in rows.items())


def test_values_without_a_zone_need_an_explicit_clock(client, workspace):
    source = upload(client, workspace, RAW, EXPECTED["file"])
    from_values = {"id": "incident.time.explicit_format_timezone_utc.v1",
                   "parameters": {"format": EXPECTED["format"], "timezone": {"mode": "from_values"}, "snapshot_cutoff_utc": EXPECTED["fixed_offset"]["cutoff_utc"]}}
    refused = client.post("/api/preparations", json=reading(workspace, source, from_values))
    assert refused.status_code >= 400 and refused.json()["code"] == "timezone_required", refused.text
    fixed = {**from_values, "parameters": {**from_values["parameters"], "timezone": {"mode": "fixed_offset", "offset_minutes": EXPECTED["fixed_offset"]["offset_minutes"]}}}
    rows = {record["source_position"]: record for history in records(client, workspace, population(client, workspace, prepare(client, reading(workspace, source, fixed)))).values()
            for record in history}
    assert {str(position): rows[position]["utc_instant"] for position in map(int, EXPECTED["fixed_offset"]["utc"])} == EXPECTED["fixed_offset"]["utc"]


def test_a_wrong_format_leaves_no_incident_in_a_known_order_and_keeps_every_record(client, workspace):
    source = upload(client, workspace, RAW, EXPECTED["file"])
    prepared = prepare(client, reading(workspace, source, wall(EXPECTED["wrong_format"]["format"])))
    assert prepared["report"]["usable_timestamp_record_count"] == EXPECTED["wrong_format"]["usable"]
    assert prepared["report"]["sequence_evaluable_case_count"] == EXPECTED["wrong_format"]["sequence_evaluable_case_count"]
    answer = population(client, workspace, prepared)
    assert not any(summary["sequence_evaluable"] for summary in answer["cases"])
    assert sum(len(history) for history in records(client, workspace, answer).values()) == EXPECTED["wall"]["report"]["raw_record_count"]
