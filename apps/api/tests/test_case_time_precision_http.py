"""Maximum raw-gap witnesses use exact recorded durations through the public API."""

import json
from pathlib import Path

from fastapi.testclient import TestClient
from jsonschema import Draft202012Validator, FormatChecker
import pytest

from wise_platform_api.app import create_app
from import_requests import envelope, policies, wall_policies


ROOT = Path(__file__).resolve().parents[3]
IMPORT = Draft202012Validator(
    json.loads((ROOT / "contracts/import.schema.json").read_text(encoding="utf-8")),
    format_checker=FormatChecker(),
)
CASE_LIST = Draft202012Validator(
    json.loads((ROOT / "contracts/case-list.schema.json").read_text(encoding="utf-8")),
    format_checker=FormatChecker(),
)


def _checked(client, route, request, validator=IMPORT):
    response = client.post(route, json=request)
    assert response.status_code == 200, response.text
    body = response.json()
    validator.validate(body)
    assert body["request_id"] == request["request_id"]
    assert body["query_revision"] == request["query_revision"]
    return body


def _imported_case(client, path, timestamps, wall=False, activities=("First", "", "Last")):
    path.mkdir()
    request = envelope("open_workspace_request", "open", path=str(path))
    workspace = _checked(client, "/api/workspaces/open", request)
    metadata = envelope(
        "upload_source_metadata", "upload",
        workspace_id=workspace["workspace_id"], filename="recorded-time.csv",
    )
    raw = (
        "case,activity,at,seq\n"
        f"P,{activities[0]},{timestamps[0]},1\n"
        f"P,{activities[1]},{timestamps[1]},2\n"
        f"P,{activities[2]},{timestamps[2]},3\n"
    ).encode()
    response = client.put(
        "/api/sources", params=metadata, content=raw,
        headers={"Content-Type": "application/octet-stream"},
    )
    assert response.status_code == 200, response.text
    uploaded = response.json()
    IMPORT.validate(uploaded)
    chosen_policies = (
        wall_policies("iso8601", "9999-12-31T23:59:59") if wall else
        policies("iso8601", offset=None, tolerant=True, cutoff="9999-12-31T23:59:59Z")
    )
    request = envelope(
        "confirm_mapping_request", "prepare",
        workspace_id=workspace["workspace_id"], source_id=uploaded["source"]["source_id"],
        dialect={"encoding": "utf-8", "delimiter": ",", "quotechar": '"', "header": "first_record"},
        mapping={"case_column": 0, "activity_column": 1, "timestamp_column": 2,
                 "sequence_column": 3, "context_columns": []},
        policies=chosen_policies,
        accept_report_issues=True,
    )
    prepared = _checked(client, "/api/preparations", request)
    assert prepared["state"] == "ready"
    request = envelope(
        "open_population_request", "population", workspace_id=workspace["workspace_id"],
        preparation_id=prepared["preparation"]["preparation_id"],
    )
    population = _checked(client, "/api/investigations/open-population", request)
    assert population["population"] == {"case_ids": ["P"], "case_count": 1, "record_count": 3}
    request = envelope(
        "case_list_request", "list", workspace_id=workspace["workspace_id"], identity=population["identity"],
        query={"search_text": None, "sort": {"field": "case_id", "direction": "ascending"},
               "offset": 0, "limit": 1},
    )
    listed = _checked(client, "/api/investigations/case-list", request, CASE_LIST)
    request = envelope(
        "imported_case_evidence_request", "evidence", workspace_id=workspace["workspace_id"],
        identity=population["identity"], case_id="P",
    )
    evidence = _checked(client, "/api/investigations/case-evidence", request)
    assert listed["identity"] == evidence["identity"] == population["identity"]
    return listed["rows"][0]["time_summary"], evidence["records"]


@pytest.mark.parametrize("wall", [False, True], ids=["utc", "recorded-wall"])
def test_huge_raw_gaps_differing_one_microsecond_choose_the_longer_witness(tmp_path, wall):
    # The two exact durations are 126196185600000000 and 126196185600000001
    # microseconds; both round to the same displayed hours. The middle raw
    # record participates even though it has no mapped activity.
    timestamps = (
        "0001-01-01T00:00:00Z",
        "4000-01-01T00:00:00Z",
        "7998-12-31T00:00:00.000001Z",
    )
    if wall:
        timestamps = tuple(timestamp.removesuffix("Z") for timestamp in timestamps)
    with TestClient(create_app()) as client:
        summary, records = _imported_case(client, tmp_path / "workspace", timestamps, wall=wall)
    assert summary["timestamp_kind"] == ("wall_clock" if wall else "utc_instant")
    assert summary["maximum_adjacent_raw_gap_hours"] == 35054496.0
    assert summary["usable_gap_count"] == 2
    assert records[1]["activity"] is None
    witness = summary["maximum_gap_witness"]
    assert (witness["from_row_id"], witness["to_row_id"]) == (
        records[1]["row_id"], records[2]["row_id"],
    )
    assert (witness["from_activity"], witness["to_activity"]) == (None, "Last")
    assert witness["from_offset_hours"] == 35054496.0


@pytest.mark.parametrize("timestamps,activities,witness_index,maximum,span,tied_groups", [
    (("0001-01-01T00:00:00Z", "4000-01-01T00:00:00Z", "7998-12-31T00:00:00Z"),
     ("First", "", "Last"), 0, 35054496.0, 70108992.0, 0),
    (("0001-01-01T00:00:00Z", "4000-01-01T00:00:00.000001Z", "7998-12-31T00:00:00Z"),
     ("First", "", "Last"), 0, 35054496.0, 70108992.0, 0),
    (("2500-01-01T00:00:00Z", "2500-01-01T00:00:00Z", "2500-01-01T00:00:00Z"),
     ("", "Middle", ""), 0, 0.0, 0.0, 1),
    (("2500-01-01T00:00:00Z", "2500-01-01T00:00:00.000001Z", "2500-01-01T00:00:00.000002Z"),
     ("First", "", "Last"), 0, 2.7777777777777777e-10, 5.555555555555555e-10, 0),
    (("2026-10-01T00:00:00Z", "2026-10-01T01:00:00Z", "2026-10-01T05:00:00Z"),
     ("", "Middle", ""), 1, 4.0, 5.0, 0),
], ids=["huge-exact-tie", "huge-first-longer", "zero-gap", "microsecond-exact-tie", "missing-boundary-activities"])
def test_first_exact_maximum_zero_and_missing_raw_boundaries_are_preserved(
    tmp_path, timestamps, activities, witness_index, maximum, span, tied_groups,
):
    with TestClient(create_app()) as client:
        summary, records = _imported_case(client, tmp_path / "workspace", timestamps, activities=activities)
    assert summary["maximum_adjacent_raw_gap_hours"] == maximum
    assert summary["observed_span_hours"] == span
    assert summary["tied_timestamp_group_count"] == tied_groups
    assert summary["usable_gap_count"] == 2
    assert summary["first_recorded_activity"] == (activities[0] or None)
    assert summary["last_recorded_activity"] == (activities[-1] or None)
    witness = summary["maximum_gap_witness"]
    pair = records[witness_index:witness_index + 2]
    assert (witness["from_row_id"], witness["to_row_id"]) == tuple(record["row_id"] for record in pair)
    assert (witness["from_activity"], witness["to_activity"]) == tuple(record["activity"] for record in pair)
    assert witness["share_unavailable_reason"] == ("zero_observed_span" if span == 0 else None)
    if span == 0:
        assert witness["share_of_observed_span"] is None


def test_unavailable_timestamp_keeps_whole_raw_history_without_inventing_a_gap(tmp_path):
    with TestClient(create_app()) as client:
        summary, records = _imported_case(client, tmp_path / "workspace", (
            "0001-01-01T00:00:00Z", "invalid-time", "7998-12-31T00:00:00Z",
        ))
    assert len(records) == 3
    assert summary["status"] == "unavailable" and summary["reason"] == "order_unknown"
    assert summary["unavailable_timestamp_record_count"] == 1
    assert summary["usable_gap_count"] == 0
    assert summary["observed_span_hours"] is None
    assert summary["maximum_adjacent_raw_gap_hours"] is None
    assert summary["maximum_gap_witness"] is None
