"""Import shape checks; actual source interpretation is tested through HTTP."""
from copy import deepcopy
import json
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker
import pytest

from wise_platform_api.generated.imports import ConfirmMappingRequest
from test_import_acceptance import envelope, policies


ROOT = Path(__file__).resolve().parents[1]
SCHEMA = json.loads((ROOT / "contracts/import.schema.json").read_text())
VALID = envelope("confirm_mapping_request", workspace_id="workspace.v1:example123",
    source_id="source.v1:sha256:" + "0" * 64,
    dialect={"encoding": "utf-8", "delimiter": ";", "quotechar": '"', "header": "first_record"},
    mapping={"case_column": 0, "activity_column": 1, "timestamp_column": 2,
             "sequence_column": None, "context_columns": []},
    policies=policies("dmy_dot_minute", 0), accept_report_issues=False)


def test_import_schema_and_generated_mapping_request_agree():
    Draft202012Validator.check_schema(SCHEMA)
    Draft202012Validator(SCHEMA, format_checker=FormatChecker()).validate(VALID)
    assert ConfirmMappingRequest.model_validate(VALID).model_dump(mode="json") == VALID


@pytest.mark.parametrize("time_format", ["dmy_dot_minute", "mdy_dot_minute", "dmy_slash_minute", "mdy_slash_minute", "iso8601", "dmy_dot_second", "mdy_dot_second", "dmy_slash_second", "mdy_slash_second", "mdy_slash_12h_minute", "mdy_slash_12h_second"])
def test_timestamp_candidates_require_a_named_explicit_interpretation(time_format):
    value = deepcopy(VALID)
    value["policies"]["time"]["parameters"]["format"] = time_format
    Draft202012Validator(SCHEMA, format_checker=FormatChecker()).validate(value)
    assert ConfirmMappingRequest.model_validate(value).model_dump(mode="json") == value


def test_date_time_format_checker_is_installed_and_rejects_impossible_dates():
    checker = FormatChecker()
    assert "date-time" in checker.checkers
    validator = Draft202012Validator({"$ref": "#/$defs/UtcInstant", "$defs": SCHEMA["$defs"]}, format_checker=checker)
    validator.validate("2026-02-28T09:00:00Z")
    assert list(validator.iter_errors("2026-02-30T09:00:00Z"))


@pytest.mark.parametrize("mutation", ["boolean-revision", "unsafe-revision", "text-confirmation", "unknown-policy", "IANA", "extra-field"])
def test_authoritative_import_schema_rejects_coercion_and_unqualified_policies(mutation):
    value = deepcopy(VALID)
    if mutation == "boolean-revision":
        value["query_revision"] = True
    elif mutation == "unsafe-revision":
        value["query_revision"] = 9007199254740992
    elif mutation == "text-confirmation":
        value["accept_report_issues"] = "yes"
    elif mutation == "unknown-policy":
        value["policies"]["order"]["id"] += "-unknown"
    elif mutation == "IANA":
        value["policies"]["time"]["parameters"]["timezone"] = {"mode": "iana", "name": "Europe/Berlin"}
    else:
        value["silent_guess"] = True
    assert list(Draft202012Validator(SCHEMA).iter_errors(value))


def test_utc_and_recorded_wall_cutoff_domains_are_separate():
    value = deepcopy(VALID)
    value["policies"] = policies("iso8601", wall=True)
    Draft202012Validator(SCHEMA, format_checker=FormatChecker()).validate(value)
    assert ConfirmMappingRequest.model_validate(value).model_dump(mode="json") == value
    value["policies"]["time"]["parameters"]["snapshot_cutoff_local"] += "Z"
    assert list(Draft202012Validator(SCHEMA).iter_errors(value))
    value = deepcopy(VALID)
    value["policies"]["time"]["parameters"]["snapshot_cutoff_utc"] = "2027-01-01T00:00:00"
    assert list(Draft202012Validator(SCHEMA).iter_errors(value))
