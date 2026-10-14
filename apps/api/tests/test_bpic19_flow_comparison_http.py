from copy import deepcopy
import socket

from fastapi.testclient import TestClient
from wise_platform_api.app import create_app
from import_requests import envelope
from test_bpic19_profile_http import prepare_source, request as profile_request
from test_bpic19_profiles import ROLES
from test_bpic19_flow_comparison import f11_source
from test_bpic19_pipeline_http import start_process


def setup(client,path):
    wid,identity=prepare_source(client,path,f11_source(shared_document=True))
    reviewed=client.post('/api/investigations/bpic19-profile',json=profile_request(wid,identity))
    assert reviewed.status_code==200,reviewed.text
    q={'policy_id':'bpic19.flow_item_type_comparison.v1','profile_definition_id':reviewed.json()['profile']['definition_id'],'profile_query':profile_request(wid,identity)['query'],
      'target':{'flow_id':'after_gr','item_type_state':'invariant','item_type_value':'Standard'},
      'reference':{'flow_id':'after_gr','item_type_state':'invariant','item_type_value':'Service'},'page':{'role':'reference','offset':0,'limit':50}}
    given=envelope('bpic19_flow_comparison_request',workspace_id=wid,identity=identity,query=q)
    result=client.post('/api/investigations/bpic19-flow-comparison',json=given)
    assert result.status_code==200,result.text
    a=result.json();c=a['comparison']
    assert c['target']['case_ids']==['D1_3'] and c['reference']['case_ids']==['D1_1']
    assert c['outside']['case_ids']==['Z_1'] and c['unavailable']['case_ids']==['Z_1']
    assert c['documents']['union_document_count']==c['documents']['overlap_document_count']==1
    assert c['shares']['target_record_share']==1/3
    assert len(c['page']['items'][0]['witness_row_ids'])==2
    return wid,identity,given,a


def save_comparison(client,wid,identity,given,answer):
    selected=client.post('/api/investigations/select-cases',json=envelope('select_cases_request',workspace_id=wid,identity=identity,parent_case_ids=None,predicates=[]));assert selected.status_code==200
    action={'operation':'bpic19_flow_comparison','identity':identity,'query':given['query'],'definition_id':answer['definition_id'],'selection_prefix_length':None}
    request=envelope('save_investigation_request',workspace_id=wid,investigation_id=None,expected_revision_id=None,name='Literal typed subtype comparison',base_identity=identity,selection_identity=selected.json()['identity'],selection_recipe={'parent_case_ids':selected.json()['parent']['case_ids'],'predicates':[]},context_policy='incident.context.first_record_in_declared_order.v1',comparison=None,notes='Synthetic F11 same-document sides',bookmarks=[],bpic19_pipeline={'schema_version':1,'actions':[action]})
    saved=client.post('/api/investigations/save',json=request);assert saved.status_code==200,saved.text
    return saved.json()


def test_registered_public_comparison_keeps_recipes_parent_coverage_and_typed_refusals(tmp_path):
    path=tmp_path/'workspace';path.mkdir()
    with TestClient(create_app()) as client:
        wid,identity,given,a=setup(client,path)
        artifact=save_comparison(client,wid,identity,given,a)
        exported=artifact['bpic19_outputs']['outputs'][0]['output']
        assert exported['query']==given['query'] and exported['comparison']==a['comparison']
        for modify in ('foreign_profile','same_rule','bool_page'):
            bad=deepcopy(given)
            if modify=='foreign_profile':bad['query']['profile_definition_id']='bpic19-profile.v1:sha256:'+'f'*64
            elif modify=='same_rule':bad['query']['reference']=deepcopy(bad['query']['target'])
            else:bad['query']['page']['offset']=True
            refused=client.post('/api/investigations/bpic19-flow-comparison',json=bad)
            assert refused.status_code in (400,409,422),refused.text
            assert refused.json()['code'] in ('identity_mismatch','invalid_parameter','invalid_request')
        side=client.post('/api/investigations/select-cases',json=envelope('select_cases_request',workspace_id=wid,identity=identity,parent_case_ids=None,predicates=[{'kind':'case_id_in','case_ids':['D1_1'],'negate':False}]))
        assert side.status_code==200 and side.json()['kept']['record_count']==2
        evidence=client.post('/api/investigations/case-evidence',json=envelope('imported_case_evidence_request',workspace_id=wid,identity=side.json()['identity'],case_id='D1_1'))
        assert evidence.status_code==200 and len(evidence.json()['records'])==2
        assert [row['row_id'] for row in evidence.json()['records']]==a['comparison']['page']['items'][0]['witness_row_ids']


def test_actual_fresh_pid_reopens_both_typed_recipes_overlap_unknown_and_source_rows(tmp_path):
    path=tmp_path/'workspace';path.mkdir()
    with socket.socket() as socket_:
        socket_.bind(('127.0.0.1',0));port=socket_.getsockname()[1]
    first,client=start_process(port)
    try:
        wid,identity,given,a=setup(client,path)
        saved=save_comparison(client,wid,identity,given,a)
    finally:
        first.terminate();first.wait(timeout=15)
    second,fresh=start_process(port)
    try:
        assert first.returncode is not None and second.pid!=first.pid
        assert fresh.post('/api/workspaces/open',json=envelope('open_workspace_request',path=str(path))).status_code==200
        reopened=fresh.post('/api/investigations/reopen',json=envelope('reopen_investigation_request',workspace_id=wid,saved_revision_id=saved['revision']['saved_revision_id']))
        assert reopened.status_code==200,reopened.text
        r=reopened.json();assert r['revision']==saved['revision'] and r['bpic19_outputs']==saved['bpic19_outputs']
        comparison=r['bpic19_outputs']['outputs'][0]['output']['comparison']
        assert comparison['definition']['target']==given['query']['target'] and comparison['definition']['reference']==given['query']['reference']
        assert comparison['unavailable']['case_ids']==['Z_1'] and comparison['documents']['overlap_document_ids']==['D1']
        evidence=fresh.post('/api/investigations/case-evidence',json=envelope('imported_case_evidence_request',workspace_id=wid,identity=identity,case_id='D1_1'))
        assert evidence.status_code==200
        assert [row['row_id'] for row in evidence.json()['records']]==comparison['page']['items'][0]['witness_row_ids']
    finally:
        second.terminate();second.wait(timeout=15)
