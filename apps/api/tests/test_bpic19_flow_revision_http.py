"""Public four-flow revision and refusal contracts over independent literal records."""
from copy import deepcopy
import json

import pytest
from fastapi.testclient import TestClient

from import_requests import envelope
from test_bpic19_profile_http import ROUTE, VALIDATOR, request as profile_request
from flow_f10_literal import ROLES, prepare as prepare_source
from wise_platform_api.app import create_app


def request(wid, identity):
    return profile_request(wid, identity, ROLES)


@pytest.mark.parametrize("field,value,code,location", [
    ("policy_id", "first_record.v1", "unsupported_policy", "query.policy_id"),
    *[("category_labels", {flow: "other"}, "invalid_request", "query.category_labels")
      for flow in ["after_gr", "before_gr", "two_way", "consignment"]],
    ("invariance_policy", "majority", "invalid_request", "query.invariance_policy"),
    ("flag_policy", "infer_category", "invalid_request", "query.flag_policy"),
    ("unresolved_treatment", "largest_flow", "invalid_request", "query.unresolved_treatment"),
])
def test_immutable_flow_meanings_refuse_without_replacing_reviewed_answer(tmp_path, field, value, code, location):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    with TestClient(create_app()) as client:
        wid, identity = prepare_source(client, workspace)
        original = request(wid, identity)
        accepted = client.post(ROUTE, json=original)
        assert accepted.status_code == 200
        changed = deepcopy(original)
        changed["query"][field] = value
        refused = client.post(ROUTE, json=changed)
        VALIDATOR.validate(refused.json())
        assert refused.json()["code"] == code
        assert refused.json()["field"] == location
        assert refused.status_code in {400, 422}
        replayed = client.post(ROUTE, json=original)
        assert replayed.status_code == 200
        assert replayed.json()["profile"] == accepted.json()["profile"]


def test_category_role_and_parent_change_identity_but_attribute_order_does_not(tmp_path):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    with TestClient(create_app()) as client:
        wid, identity = prepare_source(client, workspace)
        original = request(wid, identity)
        original["query"]["profile_columns"] = [4, 5, 6, 7, 8, 9, 10]
        a = client.post(ROUTE, json=original).json()
        assert a["profile"]["flows"][0]["case_ids"] == ["D1_1"]
        reordered = deepcopy(original)
        reordered["query"]["profile_columns"].reverse()
        same = client.post(ROUTE, json=reordered).json()
        assert same["profile"]["definition_id"] == a["profile"]["definition_id"]
        changed = deepcopy(original)
        changed["query"]["roles"]["item_category"] = 12
        response = client.post(ROUTE, json=changed)
        assert response.status_code == 200
        b = response.json()
        assert b["profile"]["definition_id"] != a["profile"]["definition_id"]
        assert {row["flow_id"]: row["case_ids"] for row in b["profile"]["flows"]} == {
            "after_gr": [], "before_gr": [], "two_way": [], "consignment": []}
        kept = client.post("/api/investigations/select-cases", json=envelope(
            "select_cases_request", workspace_id=wid, identity=identity, parent_case_ids=None,
            predicates=[{"kind": "case_id_in", "case_ids": ["D1_1"], "negate": False}]))
        assert kept.status_code == 200
        child = client.post(ROUTE, json=request(wid, kept.json()["identity"]))
        assert child.status_code == 200
        assert child.json()["profile"]["definition_id"] != a["profile"]["definition_id"]
        assert child.json()["profile"]["population"]["case_count"] == 1
        assert client.post(ROUTE, json=original).json()["profile"] == a["profile"]


def test_current_flow_revision_save_reopen_and_unknown_recipe_refusals(tmp_path):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    with TestClient(create_app()) as client:
        wid, identity = prepare_source(client, workspace)
        selected = client.post("/api/investigations/select-cases", json=envelope(
            "select_cases_request", workspace_id=wid, identity=identity, parent_case_ids=None, predicates=[])).json()
        current = selected["identity"]
        query = request(wid, current)["query"]
        profile = client.post(ROUTE, json=request(wid, current)).json()["profile"]
        given = envelope("save_investigation_request", workspace_id=wid, investigation_id=None,
            expected_revision_id=None, name="F10 immutable flow meanings", base_identity=identity,
            selection_identity=current, selection_recipe={"parent_case_ids": selected["parent"]["case_ids"], "predicates": []},
            context_policy="incident.context.first_record_in_declared_order.v1", comparison=None, notes="", bookmarks=[],
            bpic19_pipeline={"schema_version": 1, "actions": [{"operation": "bpic19_profile", "identity": current,
                "query": query, "definition_id": profile["definition_id"], "selection_prefix_length": 0}]})
        saved_a = client.post("/api/investigations/save", json=given)
        assert saved_a.status_code == 200, saved_a.text
        a = saved_a.json()
        changed = deepcopy(given)
        changed.update(investigation_id=a["revision"]["investigation_id"], expected_revision_id=a["revision"]["saved_revision_id"])
        action = changed["bpic19_pipeline"]["actions"][0]
        action["query"]["roles"].update(item_category=5, item_type=4)
        b_request = request(wid, current)
        b_request["query"] = action["query"]
        b_profile = client.post(ROUTE, json=b_request).json()["profile"]
        action["definition_id"] = b_profile["definition_id"]
        saved_b = client.post("/api/investigations/save", json=changed)
        assert saved_b.status_code == 200, saved_b.text
        b = saved_b.json()
        assert b["revision"]["saved_revision_id"] != a["revision"]["saved_revision_id"]
        assert b["revision"]["content"]["bpic19_pipeline"] == changed["bpic19_pipeline"]
        assert len(b["bpic19_outputs"]["outputs"]) == 1
        assert b["bpic19_outputs"]["outputs"][0]["output"]["profile"] == b_profile
        stale = client.post("/api/investigations/save", json=changed)
        assert stale.status_code == 409
        assert stale.json()["code"] == "revision_conflict"
        for label, code, mutate in [
            ("action", "unsupported_action", lambda value: value["bpic19_pipeline"]["actions"][0].update(operation="python")),
            ("pipeline_version", "invalid_request", lambda value: value["bpic19_pipeline"].update(schema_version=2)),
            ("schema", "unsupported_schema", lambda value: value.update(schema_version=2)),
        ]:
            invalid = deepcopy(changed)
            invalid["expected_revision_id"] = b["revision"]["saved_revision_id"]
            mutate(invalid)
            refused = client.post("/api/investigations/save", json=invalid)
            assert refused.status_code in {400, 422}, (label, refused.text)
            assert refused.json()["code"] == code
        for saved, expected in [(a, profile), (b, b_profile)]:
            reopened = client.post("/api/investigations/reopen", json=envelope("reopen_investigation_request",
                workspace_id=wid, saved_revision_id=saved["revision"]["saved_revision_id"]))
            assert reopened.status_code == 200, reopened.text
            assert reopened.json()["revision"] == saved["revision"]
            assert reopened.json()["bpic19_outputs"]["outputs"][0]["output"]["profile"] == expected


def test_exact_f10_all_category_and_flag_states_preserve_original_witnesses(tmp_path):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    with TestClient(create_app()) as client:
        wid, identity = prepare_source(client, workspace)
        response = client.post(ROUTE, json=request(wid, identity))
        assert response.status_code == 200
        p = response.json()["profile"]
        assert {r["flow_id"]: r["case_ids"] for r in p["flows"]} == {
            "after_gr": ["D1_1"], "before_gr": ["B_1", "D1_2", "F_1", "G_1"],
            "two_way": ["D3_1"], "consignment": ["D2_1"]}
        assert {r["state"]: r["case_ids"] for r in p["unresolved"]} == {
            "missing": ["M_1"], "conflicting": ["C_1"], "unrecognized": ["U_1"]}
        assert {r["state"]: r["case_ids"] for r in p["cross_checks"]} == {
            "valid": ["D1_1", "D1_2", "D2_1", "D3_1", "G_1"],
            "flag_disagreement": ["F_1"], "unavailable": ["B_1", "C_1", "M_1", "U_1"]}
        assert p["population"] == dict(case_count=10, record_count=14, document_count=8, document_unknown_case_count=1)
        for case, expected in [("C_1", [["f08", "not-a-time", "3-way match, invoice after GR"],
                                    ["f09", "2018-01-03T00:00:00Z", "3-way match, invoice before GR"]]),
                               ("B_1", [["f12", "2018-01-01T00:00:00Z", "3-way match, invoice before GR"]])]:
            evidence = client.post("/api/investigations/case-evidence", json=envelope(
                "imported_case_evidence_request", workspace_id=wid, identity=identity, case_id=case))
            assert evidence.status_code == 200
            rows = sorted(evidence.json()["records"], key=lambda row: row["source_position"])
            assert [[r["original_cells"][i] for i in [0, 3, 4]] for r in rows] == expected


@pytest.mark.parametrize("category,code,field", [
    (None, "invalid_request", "query.roles.item_category"),
    (99, "invalid_parameter", "query.roles.item_category"),
    (5, "invalid_parameter", "query.roles"),
])
def test_unavailable_or_ambiguous_category_binding_is_a_typed_refusal(tmp_path, category, code, field):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    with TestClient(create_app()) as client:
        wid, identity = prepare_source(client, workspace)
        given = request(wid, identity)
        given["query"]["roles"]["item_category"] = category
        refused = client.post(ROUTE, json=given)
        assert refused.status_code == (400 if category is None else 422)
        VALIDATOR.validate(refused.json())
        assert refused.json()["code"] == code and refused.json()["field"] == field


@pytest.mark.parametrize("mutation,code", [("missing", "artifact_unavailable"), ("checksum", "checksum_mismatch")])
def test_stopped_disposable_f10_output_damage_refuses_without_repair(tmp_path, mutation, code):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    with TestClient(create_app()) as client:
        wid, identity = prepare_source(client, workspace)
        selected = client.post('/api/investigations/select-cases', json=envelope('select_cases_request', workspace_id=wid,
            identity=identity, parent_case_ids=None, predicates=[])).json()
        current = selected['identity']
        query = request(wid, current)['query']
        reviewed = client.post(ROUTE, json=request(wid, current)).json()['profile']
        given = envelope('save_investigation_request', workspace_id=wid, investigation_id=None, expected_revision_id=None,
            name='F10 corruption control', base_identity=identity, selection_identity=current,
            selection_recipe=dict(parent_case_ids=selected['parent']['case_ids'], predicates=[]),
            context_policy='incident.context.first_record_in_declared_order.v1', comparison=None, notes='', bookmarks=[],
            bpic19_pipeline=dict(schema_version=1, actions=[dict(operation='bpic19_profile', identity=current,
                query=query, definition_id=reviewed['definition_id'], selection_prefix_length=0)]))
        saved = client.post("/api/investigations/save", json=given)
        assert saved.status_code == 200
        revision = saved.json()["revision"]["saved_revision_id"]
    # External injection into the documented immutable artifact, not an assertion
    # through the store or database. The serving application's lifespan has ended.
    path = workspace / "investigations/revisions" / (revision.split(":")[-1] + ".json")
    damaged = json.loads(path.read_bytes())
    output = damaged["results"]["bpic19_pipeline"]["outputs"][0]
    if mutation == "missing":
        del output["output"]
    else:
        output["output"]["profile"]["population"]["case_count"] = 999
    path.write_text(json.dumps(damaged))
    injected = path.read_bytes()
    with TestClient(create_app()) as fresh:
        opened = fresh.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(workspace)))
        assert opened.status_code == 200
        refused = fresh.post("/api/investigations/reopen", json=envelope("reopen_investigation_request",
            workspace_id=given["workspace_id"], saved_revision_id=revision))
        assert refused.status_code == 409 and refused.json()["code"] == code
    assert path.read_bytes() == injected
