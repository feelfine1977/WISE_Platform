"""Issue 106 public independent subtype, mutation and immutable-current contracts."""
from copy import deepcopy

import pytest
from fastapi.testclient import TestClient

from flow_f11_literal import F11, IDS, ROLES, ROWS, assert_mutation, prepare
from import_requests import envelope
from test_bpic19_profile_http import request as profile_request
from wise_platform_api.app import create_app

ROUTE = '/api/investigations/bpic19-flow-comparison'


def comparison_request(client, wid, identity, roles=ROLES):
    profile = profile_request(wid, identity, roles)
    reviewed = client.post('/api/investigations/bpic19-profile', json=profile)
    assert reviewed.status_code == 200, reviewed.text
    return envelope('bpic19_flow_comparison_request', workspace_id=wid, identity=identity, query=dict(
        policy_id='bpic19.flow_item_type_comparison.v1', profile_definition_id=reviewed.json()['profile']['definition_id'],
        profile_query=profile['query'], target=dict(flow_id='after_gr',item_type_state='invariant',item_type_value='Standard'),
        reference=dict(flow_id='after_gr',item_type_state='invariant',item_type_value='Service'),page=dict(role='target',offset=0,limit=50)))


def test_exact_f11_and_all_subtype_states_at_public_boundary(tmp_path):
    for label, rows in [('exact', F11), ('boundaries', ROWS)]:
        workspace = tmp_path / label
        workspace.mkdir()
        with TestClient(create_app()) as client:
            wid, identity = prepare(client, workspace, rows)
            given = comparison_request(client, wid, identity)
            response = client.post(ROUTE, json=given)
            assert response.status_code == 200, response.text
            c = response.json()['comparison']
            assert c['target']['case_ids'] == (['D4_1'] if label == 'exact' else ['D4_1','X_1'])
            assert c['reference']['case_ids'] == (['D1_1'] if label == 'exact' else ['D1_1','X_2'])
            assert c['shares']['target_item_share'] == 1/2
            assert c['shares']['target_record_share'] == 1/3
            assert c['documents']['overlap_document_ids'] == ([] if label == 'exact' else ['X'])
            assert c['outside']['case_ids'] == ([] if label == 'exact' else ['I_1','Q_1','Y_1','Z_1'])
            assert c['unavailable']['case_ids'] == ([] if label == 'exact' else ['I_1','Y_1','Z_1'])
            assert c['scope_unavailable']['case_ids'] == ['C_1','M_1','U_1']
            assert c['parent']['case_count'] == (11 if label == 'exact' else 17)
            assert c['parent']['record_count'] == (15 if label == 'exact' else 24)
            if label == 'exact':
                continue
            page = deepcopy(given)
            page['query']['page']['role'] = 'outside'
            outside = client.post(ROUTE, json=page).json()['comparison']['page']['items']
            assert [(r['case_id'],r['item_type_state'],r['item_type_value']) for r in outside] == [
                ('I_1','conflicting',None),('Q_1','invariant','Alien type'),('Y_1','conflicting',None),('Z_1','missing',None)]
            for item in outside:
                evidence = client.post('/api/investigations/case-evidence', json=envelope('imported_case_evidence_request',
                    workspace_id=wid,identity=identity,case_id=item['case_id']))
                assert evidence.status_code == 200
                original = sorted(evidence.json()['records'], key=lambda r:r['source_position'])
                assert [r['original_cells'] for r in original] == [r for r in ROWS if r[1] == item['case_id']]
                assert set(item['witness_row_ids']) == {r['row_id'] for r in original}


@pytest.mark.parametrize('field,value', [
    ('policy_id','discovery.v1'),('item_type_reducer','first_record'),('normalization','lowercase'),
    ('document_policy','disjoint'),('measure','amount'),('measure','time'),
])
def test_unsupported_meaning_refuses_without_changing_count_answer(tmp_path, field, value):
    workspace = tmp_path / 'workspace'
    workspace.mkdir()
    with TestClient(create_app()) as client:
        wid, identity = prepare(client, workspace)
        given = comparison_request(client,wid,identity)
        a = client.post(ROUTE,json=given).json()
        bad = deepcopy(given)
        bad['query'][field] = value
        refused = client.post(ROUTE,json=bad)
        assert refused.status_code in {400,422}
        assert refused.json()['code'] == 'invalid_request'
        assert refused.json()['field'] == 'query.'+field
        assert client.post(ROUTE,json=given).json()['comparison'] == a['comparison']


def test_supported_mutations_presentation_and_current_immutable_revisions(tmp_path):
    workspace = tmp_path / 'workspace'
    workspace.mkdir()
    with TestClient(create_app()) as client:
        wid, base = prepare(client,workspace)
        selected = client.post('/api/investigations/select-cases',json=envelope('select_cases_request',workspace_id=wid,
            identity=base,parent_case_ids=None,predicates=[])).json()
        identity = selected['identity']
        given = comparison_request(client,wid,identity)
        a = client.post(ROUTE,json=given).json()
        variants = []
        swapped = deepcopy(given)
        swapped['query']['target'],swapped['query']['reference'] = swapped['query']['reference'],swapped['query']['target']
        variants.append(('swapped',swapped))
        roles = dict(ROLES,item_type=12)
        variants.append(('binding',comparison_request(client,wid,identity,roles)))
        predicate = deepcopy(given)
        predicate['query']['target']['item_type_value'] = 'Alien type'
        variants.append(('predicate',predicate))
        child_response = client.post('/api/investigations/select-cases',json=envelope('select_cases_request',workspace_id=wid,
            identity=base,parent_case_ids=None,predicates=[dict(kind='case_id_in',case_ids=['D1_1','D4_1'],negate=False)])).json()
        assert 'identity' in child_response, str(child_response)
        assert child_response['kept']['case_ids'] == ['D1_1','D4_1']
        variants.append(('parent',comparison_request(client,wid,child_response['identity'])))
        for kind, changed in variants:
            response = client.post(ROUTE,json=changed)
            assert response.status_code == 200,response.text
            assert response.json()['definition_id'] != a['definition_id']
            if kind != 'swapped':
                assert_mutation(response.json(),kind)
                with pytest.raises(AssertionError):
                    assert_mutation(a,kind)
        presentation = deepcopy(given)
        presentation['query']['page'].update(role='outside',offset=1,limit=1)
        assert client.post(ROUTE,json=presentation).json()['definition_id'] == a['definition_id']
        assert a['definition']['document_policy'] == 'all_record_invariant_document_overlap_preserved'
        assert a['definition']['membership_policy'] == 'exact_invariant_category_and_reviewed_item_type_state'
        save = envelope('save_investigation_request',workspace_id=wid,investigation_id=None,expected_revision_id=None,
            name='Issue 106 immutable A/B',base_identity=base,selection_identity=identity,
            selection_recipe=dict(parent_case_ids=IDS,predicates=[]),context_policy='incident.context.first_record_in_declared_order.v1',
            comparison=None,notes='',bookmarks=[],bpic19_pipeline=dict(schema_version=1,actions=[]))
        receipts = []
        for kind, query in [('base',given),*variants]:
            answer = client.post(ROUTE,json=query).json()
            is_child = query['identity'] == child_response['identity']
            if is_child:
                save['selection_identity'] = child_response['identity']
                save['selection_recipe']['predicates'] = [dict(kind='case_id_in',case_ids=['D1_1','D4_1'],negate=False)]
            save['bpic19_pipeline']['actions'] = [dict(operation='bpic19_flow_comparison',identity=query['identity'],
                query=query['query'],definition_id=answer['definition_id'],selection_prefix_length=1 if is_child else 0)]
            result = client.post('/api/investigations/save',json=save)
            assert result.status_code == 200,result.text
            saved = result.json()
            assert saved['bpic19_outputs']['outputs'][0]['output']['comparison'] == answer['comparison']
            if kind in {'binding','predicate','parent'}:
                assert_mutation(saved['bpic19_outputs']['outputs'][0]['output'],kind)
            receipts.append((kind,saved))
            save.update(investigation_id=saved['revision']['investigation_id'],expected_revision_id=saved['revision']['saved_revision_id'])
        assert receipts[0][1]['revision']['saved_revision_id'] != receipts[1][1]['revision']['saved_revision_id']
        save['expected_revision_id'] = receipts[0][1]['revision']['saved_revision_id']
        stale = client.post('/api/investigations/save',json=save)
        assert stale.status_code == 409 and stale.json()['code'] == 'revision_conflict'
        for kind, receipt in receipts:
            opened = client.post('/api/investigations/reopen',json=envelope('reopen_investigation_request',workspace_id=wid,
                saved_revision_id=receipt['revision']['saved_revision_id']))
            assert opened.status_code == 200
            assert opened.json()['revision'] == receipt['revision']
            assert opened.json()['bpic19_outputs'] == receipt['bpic19_outputs']
            if kind in {'binding','predicate','parent'}:
                assert_mutation(opened.json()['bpic19_outputs']['outputs'][0]['output'],kind)


@pytest.mark.parametrize('role', [None,99,4])
def test_subtype_binding_refusal_preserves_other_known_count_evidence(tmp_path,role):
    workspace = tmp_path/'workspace'
    workspace.mkdir()
    with TestClient(create_app()) as client:
        wid,identity = prepare(client,workspace)
        given = comparison_request(client,wid,identity)
        original = client.post(ROUTE,json=given).json()['comparison']
        bad = deepcopy(given)
        bad['query']['profile_query']['roles']['item_type'] = role
        refused = client.post(ROUTE,json=bad)
        assert refused.status_code in {400,422}
        assert refused.json()['code'] in {'invalid_request','invalid_parameter'}
        assert 'roles' in refused.json()['field']
        assert client.post(ROUTE,json=given).json()['comparison'] == original
