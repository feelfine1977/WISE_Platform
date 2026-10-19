"""#4: a corrected reading is published as a new preparation; an investigation saved on the earlier one keeps it.

B3's dotted dates read day-first and month-first give two preparations of the same stored source. An investigation is
saved on the day-first reading; after the month-first reading is published, reopening it gives back the day-first
identity, population and instants of the independent oracle, and the month-first reading keeps its own.
"""

from copy import deepcopy

from fastapi.testclient import TestClient
import pytest

from test_import_acceptance import envelope, evidence, mapping_request, policies, population, prepare, read_input, upload
from wise_platform_api.app import create_app

CONTEXT_POLICY = "incident.context.first_record_in_declared_order.v1"


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(static_dir=tmp_path / "unbuilt")) as active:
        yield active


@pytest.fixture
def workspace(client, tmp_path):
    path = tmp_path / "workspace"
    path.mkdir()
    return client.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(path))).json()


def instants(client, workspace, answer):
    return {row["source_position"]: row["utc_instant"] for case in answer["population"]["case_ids"]
            for row in evidence(client, workspace, answer, case)["records"]}


def test_a_corrected_reading_is_a_new_preparation_and_a_saved_investigation_keeps_its_own(client, workspace):
    literal, raw, _ = read_input("B3")
    source = upload(client, workspace, raw, literal["file"])
    request = mapping_request(workspace, source, "B3")
    request["policies"]["time"] = policies("dmy_dot_minute", 0)["time"]
    day_first = population(client, workspace, prepare(client, deepcopy(request)))
    expected_day = dict(enumerate(literal["chosen_day_first"]["normalized_utc_by_record"]))
    assert {key: value for key, value in instants(client, workspace, day_first).items() if key in expected_day} == expected_day

    selected = client.post("/api/investigations/select-cases", json=envelope("select_cases_request", workspace_id=workspace["workspace_id"],
                           identity=day_first["identity"], parent_case_ids=None, predicates=[])).json()
    saved = client.post("/api/investigations/save", json=envelope("save_investigation_request", workspace_id=workspace["workspace_id"],
        investigation_id=None, expected_revision_id=None, name="Day-first reading", base_identity=day_first["identity"],
        selection_identity=selected["identity"], selection_recipe={"parent_case_ids": selected["parent"]["case_ids"], "predicates": []},
        context_policy=CONTEXT_POLICY, comparison=None, notes="", bookmarks=[]))
    assert saved.status_code == 200, saved.text

    # The analyst corrects the reading: month first. It is published as a new preparation of the same source.
    request["policies"]["time"] = policies("mdy_dot_minute", 0)["time"]
    month_first = population(client, workspace, prepare(client, deepcopy(request)))
    assert month_first["identity"]["source_id"] == day_first["identity"]["source_id"]
    assert month_first["identity"]["preparation_id"] != day_first["identity"]["preparation_id"]
    expected_month = dict(enumerate(literal["chosen_month_first"]["normalized_utc_by_record"]))
    assert {key: value for key, value in instants(client, workspace, month_first).items() if key in expected_month} == expected_month

    reopened = client.post("/api/investigations/reopen", json=envelope("reopen_investigation_request", workspace_id=workspace["workspace_id"],
                           saved_revision_id=saved.json()["revision"]["saved_revision_id"]))
    assert reopened.status_code == 200, reopened.text
    restored = reopened.json()["restored_selection"]
    # The saved investigation still reads the source day-first: its preparation, population, selection and instants are unchanged.
    assert reopened.json()["revision"]["content"]["base_identity"] == day_first["identity"]
    assert restored["identity"] == selected["identity"] and restored["identity"]["preparation_id"] == day_first["identity"]["preparation_id"]
    again = {**day_first, "identity": restored["identity"]}
    assert {key: value for key, value in instants(client, workspace, again).items() if key in expected_day} == expected_day
    listed = client.post("/api/workspaces/open", json=envelope("open_workspace_request", path=workspace["path"])).json()["preparations"]
    assert {entry["preparation_id"] for entry in listed} >= {day_first["identity"]["preparation_id"], month_first["identity"]["preparation_id"]}
