"""Real synthetic population/evidence HTTP acceptance, scoped by operation."""
from copy import deepcopy
import csv
import hashlib
import json
from pathlib import Path

from fastapi.testclient import TestClient
from jsonschema import Draft202012Validator, FormatChecker
import pytest

from wise_platform_api.app import create_app


ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "tests" / "fixtures" / "incidents"
EXAMPLES = ROOT / "apps" / "api" / "src" / "wise_platform_api" / "examples"
SCHEMA = json.loads((ROOT / "contracts" / "investigation.schema.json").read_text(encoding="utf-8"))
POLICY_IDS = json.loads((FIXTURES / "policy_ids.json").read_text(encoding="utf-8"))
VALIDATOR = Draft202012Validator(SCHEMA, format_checker=FormatChecker())

OPEN_ROUTE = "/api/investigations/open-example"
EVIDENCE_ROUTE = "/api/investigations/case-evidence"

PARENT_IDS = ["INC01", "INC02", "INC03", "INC04", "INC05", "INC06", "INC07", "INC08", "INC09", "INC10", "INC11", "INC12"]
KEPT_IDS = ["INC01", "INC02", "INC03", "INC04", "INC05", "INC06", "INC07"]
REMOVED_IDS = ["INC08", "INC09", "INC10", "INC11", "INC12"]
OUTSIDE_IDS = ["INC13", "INC14"]
ORDINARY_CASE_ROWS = {"INC01": 2, "INC02": 3, "INC03": 3, "INC04": 2, "INC05": 3, "INC06": 2, "INC07": 3, "INC08": 2, "INC09": 1, "INC10": 2, "INC11": 1, "INC12": 1}

# Literal independently specified supports, not output-derived expected values.
EXPECTED = {
    "S0": {
        "base": (PARENT_IDS + OUTSIDE_IDS, 14, 28), "parent": (PARENT_IDS, 12, 25),
        "kept": (KEPT_IDS, 7, 18), "removed": (REMOVED_IDS, 5, 7),
        "unevaluable": ([], 0, 0), "outside": (OUTSIDE_IDS, 2, 3),
        "coverage": (25, 25, 0), "case_rows": ORDINARY_CASE_ROWS,
    },
    "S1": {
        "base": (PARENT_IDS + OUTSIDE_IDS, 14, 31), "parent": (PARENT_IDS, 12, 28),
        "kept": (KEPT_IDS, 7, 21), "removed": (REMOVED_IDS, 5, 7),
        "unevaluable": ([], 0, 0), "outside": (OUTSIDE_IDS, 2, 3),
        "coverage": (28, 28, 0), "case_rows": {**ORDINARY_CASE_ROWS, "INC05": 6},
    },
    "S2": {
        "base": (["S2A", "S2B"], 2, 8), "parent": (["S2A", "S2B"], 2, 8),
        "kept": (["S2A", "S2B"], 2, 8), "removed": ([], 0, 0),
        "unevaluable": ([], 0, 0), "outside": ([], 0, 0),
        "coverage": (8, 6, 2), "case_rows": {"S2A": 4, "S2B": 4},
    },
    "S3": {
        "base": (["S3A", "S3B"], 2, 2), "parent": (["S3A", "S3B"], 2, 2),
        "kept": ([], 0, 0), "removed": (["S3A", "S3B"], 2, 2),
        "unevaluable": ([], 0, 0), "outside": ([], 0, 0),
        "coverage": (2, 2, 0), "case_rows": {"S3A": 1, "S3B": 1},
    },
}
FROZEN_DIGESTS = {
    "S0": "795a78f842a08e292de49651f309549578b18e80bcc179b6db01aec5eff0db3b",
    "S1": "73d6e28c3a4a85daa635eed7938b4c0809d28e9f62014cfe31a315e34bcc6856",
    "S2": "c133fbc366bd9c20b518e3a3e445bf064bb5d789978b78fecef560027b40923a",
    "S3": "3b4e64d704704c51ace18fdcefba2248c2f1f946599676f1782e59650362b058",
}


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(static_dir=tmp_path / "unbuilt")) as active:
        yield active


def input_policies():
    parameters = {
        "order": {"primary": "timestamp_utc_ascending", "secondary": "source_sequence_ascending", "tie_breaker": "source_position_ascending"},
        "activity_projection": {"missing_activity": "omit_from_mapped_sequence", "raw_records": "retain_all", "gap_evidence": "omitted_row_ids"},
        "context_projection": {"anchor_activity": "Opened", "anchor_occurrence": "first_in_declared_order", "attribute": "assignment_group", "missing_at_anchor": "retain"},
        "parent": {"service": "S", "service_quantifier": "all_records", "contains_activity": "Opened"},
        "predicate": {"contains_activity": "Resolved", "semantics": "recorded_event_presence"},
        "comparison": {"target": "removed", "comparator": "kept"},
        "missing_values": {"activity_empty_cell": "missing", "assignment_group_empty_cell": "missing", "literal_Unknown": "value"},
        "clock": {"timestamp_field": "timestamp_utc", "timezone": "UTC", "unit": "hours"},
        "nullable_measure": {"missing_endpoint": "unevaluable", "missing_as_false": False},
    }
    assert set(parameters) <= set(POLICY_IDS), "Register the frozen missing-values/UTC-clock policy IDs with the fixture policies."
    return {key: {"id": POLICY_IDS[key], "parameters": value} for key, value in parameters.items()}


def open_request(example="S0", request_id="open-1", revision=1):
    return {"schema_version": 1, "message_type": "open_example_request", "request_id": request_id,
            "query_revision": revision, "example_id": example, "policies": input_policies()}


def checked_payload(response, message_type, status=200):
    assert response.status_code == status, response.text
    payload = response.json()
    VALIDATOR.validate(payload)
    assert payload["message_type"] == message_type
    return payload


def open_example(client, example="S0", request_id="open-1", revision=1):
    request = open_request(example, request_id, revision)
    VALIDATOR.validate(request)
    answer = checked_payload(client.post(OPEN_ROUTE, json=request), "population_answer")
    assert answer["request_id"] == request_id
    assert answer["query_revision"] == revision
    assert answer["policies"] == request["policies"]
    return answer


def evidence_request(population, case_id, request_id="case-1"):
    return {"schema_version": 1, "message_type": "case_evidence_request", "request_id": request_id,
            "query_revision": population["query_revision"], "identity": deepcopy(population["identity"]), "case_id": case_id}


def case_evidence(client, population, case_id, request_id="case-1"):
    request = evidence_request(population, case_id, request_id)
    VALIDATOR.validate(request)
    answer = checked_payload(client.post(EVIDENCE_ROUTE, json=request), "case_evidence_answer")
    assert answer["request_id"] == request_id
    assert answer["query_revision"] == population["query_revision"]
    assert answer["identity"] == population["identity"]
    assert answer["case_id"] == case_id
    return answer


def refusal(response, operation, code, status, request=None):
    answer = checked_payload(response, "refusal", status)
    assert answer["operation"] == operation
    assert answer["code"] == code
    assert answer["message"].strip()
    if request is not None:
        assert answer["request_id"] == request["request_id"]
        revision = request.get("query_revision")
        if type(revision) is int and revision >= 1:
            assert answer["query_revision"] == revision
    return answer


@pytest.mark.parametrize("example", ["S0", "S1", "S2", "S3"])
def test_shipped_synthetic_example_bytes_equal_independent_fixtures(example):
    independent = (FIXTURES / f"{example}.csv").read_bytes()
    assert hashlib.sha256(independent).hexdigest() == FROZEN_DIGESTS[example]
    assert (EXAMPLES / f"{example}.csv").read_bytes() == independent


@pytest.mark.parametrize("example", ["S0", "S1", "S2", "S3"])
def test_real_population_and_every_complete_case_match_literal_supports(client, example):
    population = open_example(client, example)
    expected = EXPECTED[example]
    assert population["source"]["example_id"] == example
    assert population["source"]["synthetic"] is True
    assert "synthetic" in population["source"]["label"].lower()
    assert population["source"]["snapshot_cutoff_utc"] == "2026-10-02T00:00:00Z"
    assert population["identity"]["source_id"] == "source.v1:sha256:" + FROZEN_DIGESTS[example]
    for name in ("base", "parent", "kept", "removed", "unevaluable", "outside"):
        ids, cases, records = expected[name]
        assert population["populations"][name] == {"case_ids": ids, "case_count": cases, "record_count": records}, (example, name)
    raw_count, mapped_count, omitted_count = expected["coverage"]
    assert population["coverage"] == {"raw_record_count": raw_count, "mapped_record_count": mapped_count, "omitted_activity_record_count": omitted_count}
    summaries = population["cases"]
    assert [summary["case_id"] for summary in summaries] == expected["parent"][0]
    with (FIXTURES / f"{example}.csv").open(newline="", encoding="utf-8") as stream:
        originals = list(csv.DictReader(stream))
    for summary in summaries:
        case_id = summary["case_id"]
        count = expected["case_rows"][case_id]
        omitted = 1 if example == "S2" else 0
        assert summary["record_count"] == count
        assert summary["mapped_record_count"] == count - omitted
        assert summary["omitted_activity_record_count"] == omitted
        assert summary["partition"] == ("kept" if case_id in expected["kept"][0] else "removed")
        evidence = case_evidence(client, population, case_id, f"case-{example}-{case_id}")
        assert evidence["coverage"] == {"raw_record_count": count, "mapped_record_count": count - omitted, "omitted_activity_record_count": omitted}
        assert len(evidence["records"]) == count
        assert [row["source_event_id"] for row in evidence["records"]] == [
            f"e-{case_id}-{sequence:02d}" for sequence in range(1, count + 1)
        ]
        row_ids = [row["row_id"] for row in evidence["records"]]
        assert len(set(row_ids)) == count
        # Source equality checks original evidence directly; no sorting/count oracle replaces product logic.
        assert {row["source_position"] for row in evidence["records"]} == {position for position, row in enumerate(originals) if row["incident_id"] == case_id}
        for row in evidence["records"]:
            assert row["original_values"] == originals[row["source_position"]]
            assert row["source_event_id"] == row["original_values"]["source_event_id"]
            assert row["original_values"]["incident_id"] == case_id
            assert row["source_sequence"] == int(row["original_values"]["source_sequence"])
            assert row["timestamp_utc"] == row["original_values"]["timestamp_utc"]
            assert row["service"] == row["original_values"]["service"]
            assert row["activity"] == (row["original_values"]["activity"] or None)
            assert row["assignment_group"] == (row["original_values"]["assignment_group"] or None)
        assert set(evidence["mapped_row_ids"]).isdisjoint(evidence["omitted_activity_row_ids"])
        assert set(evidence["mapped_row_ids"]) | set(evidence["omitted_activity_row_ids"]) == set(row_ids)
        assert len(evidence["mapped_row_ids"]) == count - omitted
        assert len(evidence["omitted_activity_row_ids"]) == omitted
        assert evidence["mapped_row_ids"] == [row["row_id"] for row in evidence["records"] if row["activity"] is not None]


def test_repeated_incident_retains_all_six_original_records(client):
    population = open_example(client, "S1")
    evidence = case_evidence(client, population, "INC05")
    assert [row["activity"] for row in evidence["records"]] == ["Opened", "Assigned", "Resolved", "Reopened", "Assigned", "Resolved"]
    assert [row["source_event_id"] for row in evidence["records"]] == ["e-INC05-01", "e-INC05-02", "e-INC05-03", "e-INC05-04", "e-INC05-05", "e-INC05-06"]
    assert evidence["mapped_row_ids"] == [row["row_id"] for row in evidence["records"]]
    assert evidence["omitted_activity_row_ids"] == []


def test_ties_use_declared_sequence_and_missing_activity_keeps_original_raw_row(client):
    population = open_example(client, "S2")
    evidence = case_evidence(client, population, "S2B")
    rows = evidence["records"]
    assert [row["source_position"] for row in rows] == [4, 5, 7, 6]
    assert [row["source_sequence"] for row in rows] == [1, 2, 3, 4]
    assert [row["source_event_id"] for row in rows] == ["e-S2B-01", "e-S2B-02", "e-S2B-03", "e-S2B-04"]
    assert [row["activity"] for row in rows] == ["Opened", None, "Resolved", "Assigned"]
    assert rows[1]["original_values"]["activity"] == ""
    assert rows[1]["timestamp_utc"] == rows[2]["timestamp_utc"] == rows[3]["timestamp_utc"] == "2026-10-01T10:00:00Z"
    assert evidence["mapped_row_ids"] == [rows[0]["row_id"], rows[2]["row_id"], rows[3]["row_id"]]
    assert evidence["omitted_activity_row_ids"] == [rows[1]["row_id"]]


def test_literal_unknown_context_and_missing_context_are_distinct(client):
    population = open_example(client, "S3")
    literal = case_evidence(client, population, "S3A", "case-literal")["records"][0]
    missing = case_evidence(client, population, "S3B", "case-missing")["records"][0]
    assert literal["assignment_group"] == literal["original_values"]["assignment_group"] == "Unknown"
    assert missing["assignment_group"] is None
    assert missing["original_values"]["assignment_group"] == ""


def test_identical_query_keeps_content_identity_but_echoes_new_publication_identity(client):
    first = open_example(client, "S1", "open-first", 11)
    second = open_example(client, "S1", "open-second", 12)
    assert second["identity"] == first["identity"]
    assert second["populations"] == first["populations"]
    assert second["cases"] == first["cases"]
    first_case = case_evidence(client, first, "INC05", "evidence-first")
    second_case = case_evidence(client, second, "INC05", "evidence-second")
    assert second_case["records"] == first_case["records"]
    assert second_case["mapped_row_ids"] == first_case["mapped_row_ids"]


@pytest.mark.parametrize("field", ["source_id", "preparation_id", "representation_id", "case_dictionary_id", "population_id", "implementation_version"])
def test_each_case_identity_mismatch_is_a_refusal(client, field):
    population = open_example(client)
    request = evidence_request(population, "INC05", f"mismatch-{field}")
    if field == "implementation_version":
        request["identity"][field] = "999.0.0"
    else:
        prefix, old_hash = request["identity"][field].rsplit(":", 1)
        request["identity"][field] = prefix + ":" + ("0" if old_hash != "0" * 64 else "f") * 64
    VALIDATOR.validate(request)
    refusal(client.post(EVIDENCE_ROUTE, json=request), "case_evidence", "identity_mismatch", 409, request)


@pytest.mark.parametrize("case_id,code,status", [("NOT-RECORDED", "case_not_found", 404), ("INC13", "case_not_in_population", 409)])
def test_unknown_and_outside_cases_do_not_return_empty_success(client, case_id, code, status):
    request = evidence_request(open_example(client), case_id, "case-refused")
    refusal(client.post(EVIDENCE_ROUTE, json=request), "case_evidence", code, status, request)


def test_unknown_schema_version_is_a_typed_refusal(client):
    request = open_request()
    request["schema_version"] = 2
    refusal(client.post(OPEN_ROUTE, json=request), "open_example", "unsupported_schema", 400, request)


def test_missing_example_source_is_an_explicit_local_refusal(tmp_path):
    request = open_request(request_id="source-missing")
    with TestClient(create_app(static_dir=tmp_path / "unbuilt", examples_dir=tmp_path / "absent")) as active:
        response = active.post(OPEN_ROUTE, json=request)
    answer = refusal(response, "open_example", "source_unavailable", 404, request)
    assert str(tmp_path) not in answer["message"]


def test_malformed_example_source_is_not_an_empty_population(tmp_path):
    examples = tmp_path / "examples"
    examples.mkdir()
    (examples / "S0.csv").write_text("incident_id,activity\nONE,Opened\n", encoding="utf-8")
    request = open_request(request_id="source-malformed")
    with TestClient(create_app(static_dir=tmp_path / "unbuilt", examples_dir=examples)) as active:
        response = active.post(OPEN_ROUTE, json=request)
    refusal(response, "open_example", "malformed_source", 422, request)


@pytest.mark.parametrize("policy", ["order", "activity_projection", "context_projection", "parent", "predicate", "comparison", "missing_values", "clock", "nullable_measure"])
@pytest.mark.parametrize("unknown_id", ["unknown-policy.v1", "future-version"])
def test_unknown_policy_or_policy_version_is_a_typed_refusal(client, policy, unknown_id):
    request = open_request(request_id="policy-refused")
    current = request["policies"][policy]["id"]
    request["policies"][policy]["id"] = current[:-2] + "v2" if unknown_id == "future-version" else unknown_id
    refusal(client.post(OPEN_ROUTE, json=request), "open_example", "unsupported_policy", 400, request)


@pytest.mark.parametrize("kind", ["wrong-value", "extra-field", "missing-field", "wrong-type"])
def test_unsupported_or_malformed_policy_parameters_are_a_typed_refusal(client, kind):
    request = open_request(request_id="parameters-refused")
    parameters = request["policies"]["parent"]["parameters"]
    if kind == "wrong-value":
        parameters["service"] = "T"
    elif kind == "extra-field":
        parameters["fallback"] = "guess"
    elif kind == "missing-field":
        del parameters["service_quantifier"]
    else:
        request["policies"]["nullable_measure"]["parameters"]["missing_as_false"] = "false"
    refusal(client.post(OPEN_ROUTE, json=request), "open_example", "invalid_parameter", 400, request)


@pytest.mark.parametrize("bad_revision", [True, False, 0, -1, "1", None])
def test_invalid_open_revision_is_not_coerced_to_valid_query_identity(client, bad_revision):
    request = open_request(request_id="revision-refused")
    request["query_revision"] = bad_revision
    refusal(client.post(OPEN_ROUTE, json=request), "open_example", "invalid_request", 400, request)


@pytest.mark.parametrize("bad_revision", [True, False])
def test_invalid_evidence_revision_is_not_coerced_to_valid_query_identity(client, bad_revision):
    request = evidence_request(open_example(client), "INC05", "case-revision-refused")
    request["query_revision"] = bad_revision
    refusal(client.post(EVIDENCE_ROUTE, json=request), "case_evidence", "invalid_request", 400, request)


@pytest.mark.parametrize("operation", ["open_example", "case_evidence"])
def test_extra_request_fields_do_not_silently_expand_operation_scope(client, operation):
    if operation == "open_example":
        route, request = OPEN_ROUTE, open_request(request_id="extra-refused")
    else:
        route, request = EVIDENCE_ROUTE, evidence_request(open_example(client), "INC05", "extra-refused")
    request["norm_id"] = "not-required-for-exploration"
    refusal(client.post(route, json=request), operation, "invalid_request", 400, request)
