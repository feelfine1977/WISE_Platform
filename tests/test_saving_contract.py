"""Immutable revisions require an explicit expected head and frozen meaning."""

from copy import deepcopy
import json
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker
import pytest

from wise_platform_api.generated.saving import SaveInvestigationRequest
from test_selection_contract import IDENTITY

SCHEMA = json.loads(
    (Path(__file__).resolve().parents[1] / "contracts/saving.schema.json").read_text()
)
VALIDATOR = Draft202012Validator(SCHEMA, format_checker=FormatChecker())


def request():
    return {
        "schema_version": 1,
        "message_type": "save_investigation_request",
        "request_id": "save-1",
        "query_revision": 1,
        "workspace_id": "workspace.v1:fixture123",
        "investigation_id": None,
        "expected_revision_id": None,
        "name": "Fictional incident investigation",
        "base_identity": deepcopy(IDENTITY),
        "selection_identity": deepcopy(IDENTITY),
        "selection_recipe": {"parent_case_ids": ["A", "B"], "predicates": []},
        "context_policy": "incident.context.first_record_in_declared_order.v1",
        "comparison": None,
        "notes": "Keep every original record.",
        "bookmarks": [],
    }


def test_unscored_save_is_valid_without_a_norm_or_run_reference():
    value = request()
    Draft202012Validator.check_schema(SCHEMA)
    VALIDATOR.validate(value)
    assert (
        SaveInvestigationRequest.model_validate(value).model_dump(
            mode="json", exclude_unset=True
        )
        == value
    )


def test_update_requires_both_investigation_and_expected_revision():
    value = request()
    value.update(
        investigation_id="investigation.v1:example123",
        expected_revision_id="saved-revision.v1:sha256:" + "a" * 64,
    )
    VALIDATOR.validate(value)
    assert (
        SaveInvestigationRequest.model_validate(value).model_dump(
            mode="json", exclude_unset=True
        )
        == value
    )
    for field in ("investigation_id", "expected_revision_id"):
        broken = deepcopy(value)
        broken[field] = None
        assert list(VALIDATOR.iter_errors(broken))


@pytest.mark.parametrize(
    "mutation",
    [
        "unsafe-revision",
        "boolean-revision",
        "live-parent",
        "duplicate-parent",
        "no-binding",
        "unknown-run-shape",
        "bookmark-no-identity",
    ],
)
def test_saving_refuses_mutable_or_unbound_meaning(mutation):
    value = request()
    if mutation == "unsafe-revision":
        value["query_revision"] = 9007199254740992
    elif mutation == "boolean-revision":
        value["query_revision"] = True
    elif mutation == "live-parent":
        value["selection_recipe"]["parent_case_ids"] = None
    elif mutation == "duplicate-parent":
        value["selection_recipe"]["parent_case_ids"] = ["A", "A"]
    elif mutation == "no-binding":
        del value["base_identity"]["case_dictionary_id"]
    elif mutation == "unknown-run-shape":
        value["score_run_ref"] = {
            "score_run_id": "latest",
            "scored_population_id": IDENTITY["population_id"],
            "calibration_id": "automatic",
        }
    else:
        value["bookmarks"] = [{"label": "A", "case_id": "A", "row_ids": [], "note": ""}]
    assert list(VALIDATOR.iter_errors(value))


def test_real_score_reference_requires_returned_run_population_and_calibration():
    value = request()
    value["score_run_ref"] = {
        "score_run_id": "score-run.v1:sha256:" + "b" * 64,
        "scored_population_id": IDENTITY["population_id"],
        "calibration_id": "calibration.v1:sha256:" + "c" * 64,
    }
    VALIDATOR.validate(value)
    for field in value["score_run_ref"]:
        broken = deepcopy(value)
        del broken["score_run_ref"][field]
        assert list(VALIDATOR.iter_errors(broken))


def test_revision_conflict_has_both_expected_and_actual_heads():
    schema = {"$ref": "#/$defs/SavingRefusal", "$defs": SCHEMA["$defs"]}
    validator = Draft202012Validator(schema)
    value = {
        "schema_version": 1,
        "message_type": "saving_refusal",
        "request_id": "save-1",
        "query_revision": 1,
        "workspace_id": "workspace.v1:fixture123",
        "operation": "save_investigation",
        "code": "revision_conflict",
        "message": "The saved head changed.",
        "field": "expected_revision_id",
        "retryable": False,
        "investigation_id": "investigation.v1:example123",
        "expected_revision_id": "saved-revision.v1:sha256:" + "b" * 64,
        "current_revision_id": "saved-revision.v1:sha256:" + "c" * 64,
    }
    validator.validate(value)
    del value["current_revision_id"]
    assert list(validator.iter_errors(value))
