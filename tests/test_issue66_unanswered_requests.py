"""#66: requests without an answer, by the analyst's definitions.

Against the invented tests/fixtures/requests file and its hand-written expected.json: the local service reads, for each
kept incident in the declared order, the latest matter (a gap longer than the threshold starts a new one), its last
request (on the given turn) and whether an answer follows it; it names the last request as evidence and the hours from
the incident's last record to the cutoff accepted at import. No resolved label, rate or closure activity is formed. A
reviewed definition is saved with the investigation, bound to its reading.
"""

import json

import pytest

from test_import_acceptance import envelope
from test_issue10_interval_tail import ROOT, client, read, select  # noqa: F401  (client is a fixture)
from wise_platform_api.saving import _recovery

FIXTURES = ROOT / "tests/fixtures/requests"
EXPECTED = json.loads((FIXTURES / "expected.json").read_text(encoding="utf-8"))
RAW = (FIXTURES / EXPECTED["file"]).read_bytes()


@pytest.fixture
def opened(client, tmp_path):  # noqa: F811
    return read(client, tmp_path, RAW, EXPECTED["file"], dict(EXPECTED["mapping"]), EXPECTED["cutoff_utc"])


def ask(client, workspace, identity, definition, limit=100):  # noqa: F811
    return client.post("/api/investigations/unanswered-requests", json=envelope("unanswered_requests_request", "requests-66", 4, workspace_id=workspace["workspace_id"],
                       identity=identity, definition=definition, case_limit=limit))


@pytest.mark.parametrize("name", ["with_turn_and_gap", "plain"])
def test_the_last_request_without_a_later_answer_as_the_oracle(client, opened, name):  # noqa: F811
    workspace, base = opened
    wanted = EXPECTED[name]
    response = ask(client, workspace, base["identity"], wanted["definition"])
    assert response.status_code == 200, response.text
    answer = response.json()
    assert (answer["request_id"], answer["query_revision"], answer["identity"], answer["definition"]) == ("requests-66", 4, base["identity"], wanted["definition"])
    assert answer["policy"] == "incident.request.last_unanswered.v1"
    assert answer["clock"] == {"timestamp_kind": "utc_instant", "snapshot_cutoff": EXPECTED["cutoff_utc"]}
    assert answer["kept_case_count"] == len(EXPECTED["incidents"])
    assert answer["outcomes"] == wanted["outcomes"]
    assert answer["order_unknown_case_ids"] == ["R-7"]
    got = [{"case_id": item["case_id"], "position": item["last_request"]["position"], "records_after_request": item["records_after_request"],
            "last_record_time": item["last_record_time"], "hours": item["hours_since_last_record"]} for item in answer["cases"]]
    assert got == wanted["cases"]
    assert all(item["last_request"]["activity"] == "Asked customer" and item["last_request"]["row_id"] for item in answer["cases"])
    # Nothing is called resolved or unresolved, and no rate is formed.
    text = json.dumps(answer).lower()
    assert "resolved" not in text and "rate" not in answer and "closure" not in text


def test_only_the_kept_incidents_are_read(client, opened):  # noqa: F811
    workspace, base = opened
    kept = select(client, workspace, base, [{"kind": "case_id_in", "case_ids": ["R-2", "R-4"], "negate": False}])
    answer = ask(client, workspace, kept["identity"], EXPECTED["plain"]["definition"]).json()
    assert answer["kept_case_count"] == 2 and answer["outcomes"] == {"without_answer": 1, "answered": 0, "no_request": 1, "order_unknown": 0}
    assert [item["case_id"] for item in answer["cases"]] == ["R-2"]
    # A limit lists the longest first and says that more are there.
    limited = ask(client, workspace, base["identity"], EXPECTED["plain"]["definition"], limit=1).json()
    assert [item["case_id"] for item in limited["cases"]] == ["R-6"] and limited["cases_truncated"] is True


@pytest.mark.parametrize("change, code, field", [
    (lambda d: {**d, "answer_activities": ["Asked customer"]}, "definition_invalid", "definition.answer_activities"),
    (lambda d: {**d, "request_activities": ["Phoned"]}, "activity_unknown", "definition.request_activities"),
    (lambda d: {**d, "turn": {"column_index": 3, "value": "1"}}, "column_not_context", "definition.turn.column_index"),
])
def test_definitions_that_cannot_be_read_are_refused(client, opened, change, code, field):  # noqa: F811
    workspace, base = opened
    response = ask(client, workspace, base["identity"], change(EXPECTED["plain"]["definition"]))
    assert response.status_code in (400, 422)
    assert (response.json()["code"], response.json()["field"]) == (code, field)


def requests_for(preparation_id):
    definition = EXPECTED["with_turn_and_gap"]["definition"]
    return {"preparation_id": preparation_id, **definition, "reviewed": True}


def test_a_reviewed_definition_is_saved_with_the_investigation_bound_to_its_reading(client, opened):  # noqa: F811
    workspace, base = opened
    answer = select(client, workspace, base, [])

    def save(requests):
        return client.post("/api/investigations/save", json=envelope("save_investigation_request", workspace_id=workspace["workspace_id"],
            investigation_id=None, expected_revision_id=None, name="Invented requests", base_identity=base["identity"], selection_identity=answer["identity"],
            selection_recipe={"parent_case_ids": answer["parent"]["case_ids"], "predicates": []}, context_policy="incident.context.first_record_in_declared_order.v1",
            comparison=None, notes="", bookmarks=[], presentation_state={"active_view": "incidents", "table_sorts": [], "flow_artifact_sha256": None,
            "graph_positions": None, "requests": requests}))

    saved = save(requests_for(base["identity"]["preparation_id"]))
    assert saved.status_code == 200, saved.text
    reopened = client.post("/api/investigations/reopen", json=envelope("reopen_investigation_request", workspace_id=workspace["workspace_id"],
                           saved_revision_id=saved.json()["revision"]["saved_revision_id"])).json()
    assert reopened["recovery"]["presentation_state"]["requests"] == requests_for(base["identity"]["preparation_id"])
    other = save(requests_for("preparation.v1:sha256:" + "0" * 64))
    assert (other.status_code, other.json()["field"]) == (400, "presentation_state.requests.preparation_id")
    # A draft is not saved: only a reviewed definition is.
    draft = save({**requests_for(base["identity"]["preparation_id"]), "reviewed": False})
    assert draft.status_code == 400


def test_a_definition_of_another_reading_is_left_out_when_reopened_and_said_to_be():
    base = {"preparation_id": "preparation.v1:sha256:" + "1" * 64}
    stored = {"active_view": "incidents", "table_sorts": [], "flow_artifact_sha256": None, "graph_positions": None, "requests": requests_for("preparation.v1:sha256:" + "2" * 64)}
    recovered = _recovery(stored, base)
    assert "requests" not in recovered["presentation_state"]
    assert [warning["code"] for warning in recovered["warnings"]] == ["requests_not_applied"]
