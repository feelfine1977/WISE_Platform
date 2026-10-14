"""Public route and actual fresh-PID replay of both recipes and endpoint witnesses."""
from copy import deepcopy
import json
from pathlib import Path
import socket

from fastapi.testclient import TestClient
from jsonschema import Draft202012Validator
from import_requests import envelope
from test_bpic19_profile_http import prepare_source
from test_bpic19_pipeline_http import start_process
from test_bpic19_interval_comparison import interval_source, interval_query
from wise_platform_api.app import create_app

ROOT=Path(__file__).resolve().parents[3]
VALIDATOR=Draft202012Validator(json.loads((ROOT/'contracts/bpic19-interval-comparison.schema.json').read_text()))
ROUTE='/api/investigations/bpic19-interval-comparison'


def setup(client,path):
    wid,identity=prepare_source(client,path,interval_source())
    given=envelope('bpic19_interval_comparison_request',workspace_id=wid,identity=identity,query=interval_query())
    result=client.post(ROUTE,json=given);assert result.status_code==200,result.text
    a=result.json();VALIDATOR.validate(given);VALIDATOR.validate(a)
    c=a['comparison']
    assert c['target']['summary']['available_case_count']==3 and c['target']['summary']['unavailable_case_count']==1 and c['target']['summary']['median']==1
    assert c['reference']['summary']['available_case_count']==1 and c['reference']['summary']['unavailable_case_count']==1 and c['reference']['summary']['median']==2
    assert c['target']['zero_case_ids']==['T0'] and c['reference']['unavailable_reasons']=={'reversed_interval':1}
    return wid,identity,given,a


def save_on_kept_child(client,wid,identity,given,answer):
    # Retain the accepted parent recipe before keeping a complete five-record item.
    child=client.post('/api/investigations/select-cases',json=envelope('select_cases_request',workspace_id=wid,identity=identity,parent_case_ids=None,
        predicates=[{'kind':'case_id_in','case_ids':['T0'],'negate':False}]))
    assert child.status_code==200 and child.json()['kept']['record_count']==5,child.text
    action={'operation':'bpic19_interval_comparison','identity':identity,'query':given['query'],'definition_id':answer['definition_id'],'selection_prefix_length':None}
    request=envelope('save_investigation_request',workspace_id=wid,investigation_id=None,expected_revision_id=None,name='Literal zero, missing and reversed intervals',base_identity=identity,
        selection_identity=child.json()['identity'],selection_recipe={'parent_case_ids':child.json()['parent']['case_ids'],'predicates':[{'kind':'case_id_in','case_ids':['T0'],'negate':False}]},
        context_policy='incident.context.first_record_in_declared_order.v1',comparison=None,notes='Synthetic independent literal intervals',bookmarks=[],bpic19_pipeline={'schema_version':1,'actions':[action]})
    saved=client.post('/api/investigations/save',json=request);assert saved.status_code==200,saved.text
    return saved.json(),child.json()['identity']


def test_real_boundary_whole_history_and_parameter_or_foreign_parent_refusals(tmp_path):
    path=tmp_path/'workspace';path.mkdir()
    with TestClient(create_app()) as client:
        wid,identity,given,a=setup(client,path)
        saved,child_identity=save_on_kept_child(client,wid,identity,given,a)
        output=saved['bpic19_outputs']['outputs'][0]['output']
        assert output['query']==given['query'] and output['comparison']==a['comparison']
        assert json.loads(json.dumps(output,allow_nan=False))['comparison']['reference']['summary']['median']==2
        for mutation in ('duplicate','foreign','bool_page','unregistered_policy','script','label_blank'):
            bad=deepcopy(given)
            if mutation=='duplicate':bad['query']['target']['recipe']['case_ids']=['T0','T0']
            elif mutation=='foreign':bad['query']['target']['recipe']['case_ids']=['foreign']
            elif mutation=='bool_page':bad['query']['page']['offset']=True
            elif mutation=='unregistered_policy':bad['query']['interval_policy']='first_after'
            elif mutation=='script':bad['query']['target']['recipe']['execute']='untrusted source code'
            else:bad['query']['target']['label']='  '
            refused=client.post(ROUTE,json=bad);assert refused.status_code in (400,409,422),refused.text
            VALIDATOR.validate(refused.json())
        bad=deepcopy(given);bad['identity']=child_identity
        refused=client.post(ROUTE,json=bad);assert refused.status_code==422 and refused.json()['code']=='invalid_parent',refused.text
        evidence=client.post('/api/investigations/case-evidence',json=envelope('imported_case_evidence_request',workspace_id=wid,identity=child_identity,case_id='T0'))
        assert evidence.status_code==200,evidence.text
        assert [row['row_id'] for row in evidence.json()['records']]==a['comparison']['page']['items'][0]['record_row_ids']
        assert len(evidence.json()['records'])==5
        equal=deepcopy(given);equal['query']['page']={'role':'reference','offset':0,'limit':1}
        paged=client.post(ROUTE,json=equal);assert paged.status_code==200
        assert paged.json()['definition_id']==a['definition_id'] and paged.json()['comparison']['page']['items'][0]['case_id']=='R2'


def test_actual_old_pid_exit_and_new_pid_reopens_parent_recipe_and_whole_child(tmp_path):
    path=tmp_path/'workspace';path.mkdir()
    with socket.socket() as socket_:socket_.bind(('127.0.0.1',0));port=socket_.getsockname()[1]
    first,client=start_process(port)
    try:
        wid,identity,given,a=setup(client,path)
        saved,child_identity=save_on_kept_child(client,wid,identity,given,a)
    finally:first.terminate();first.wait(timeout=15)
    second,fresh=start_process(port)
    try:
        assert first.returncode is not None and second.pid!=first.pid
        assert fresh.post('/api/workspaces/open',json=envelope('open_workspace_request',path=str(path))).status_code==200
        reopened=fresh.post('/api/investigations/reopen',json=envelope('reopen_investigation_request',workspace_id=wid,saved_revision_id=saved['revision']['saved_revision_id']))
        assert reopened.status_code==200,reopened.text
        result=reopened.json();assert result['revision']==saved['revision'] and result['bpic19_outputs']==saved['bpic19_outputs']
        output=result['bpic19_outputs']['outputs'][0]['output'];assert output['identity']==identity
        assert output['comparison']['definition']['target']==given['query']['target']
        assert output['comparison']['definition']['reference']==given['query']['reference']
        assert output['comparison']['definition']['clock_policy_id']==a['definition']['clock_policy_id']
        assert result['restored_selection']['kept']['case_ids']==['T0'] and result['restored_selection']['kept']['record_count']==5
        evidence=fresh.post('/api/investigations/case-evidence',json=envelope('imported_case_evidence_request',workspace_id=wid,identity=child_identity,case_id='T0'))
        assert evidence.status_code==200 and [row['row_id'] for row in evidence.json()['records']]==output['comparison']['page']['items'][0]['record_row_ids']
        # Parent recipe is registered again on reopen; changing presentation keeps the frozen definition.
        given['query']['page']={'role':'reference','offset':1,'limit':1}
        replay=fresh.post(ROUTE,json=given);assert replay.status_code==200,replay.text
        interval=replay.json()['comparison']['page']['items'][0]['interval']
        assert replay.json()['definition_id']==a['definition_id'] and interval['recorded_difference_days']==-1 and interval['value'] is None
    finally:second.terminate();second.wait(timeout=15)


def retained_actor_modes(client,path):
    import csv
    import io
    rows=list(csv.reader(io.StringIO(interval_source().decode())))
    rows[0].extend(['Original Actor','Original Amount'])
    for index,row in enumerate(rows[1:]):
        row.extend([[' USER_1 ','batch_2','None','user_2','batch_1'][index] if index<5 else 'user_3','0'])
    stream=io.StringIO();csv.writer(stream).writerows(rows)
    wid,identity=prepare_source(client,path,stream.getvalue().encode())
    actions=[];answers=[]
    for mode in ('paper_v1','historical_v1'):
        query={'policy_id':'bpic19.source_witnessed_measures.v1','measure_profile':mode,'roles':{'activity':1,'resource':10,'value':11,'net_worth':11},'offset':0,'limit':20,'calibration_population':'parent'}
        reply=client.post('/api/investigations/bpic19-measures',json=envelope('bpic19_measures_request',workspace_id=wid,identity=identity,query=query))
        assert reply.status_code==200,reply.text
        answer=reply.json();answers.append(answer)
        actions.append({'operation':'bpic19_measures','identity':identity,'query':query,'definition_id':answer['definition_id'],'selection_prefix_length':None})
    assert answers[0]['definition_id']!=answers[1]['definition_id']
    strict=next(case for case in answers[0]['cases'] if case['case_id']=='T0')
    historical=next(case for case in answers[1]['cases'] if case['case_id']=='T0')
    assert strict['measures']['user_event_count']['value'] is None and strict['measures']['user_event_count']['lower_bound']==2
    assert strict['actor_summary']['unknown_event_count']==1 and strict['actor_summary']['batch_event_count']==2
    assert historical['historical_measures']['historical_manual_touch_count']['value']==2
    selected=client.post('/api/investigations/select-cases',json=envelope('select_cases_request',workspace_id=wid,identity=identity,parent_case_ids=None,predicates=[]))
    assert selected.status_code==200,selected.text
    request=envelope('save_investigation_request',workspace_id=wid,investigation_id=None,expected_revision_id=None,name='Explicitly retained strict and historical actor recipes',base_identity=identity,
        selection_identity=selected.json()['identity'],selection_recipe={'parent_case_ids':selected.json()['parent']['case_ids'],'predicates':[]},
        context_policy='incident.context.first_record_in_declared_order.v1',comparison=None,notes='Both modes explicitly retained on one parent',bookmarks=[],bpic19_pipeline={'schema_version':1,'actions':actions})
    saved=client.post('/api/investigations/save',json=request);assert saved.status_code==200,saved.text
    assert len(saved.json()['bpic19_outputs']['outputs'])==2
    assert [output['output']['definition']['measure_profile'] for output in saved.json()['bpic19_outputs']['outputs']]==['paper_v1','historical_v1']
    return wid,saved.json()


def test_explicit_strict_and_historical_actor_modes_survive_same_parent_actual_new_pid(tmp_path):
    path=tmp_path/'workspace';path.mkdir()
    with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
    first,client=start_process(port)
    try:wid,saved=retained_actor_modes(client,path)
    finally:first.terminate();first.wait(timeout=15)
    second,fresh=start_process(port)
    try:
        assert first.returncode is not None and first.pid!=second.pid
        assert fresh.post('/api/workspaces/open',json=envelope('open_workspace_request',path=str(path))).status_code==200
        reopened=fresh.post('/api/investigations/reopen',json=envelope('reopen_investigation_request',workspace_id=wid,saved_revision_id=saved['revision']['saved_revision_id']))
        assert reopened.status_code==200,reopened.text
        assert reopened.json()['revision']==saved['revision'] and reopened.json()['bpic19_outputs']==saved['bpic19_outputs']
    finally:second.terminate();second.wait(timeout=15)
