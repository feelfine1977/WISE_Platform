"""The opening context and the variants of a population through their routes, and their refusals."""

import pytest
from fastapi.testclient import TestClient
from import_requests import envelope, policies

from wise_platform_analytics.preparation import prepare
from wise_platform_analytics.selection import OpeningAttributeEquals, select_cases
from wise_platform_api import population_views
from wise_platform_api.app import create_app
from wise_platform_api.population_view_messages import (
    STATUS,
    OpeningContextAnswer,
    PopulationViewRefusal,
    VariantsAnswer,
)

# Four incidents. A opens with an empty desk and has East only later; B opens with the text
# "Unknown"; C opens at East; D has a record without a readable time, so its order is unknown.
LOG = (
    "Ticket,Activity,At,Desk\r\n"
    "A,Open,2026-10-01T08:00:00Z,\r\n"
    "A,Close,2026-10-01T09:00:00Z,East\r\n"
    "B,Open,2026-10-01T08:00:00Z,Unknown\r\n"
    "B,Close,2026-10-01T09:00:00Z,Unknown\r\n"
    "C,Open,2026-10-01T08:00:00Z,East\r\n"
    "C,,2026-10-01T08:30:00Z,East\r\n"
    "C,Close,2026-10-01T09:00:00Z,East\r\n"
    "D,Open,2026-10-01T08:00:00Z,East\r\n"
    "D,Close,later,East\r\n"
).encode("utf-8")
DIALECT = {"encoding": "utf-8", "delimiter": ",", "quotechar": '"', "header": "first_record"}


def mapping(context=(3,)):
    return {"case_column": 0, "activity_column": 1, "timestamp_column": 2, "sequence_column": None,
            "context_columns": list(context)}


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(static_dir=tmp_path / "unbuilt")) as active:
        yield active


def open_workspace(client, folder) -> str:
    folder.mkdir()
    response = client.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(folder)))
    assert response.status_code == 200, response.text
    return response.json()["workspace_id"]


def prepared_identity(client, workspace_id, context=(3,)) -> dict:
    metadata = envelope("upload_source_metadata", "upload-1", workspace_id=workspace_id, filename="log.csv")
    uploaded = client.put("/api/sources", params=metadata, content=LOG,
                          headers={"Content-Type": "application/octet-stream"})
    source_id = uploaded.json()["source"]["source_id"]
    confirmed = client.post("/api/preparations", json=envelope(
        "confirm_mapping_request", "prepare-1", workspace_id=workspace_id, source_id=source_id, dialect=DIALECT,
        mapping=mapping(context), policies=policies("iso8601", None), accept_report_issues=True))
    assert confirmed.json()["state"] == "ready", confirmed.text
    preparation_id = confirmed.json()["preparation"]["preparation_id"]
    opened = client.post("/api/investigations/open-population", json=envelope(
        "open_population_request", "population-1", workspace_id=workspace_id, preparation_id=preparation_id))
    return opened.json()["identity"]


@pytest.fixture
def workspace_id(client, tmp_path):
    return open_workspace(client, tmp_path / "Ablage")


@pytest.fixture
def identity(client, workspace_id):
    return prepared_identity(client, workspace_id)


def ask(client, route, workspace_id, identity, request_id="view-1", revision=4):
    message_type = {"opening-context": "opening_context_request", "variants": "variants_request"}[route]
    request = envelope(message_type, request_id, revision, workspace_id=workspace_id, identity=identity)
    return client.post(f"/api/investigations/{route}", json=request), request


def refused(response, operation, code, field=None):
    body = response.json()
    PopulationViewRefusal.model_validate(body)
    assert (body["operation"], body["code"]) == (operation, code), body
    assert response.status_code == STATUS[code]
    assert body["message"].strip()
    if field is not None:
        assert body["field"] == field, body
    return body


def categories(answer):
    (desk,) = answer["opening_context"]["columns"]
    return {(item["kind"], item["value"]): item for item in desk["categories"]}


def test_the_opening_context_of_the_parent_is_compared_with_itself(client, workspace_id, identity):
    response, request = ask(client, "opening-context", workspace_id, identity)
    assert response.status_code == 200, response.text
    answer = response.json()
    OpeningContextAnswer.model_validate(answer)
    assert (answer["request_id"], answer["query_revision"], answer["workspace_id"]) == ("view-1", 4, workspace_id)
    assert answer["identity"] == identity
    assert answer["parent_identity"] == identity
    context = answer["opening_context"]
    assert context["anchor_policy"] == "incident.context.first_record_in_declared_order.v1"
    assert context["parent"] == {"case_count": 4, "evaluable_case_count": 3, "unevaluable_case_count": 1,
                                 "unevaluable_case_ids": ["D"]}
    assert context["columns"][0]["column_name"] == "Desk"
    shown = categories(answer)
    assert set(shown) == {("value", "East"), ("value", "Unknown"), ("missing", None)}
    assert shown[("missing", None)]["population"] == {"count": 1, "share": 1 / 3, "denominator": 3}
    assert shown[("value", "East")]["difference_percentage_points"] == 0.0


def test_the_variants_of_the_parent_keep_the_unordered_incident_apart(client, workspace_id, identity):
    response, _ = ask(client, "variants", workspace_id, identity)
    assert response.status_code == 200, response.text
    answer = response.json()
    VariantsAnswer.model_validate(answer)
    assert answer["identity"] == identity
    summary = answer["variants"]
    assert [(item["activities"], item["case_ids"], item["share"], item["denominator"]) for item in summary["variants"]] == [
        (["Open", "Close"], ["A", "B", "C"], 1.0, 3)]
    assert summary["variants"][0]["omitted_activity_record_count"] == 1
    assert summary["unevaluable"] == {"case_ids": ["D"], "case_count": 1, "record_count": 2,
                                      "omitted_activity_record_count": 0}


def register_selection(client, workspace_id, identity, value=None, negate=True):
    """A selection made by the package over the same bytes and choices, held as the application holds it."""
    result = prepare(LOG, DIALECT, mapping(), policies("iso8601", None), True)
    prepared = result.preparation
    assert prepared.identity_dict() == identity
    selection = select_cases(prepared, [OpeningAttributeEquals(3, value, negate)])
    client.app.state.selections.keep(workspace_id, selection)
    return selection.identity_dict()


def test_a_selection_is_compared_with_the_parent_it_was_made_from(client, workspace_id, identity):
    # Keep the incidents that did not open with a missing desk: B and C; A is removed, D unevaluable.
    selected = register_selection(client, workspace_id, identity)
    assert selected["population_id"] != identity["population_id"]
    response, _ = ask(client, "opening-context", workspace_id, selected)
    assert response.status_code == 200, response.text
    answer = response.json()
    assert answer["identity"] == selected
    # The parent is the frozen parent the selection was made from: the selection without steps over
    # the same incidents, which is another population than the preparation's own.
    frozen_parent = select_cases(prepare(LOG, DIALECT, mapping(), policies("iso8601", None), True).preparation, []).identity_dict()
    assert answer["parent_identity"] == frozen_parent
    assert frozen_parent["population_id"] != identity["population_id"]
    assert {name: value for name, value in frozen_parent.items() if name != "population_id"} == {
        name: value for name, value in identity.items() if name != "population_id"
    }
    assert answer["opening_context"]["population"]["case_count"] == 2
    shown = categories(answer)
    assert shown[("value", "Unknown")]["population"] == {"count": 1, "share": 0.5, "denominator": 2}
    assert shown[("value", "Unknown")]["parent"] == {"count": 1, "share": 1 / 3, "denominator": 3}
    assert shown[("value", "Unknown")]["difference_percentage_points"] == pytest.approx(50 - 100 / 3)
    assert shown[("missing", None)]["population"] == {"count": 0, "share": 0.0, "denominator": 2}

    response, _ = ask(client, "variants", workspace_id, selected)
    assert [item["case_ids"] for item in response.json()["variants"]["variants"]] == [["B", "C"]]
    assert response.json()["variants"]["unevaluable"]["case_ids"] == []


def test_a_selection_is_bound_to_its_workspace_and_its_whole_identity(client, workspace_id, identity, tmp_path):
    selected = register_selection(client, workspace_id, identity)
    other = open_workspace(client, tmp_path / "Zweite Ablage")
    assert prepared_identity(client, other) == identity
    for route, operation in (("opening-context", "opening_context"), ("variants", "variants")):
        response, request = ask(client, route, other, selected)
        body = refused(response, operation, "population_unavailable", "identity.population_id")
        assert (body["request_id"], body["query_revision"], body["workspace_id"]) == ("view-1", 4, other)
    unknown = dict(selected, population_id="population.v1:sha256:" + "0" * 64)
    refused(ask(client, "variants", workspace_id, unknown)[0], "variants", "population_unavailable")


def test_an_identity_of_another_preparation_is_refused(client, workspace_id, identity):
    changed = dict(identity, representation_id="representation.v1:sha256:" + "1" * 64)
    refused(ask(client, "opening-context", workspace_id, changed)[0], "opening_context", "identity_mismatch",
            "identity.representation_id")
    changed = dict(identity, implementation_version="9.9.9")
    refused(ask(client, "variants", workspace_id, changed)[0], "variants", "identity_mismatch",
            "identity.implementation_version")


def test_a_preparation_the_workspace_does_not_keep_is_refused(client, workspace_id, identity):
    absent = dict(identity, preparation_id="preparation.v1:sha256:" + "2" * 64)
    body = refused(ask(client, "variants", workspace_id, absent)[0], "variants", "preparation_unavailable",
                   "identity.preparation_id")
    assert body["retryable"] is True


def test_a_source_the_workspace_no_longer_holds_is_refused_at_the_identity(client, workspace_id, identity, tmp_path):
    digest = identity["source_id"].rsplit(":", 1)[1]
    (tmp_path / "Ablage" / "sources" / f"{digest}.json").unlink()
    body = refused(ask(client, "opening-context", workspace_id, identity)[0], "opening_context", "source_unavailable",
                   "identity.source_id")
    assert body["retryable"] is True


def test_a_workspace_that_is_not_open_is_refused(client, identity):
    response, _ = ask(client, "opening-context", "workspace.v1:00000000-not-open", identity)
    refused(response, "opening_context", "workspace_unavailable", "workspace_id")


def test_without_a_context_column_the_opening_context_is_refused_and_the_variants_answer(client, tmp_path):
    workspace_id = open_workspace(client, tmp_path / "Ohne Kontext")
    identity = prepared_identity(client, workspace_id, context=())
    body = refused(ask(client, "opening-context", workspace_id, identity)[0], "opening_context", "no_context_columns",
                   "mapping.context_columns")
    assert body["retryable"] is False
    assert ask(client, "variants", workspace_id, identity)[0].status_code == 200


@pytest.mark.parametrize(("change", "field"), [
    ({"message_type": "variants_request"}, "message_type"),
    ({"query_revision": True}, "query_revision"),
    ({"query_revision": 0}, "query_revision"),
    ({"request_id": " spaced"}, "request_id"),
    ({"extra": 1}, "extra"),
    ({"identity": None}, "identity"),
])
def test_a_request_outside_its_model_is_refused_at_its_place(client, workspace_id, identity, change, field):
    request = envelope("opening_context_request", "view-2", 2, workspace_id=workspace_id, identity=identity) | change
    refused(client.post("/api/investigations/opening-context", json=request), "opening_context", "invalid_request", field)


def test_a_missing_field_and_a_body_that_is_not_json_are_refused(client, workspace_id):
    request = envelope("variants_request", "view-3", 2, workspace_id=workspace_id)
    body = refused(client.post("/api/investigations/variants", json=request), "variants", "invalid_request", "identity")
    assert (body["request_id"], body["query_revision"], body["workspace_id"]) == ("view-3", 2, workspace_id)
    body = refused(client.post("/api/investigations/variants", content=b"{not json"), "variants", "invalid_request")
    assert (body["request_id"], body["query_revision"], body["workspace_id"]) == (None, None, None)


def test_another_schema_version_is_refused(client, workspace_id, identity):
    request = envelope("variants_request", "view-4", 2, workspace_id=workspace_id, identity=identity) | {"schema_version": 2}
    refused(client.post("/api/investigations/variants", json=request), "variants", "unsupported_schema", "schema_version")


def test_an_unexpected_failure_is_a_typed_refusal(client, workspace_id, identity, monkeypatch):
    def broken(prepared, case_ids):
        raise RuntimeError("broken")

    monkeypatch.setattr(population_views, "variants", broken)
    body = refused(ask(client, "variants", workspace_id, identity)[0], "variants", "computation_failed")
    assert body["retryable"] is True
    assert body["request_id"] == "view-1"
