"""Explicit nondefault pairs retain their roles across a real process exit."""
from copy import deepcopy
import socket

from fastapi.testclient import TestClient
from import_requests import envelope
from test_bpic19_operators_http import prepare, request, ORDINAL, FIFO
from test_bpic19_pipeline_http import start_process
from wise_platform_api.app import create_app

ROUTE='/api/investigations/bpic19-recipe-comparison'


def pair_request(client,folder):
    wid,identity=prepare(client,folder)
    ordinal=request(wid,identity,{**ORDINAL,'order':'timestamp_source_position'})['query']
    fifo=request(wid,identity,{**FIFO,'order':'timestamp_numeric_event_id','ties':'strict_time'})['query']
    refs=[]
    for query in (ordinal,fifo):
        response=client.post('/api/investigations/bpic19-operators',json=envelope('bpic19_operator_request',workspace_id=wid,identity=identity,query=query))
        assert response.status_code==200,response.text
        refs.append({'definition_id':response.json()['definition_id'],'query':query})
    return envelope('bpic19_recipe_comparison_request',workspace_id=wid,identity=identity,
                    query={'policy_id':'bpic19.ordinal_fifo_comparison.v1','ordinal':refs[0],'fifo':refs[1]})


def cohort_pair(client,given):
    query={'policy_id':'bpic19.flow_completion_cohorts.v1','roles':{'item_category':4,'purchasing_document':5},
           'inclusion':{'kind':'all_items','timestamp_kind':'wall_clock','start_inclusive':None,'end_exclusive':None},
           'completion':{'recipe':'flow_presence','receipt':'goods_only','tie_policy':'unknown'},
           'retain':'all_included','horizon':{'timestamp_kind':'wall_clock','value':None,'provenance':None},'page':{'offset':0,'limit':10}}
    refs=[]
    for recipe in ('flow_presence','kpmg_last_ending'):
        q=deepcopy(query);q['completion']['recipe']=recipe
        reply=client.post('/api/investigations/bpic19-cohorts',json=envelope('bpic19_cohorts_request',workspace_id=given['workspace_id'],identity=given['identity'],query=q))
        assert reply.status_code==200,reply.text
        refs.append({'name':recipe,'query':q,'definition_id':reply.json()['definition_id']})
    return {**given,'query':{'policy_id':'bpic19.same_parent_completion_comparison.v1','target':refs[0],'reference':refs[1]}}


def save_pair(client,given,answers):
    wid=given['workspace_id'];identity=given['identity']
    population=client.post('/api/investigations/open-population',json=envelope('open_population_request',workspace_id=wid,preparation_id=identity['preparation_id'])).json()
    selected=client.post('/api/investigations/select-cases',json=envelope('select_cases_request',workspace_id=wid,identity=identity,parent_case_ids=None,predicates=[])).json()
    return envelope('save_investigation_request',workspace_id=wid,investigation_id=None,expected_revision_id=None,name='Explicit recorded comparisons',base_identity=identity,selection_identity=selected['identity'],
                    selection_recipe={'parent_case_ids':population['population']['case_ids'],'predicates':[]},context_policy='incident.context.first_record_in_declared_order.v1',comparison=None,notes='',bookmarks=[],
                    bpic19_pipeline={'schema_version':1,'literature_claims':[{'claim_id':'synthetic-report-1','report_id':'R01','source_locator':'Synthetic analyst report, page1','claim':'A fictional analyst narrative, preserved as reported rather than rerun.','claim_level':'reported_not_rerun','compared_run_id':None}],
                                      'actions':[{'operation':a['operation'],'identity':identity,'query':a['query'],'definition_id':a['definition_id']} for a in answers]})


def test_closed_pair_roles_and_literal_completion_transition(tmp_path):
    folder=tmp_path/'workspace';folder.mkdir()
    with TestClient(create_app()) as client:
        given=pair_request(client,folder);reply=client.post(ROUTE,json=given)
        assert reply.status_code==200,reply.text
        pair=reply.json()
        assert pair['comparison']['first']['query']==given['query']['ordinal']['query']
        assert pair['comparison']['second']['query']==given['query']['fifo']['query']
        assert pair['comparison']['first']['operation']=='bpic19_ordinal'
        assert pair['comparison']['second']['operation']=='bpic19_fifo'
        changed=deepcopy(given);changed['query']['fifo']['definition_id']='guessed'
        refusal=client.post(ROUTE,json=changed);assert refusal.status_code==422 and refusal.json()['code']=='identity_mismatch',refusal.text
        swapped=deepcopy(given);swapped['query']['ordinal'],swapped['query']['fifo']=swapped['query']['fifo'],swapped['query']['ordinal']
        assert client.post(ROUTE,json=swapped).status_code==422
        changed=deepcopy(given);changed['query']['execute']='source code';assert client.post(ROUTE,json=changed).status_code==400
        cohort=cohort_pair(client,given);reply=client.post(ROUTE,json=cohort);assert reply.status_code==200,reply.text
        transitions=reply.json()['comparison']['completion_transitions']
        assert next(row for row in transitions if row['target_state']=='observed_closed' and row['reference_state']=='open_recorded')['case_ids']==['a']
        assert sum(row['case_count'] for row in transitions)==7
        assert sorted(cid for row in transitions for cid in row['case_ids'])==list('abcdefg')


def test_actual_pid_exit_restores_exact_roles_queries_and_comparison_outputs(tmp_path):
    folder=tmp_path/'workspace';folder.mkdir()
    with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
    first,client=start_process(port)
    try:
        given=pair_request(client,folder)
        operator=client.post(ROUTE,json=given);assert operator.status_code==200,operator.text
        cohort=client.post(ROUTE,json=cohort_pair(client,given));assert cohort.status_code==200,cohort.text
        save=save_pair(client,given,[operator.json(),cohort.json()])
        saved=client.post('/api/investigations/save',json=save);assert saved.status_code==200,saved.text
        answer=saved.json()
    finally:first.terminate();first.wait(timeout=15)
    second,fresh=start_process(port)
    try:
        assert first.returncode is not None and first.pid!=second.pid
        fresh.post('/api/workspaces/open',json=envelope('open_workspace_request',path=str(folder)))
        reopened=fresh.post('/api/investigations/reopen',json=envelope('reopen_investigation_request',workspace_id=given['workspace_id'],saved_revision_id=answer['revision']['saved_revision_id']))
        assert reopened.status_code==200,reopened.text
        assert reopened.json()['revision']==answer['revision']
        assert reopened.json()['bpic19_outputs']==answer['bpic19_outputs']
        assert reopened.json()['revision']['content']['bpic19_pipeline']['actions'][0]['query']==given['query']
        assert reopened.json()['bpic19_outputs']['literature_claims']==save['bpic19_pipeline']['literature_claims']
    finally:second.terminate();second.wait(timeout=15)
