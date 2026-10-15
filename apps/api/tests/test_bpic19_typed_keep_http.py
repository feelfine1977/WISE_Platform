"""Independent literal group membership survives public save/reopen, without ID-only provenance."""
from copy import deepcopy
import hashlib
import json
import socket

from fastapi.testclient import TestClient
import pytest

from wise_platform_api.app import create_app
from import_requests import envelope
from test_bpic19_profile_http import prepare_source, request as profile_request
from test_bpic19_pipeline_http import start_process

ALL = ["B_1", "C_1", "D1_1", "D1_2", "D2_1", "D3_1", "F_1", "G_1", "M_1", "U_1"]
BEFORE = ["B_1", "D1_2", "F_1", "G_1"]
PROFILE = "/api/investigations/bpic19-profile"


def selected(client, wid, base, predicates):
    response = client.post("/api/investigations/select-cases", json=envelope("select_cases_request",
        workspace_id=wid, identity=base, parent_case_ids=ALL, predicates=predicates))
    assert response.status_code == 200, response.text
    return response.json()


def given_keep(client, folder, group=None, ids=BEFORE, *, use_base=False, query_extra=None):
    # Existing fixture input is fourteen explicitly declared original records;
    # expected memberships below are independent literals, never extracted from groups.
    wid, base = prepare_source(client, folder)
    p0 = selected(client, wid, base, [])
    assert p0["identity"] != base and p0["kept"]["case_ids"] == ALL
    parent = base if use_base else p0["identity"]
    asked = profile_request(wid, parent)
    asked["query"].update(query_extra or {})
    answer = client.post(PROFILE, json=asked)
    assert answer.status_code == 200, answer.text
    predicate = {"kind": "case_id_in", "case_ids": list(ids), "negate": False}
    child = selected(client, wid, base, [predicate])
    action = {"operation": "bpic19_profile", "identity": parent, "query": asked["query"],
        "definition_id": answer.json()["profile"]["definition_id"], "selection_prefix_length": None if use_base else 0,
        "selection_keep": {"policy_id": "bpic19.profile_group_keep.v1", "step_index": 0,
                           "group": group or {"kind": "flow", "flow_id": "before_gr"}}}
    given = envelope("save_investigation_request", workspace_id=wid, investigation_id=None, expected_revision_id=None,
        name="Literal typed purchasing Keep", base_identity=base, selection_identity=child["identity"],
        selection_recipe={"parent_case_ids": ALL, "predicates": [predicate]},
        context_policy="incident.context.first_record_in_declared_order.v1", comparison=None, notes="Synthetic source witnesses",
        bookmarks=[], bpic19_pipeline={"schema_version": 1, "actions": [action]})
    return given, answer.json(), child


def files(folder):
    return {str(path.relative_to(folder)): (len(path.read_bytes()), hashlib.sha256(path.read_bytes()).hexdigest(), path.stat().st_mtime_ns)
            for path in folder.rglob("*") if path.is_file()}


@pytest.mark.parametrize("use_base", [False, True], ids=["numeric-P0", "actual-source-base-null"])
def test_exact_parent_namespace_and_literal_before_support_are_replayed(use_base, tmp_path):
    folder = tmp_path / "workspace"; folder.mkdir()
    with TestClient(create_app()) as client:
        given, profile, child = given_keep(client, folder, use_base=use_base)
        assert child["kept"] == {"case_ids": BEFORE, "case_count": 4, "record_count": 6}
        assert "D2_1" not in child["kept"]["case_ids"]  # Consignment shares flags, not category.
        saved = client.post("/api/investigations/save", json=given)
        assert saved.status_code == 200, saved.text
        result = saved.json(); action = result["revision"]["content"]["bpic19_pipeline"]["actions"][0]
        assert action == given["bpic19_pipeline"]["actions"][0]
        assert set(action["selection_keep"]) == {"policy_id", "step_index", "group"}  # no duplicate ID payload
        p = result["bpic19_outputs"]["outputs"][0]["output"]["profile"]
        assert p == profile["profile"]
        assert p["population"] == {"case_count": 10, "record_count": 14, "document_count": 8, "document_unknown_case_count": 1}
        before = next(row for row in p["flows"] if row["flow_id"] == "before_gr")
        assert (before["case_ids"], before["case_count"], before["record_count"], before["document_count"], before["share"]) == (BEFORE, 4, 6, 3, .4)
        revision = result["revision"]["saved_revision_id"]; snapshot = files(folder)
        reopened = client.post("/api/investigations/reopen", json=envelope("reopen_investigation_request", workspace_id=given["workspace_id"], saved_revision_id=revision))
        assert reopened.status_code == 200, reopened.text
        assert reopened.json()["revision"] == result["revision"]
        assert reopened.json()["bpic19_outputs"] == result["bpic19_outputs"]
        assert files(folder) == snapshot
        # Equal members do not authorize swapping null/source-base with numeric P0.
        bad = deepcopy(given); a = bad["bpic19_pipeline"]["actions"][0]
        a["selection_prefix_length"] = 0 if use_base else None
        refused = client.post("/api/investigations/save", json=bad)
        assert refused.status_code == 409 and refused.json()["code"] == "identity_mismatch", refused.text
        assert files(folder) == snapshot


def test_wrong_group_step_parent_ids_policy_null_or_operator_refuse_before_publication(tmp_path):
    folder = tmp_path / "workspace"; folder.mkdir()
    with TestClient(create_app()) as client:
        given, _, _ = given_keep(client, folder)
        baseline = files(folder)
        variants = []
        def variant(change):
            value=deepcopy(given); change(value); variants.append(value)
        variant(lambda value: value["bpic19_pipeline"]["actions"][0]["selection_keep"].update(group={"kind":"flow","flow_id":"consignment"}))
        variant(lambda value: value["bpic19_pipeline"]["actions"][0]["selection_keep"].update(step_index=1))
        variant(lambda value: value["bpic19_pipeline"]["actions"][0]["selection_keep"].update(group={"kind":"python","execute":"raise RuntimeError('data, never code')"}))
        variant(lambda value: value["bpic19_pipeline"]["actions"][0]["selection_keep"].update(policy_id="bpic19.guessed_keep.v9"))
        variant(lambda value: value["bpic19_pipeline"]["actions"][0].update(selection_keep=None))
        variant(lambda value: value["bpic19_pipeline"]["actions"][0].update(operation="bpic19_measures"))
        variant(lambda value: value["bpic19_pipeline"]["actions"][0]["query"]["roles"].update(item_category=4))
        for value in variants:
            refused=client.post("/api/investigations/save",json=value)
            assert refused.status_code in {400,409}, refused.text
            assert refused.json()["code"] in {"invalid_request","invalid_parameter","identity_mismatch","selection_mismatch"}
            assert files(folder)==baseline
        # The same IDs with no semantic association remain a legitimate legacy question.
        legacy=deepcopy(given);legacy["bpic19_pipeline"]["actions"][0].pop("selection_keep")
        accepted=client.post("/api/investigations/save",json=legacy)
        assert accepted.status_code==200,accepted.text
        assert "selection_keep" not in accepted.json()["revision"]["content"]["bpic19_pipeline"]["actions"][0]


def test_a_real_negated_selection_cannot_claim_a_positive_typed_group_origin(tmp_path):
    folder=tmp_path/'workspace';folder.mkdir()
    with TestClient(create_app()) as client:
        given,_,_=given_keep(client,folder)
        negative={"kind":"case_id_in","case_ids":BEFORE,"negate":True}
        answer=selected(client,given['workspace_id'],given['base_identity'],[negative])
        assert answer['kept']=={'case_ids':['C_1','D1_1','D2_1','D3_1','M_1','U_1'],'case_count':6,'record_count':8}
        given['selection_recipe']['predicates']=[negative];given['selection_identity']=answer['identity']
        snapshot=files(folder)
        refused=client.post('/api/investigations/save',json=given)
        assert refused.status_code==409 and refused.json()['code']=='selection_mismatch',refused.text
        assert refused.json()['field']=='selection_recipe.predicates.0'
        assert files(folder)==snapshot


@pytest.mark.parametrize("group,ids,records,extra", [
    ({"kind":"flow_item_type","flow_id":"before_gr","state":"invariant","item_type_value":"Standard"}, BEFORE,6,{}),
    ({"kind":"unresolved","state":"conflicting"},["C_1"],2,{}),
    ({"kind":"cross_check","state":"flag_disagreement"},["F_1"],1,{}),
    ({"kind":"grain_issue","state":"conflicting_document_or_item"},["G_1"],2,{}),
    ({"kind":"attribute_value","column_index":3,"value":"3-way match, invoice before GR"},["B_1","C_1","D1_2","F_1","G_1"],8,
     {"attribute_view":{"column_index":3,"offset":0,"limit":12,"select_value":True,"value":"3-way match, invoice before GR"}}),
    ({"kind":"source_inclusion","state":"retained"},["D1_1"],2,
     {"source_interpretation":{"profile_name":"Literal item start","policy_id":"bpic19.raw_source_interpretation.v1",
       "inclusion":{"kind":"item_start","timestamp_kind":"wall_clock","start_inclusive":"2018-01-02T00:00:00","end_exclusive":None},
       "horizon":{"timestamp_kind":"wall_clock","value":None,"provenance":None},"discrepancies":[]}}),
])
def test_each_admitted_existing_selector_uses_its_exact_original_support(group,ids,records,extra,tmp_path):
    folder=tmp_path/'workspace';folder.mkdir()
    with TestClient(create_app()) as client:
        given,_,child=given_keep(client,folder,group,ids,query_extra=extra)
        assert child['kept']['case_ids']==ids and child['kept']['record_count']==records
        saved=client.post('/api/investigations/save',json=given)
        assert saved.status_code==200,saved.text
        assert saved.json()['revision']['content']['bpic19_pipeline']['actions'][0]['selection_keep']['group']==group


def test_actual_tcp_distinct_process_reopens_exact_typed_keep_and_original_missing_clock_history(tmp_path):
    folder=tmp_path/'workspace';folder.mkdir()
    with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
    first,client=start_process(port)
    try:
        given,_,_=given_keep(client,folder,{"kind":"unresolved","state":"conflicting"},["C_1"])
        result=client.post('/api/investigations/save',json=given)
        assert result.status_code==200,result.text
        saved=result.json();snapshot=files(folder)
    finally:first.terminate();first.wait(timeout=15)
    assert first.returncode is not None
    second,fresh=start_process(port)
    try:
        assert second.pid!=first.pid
        assert fresh.post('/api/workspaces/open',json=envelope('open_workspace_request',path=str(folder))).status_code==200
        result=fresh.post('/api/investigations/reopen',json=envelope('reopen_investigation_request',workspace_id=given['workspace_id'],saved_revision_id=saved['revision']['saved_revision_id']))
        assert result.status_code==200,result.text
        assert result.json()['revision']==saved['revision'] and result.json()['bpic19_outputs']==saved['bpic19_outputs']
        identity=result.json()['restored_selection']['identity']
        evidence=fresh.post('/api/investigations/case-evidence',json=envelope('imported_case_evidence_request',workspace_id=given['workspace_id'],identity=identity,case_id='C_1'))
        assert evidence.status_code==200,evidence.text
        rows=evidence.json()['records'];assert len(rows)==2
        assert [row['source_position'] for row in rows]==[7,8]
        assert [row['row_id'] for row in rows]==[
            'row.v1:sha256:9463cc202094e50be44514226f1dea7791e21c92306371628d47fa0786856bb3',
            'row.v1:sha256:8bf89ee697afe1aeef67ae4b401db1b152dddb81d4510193618e90103286e784']
        assert [row['original_cells'][3] for row in rows]==['3-way match, invoice after GR','3-way match, invoice before GR']
        assert rows[1]['original_cells'][2]=='bad time'
        assert files(folder)==snapshot
    finally:second.terminate();second.wait(timeout=15)
    assert second.returncode is not None
