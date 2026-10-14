"""Comparison shapes keep role, denominator, and clock meaning explicit."""

from copy import deepcopy
import json
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker
import pytest

from wise_platform_api.generated.comparison import (
    GroupComparisonRequest,
    PeriodComparisonRequest,
)
from test_comparison_acceptance import explicit_groups, periods_definition
from test_selection_contract import IDENTITY

SCHEMA = json.loads(
    (
        Path(__file__).resolve().parents[1] / "contracts/comparison.schema.json"
    ).read_text()
)
VALIDATOR = Draft202012Validator(SCHEMA, format_checker=FormatChecker())


def request(periods=False):
    return {
        "schema_version": 1,
        "message_type": (
            "compare_periods_request" if periods else "compare_groups_request"
        ),
        "request_id": "compare-1",
        "query_revision": 1,
        "workspace_id": "workspace.v1:fixture123",
        "identity": deepcopy(IDENTITY),
        "parent_case_ids": None,
        "context_column_index": 4,
        "context_policy": "incident.context.first_record_in_declared_order.v1",
        "definition": periods_definition() if periods else explicit_groups(),
    }


@pytest.mark.parametrize("periods", [False, True])
def test_comparison_request_schema_and_generated_boundary_agree(periods):
    value = request(periods)
    Draft202012Validator.check_schema(SCHEMA)
    VALIDATOR.validate(value)
    generated = PeriodComparisonRequest if periods else GroupComparisonRequest
    assert generated.model_validate(value).model_dump(mode="json") == value


@pytest.mark.parametrize(
    "mutation",
    [
        "boolean-revision",
        "unsafe-revision",
        "extra-score",
        "duplicate-group",
        "missing-policy",
    ],
)
def test_group_comparison_refuses_ambiguous_or_hidden_roles(mutation):
    value = request()
    if mutation == "boolean-revision":
        value["query_revision"] = True
    elif mutation == "unsafe-revision":
        value["query_revision"] = 9007199254740992
    elif mutation == "extra-score":
        value["norm_id"] = "unasked"
    elif mutation == "duplicate-group":
        value["definition"]["target"]["definition"]["case_ids"] = ["G01", "G01"]
    else:
        del value["context_policy"]
    assert list(VALIDATOR.iter_errors(value))


@pytest.mark.parametrize(
    "mutation",
    ["mixed-clock", "invalid-date", "zoned-wall", "negative-followup", "silent-cutoff"],
)
def test_period_comparison_keeps_clock_and_preparation_cutoff_authority(mutation):
    value = request(True)
    if mutation == "mixed-clock":
        window = value["definition"]["target"]["window"]
        window["timestamp_kind"] = "wall_clock"
        window["start_inclusive"] = window["start_inclusive"].removesuffix("Z")
        window["end_exclusive"] = window["end_exclusive"].removesuffix("Z")
    elif mutation == "invalid-date":
        value["definition"]["target"]["window"][
            "start_inclusive"
        ] = "2026-02-30T00:00:00Z"
    elif mutation == "zoned-wall":
        for role in ("target", "reference"):
            value["definition"][role]["window"]["timestamp_kind"] = "wall_clock"
    elif mutation == "negative-followup":
        value["definition"]["minimum_followup_hours"] = -1
    else:
        value["definition"]["snapshot_cutoff_utc"] = "2027-01-01T00:00:00Z"
    assert list(VALIDATOR.iter_errors(value))


def test_zero_ratio_is_available_but_missing_denominator_has_no_value():
    schema = {"$ref": "#/$defs/ConcentrationRatio", "$defs": SCHEMA["$defs"]}
    validator = Draft202012Validator(schema)
    validator.validate({"status": "available", "value": 0})
    validator.validate({"status": "unavailable", "reason": "zero_reference_share"})
    assert list(
        validator.iter_errors(
            {"status": "unavailable", "reason": "zero_reference_share", "value": 0}
        )
    )
