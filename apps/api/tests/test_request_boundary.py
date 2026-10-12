"""Validation of request bodies at the boundary: the contract itself, and the refusal it names."""

import pytest
from api_requests import VALIDATOR, body, evidence_request, open_request

from wise_platform_api.boundary import STATUS, parse_request, read_object, refusal
from wise_platform_api.generated.investigation import (
    CaseEvidenceRequest,
    OpenExampleRequest,
    Refusal,
)

IDENTITY = {
    "source_id": "source.v1:sha256:" + "a" * 64,
    "preparation_id": "preparation.v1:sha256:" + "b" * 64,
    "representation_id": "representation.v1:sha256:" + "c" * 64,
    "case_dictionary_id": "case-dictionary.v1:sha256:" + "d" * 64,
    "population_id": "population.v1:sha256:" + "e" * 64,
    "implementation_version": "0.1.0",
}


def evidence(**changed: object) -> dict:
    request = evidence_request(
        {"query_revision": 3, "identity": IDENTITY}, "INC05", "case-7"
    )
    request.update(changed)
    return request


def parsed_open(message: object) -> OpenExampleRequest | Refusal:
    return parse_request(body(message), OpenExampleRequest, "open_example")


def refused(message: object, code: str, field: str | None, model=OpenExampleRequest) -> Refusal:
    operation = "open_example" if model is OpenExampleRequest else "case_evidence"
    result = parse_request(body(message), model, operation)
    assert isinstance(result, Refusal), result
    assert result.code == code, result
    assert result.field == field, result
    assert result.operation == operation
    assert result.message.strip()
    VALIDATOR.validate(result.model_dump(mode="json"))
    return result


def test_a_valid_open_request_becomes_its_model():
    result = parsed_open(open_request("S2", "open-9", 4))

    assert isinstance(result, OpenExampleRequest)
    assert result.example_id.root == "S2"
    assert result.query_revision.root == 4
    assert result.policies.nullable_measure.parameters.missing_as_false is False


def test_a_valid_evidence_request_becomes_its_model():
    result = parse_request(body(evidence()), CaseEvidenceRequest, "case_evidence")

    assert isinstance(result, CaseEvidenceRequest)
    assert result.identity.model_dump(mode="json") == IDENTITY
    assert result.case_id.root == "INC05"


@pytest.mark.parametrize("raw", [b"", b"{", b"\xff", b"[]", b"1", b"null", b'"open"'])
def test_a_body_that_is_not_a_json_object_is_an_invalid_request(raw):
    result = parse_request(raw, OpenExampleRequest, "open_example")

    assert isinstance(result, Refusal)
    assert result.code == "invalid_request"
    assert result.request_id is None
    assert result.query_revision is None


@pytest.mark.parametrize("raw", [b"[" * 100_000 + b"]" * 100_000, b'{"a":' + b"[" * 100_000 + b"]" * 100_000 + b"}"])
def test_a_body_nested_deeper_than_can_be_read_is_an_invalid_request(raw):
    result = parse_request(raw, OpenExampleRequest, "open_example")

    assert isinstance(result, Refusal)
    assert result.code == "invalid_request"
    assert result.request_id is None
    VALIDATOR.validate(result.model_dump(mode="json"))


@pytest.mark.parametrize(
    "raw",
    [
        body(open_request(request_id="half", revision=2)).replace(b'"half"', b'"\\ud800"'),
        body(open_request(request_id="half", revision=2)).replace(b'"half"', b'"left \\udfff right"'),
        b'{"\\ud83d": 1}',
        b'{"policies": {"order": {"id": ["\\ud800"]}}}',
    ],
)
def test_text_that_holds_half_a_surrogate_pair_is_an_invalid_request_and_is_not_repeated(raw):
    result = parse_request(raw, OpenExampleRequest, "open_example")

    assert isinstance(result, Refusal)
    assert result.code == "invalid_request"
    assert result.request_id is None
    assert result.query_revision is None
    written = result.model_dump_json()
    assert "\\ud8" not in written.lower() and "\\udf" not in written.lower()
    written.encode("utf-8")
    VALIDATOR.validate(result.model_dump(mode="json"))


def test_a_whole_surrogate_pair_is_ordinary_text():
    assert read_object(b'{"note": "\\ud83d\\ude00 and \\u00dc"}') == {"note": "\U0001f600 and \u00dc"}


@pytest.mark.parametrize("version", [2, 0, -1, 10**20])
def test_another_whole_schema_version_is_unsupported(version):
    request = open_request(request_id="schema-9", revision=5)
    request["schema_version"] = version

    result = refused(request, "unsupported_schema", "schema_version")

    assert result.request_id.root == "schema-9"
    assert result.query_revision.root == 5


@pytest.mark.parametrize("version", [True, "1", 1.0, None])
def test_a_schema_version_that_is_not_a_whole_number_is_an_invalid_request(version):
    request = open_request()
    request["schema_version"] = version

    refused(request, "invalid_request", "schema_version")


def test_a_missing_schema_version_is_an_invalid_request():
    request = open_request()
    del request["schema_version"]

    refused(request, "invalid_request", "schema_version")


@pytest.mark.parametrize("revision", [True, False, 0, -1, "1", None, 1.0, 2.5])
def test_a_revision_that_is_not_a_whole_number_from_one_is_refused_and_not_echoed(revision):
    request = open_request(request_id="revision-9")
    request["query_revision"] = revision

    result = refused(request, "invalid_request", "query_revision")

    assert result.request_id.root == "revision-9"
    assert result.query_revision is None


@pytest.mark.parametrize("revision", [True, False])
def test_a_truth_value_is_not_a_revision_of_an_evidence_request(revision):
    result = refused(
        evidence(query_revision=revision),
        "invalid_request",
        "query_revision",
        CaseEvidenceRequest,
    )

    assert result.request_id.root == "case-7"
    assert result.query_revision is None


@pytest.mark.parametrize("request_id", ["", "-starts-with-dash", "a b", "a\n", "x" * 129, 7, None])
def test_an_invalid_request_id_is_refused_and_not_echoed(request_id):
    request = open_request(revision=6)
    request["request_id"] = request_id

    result = refused(request, "invalid_request", "request_id")

    assert result.request_id is None
    assert result.query_revision.root == 6


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("message_type", "case_evidence_request"),
        ("example_id", "S4"),
        ("example_id", "s0"),
        ("norm_id", "not-required-for-exploration"),
    ],
)
def test_an_envelope_that_is_not_the_contract_is_an_invalid_request(field, value):
    request = open_request()
    request[field] = value

    refused(request, "invalid_request", field)


def test_a_missing_field_is_named():
    request = open_request()
    del request["example_id"]

    refused(request, "invalid_request", "example_id")


def test_a_missing_role_is_an_invalid_request():
    request = open_request()
    del request["policies"]["clock"]

    refused(request, "invalid_request", "policies.clock")


def test_a_role_the_contract_does_not_know_is_an_unsupported_policy():
    request = open_request()
    request["policies"]["outcome"] = {"id": "incident.outcome.v1", "parameters": {}}

    refused(request, "unsupported_policy", "policies.outcome")


@pytest.mark.parametrize(
    "role",
    [
        "order",
        "activity_projection",
        "context_projection",
        "parent",
        "predicate",
        "comparison",
        "missing_values",
        "clock",
        "nullable_measure",
    ],
)
@pytest.mark.parametrize("policy_id", ["unknown-policy.v1", "next-version.v2", 5])
def test_an_unknown_policy_in_any_role_is_an_unsupported_policy(role, policy_id):
    request = open_request()
    request["policies"][role]["id"] = (
        request["policies"][role]["id"][:-2] + "v2" if policy_id == "next-version.v2" else policy_id
    )

    refused(request, "unsupported_policy", f"policies.{role}.id")


@pytest.mark.parametrize(
    ("role", "parameter", "value"),
    [
        ("parent", "service", "T"),
        ("predicate", "contains_activity", "Opened"),
        ("comparison", "target", "kept"),
        ("missing_values", "literal_Unknown", "missing"),
        ("nullable_measure", "missing_as_false", "false"),
        ("nullable_measure", "missing_as_false", 0),
        ("nullable_measure", "missing_as_false", None),
        ("nullable_measure", "missing_as_false", True),
        ("order", "primary", 1),
    ],
)
def test_an_unsupported_parameter_value_or_type_is_an_invalid_parameter(role, parameter, value):
    request = open_request()
    request["policies"][role]["parameters"][parameter] = value

    refused(request, "invalid_parameter", f"policies.{role}.parameters.{parameter}")


def test_a_missing_or_extra_parameter_is_an_invalid_parameter():
    missing = open_request()
    del missing["policies"]["parent"]["parameters"]["service_quantifier"]
    extra = open_request()
    extra["policies"]["parent"]["parameters"]["fallback"] = "guess"
    absent = open_request()
    del absent["policies"]["clock"]["parameters"]

    refused(missing, "invalid_parameter", "policies.parent.parameters.service_quantifier")
    refused(extra, "invalid_parameter", "policies.parent.parameters.fallback")
    refused(absent, "invalid_parameter", "policies.clock.parameters")


def test_a_policy_entry_with_another_shape_is_an_invalid_request():
    extra = open_request()
    extra["policies"]["order"]["note"] = "x"
    not_object = open_request()
    not_object["policies"]["order"] = "incident.order.timestamp_sequence_source_position.v1"

    refused(extra, "invalid_request", "policies.order.note")
    refused(not_object, "invalid_request", "policies.order")


def test_an_envelope_error_is_named_before_a_policy_error():
    request = open_request()
    request["example_id"] = "S9"
    request["policies"]["parent"]["id"] = "unknown-policy.v1"
    request["policies"]["clock"]["parameters"]["unit"] = "days"

    refused(request, "invalid_request", "example_id")


def test_an_unknown_policy_is_named_before_an_invalid_parameter():
    request = open_request()
    request["policies"]["order"]["parameters"]["primary"] = "timestamp_utc_descending"
    request["policies"]["clock"]["id"] = "unknown-policy.v1"

    refused(request, "unsupported_policy", "policies.clock.id")


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("source_id", "a" * 64),
        ("population_id", "pop_" + "e" * 64),
        ("preparation_id", "preparation.v1:sha256:" + "B" * 64),
        ("implementation_version", "0.1"),
        ("implementation_version", "٠.١.٠"),
        ("implementation_version", 1),
    ],
)
def test_an_identity_that_is_not_of_the_contract_form_is_an_invalid_request(field, value):
    request = evidence(identity={**IDENTITY, field: value})

    refused(request, "invalid_request", f"identity.{field}", CaseEvidenceRequest)


@pytest.mark.parametrize("case_id", ["", "x" * 257, 5, None])
def test_an_invalid_case_id_is_an_invalid_request(case_id):
    refused(evidence(case_id=case_id), "invalid_request", "case_id", CaseEvidenceRequest)


def test_a_refusal_carries_its_echo_and_whether_a_retry_can_help():
    built = refusal(
        "case_evidence",
        "source_unavailable",
        "The synthetic example S0 is not available.",
        request_id="case-3",
        query_revision=8,
    )

    assert built.model_dump(mode="json") == {
        "schema_version": 1,
        "message_type": "refusal",
        "request_id": "case-3",
        "query_revision": 8,
        "operation": "case_evidence",
        "code": "source_unavailable",
        "message": "The synthetic example S0 is not available.",
        "field": None,
        "retryable": True,
    }
    assert refusal("open_example", "invalid_request", "No.").retryable is False
    assert refusal("open_example", "computation_failed", "Failed.").retryable is True


def test_every_refusal_code_has_its_status():
    assert STATUS == {
        "unsupported_schema": 400,
        "unsupported_policy": 400,
        "invalid_parameter": 400,
        "invalid_request": 400,
        "source_unavailable": 404,
        "malformed_source": 422,
        "case_not_found": 404,
        "case_not_in_population": 409,
        "identity_mismatch": 409,
        "computation_failed": 500,
    }
