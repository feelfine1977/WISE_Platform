"""Structural contract checks, separate from real population/evidence acceptance."""
from copy import deepcopy
import json
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker
from pydantic import ValidationError
import pytest

from wise_platform_api.generated.investigation import OpenExampleRequest


ROOT = Path(__file__).resolve().parents[1]
SCHEMA = json.loads((ROOT / "contracts" / "investigation.schema.json").read_text())
POLICIES = json.loads((ROOT / "tests" / "fixtures" / "incidents" / "policies.v1.json").read_text())
VALID = {"schema_version": 1, "message_type": "open_example_request", "request_id": "open-1",
         "query_revision": 1, "example_id": "S1", "policies": POLICIES}


def test_source_schema_and_generated_request_agree_on_supported_policies():
    Draft202012Validator.check_schema(SCHEMA)
    Draft202012Validator(SCHEMA, format_checker=FormatChecker()).validate(VALID)
    assert OpenExampleRequest.model_validate(VALID).model_dump(mode="json") == VALID
    assert set(SCHEMA["$defs"]["InputPolicies"]["required"]) == set(POLICIES)
    assert all(SCHEMA["$defs"][name]["additionalProperties"] is False
               for name in ("OpenExampleRequest", "PopulationAnswer", "CaseEvidenceRequest", "CaseEvidenceAnswer", "Refusal"))


@pytest.mark.parametrize("field,value", [
    ("schema_version", 2), ("message_type", "score_request"), ("example_id", "not-shipped"),
    ("request_id", ""), ("query_revision", 0), ("extra", "unexpected"),
])
def test_generated_request_and_source_schema_refuse_invalid_envelope_fields(field, value):
    payload = deepcopy(VALID)
    payload[field] = value
    assert list(Draft202012Validator(SCHEMA).iter_errors(payload))
    with pytest.raises(ValidationError):
        OpenExampleRequest.model_validate(payload)


@pytest.mark.parametrize("mutation", ["unknown-id", "unknown-version", "wrong-value", "extra", "missing"])
def test_named_policy_parameters_are_closed_and_do_not_interpret_prose(mutation):
    payload = deepcopy(VALID)
    order = payload["policies"]["order"]
    if mutation == "unknown-id":
        order["id"] = "sort by time and then sequence"
    elif mutation == "unknown-version":
        order["id"] = "incident.order.timestamp_sequence_source_position.v2"
    elif mutation == "wrong-value":
        order["parameters"]["primary"] = "source_sequence_ascending"
    elif mutation == "extra":
        order["parameters"]["guess"] = True
    else:
        del order["parameters"]["tie_breaker"]
    assert list(Draft202012Validator(SCHEMA).iter_errors(payload))
    with pytest.raises(ValidationError):
        OpenExampleRequest.model_validate(payload)


@pytest.mark.parametrize("value", [True, False, "1", None, 9007199254740992])
def test_source_schema_distinguishes_query_integer_from_coercible_values(value):
    payload = {**VALID, "query_revision": value}
    assert list(Draft202012Validator(SCHEMA).iter_errors(payload))
    # HTTP acceptance separately verifies refusal: generated model coercion alone is insufficient.


def test_utc_clock_definition_rejects_offsets_and_missing_zone():
    clock_schema = {"$ref": "#/$defs/UtcInstant", "$defs": SCHEMA["$defs"]}
    validator = Draft202012Validator(clock_schema, format_checker=FormatChecker())
    validator.validate("2026-10-01T09:00:00Z")
    for value in ("2026-10-01T09:00:00", "2026-10-01T11:00:00+02:00", "not-a-time"):
        assert list(validator.iter_errors(value))
