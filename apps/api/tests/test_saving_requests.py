"""The request boundary of the saving and comparison operations, without a workspace.

Requests are read before any workspace is looked up, so a request that is not
what the contract allows is refused with its place even for a workspace that
is not open, and one that is allowed reaches the workspace lookup
(``workspace_unavailable``). Every shape decided here is also checked against
the source schema itself, so the boundary neither refuses what the contract
allows nor allows what it refuses.
"""

import json
from copy import deepcopy
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from jsonschema import Draft202012Validator, FormatChecker

from wise_platform_api.app import create_app
from wise_platform_api.comparisons import STATUS as COMPARISON_STATUS
from wise_platform_api.saving_boundary import STATUS

ROOT = Path(__file__).resolve().parents[3]
SAVING = json.loads((ROOT / "contracts" / "saving.schema.json").read_text(encoding="utf-8"))
COMPARISON = json.loads((ROOT / "contracts" / "comparison.schema.json").read_text(encoding="utf-8"))


def validator(schema, definition):
    return Draft202012Validator({"$ref": f"#/$defs/{definition}", "$defs": schema["$defs"]}, format_checker=FormatChecker())


SAVE_REQUEST = validator(SAVING, "SaveInvestigationRequest")
REFUSAL = validator(SAVING, "SavingRefusal")
PERIOD_REQUEST = validator(COMPARISON, "PeriodComparisonRequest")

POLICY = "incident.context.first_record_in_declared_order.v1"
IDENTITY = {
    "source_id": "source.v1:sha256:" + "1" * 64,
    "preparation_id": "preparation.v1:sha256:" + "2" * 64,
    "representation_id": "representation.v1:sha256:" + "3" * 64,
    "case_dictionary_id": "case-dictionary.v1:sha256:" + "4" * 64,
    "population_id": "population.v1:sha256:" + "5" * 64,
    "implementation_version": "0.1.0",
}
WINDOWS = {
    "target": {"name": "Early", "window": {"timestamp_kind": "utc_instant", "start_inclusive": "2026-10-01T00:00:00Z",
                                           "end_exclusive": "2026-10-03T00:00:00Z"}},
    "reference": {"name": "Late", "window": {"timestamp_kind": "utc_instant", "start_inclusive": "2026-10-09T00:00:00Z",
                                             "end_exclusive": "2026-10-11T00:00:00Z"}},
    "minimum_followup_hours": 4,
    "endpoint_activity": None,
}


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    with TestClient(create_app(static_dir=tmp_path_factory.mktemp("unbuilt"))) as active:
        yield active


def save_request() -> dict:
    return {
        "schema_version": 1, "message_type": "save_investigation_request", "request_id": "save-1", "query_revision": 4,
        "workspace_id": "workspace.v1:not-opened", "investigation_id": None, "expected_revision_id": None,
        "name": "Handoffs", "base_identity": deepcopy(IDENTITY), "selection_identity": deepcopy(IDENTITY),
        "selection_recipe": {"parent_case_ids": ["A", "B"],
                             "predicates": [{"kind": "contains_activity", "activity": "Routed", "negate": False}]},
        "context_policy": POLICY,
        "comparison": {"kind": "period", "comparison_id": "comparison.v1:sha256:" + "6" * 64, "parent_case_ids": ["A", "B"],
                       "context_column_index": 3, "context_policy": POLICY, "definition": deepcopy(WINDOWS)},
        "notes": "", "bookmarks": [],
    }


def posted(client, request) -> tuple[int, dict]:
    response = client.post("/api/investigations/save", content=json.dumps(request).encode("utf-8"),
                           headers={"Content-Type": "application/json"})
    return response.status_code, response.json()


def accepted(client, request) -> None:
    """The request passes the boundary: only the workspace, which is not open, refuses it."""
    SAVE_REQUEST.validate(request)
    status, body = posted(client, request)
    assert (status, body["code"], body["field"]) == (404, "workspace_unavailable", "workspace_id"), body


# Python's JSON Schema validator reads two things more loosely than the contract means them: it counts 4.0
# as an integer, and its \d matches any decimal digit where the contract's patterns mean ASCII digits.
LOOSER_IN_PYTHON = {(4.0, "query_revision"), ("٠.١.٠", "base_identity.implementation_version")}


def refused(client, request, code, field, given=None) -> dict:
    if (given, field) not in LOOSER_IN_PYTHON:
        assert list(SAVE_REQUEST.iter_errors(request)), "the contract allows this request"
    status, body = posted(client, request)
    REFUSAL.validate(body)
    assert (body["operation"], body["code"], body["field"]) == ("save_investigation", code, field), body
    assert status == STATUS[code]
    # The query revision is echoed only when it is valid itself.
    revision = None if field == "query_revision" else 4
    assert (body["request_id"], body["query_revision"], body["workspace_id"]) == ("save-1", revision, "workspace.v1:not-opened")
    return body


def test_a_request_without_its_optional_fields_reaches_the_workspace(client):
    request = save_request()
    assert "score_run_ref" not in request and "presentation_state" not in request
    accepted(client, request)


def test_optional_fields_left_out_inside_a_presentation_are_not_written_back_as_null(client):
    request = save_request()
    request["presentation_state"] = {
        "active_view": "process_map", "table_sorts": [], "flow_artifact_sha256": None,
        "graph_positions": {"nodes": {"Recorded": {"x": 0, "y": 1.5, "width": 120, "height": 40}}, "groups": {},
                            "edges": {"e1": {"points": [{"x": 1, "y": 2}]}},
                            "bounds": {"x": 0, "y": 0, "width": 400, "height": 300}, "engine": "elk",
                            "direction": "RIGHT"}}
    accepted(client, request)


@pytest.mark.parametrize("hours", [4, 4.0, 0, 2.5])
def test_a_number_field_takes_a_whole_number_written_either_way(client, hours):
    request = save_request()
    request["comparison"]["definition"]["minimum_followup_hours"] = hours
    accepted(client, request)


def test_an_instant_with_fractions_of_a_second_is_taken_as_written(client):
    request = save_request()
    request["comparison"]["definition"]["target"]["window"]["start_inclusive"] = "2026-10-01T00:00:00.5Z"
    accepted(client, request)


def test_an_update_naming_both_its_investigation_and_expected_revision_is_taken(client):
    request = save_request()
    request.update(investigation_id="investigation.v1:abc-12345", expected_revision_id="saved-revision.v1:sha256:" + "7" * 64)
    accepted(client, request)


@pytest.mark.parametrize(
    ("change", "code", "field"),
    [
        (lambda r: r.update(query_revision=True), "invalid_request", "query_revision"),
        (lambda r: r.update(query_revision=4.0), "invalid_request", "query_revision"),
        (lambda r: r.update(query_revision=9007199254740992), "invalid_request", "query_revision"),
        (lambda r: r.update(schema_version=True), "invalid_request", "schema_version"),
        (lambda r: r["selection_recipe"]["predicates"][0].update(negate=0), "invalid_request",
         "selection_recipe.predicates.0.negate"),
        (lambda r: r.update(investigation_id="investigation.v1:abc-12345"), "invalid_request", "expected_revision_id"),
        (lambda r: r.update(expected_revision_id="saved-revision.v1:sha256:" + "7" * 64), "invalid_request",
         "investigation_id"),
        (lambda r: r["selection_recipe"].update(parent_case_ids=["A", "B", "A"]), "invalid_request",
         "selection_recipe.parent_case_ids.2"),
        (lambda r: r["selection_recipe"].update(parent_case_ids=None), "invalid_request", "selection_recipe.parent_case_ids"),
        (lambda r: r["comparison"].update(parent_case_ids=["A", "A"]), "invalid_request", "comparison.parent_case_ids.1"),
        (lambda r: r["selection_recipe"]["predicates"][0].update(kind="contains_text"), "invalid_request",
         "selection_recipe.predicates.0.kind"),
        (lambda r: r["selection_recipe"]["predicates"][0].pop("negate"), "invalid_request",
         "selection_recipe.predicates.0.negate"),
        (lambda r: r.update(context_policy="first-nonmissing"), "unsupported_policy", "context_policy"),
        (lambda r: r["comparison"]["definition"]["target"]["window"].update(start_inclusive="2026-10-01T02:00:00+02:00"),
         "invalid_request", "comparison.definition.target.window.start_inclusive"),
        (lambda r: r["comparison"]["definition"]["reference"]["window"].update(end_exclusive="2026-02-30T00:00:00Z"),
         "invalid_request", "comparison.definition.reference.window.end_exclusive"),
        (lambda r: r["comparison"]["definition"].update(minimum_followup_hours=-1), "invalid_request",
         "comparison.definition.minimum_followup_hours"),
        (lambda r: r["comparison"]["definition"].update(minimum_followup_hours="4"), "invalid_request",
         "comparison.definition.minimum_followup_hours"),
        (lambda r: r["base_identity"].update(implementation_version="٠.١.٠"), "invalid_request",
         "base_identity.implementation_version"),
        (lambda r: r["base_identity"].pop("case_dictionary_id"), "invalid_request", "base_identity.case_dictionary_id"),
        (lambda r: r.update(bookmarks=[{"label": "A", "case_id": "A", "row_ids": [], "note": ""}]), "invalid_request",
         "bookmarks.0.identity"),
        (lambda r: r.update(bookmarks=[{"label": "A", "identity": deepcopy(IDENTITY), "case_id": "A",
                                        "row_ids": ["row.v1:sha256:" + "8" * 64] * 2, "note": ""}]),
         "invalid_request", "bookmarks.0.row_ids.1"),
        (lambda r: r.update(score_run_ref={"score_run_id": "latest", "scored_population_id": IDENTITY["population_id"],
                                           "calibration_id": "automatic"}), "invalid_request", "score_run_ref.score_run_id"),
        (lambda r: r.update(extra=1), "invalid_request", "extra"),
    ],
)
def test_a_request_the_contract_does_not_allow_is_refused_at_its_place(client, change, code, field):
    request = save_request()
    change(request)
    place: object = request
    for part in field.split("."):
        place = place[int(part)] if isinstance(place, list) else place.get(part) if isinstance(place, dict) else None
    refused(client, request, code, field, place)


def test_another_schema_version_is_unsupported(client):
    request = save_request()
    request["schema_version"] = 2
    status, body = posted(client, request)
    assert (status, body["code"], body["field"]) == (400, "unsupported_schema", "schema_version")


def test_a_body_that_is_not_json_is_refused_without_an_echo(client):
    response = client.post("/api/investigations/reopen", content=b"{not json", headers={"Content-Type": "application/json"})
    body = response.json()
    REFUSAL.validate(body)
    assert (response.status_code, body["operation"], body["code"], body["request_id"]) == (
        400, "reopen_investigation", "invalid_request", None)


def test_a_reopen_and_a_list_request_are_read_strictly(client):
    reopen = {"schema_version": 1, "message_type": "reopen_investigation_request", "request_id": "r-1",
              "query_revision": 1, "workspace_id": "workspace.v1:not-opened", "saved_revision_id": "saved-revision.v1:x"}
    response = client.post("/api/investigations/reopen", json=reopen)
    assert (response.status_code, response.json()["field"]) == (400, "saved_revision_id")
    listing = {"schema_version": 1, "message_type": "list_saved_request", "request_id": "l-1", "query_revision": 1,
               "workspace_id": "workspace.v1:not-opened"}
    response = client.post("/api/investigations/list-saved", json=listing)
    assert (response.status_code, response.json()["code"]) == (404, "workspace_unavailable")


def period_request(hours) -> dict:
    definition = deepcopy(WINDOWS)
    definition["minimum_followup_hours"] = hours
    return {"schema_version": 1, "message_type": "compare_periods_request", "request_id": "c-1", "query_revision": 2,
            "workspace_id": "workspace.v1:not-opened", "identity": deepcopy(IDENTITY), "parent_case_ids": None,
            "context_column_index": 3, "context_policy": POLICY, "definition": definition}


@pytest.mark.parametrize("hours", [4, 4.0])
def test_a_period_comparison_request_takes_a_whole_number_written_either_way(client, hours):
    request = period_request(hours)
    PERIOD_REQUEST.validate(request)
    response = client.post("/api/investigations/compare-periods", json=request)
    assert (response.status_code, response.json()["code"]) == (404, "workspace_unavailable")


@pytest.mark.parametrize(
    ("change", "code", "field"),
    [
        (lambda r: r.update(parent_case_ids=["A", "A"]), "invalid_request", "parent_case_ids.1"),
        (lambda r: r["definition"].update(minimum_followup_hours=-1), "invalid_parameter", "definition.minimum_followup_hours"),
        (lambda r: r["definition"]["target"]["window"].update(start_inclusive="2026-10-01T00:00:00+00:00"),
         "invalid_parameter", "definition.target.window.start_inclusive"),
        (lambda r: r.update(context_policy="latest"), "unsupported_policy", "context_policy"),
        (lambda r: r.update(context_column_index=True), "invalid_request", "context_column_index"),
    ],
)
def test_a_comparison_request_the_contract_does_not_allow_is_refused_at_its_place(client, change, code, field):
    request = period_request(4)
    change(request)
    assert list(PERIOD_REQUEST.iter_errors(request))
    response = client.post("/api/investigations/compare-periods", json=request)
    body = response.json()
    assert (body["message_type"], body["code"], body["field"]) == ("comparison_refusal", code, field), body
    assert response.status_code == COMPARISON_STATUS[code]
