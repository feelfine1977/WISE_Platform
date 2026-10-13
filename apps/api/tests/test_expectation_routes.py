"""Validating, scoring and witnessing one expectation through the routes, and every refusal.

The literal log below has five incidents on 9 October 2026 (UTC); the
expectation is "after Opened, Resolved within 4 hours", partly met up to
2 hours later. Every expected value and count was worked out by hand:

    A  Opened 00:00, Resolved 03:00     3 h   value 0     met
    B  Opened 00:00, Resolved 05:00     5 h   value 0.5   partly met: (5 - 4) / 2
    C  Opened 00:00, Resolved 08:00     8 h   value 1     not met
    D  Opened 00:00                     no response: no value when left out, 1 when counted as not met
    E  Assigned 00:00                   no start: no value under either meaning
"""

import hashlib
import json
import sys
from copy import deepcopy
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from import_requests import envelope, policies, wall_policies
from jsonschema import Draft202012Validator, FormatChecker

from wise_platform_api import method
from wise_platform_api.app import create_app
from wise_platform_api.scoring_boundary import STATUS

ROOT = Path(__file__).resolve().parents[3]
SCHEMA = json.loads((ROOT / "contracts" / "scoring.schema.json").read_text(encoding="utf-8"))
VALIDATOR = Draft202012Validator(SCHEMA, format_checker=FormatChecker())
VALIDATE = "/api/expectations/validate"
SCORE = "/api/expectations/score"
WITNESS = "/api/expectations/case-witness"

LOG = (
    "Ticket,Activity,At,Desk\r\n"
    "A,Opened,2026-10-09T00:00:00Z,East\r\n"
    "A,Resolved,2026-10-09T03:00:00Z,East\r\n"
    "B,Opened,2026-10-09T00:00:00Z,East\r\n"
    "B,Resolved,2026-10-09T05:00:00Z,West\r\n"
    "C,Opened,2026-10-09T00:00:00Z,West\r\n"
    "C,Resolved,2026-10-09T08:00:00Z,West\r\n"
    "D,Opened,2026-10-09T00:00:00Z,\r\n"
    "E,Assigned,2026-10-09T00:00:00Z,East\r\n"
).encode("utf-8")
# U has a record whose time cannot be read, so its order cannot be evaluated.
UNORDERED = LOG + b"U,Opened,not-a-time,East\r\nU,Resolved,2026-10-09T02:00:00Z,East\r\n"
DEFINITION = {
    "kind": "resolution_first_after.v1",
    "name": "Resolved within four hours",
    "definition_revision": 1,
    "review_state": "reviewed",
    "provenance": {"kind": "locally_entered", "owner_label": "Service desk", "source_label": "Literal test",
                   "rationale": "Worked out by hand."},
    "role": "negotiable_target",
    "scope": {"kind": "all_cases"},
    "endpoints": {"activation_activity": "Opened", "response_activity": "Resolved", "activation": "first",
                  "response": "first_after", "response_time_comparison": "at_or_after"},
    "clock_kind": "utc_instant",
    "target": 4,
    "width": 2,
    "unit": "hours",
    "missing_activation": "skip",
    "missing_response": "skip",
    "calibration": "fixed_threshold",
}


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(static_dir=tmp_path / "unbuilt")) as active:
        yield active


@pytest.fixture
def workspace_id(client, tmp_path):
    folder = tmp_path / "Erwartungen Ä"
    folder.mkdir()
    response = client.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(folder)))
    assert response.status_code == 200, response.text
    return response.json()["workspace_id"]


def opened(client, workspace_id, raw=LOG, choices=None) -> dict:
    """The population of a literal log as the investigation opens it."""
    metadata = envelope("upload_source_metadata", "upload-1", workspace_id=workspace_id, filename="log.csv")
    response = client.put("/api/sources", params=metadata, content=raw, headers={"Content-Type": "application/octet-stream"})
    assert response.status_code == 200, response.text
    confirmation = envelope(
        "confirm_mapping_request", "prepare-1", workspace_id=workspace_id,
        source_id="source.v1:sha256:" + hashlib.sha256(raw).hexdigest(),
        dialect={"encoding": "utf-8", "delimiter": ",", "quotechar": '"', "header": "first_record"},
        mapping={"case_column": 0, "activity_column": 1, "timestamp_column": 2, "sequence_column": None,
                 "context_columns": [3]},
        policies=choices or policies("iso8601", None, cutoff="2026-10-09T10:00:00Z"), accept_report_issues=True)
    prepared = client.post("/api/preparations", json=confirmation).json()
    assert prepared["state"] == "ready", prepared
    request = envelope("open_population_request", "population-1", workspace_id=workspace_id,
                       preparation_id=prepared["preparation"]["preparation_id"])
    response = client.post("/api/investigations/open-population", json=request)
    assert response.status_code == 200, response.text
    return response.json()


@pytest.fixture
def base(client, workspace_id):
    return opened(client, workspace_id)


def selected(client, workspace_id, base, parent) -> dict:
    request = envelope("select_cases_request", "select-1", workspace_id=workspace_id, identity=base["identity"],
                       parent_case_ids=parent, predicates=[])
    response = client.post("/api/investigations/select-cases", json=request)
    assert response.status_code == 200, response.text
    return response.json()


def validation(workspace_id, base, definition=None, population=None, **changes) -> dict:
    return envelope(
        "validate_expectation_request", "validate-1", 3, workspace_id=workspace_id,
        base_identity=deepcopy(base["identity"]),
        named_population={"name": "Every incident", "identity": deepcopy((population or base)["identity"])},
        definition={**deepcopy(definition or DEFINITION), **changes},
    )


def answered(response, message_type) -> dict:
    assert response.status_code == 200, response.text
    body = response.json()
    VALIDATOR.validate(body)
    assert body["message_type"] == message_type, body
    return body


def refused(response, operation, code, field=None) -> dict:
    body = response.json()
    VALIDATOR.validate(body)
    assert body["message_type"] == "scoring_refusal", body
    assert (body["operation"], body["code"]) == (operation, code), body
    assert response.status_code == STATUS[code]
    assert body["message"].strip()
    if field is not None:
        assert body["field"] == field, body
    return body


def ready(client, workspace_id, base, population=None, **changes) -> dict:
    answer = answered(client.post(VALIDATE, json=validation(workspace_id, base, population=population, **changes)),
                      "expectation_validation_answer")
    assert answer["state"] == "ready", answer
    return answer["definition_version"]


def scoring(workspace_id, base, version, population=None, request_id="score-1", revision=4) -> dict:
    return envelope("score_expectation_request", request_id, revision, workspace_id=workspace_id,
                    base_identity=deepcopy(base["identity"]),
                    named_population={"name": "Scored incidents", "identity": deepcopy((population or base)["identity"])},
                    definition_version_id=version["definition_version_id"])


def run_of(client, workspace_id, base, version, population=None, **request) -> dict:
    return answered(client.post(SCORE, json=scoring(workspace_id, base, version, population, **request)), "score_run_answer")["run"]


def witness(client, workspace_id, run, case_id) -> dict:
    request = envelope("score_case_witness_request", "witness-1", 5, workspace_id=workspace_id,
                       run_id=run["identity"]["run_id"], case_id=case_id)
    return client.post(WITNESS, json=request)


# Validating ----------------------------------------------------------------------------------------


def test_a_ready_definition_is_kept_as_a_version_and_the_same_meaning_gives_the_same_version(client, workspace_id, base):
    first = ready(client, workspace_id, base)
    assert first["definition"] == {**DEFINITION, "target": 4.0, "width": 2.0}
    assert first["source_binding"] == {key: value for key, value in base["identity"].items() if key != "population_id"}
    assert first["norm"]["document"]["constraints"][0]["params"]["unit"] == "h"
    # Written as decimal numbers the meaning is the same; another target is another version.
    assert ready(client, workspace_id, base, target=4.0, width=2.0) == first
    assert ready(client, workspace_id, base, target=5)["definition_version_id"] != first["definition_version_id"]
    assert ready(client, workspace_id, base, review_state="draft")["definition_version_id"] != first["definition_version_id"]


def test_a_definition_on_another_clock_is_blocked_at_its_clock(client, workspace_id, base):
    answer = answered(client.post(VALIDATE, json=validation(workspace_id, base, clock_kind="wall_clock")),
                      "expectation_validation_answer")
    assert answer["state"] == "blocked" and answer["definition_version"] is None
    assert [(blocker["code"], blocker["field"]) for blocker in answer["blockers"]] == [("clock_mismatch", "definition.clock_kind")]
    assert answer["blockers"][0]["recovery_actions"] == ["edit_definition"]
    assert answer["readiness"]["supported_definition"] is False and answer["readiness"]["method_check_passed"] is False


def test_activities_must_be_activities_of_the_preparation_and_differ(client, workspace_id, base):
    endpoints = {**DEFINITION["endpoints"], "activation_activity": "Closed", "response_activity": "Closed"}
    answer = answered(client.post(VALIDATE, json=validation(workspace_id, base, endpoints=endpoints)),
                      "expectation_validation_answer")
    assert [(blocker["code"], blocker["field"]) for blocker in answer["blockers"]] == [
        ("invalid_parameter", "definition.endpoints.activation_activity"),
        ("invalid_parameter", "definition.endpoints.response_activity"),
        ("invalid_parameter", "definition.endpoints.response_activity"),
    ]


def test_an_activity_absent_from_the_named_population_is_blocked_by_the_library_check(client, workspace_id, base):
    # Assigned is an activity of the preparation, but only E has it, and E is not selected.
    population = selected(client, workspace_id, base, ["A", "B"])
    endpoints = {**DEFINITION["endpoints"], "activation_activity": "Assigned"}
    answer = answered(client.post(VALIDATE, json=validation(workspace_id, base, population=population, endpoints=endpoints)),
                      "expectation_validation_answer")
    assert answer["state"] == "blocked"
    assert answer["readiness"]["supported_definition"] is True and answer["readiness"]["method_check_passed"] is False
    assert [(blocker["code"], blocker["field"]) for blocker in answer["blockers"]] == [
        ("invalid_parameter", "definition.endpoints.activation_activity")]
    assert "Assigned" in answer["blockers"][0]["message"]


def test_a_target_whose_duration_cannot_be_represented_is_blocked_at_the_target(client, workspace_id, base):
    answer = answered(client.post(VALIDATE, json=validation(workspace_id, base, target=1e308)), "expectation_validation_answer")
    assert [(blocker["code"], blocker["field"]) for blocker in answer["blockers"]] == [("invalid_parameter", "definition.target")]


def test_a_population_with_an_incident_of_unknown_order_is_refused_before_the_library_is_called(
    client, workspace_id, monkeypatch
):
    base = opened(client, workspace_id, UNORDERED)
    calls = []
    monkeypatch.setattr(method, "compile_norm", lambda *args: calls.append(args))
    monkeypatch.setattr(method, "event_log", lambda *args: calls.append(args))
    body = refused(client.post(VALIDATE, json=validation(workspace_id, base)), "validate_expectation", "unevaluable_sequence",
                   "named_population")
    assert (body["case_ids"], body["case_count"]) == (["U"], 1)
    assert body["recovery_actions"] == ["inspect_quality", "choose_qualified_named_population"]
    assert (body["request_id"], body["query_revision"], body["workspace_id"]) == ("validate-1", 3, workspace_id)
    assert calls == []


def test_an_empty_or_unknown_or_foreign_population_is_refused(client, workspace_id, base):
    empty = selected(client, workspace_id, base, [])
    refused(client.post(VALIDATE, json=validation(workspace_id, base, population=empty)), "validate_expectation",
            "empty_population", "named_population")
    unknown = deepcopy(empty)
    unknown["identity"]["population_id"] = "population.v1:sha256:" + "0" * 64
    refused(client.post(VALIDATE, json=validation(workspace_id, base, population=unknown)), "validate_expectation",
            "population_unavailable", "named_population.identity.population_id")
    foreign = deepcopy(base)
    foreign["identity"]["representation_id"] = "representation.v1:sha256:" + "1" * 64
    refused(client.post(VALIDATE, json=validation(workspace_id, base, population=foreign)), "validate_expectation",
            "identity_mismatch", "named_population.identity")
    tampered = deepcopy(base)
    tampered["identity"]["case_dictionary_id"] = "case-dictionary.v1:sha256:" + "2" * 64
    request = validation(workspace_id, tampered)
    refused(client.post(VALIDATE, json=request), "validate_expectation", "identity_mismatch", "base_identity")


def test_a_workspace_that_is_not_open_is_refused(client, base):
    request = validation("workspace.v1:0000000000000000", base)
    refused(client.post(VALIDATE, json=request), "validate_expectation", "workspace_unavailable", "workspace_id")


# Reading the request -----------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("changes", "code", "field"),
    [
        ({"target": 0}, "invalid_parameter", "definition.target"),
        ({"target": True}, "invalid_parameter", "definition.target"),
        ({"width": -1}, "invalid_parameter", "definition.width"),
        ({"target": "4"}, "invalid_parameter", "definition.target"),
        # 9007199254740993 cannot be held as a decimal number; it would be read as ...992.
        ({"target": 9007199254740993}, "invalid_parameter", "definition.target"),
        ({"missing_response": "first"}, "unsupported_definition", "definition.missing_response"),
        ({"calibration": "quantile"}, "unsupported_definition", "definition.calibration"),
        ({"unit": "minutes"}, "unsupported_definition", "definition.unit"),
        ({"name": ""}, "invalid_request", "definition.name"),
    ],
)
def test_a_definition_outside_the_contract_is_refused_at_its_field(client, workspace_id, base, changes, code, field):
    refused(client.post(VALIDATE, json=validation(workspace_id, base, **changes)), "validate_expectation", code, field)


def test_another_pairing_is_an_unsupported_definition(client, workspace_id, base):
    endpoints = {**DEFINITION["endpoints"], "response": "last"}
    refused(client.post(VALIDATE, json=validation(workspace_id, base, endpoints=endpoints)), "validate_expectation",
            "unsupported_definition", "definition.endpoints.response")


@pytest.mark.parametrize("token", ["1e400", "NaN", "Infinity", "-Infinity"])
def test_a_number_that_cannot_be_read_is_refused_at_reading(client, workspace_id, base, token):
    body = json.dumps(validation(workspace_id, base, target="TARGET")).replace('"TARGET"', token)
    body = refused(client.post(VALIDATE, content=body.encode(), headers={"Content-Type": "application/json"}),
                   "validate_expectation", "invalid_request")
    assert body["request_id"] is None


def test_another_schema_version_and_an_unknown_field_are_refused(client, workspace_id, base):
    request = validation(workspace_id, base)
    refused(client.post(VALIDATE, json={**request, "schema_version": 2}), "validate_expectation", "unsupported_schema",
            "schema_version")
    refused(client.post(VALIDATE, json={**request, "extra": 1}), "validate_expectation", "invalid_request", "extra")
    refused(client.post(VALIDATE, json={**request, "query_revision": 3.0}), "validate_expectation", "invalid_request",
            "query_revision")


# Scoring -----------------------------------------------------------------------------------------------


def test_a_run_carries_the_library_values_and_the_number_of_incidents_in_each_state(client, workspace_id, base):
    version = ready(client, workspace_id, base)
    run = run_of(client, workspace_id, base, version)
    cases = {case["case_id"]: case for case in run["cases"]}
    assert {key: case["value"] for key, case in cases.items()} == {"A": 0, "B": 0.5, "C": 1, "D": None, "E": None}
    assert {key: case["measurement"]["value"] for key, case in cases.items()} == {"A": 3, "B": 5, "C": 8, "D": None, "E": None}
    assert {key: case["reason"] for key, case in cases.items()} == {
        "A": "evaluated", "B": "evaluated", "C": "evaluated", "D": "missing_response", "E": "missing_activation"}
    assert run["support"] == {
        "scored_case_count": 5, "in_scope_case_count": 5, "out_of_scope_case_count": 0, "scope_unknown_case_count": 0,
        "numeric_value_case_count": 3, "unavailable_value_case_count": 2, "affected_case_count": 2,
        "zero_value_case_count": 1, "observed_interval_case_count": 3, "activation_known_case_count": 4,
        "response_known_case_count": 3, "missing_activation_case_count": 1, "missing_response_case_count": 1,
        "censored_case_count": 0,
        "method_reason_counts": [{"reason": "evaluated", "case_count": 3}, {"reason": "missing_activation", "case_count": 1},
                                 {"reason": "missing_response", "case_count": 1}],
    }
    assert run["population"] == {"case_ids": ["A", "B", "C", "D", "E"], "case_count": 5, "record_count": 8}
    assert run["calibration"]["calibration_id"] == run["identity"]["calibration_id"]
    assert run["identity"]["clock"] == {
        "timestamp_kind": "utc_instant", "duration_meaning": "elapsed_utc",
        "observation_start_utc": "2026-10-09T00:00:00Z", "snapshot_cutoff_utc": "2026-10-09T10:00:00Z",
        "observation_start_local": None, "snapshot_cutoff_local": None,
    }
    assert run["identity"]["method_artifact"] == method.METHOD_ARTIFACT


def test_a_missing_response_counted_as_not_met_is_valued_one_without_a_measured_time(client, workspace_id, base):
    version = ready(client, workspace_id, base, missing_response="violate")
    run = run_of(client, workspace_id, base, version)
    missing = next(case for case in run["cases"] if case["case_id"] == "D")
    assert missing["value"] == 1 and missing["reason"] == "evaluated" and missing["measurement"]["value"] is None
    assert run["support"]["affected_case_count"] == 3 and run["support"]["missing_response_case_count"] == 1
    assert run["support"]["numeric_value_case_count"] == 4


def test_asking_again_answers_the_stored_run_without_the_library(client, workspace_id, base, monkeypatch):
    version = ready(client, workspace_id, base)
    run = run_of(client, workspace_id, base, version)

    def not_again(*args):
        raise AssertionError("The library was asked to score again.")

    monkeypatch.setattr(method, "score", not_again)
    monkeypatch.setattr(method, "event_log", not_again)
    assert run_of(client, workspace_id, base, version, request_id="score-2", revision=9) == run


def test_the_run_is_kept_in_the_workspace_for_another_run_of_the_application(client, workspace_id, base, tmp_path, monkeypatch):
    version = ready(client, workspace_id, base)
    run = run_of(client, workspace_id, base, version)
    with TestClient(create_app(static_dir=tmp_path / "unbuilt")) as restarted:
        folder = tmp_path / "Erwartungen Ä"
        assert restarted.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(folder))).status_code == 200
        monkeypatch.setattr(method, "score", lambda *args: pytest.fail("The library was asked to score again."))
        assert run_of(restarted, workspace_id, base, version) == run
        answered(witness(restarted, workspace_id, run, "B"), "score_case_witness_answer")


def test_scoring_another_population_is_another_run_with_the_same_fixed_calibration(client, workspace_id, base):
    version = ready(client, workspace_id, base)
    whole = run_of(client, workspace_id, base, version)
    subset = selected(client, workspace_id, base, ["B", "D"])
    part = run_of(client, workspace_id, base, version, subset)
    assert part["identity"]["run_id"] != whole["identity"]["run_id"]
    assert part["calibration"]["calibration_id"] == whole["calibration"]["calibration_id"]
    assert part["calibration"]["scored_population_id"] == subset["identity"]["population_id"]
    assert [(case["case_id"], case["value"]) for case in part["cases"]] == [("B", 0.5), ("D", None)]
    assert part["population"] == {"case_ids": ["B", "D"], "case_count": 2, "record_count": 3}


def test_a_draft_is_not_scored(client, workspace_id, base):
    version = ready(client, workspace_id, base, review_state="draft")
    body = refused(client.post(SCORE, json=scoring(workspace_id, base, version)), "score_expectation",
                   "definition_not_reviewed", "definition_version_id")
    assert body["recovery_actions"] == ["review_definition"]


def test_an_unknown_definition_version_is_refused(client, workspace_id, base):
    version = {"definition_version_id": "definition-version.v1:sha256:" + "3" * 64}
    refused(client.post(SCORE, json=scoring(workspace_id, base, version)), "score_expectation", "definition_unavailable",
            "definition_version_id")


def test_scoring_a_population_of_unknown_order_is_refused_with_its_incidents(client, workspace_id, monkeypatch):
    base = opened(client, workspace_id, UNORDERED)
    population = selected(client, workspace_id, base, ["A", "B", "C", "D", "E"])
    version = ready(client, workspace_id, base, population=population)
    monkeypatch.setattr(method, "event_log", lambda *args: pytest.fail("The library was called."))
    body = refused(client.post(SCORE, json=scoring(workspace_id, base, version)), "score_expectation",
                   "unevaluable_sequence", "named_population")
    assert (body["case_ids"], body["case_count"]) == (["U"], 1)


def test_a_wall_clock_preparation_is_scored_on_its_recorded_clock(client, workspace_id):
    raw = (
        "Ticket,Activity,At,Desk\r\n"
        "W,Opened,2026-03-29 01:00,East\r\n"
        "W,Resolved,2026-03-29 06:00,East\r\n"
    ).encode("utf-8")
    choices = wall_policies("iso8601", "2026-03-30T00:00:00", tolerant=False)
    base = opened(client, workspace_id, raw, choices)
    refused_answer = answered(client.post(VALIDATE, json=validation(workspace_id, base)), "expectation_validation_answer")
    assert refused_answer["blockers"][0]["code"] == "clock_mismatch"
    version = ready(client, workspace_id, base, clock_kind="wall_clock")
    run = run_of(client, workspace_id, base, version)
    # Five hours as recorded on the wall clock, whatever the daylight-saving change that night.
    assert run["cases"][0]["measurement"]["value"] == 5 and run["cases"][0]["value"] == 0.5
    assert run["identity"]["clock"] == {
        "timestamp_kind": "wall_clock", "duration_meaning": "recorded_wall_clock",
        "observation_start_utc": None, "snapshot_cutoff_utc": None,
        "observation_start_local": "2026-03-29T01:00:00", "snapshot_cutoff_local": "2026-03-30T00:00:00",
    }


# Witnesses ---------------------------------------------------------------------------------------------


def test_the_witness_marks_the_records_of_the_start_and_the_response(client, workspace_id, base):
    version = ready(client, workspace_id, base)
    run = run_of(client, workspace_id, base, version)
    answer = answered(witness(client, workspace_id, run, "B"), "score_case_witness_answer")
    records = answer["trace"]["records"]
    assert [record["activity"] for record in records] == ["Opened", "Resolved"]
    assert answer["activation_candidate_row_ids"] == [records[0]["row_id"]]
    assert answer["response_candidate_row_ids"] == [records[1]["row_id"]]
    assert answer["method_trace_row_ids"] == [record["row_id"] for record in records]
    assert answer["run_identity"] == run["identity"]
    assert answer["case"] == next(case for case in run["cases"] if case["case_id"] == "B")
    missing = answered(witness(client, workspace_id, run, "D"), "score_case_witness_answer")
    assert missing["response_candidate_row_ids"] == [] and len(missing["activation_candidate_row_ids"]) == 1
    no_start = answered(witness(client, workspace_id, run, "E"), "score_case_witness_answer")
    assert no_start["activation_candidate_row_ids"] == no_start["response_candidate_row_ids"] == []


def test_a_witness_reads_the_stored_value_and_does_not_score_again(client, workspace_id, base, monkeypatch):
    version = ready(client, workspace_id, base)
    run = run_of(client, workspace_id, base, version)
    monkeypatch.setattr(method, "score", lambda *args: pytest.fail("The library was asked to score again."))
    selected(client, workspace_id, base, ["B"])
    assert answered(witness(client, workspace_id, run, "B"), "score_case_witness_answer")["case"]["value"] == 0.5


def test_a_witness_of_an_unknown_run_or_incident_is_refused(client, workspace_id, base):
    version = ready(client, workspace_id, base)
    run = run_of(client, workspace_id, base, version)
    refused(witness(client, workspace_id, run, "Z"), "score_case_witness", "case_not_found", "case_id")
    other = deepcopy(run)
    other["identity"]["run_id"] = "score-run.v1:sha256:" + "4" * 64
    refused(witness(client, workspace_id, other, "B"), "score_case_witness", "run_unavailable", "run_id")


# Without the library ---------------------------------------------------------------------------------


def test_without_the_library_every_operation_says_how_to_install_it_and_the_rest_works(client, workspace_id, base, monkeypatch):
    version = ready(client, workspace_id, base)
    run = run_of(client, workspace_id, base, version)
    monkeypatch.setitem(sys.modules, "wise", None)
    for route, request, operation in (
        (VALIDATE, validation(workspace_id, base), "validate_expectation"),
        (SCORE, scoring(workspace_id, base, version), "score_expectation"),
        (WITNESS, envelope("score_case_witness_request", "witness-1", 5, workspace_id=workspace_id,
                           run_id=run["identity"]["run_id"], case_id="B"), "score_case_witness"),
    ):
        body = refused(client.post(route, json=request), operation, "method_unavailable")
        assert method.INSTALL_COMMAND in body["message"] and body["retryable"] is True
    again = envelope("open_population_request", "population-2", workspace_id=workspace_id,
                     preparation_id=base["identity"]["preparation_id"])
    assert client.post("/api/investigations/open-population", json=again).status_code == 200


def test_every_code_of_the_contract_has_a_status():
    codes = SCHEMA["$defs"]["ScoringRefusal"]["properties"]["code"]["enum"]
    assert sorted(STATUS) == sorted(codes)
