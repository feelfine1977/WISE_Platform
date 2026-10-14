"""Strict transport and native bindings for complete time evidence."""

from copy import deepcopy
from dataclasses import replace
import json

import pytest

from wise_platform_api.generated.imports import ImportedCaseEvidenceAnswer
from test_incident_time_contracts import NEGATIVES, POSITIVES, native_preparation, preparation_for, read, validator
from test_incident_time_http import evidence_request


def validate(body, native_body=None, **kwargs):
    from wise_platform_api.incident_time_boundary import validate_incident_time_answer

    original = native_body or body
    return validate_incident_time_answer(
        body, preparation_for(original), evidence_request(original, original["workspace_id"]), **kwargs)


@pytest.mark.parametrize("case", POSITIVES, ids=lambda c: c["name"])
def test_complete_positive_bodies_and_original_timestamp_strings_are_preserved(case):
    body = read(case["expected_answer"])
    before = deepcopy(body)
    assert validate(body, require_diagnostics=True) is body
    assert body == before


@pytest.mark.parametrize("case", NEGATIVES, ids=lambda c: c["name"])
def test_complete_malicious_bodies_are_rejected_even_when_source_shape_accepts(case):
    body = read(case["malicious_full_wire"])
    before = deepcopy(body)
    native = read(case["base_positive"])
    with pytest.raises(ValueError):
        validate(body, native)
    assert body == before


def test_legacy_omission_survives_validation_but_producer_omission_and_model_dump_null_fail():
    native = read(POSITIVES[0]["expected_answer"])
    body = deepcopy(native)
    del body["incident_time"]
    assert validate(body, native) is body
    assert "incident_time" not in body
    with pytest.raises(ValueError):
        validate(body, native, require_diagnostics=True)
    parsed = ImportedCaseEvidenceAnswer.model_validate_json(json.dumps(body), strict=True)
    assert parsed.model_dump(mode="json")["incident_time"] is None
    with pytest.raises(ValueError):
        validate(parsed.model_dump(mode="json"), native)


@pytest.mark.parametrize("path,value", [
    (("identity", "source_id"), "source.v1:sha256:" + "0" * 64),
    (("identity", "population_id"), "population.v1:sha256:" + "0" * 64),
    (("request_id",), "another-request"),
    (("query_revision",), 99),
    (("workspace_id",), "workspace.v1:00000000"),
    (("case_id",), "B"),
    (("columns", 0, "name"), "changed"),
    (("records", 0, "original_cells", 0), "changed"),
    (("records", 0, "source_position"), 99),
    (("records", 0, "source_sequence"), 99),
    (("incident_time", "summary", "observed_span_hours"), float("nan")),
    (("incident_time", "summary", "maximum_gap_witness", "share_of_observed_span"), float("inf")),
    (("incident_time", "summary", "usable_gap_count"), True),
    (("incident_time", "maximum_gap_equal_count"), 1.0),
    (("incident_time", "records", 0, "clock_microseconds"), "1790812800000000\n"),
    (("incident_time", "records", 0, "timestamp_key"), "2026-10-01T00:00:00Z\n"),
])
def test_outer_envelope_source_cells_and_strict_scalar_types_bind_native_evidence(path, value):
    native = read(POSITIVES[0]["expected_answer"])
    body = deepcopy(native)
    node = body
    for key in path[:-1]:
        node = node[key]
    node[path[-1]] = value
    with pytest.raises(ValueError):
        validate(body, native)


def test_source_admitted_mutations_still_require_native_binding():
    admitted = [case for case in NEGATIVES if validator().is_valid(read(case["malicious_full_wire"]))]
    assert len(admitted) == 27
    assert any(case["name"] == "huge-float-tie-wrong-first-witness" for case in admitted)


@pytest.mark.parametrize("change", [
    {"utc_instant": "2026-10-01T00:00:00+00:00"},
    {"timestamp_status": "missing", "utc_instant": None},
])
def test_legacy_omission_does_not_bless_broken_native_clock_or_status(change):
    from wise_platform_api.incident_time_boundary import validate_incident_time_answer

    original = read(POSITIVES[0]["expected_answer"])
    prepared = native_preparation("utc_instant")
    rows = list(prepared.histories["A"])
    rows[0] = replace(rows[0], **change)
    broken = replace(prepared, histories={**prepared.histories, "A": tuple(rows)})
    body = deepcopy(original)
    del body["incident_time"]
    body["records"] = [row.to_dict() for row in rows]
    body["sequence_evaluable"] = broken.sequence_evaluable("A")
    with pytest.raises(ValueError):
        validate_incident_time_answer(body, broken, evidence_request(original, original["workspace_id"]))
