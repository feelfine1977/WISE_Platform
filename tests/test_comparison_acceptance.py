"""Descriptive comparisons exercised through the local API on complete histories."""

from copy import deepcopy
import json
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker
import pytest

from test_import_acceptance import (
    client,
    envelope,
    evidence,
    policies,
    population,
    prepare,
    upload,
    workspace,
)
from test_selection_acceptance import custom_population, opening

ROOT = Path(__file__).resolve().parents[1]
SCHEMA = json.loads((ROOT / "contracts/comparison.schema.json").read_text())
VALIDATOR = Draft202012Validator(SCHEMA, format_checker=FormatChecker())
CONTEXT_POLICY = "incident.context.first_record_in_declared_order.v1"


def checked(response, request, kind):
    assert 200 <= response.status_code < 300, response.text
    answer = response.json()
    VALIDATOR.validate(answer)
    assert answer["message_type"] == kind
    assert answer["request_id"] == request["request_id"]
    assert answer["query_revision"] == request["query_revision"]
    assert answer["workspace_id"] == request["workspace_id"]
    assert answer["identity"] == request["identity"]
    return answer


def refused(response, request, codes):
    assert 400 <= response.status_code < 500, response.text
    answer = response.json()
    VALIDATOR.validate(answer)
    assert answer["message_type"] == "comparison_refusal"
    assert answer["code"] in codes
    assert answer["message"].strip()
    assert answer["request_id"] == request["request_id"]
    return answer


def source_population(client, workspace, cutoff="2026-10-10T12:00:00Z"):
    source = upload(
        client,
        workspace,
        (ROOT / "tests/fixtures/comparisons/groups-and-periods.csv").read_bytes(),
    )
    chosen = policies()
    chosen["time"]["parameters"]["snapshot_cutoff_utc"] = cutoff
    request = envelope(
        "confirm_mapping_request",
        workspace_id=workspace["workspace_id"],
        source_id=source["source_id"],
        dialect={
            "encoding": "utf-8",
            "delimiter": ",",
            "quotechar": '"',
            "header": "first_record",
        },
        mapping={
            "case_column": 0,
            "activity_column": 1,
            "timestamp_column": 2,
            "sequence_column": None,
            "context_columns": [3, 4, 5],
        },
        policies=chosen,
        accept_report_issues=True,
    )
    return population(client, workspace, prepare(client, request))


def comparison_request(workspace, base, definition, periods=False, context=4):
    return envelope(
        "compare_periods_request" if periods else "compare_groups_request",
        workspace_id=workspace["workspace_id"],
        identity=deepcopy(base["identity"]),
        parent_case_ids=None,
        context_column_index=context,
        context_policy=CONTEXT_POLICY,
        definition=definition,
    )


def explicit_groups(
    target=("G01", "G02", "G05", "G08"), reference=("G02", "G03", "G04", "G06")
):
    return {
        "mode": "two_named_groups",
        "target": {
            "name": "Group A",
            "definition": {"kind": "explicit_case_ids", "case_ids": list(target)},
        },
        "reference": {
            "name": "Group B",
            "definition": {"kind": "explicit_case_ids", "case_ids": list(reference)},
        },
    }


def periods_definition():
    def period(name, start, end):
        return {
            "name": name,
            "window": {
                "timestamp_kind": "utc_instant",
                "start_inclusive": start,
                "end_exclusive": end,
            },
        }

    return {
        "target": period("Early", "2026-10-01T00:00:00Z", "2026-10-03T00:00:00Z"),
        "reference": period("Latest", "2026-10-09T00:00:00Z", "2026-10-11T00:00:00Z"),
        "minimum_followup_hours": 4,
        "endpoint_activity": "Resolved",
    }


def test_overlapping_groups_keep_explicit_denominators_zero_and_missing(
    client, workspace
):
    base = source_population(client, workspace)
    request = comparison_request(workspace, base, explicit_groups())
    answer = checked(
        client.post("/api/investigations/compare-groups", json=request),
        request,
        "group_comparison_answer",
    )
    assert answer["parent"] == {
        "case_ids": [f"G{i:02}" for i in range(1, 9)],
        "case_count": 8,
        "record_count": 18,
    }
    assert answer["target"]["included"] == {
        "case_ids": ["G01", "G02", "G05", "G08"],
        "case_count": 4,
        "record_count": 10,
    }
    assert answer["reference"]["included"] == {
        "case_ids": ["G02", "G03", "G04", "G06"],
        "case_count": 4,
        "record_count": 9,
    }
    assert answer["pair_support"]["overlap"] == {
        "case_ids": ["G02"],
        "case_count": 1,
        "record_count": 3,
    }
    assert answer["pair_support"]["neither"]["case_ids"] == ["G07"]
    profile = answer["context_profile"]
    assert profile["denominator_basis"] == "context_evaluable_cases"
    categories = {item["value"]: item for item in profile["categories"]}
    assert set(categories) == {None, "CRM", "ERP", "Unknown"}
    assert categories[None]["parent"]["case_count"] == 2
    assert categories["Unknown"]["parent"]["case_count"] == 1
    assert categories["ERP"]["target"] == {
        "case_count": 3,
        "denominator": 4,
        "share": {"status": "available", "value": 0.75},
    }
    assert categories["ERP"]["difference_percentage_points"] == {
        "status": "available",
        "value": 50,
    }
    assert categories["ERP"]["concentration_ratio"] == {
        "status": "available",
        "value": 3,
    }
    assert categories["CRM"]["concentration_ratio"] == {
        "status": "available",
        "value": 0,
    }
    assert categories["Unknown"]["concentration_ratio"] == {
        "status": "unavailable",
        "reason": "zero_reference_share",
    }
    cohort = {**base, "identity": answer["target"]["identity"]}
    assert len(evidence(client, workspace, cohort, "G02")["records"]) == 3
    renamed = deepcopy(request)
    renamed.update(request_id="renamed", query_revision=2)
    renamed["definition"]["target"]["name"] = "A new caption"
    repeated = checked(
        client.post("/api/investigations/compare-groups", json=renamed),
        renamed,
        "group_comparison_answer",
    )
    assert repeated["comparison_id"] == answer["comparison_id"]


def test_periods_keep_cross_window_records_and_expose_cutoff_followup(
    client, workspace
):
    base = source_population(client, workspace)
    request = comparison_request(workspace, base, periods_definition(), periods=True)
    answer = checked(
        client.post("/api/investigations/compare-periods", json=request),
        request,
        "period_comparison_answer",
    )
    assert answer["target"]["included"] == {
        "case_ids": ["G01", "G02", "G03", "G04", "G08"],
        "case_count": 5,
        "record_count": 12,
    }
    assert answer["reference"]["included"] == {
        "case_ids": ["G05", "G06", "G07"],
        "case_count": 3,
        "record_count": 6,
    }
    latest = answer["reference"]
    assert latest["exposure"]["adequate"]["case_ids"] == ["G05", "G07"]
    assert latest["exposure"]["inadequate"]["case_ids"] == ["G06"]
    assert {c["case_id"]: c["followup_hours"] for c in latest["exposure"]["cases"]} == {
        "G05": 28,
        "G06": 1,
        "G07": 13,
    }
    assert latest["endpoint_coverage"]["recorded"]["case_ids"] == ["G05", "G07"]
    assert latest["endpoint_coverage"]["not_recorded"]["case_ids"] == ["G06"]
    recent = deepcopy(request)
    recent["definition"]["reference"]["window"][
        "end_exclusive"
    ] = "2026-10-10T00:00:00Z"
    recent_answer = checked(
        client.post("/api/investigations/compare-periods", json=recent),
        recent,
        "period_comparison_answer",
    )
    assert recent_answer["reference"]["included"]["case_ids"] == ["G05", "G07"]
    cohort = {**base, "identity": recent_answer["reference"]["identity"]}
    history = evidence(client, workspace, cohort, "G07")
    assert [row["activity"] for row in history["records"]] == ["Opened", "Resolved"]
    assert history["records"][-1]["utc_instant"] == "2026-10-10T02:00:00Z"
    equality = deepcopy(request)
    equality["definition"]["minimum_followup_hours"] = 1
    equality_answer = checked(
        client.post("/api/investigations/compare-periods", json=equality),
        equality,
        "period_comparison_answer",
    )
    assert equality_answer["reference"]["exposure"]["inadequate"]["case_ids"] == []
    assert equality_answer["comparison_id"] != answer["comparison_id"]


def test_known_inclusion_and_unknown_other_role_remain_distinct(client, workspace):
    raw = b"Case;Activity;At;Group\nA;Opened;2026-10-09T08:00:00Z;\nA;Resolved;2026-10-09T09:00:00Z;Later\nB;Opened;2026-10-09T08:00:00Z;Unknown\nU;Opened;bad-time;Unknown\n"
    base = custom_population(client, workspace, raw, context=True)
    definition = {
        "mode": "two_named_groups",
        "target": {
            "name": "All named",
            "definition": {"kind": "explicit_case_ids", "case_ids": ["A", "B", "U"]},
        },
        "reference": {
            "name": "Unknown opening",
            "definition": {"kind": "predicates", "predicates": [opening(3, "Unknown")]},
        },
    }
    request = comparison_request(workspace, base, definition, context=3)
    answer = checked(
        client.post("/api/investigations/compare-groups", json=request),
        request,
        "group_comparison_answer",
    )
    assert answer["target"]["included"]["case_ids"] == ["A", "B", "U"]
    assert answer["reference"]["included"]["case_ids"] == ["B"]
    assert answer["reference"]["unevaluable"]["case_ids"] == ["U"]
    assert answer["pair_support"]["unevaluable"]["case_ids"] == ["U"]
    assert answer["context_profile"]["parent_unevaluable"]["case_ids"] == ["U"]
    assert {x["value"] for x in answer["context_profile"]["categories"]} == {
        None,
        "Unknown",
    }


@pytest.mark.parametrize(
    "mutation",
    [
        "foreign-identity",
        "outside-id",
        "unknown-parent",
        "unmapped-context",
        "wrong-policy",
    ],
)
def test_comparison_refuses_unbound_meaning(client, workspace, mutation):
    base = source_population(client, workspace)
    request = comparison_request(workspace, base, explicit_groups())
    if mutation == "foreign-identity":
        request["identity"]["case_dictionary_id"] = (
            "case-dictionary.v1:sha256:" + "0" * 64
        )
    elif mutation == "outside-id":
        request["parent_case_ids"] = ["G01"]
    elif mutation == "unknown-parent":
        request["parent_case_ids"] = ["never-present"]
    elif mutation == "unmapped-context":
        request["context_column_index"] = 2
    else:
        request["context_policy"] = "first-nonmissing"
    refused(
        client.post("/api/investigations/compare-groups", json=request),
        request,
        {
            "identity_mismatch",
            "invalid_parent",
            "unknown_case",
            "case_outside_parent",
            "unmapped_context_column",
            "invalid_parameter",
            "unsupported_policy",
            "invalid_request",
        },
    )


@pytest.mark.parametrize(
    "mutation",
    ["reversed", "empty", "wrong-clock", "invalid-date", "negative-followup"],
)
def test_period_windows_refuse_invalid_or_changed_clock_meaning(
    client, workspace, mutation
):
    base = source_population(client, workspace)
    request = comparison_request(workspace, base, periods_definition(), periods=True)
    window = request["definition"]["target"]["window"]
    if mutation == "reversed":
        window["start_inclusive"], window["end_exclusive"] = (
            window["end_exclusive"],
            window["start_inclusive"],
        )
    elif mutation == "empty":
        window["end_exclusive"] = window["start_inclusive"]
    elif mutation == "wrong-clock":
        for role in ("target", "reference"):
            w = request["definition"][role]["window"]
            w["timestamp_kind"] = "wall_clock"
            w["start_inclusive"] = w["start_inclusive"].removesuffix("Z")
            w["end_exclusive"] = w["end_exclusive"].removesuffix("Z")
    elif mutation == "invalid-date":
        window["start_inclusive"] = "2026-02-30T00:00:00Z"
    else:
        request["definition"]["minimum_followup_hours"] = -1
    refused(
        client.post("/api/investigations/compare-periods", json=request),
        request,
        {"invalid_window", "clock_mismatch", "invalid_parameter", "invalid_request"},
    )
