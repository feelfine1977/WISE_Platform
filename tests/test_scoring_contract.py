"""Scoring keeps admission gates, immutable run binding, and missing evidence explicit."""

from copy import deepcopy
import json
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker
import pytest

from wise_platform_api.generated.scoring import ValidateExpectationRequest

ROOT = Path(__file__).resolve().parents[1]
SCHEMA = json.loads((ROOT / "contracts/scoring.schema.json").read_text())
EXAMPLES = json.loads(
    (ROOT / "tests/fixtures/expectations/contract-examples.json").read_text()
)
VALIDATOR = Draft202012Validator(SCHEMA, format_checker=FormatChecker())


@pytest.mark.parametrize("name", list(EXAMPLES))
def test_scoring_wire_examples_have_explicit_valid_shapes(name):
    Draft202012Validator.check_schema(SCHEMA)
    VALIDATOR.validate(EXAMPLES[name])


def test_generated_scoring_request_preserves_explicit_meaning():
    value = EXAMPLES["validate-expectation.request"]
    assert (
        ValidateExpectationRequest.model_validate(value).model_dump(mode="json")
        == value
    )


@pytest.mark.parametrize(
    "flag", ["supported_definition", "preparation_gate_passed", "method_check_passed"]
)
def test_ready_validation_requires_every_real_gate(flag):
    value = deepcopy(EXAMPLES["validate-expectation.answer"])
    value["readiness"][flag] = False
    assert list(VALIDATOR.iter_errors(value))


@pytest.mark.parametrize("mutation", ["empty-cases", "zero-count", "no-recovery"])
def test_unevaluable_sequence_refusal_names_affected_cases_and_recovery(mutation):
    value = deepcopy(EXAMPLES["scoring-refusal"])
    assert value["code"] == "unevaluable_sequence"
    if mutation == "empty-cases":
        value["case_ids"] = []
    elif mutation == "zero-count":
        value["case_count"] = 0
    else:
        value["recovery_actions"] = []
    assert list(VALIDATOR.iter_errors(value))


@pytest.mark.parametrize(
    "mutation",
    [
        "last-response",
        "negative-width",
        "zero-target",
        "unsafe-revision",
        "boolean-target",
        "silent-fit",
    ],
)
def test_definition_refuses_unqualified_or_ambiguous_semantics(mutation):
    value = deepcopy(EXAMPLES["validate-expectation.request"])
    if mutation == "last-response":
        value["definition"]["endpoints"]["response"] = "last"
    elif mutation == "negative-width":
        value["definition"]["width"] = -1
    elif mutation == "zero-target":
        value["definition"]["target"] = 0
    elif mutation == "unsafe-revision":
        value["query_revision"] = 9007199254740992
    elif mutation == "boolean-target":
        value["definition"]["target"] = True
    else:
        value["definition"]["calibration"] = "quantile"
    assert list(VALIDATOR.iter_errors(value))


def test_returned_run_can_form_a_fully_bound_saved_reference():
    run = EXAMPLES["score-run.answer"]["run"]
    identity = run["identity"]
    assert identity["calibration_id"] == run["calibration"]["calibration_id"]
    saving = json.loads((ROOT / "contracts/saving.schema.json").read_text())
    reference = {
        "score_run_id": identity["run_id"],
        "scored_population_id": identity["scored_population_identity"]["population_id"],
        "calibration_id": identity["calibration_id"],
    }
    Draft202012Validator(
        {"$ref": "#/$defs/ScoreRunReference", "$defs": saving["$defs"]}
    ).validate(reference)


def test_endpoint_witness_keeps_the_original_missing_activity_gap():
    value = EXAMPLES["case-witness.answer"]
    records = value["trace"]["records"]
    assert [row["activity"] for row in records] == ["Opened", None, "Resolved"]
    assert records[1]["original_cells"] == ["GAP", "", "2026-10-02T00:00:00Z", ""]
    assert value["trace"]["omitted_activity_row_ids"] == [records[1]["row_id"]]
    assert value["activation_candidate_row_ids"] == [records[0]["row_id"]]
    assert value["response_candidate_row_ids"] == [records[2]["row_id"]]
