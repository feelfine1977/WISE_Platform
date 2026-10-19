"""Complete synthetic evidence messages and exact import authority."""

from copy import deepcopy
from functools import lru_cache
import hashlib
import json
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker
import pytest

from wise_platform_analytics.preparation import prepare
from wise_platform_api.generated.imports import ImportedCaseEvidenceAnswer

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "tests/fixtures/incident-time"


def read(name):
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


MANIFEST = read("manifest.json")
POSITIVES = MANIFEST["positive"]
NEGATIVES = MANIFEST["negative"]


@lru_cache
def native_preparation(kind):
    request = read(f"{kind}-prepare-request.json")
    result = prepare((FIXTURES / f"{kind}.csv").read_bytes(), request["dialect"],
                     request["mapping"], request["policies"], True)
    assert result.state == "ready"
    return result.preparation


def preparation_for(body):
    prepared = native_preparation(body["incident_time"]["timestamp_kind"])
    if body["request_id"].startswith("protocol-"):
        class UnknownOrder:
            def __getattr__(self, name):
                return getattr(prepared, name)

            def sequence_evaluable(self, case_id):
                return False
        return UnknownOrder()
    return prepared


def validator(schema=None):
    schema = schema or json.loads((ROOT / "contracts/import.schema.json").read_text(encoding="utf-8"))
    return Draft202012Validator(schema, format_checker=FormatChecker())


def test_exact_authority_and_unchanged_shared_summary_definitions():
    source = ROOT / "contracts/import.schema.json"
    # The explicit native BPIC19 dash/seconds format extends only TimestampFormat; memory_unavailable extends only the refusal codes;
    # the optional document reference role (#132) extends only Mapping.
    assert hashlib.sha256(source.read_bytes()).hexdigest() == "596fdc5694c0c0146c0edbc00132a7805d8908c82ccba7195c576c069ee9b83c"
    definitions = json.loads(source.read_text(encoding="utf-8"))["$defs"]
    listed = json.loads((ROOT / "contracts/case-list.schema.json").read_text(encoding="utf-8"))["$defs"]
    for name in ("CaseTimeSummary", "AvailableUtcCaseTimeSummary", "AvailableWallCaseTimeSummary",
                 "UnavailableCaseTimeSummary", "MaximumRawGapWitness", "UtcInstant", "LocalTimestamp", "RowId"):
        assert definitions[name] == listed[name]


@pytest.mark.parametrize("case", POSITIVES, ids=lambda c: c["name"])
def test_complete_positive_messages_pass_source_and_strict_generated_model(case):
    body = read(case["expected_answer"])
    validator().validate(body)
    ImportedCaseEvidenceAnswer.model_validate_json(json.dumps(body), strict=True)


def test_legacy_omission_is_accepted_and_explicit_null_is_not():
    body = read(POSITIVES[0]["expected_answer"])
    legacy = deepcopy(body)
    del legacy["incident_time"]
    validator().validate(legacy)
    ImportedCaseEvidenceAnswer.model_validate_json(json.dumps(legacy), strict=True)
    body["incident_time"] = None
    assert not validator().is_valid(body)


def test_full_source_corpus_outcomes_include_semantic_only_mutations():
    cases = read("validation-corpus.json")
    assert len(cases) == 172
    check = validator()
    for case in cases:
        assert check.is_valid(case["body"]) is case["source_valid"], case["name"]
    assert len(POSITIVES) == 35 and sum(c["native_reachable"] for c in POSITIVES) == 33
    assert len(NEGATIVES) == 84
    assert sum(check.is_valid(read(c["malicious_full_wire"])) for c in NEGATIVES) == 27
