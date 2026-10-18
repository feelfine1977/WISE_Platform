"""Independent H7 public HTTP qualification and stopped disposable-file fault injection."""
from copy import deepcopy
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys

import pytest

from fastapi.testclient import TestClient
from wise_platform_api.app import create_app
from import_requests import envelope, policies, wall_policies
from source_h7_literal import ROW_IDS, assert_profile, prepare, query, source


def reviewed(client, wid, identity, definition):
    response=client.post('/api/investigations/bpic19-profile',json=envelope(
        'bpic19_profile_request',workspace_id=wid,identity=identity,query=definition))
    assert response.status_code==200,response.text
    return response.json()


def saved(client, wid, identity, definition):
    selection=client.post('/api/investigations/select-cases',json=envelope(
        'select_cases_request',workspace_id=wid,identity=identity,parent_case_ids=None,predicates=[]))
    assert selection.status_code==200,selection.text
    current=selection.json()['identity']
    answer=reviewed(client,wid,current,definition)
    response=client.post('/api/investigations/save',json=envelope(
        'save_investigation_request',workspace_id=wid,investigation_id=None,expected_revision_id=None,
        name='H7 semantic mutation',base_identity=identity,selection_identity=current,
        selection_recipe=dict(parent_case_ids=['A','B','C'],predicates=[]),
        context_policy='incident.context.first_record_in_declared_order.v1',comparison=None,notes='',bookmarks=[],
        bpic19_pipeline=dict(schema_version=1,actions=[dict(operation='bpic19_profile',identity=current,
            query=definition,definition_id=answer['profile']['definition_id'],selection_prefix_length=0)])))
    assert response.status_code==200,response.text
    return response.json()


@pytest.mark.parametrize('mutation', ['source_byte','clock','parser','mapping','boundary','end_boundary','horizon','unknown_horizon','provenance','grain','profile','discrepancy','field_lineage'])
def test_h7_each_semantic_mutation_is_new_and_old_saved_answer_remains_exact(tmp_path,mutation):
    workspace=tmp_path/'workspace';workspace.mkdir()
    with TestClient(create_app()) as client:
        wid,identity=prepare(client,workspace)
        kind='record_projection' if mutation=='end_boundary' else 'item_start'
        definition=query(kind)
        a=saved(client,wid,identity,definition)
        changed=deepcopy(definition);new_identity=identity
        if mutation=='source_byte':
            _,new_identity=prepare(client,workspace,content=source().replace(b'user_1',b'user_2',1))
        elif mutation=='clock':
            naive=source().replace(b'Z',b'')
            _,new_identity=prepare(client,workspace,content=naive,time_policy=wall_policies('iso8601','2027-01-01T00:00:00'))
            changed['source_interpretation']['inclusion']['timestamp_kind']='wall_clock'
            changed['source_interpretation']['inclusion']['start_inclusive']='2018-01-01T00:00:00'
            changed['source_interpretation']['horizon'].update(timestamp_kind='wall_clock',value='2019-01-28T00:00:00')
        elif mutation=='parser':
            _,new_identity=prepare(client,workspace,time_policy=policies('iso8601',None,cutoff='2028-01-01T00:00:00Z'))
        elif mutation=='mapping':
            _,new_identity=prepare(client,workspace,mapping=dict(case_column=10,activity_column=2,timestamp_column=3,sequence_column=None,context_columns=[0,1,*range(4,10),11,12]))
        elif mutation=='boundary':changed['source_interpretation']['inclusion']['start_inclusive']='2018-01-02T00:00:00Z'
        elif mutation=='end_boundary':changed['source_interpretation']['inclusion']['end_exclusive']='2018-01-03T00:00:00Z'
        elif mutation=='horizon':changed['source_interpretation']['horizon']['value']='2019-01-27T00:00:00Z'
        elif mutation=='unknown_horizon':changed['source_interpretation']['horizon'].update(value=None,provenance=None)
        elif mutation=='provenance':changed['source_interpretation']['horizon']['provenance']='Separately reviewed synthetic contract'
        elif mutation=='grain':changed['source_interpretation']['inclusion']['kind']='document_start'
        elif mutation=='profile':changed['source_interpretation']['profile_name']='A distinct named source interpretation'
        elif mutation=='discrepancy':changed['source_interpretation']['discrepancies'][0]['reference']='Separately reviewed report'
        elif mutation=='field_lineage':changed['roles'].update(source_case=1)
        b=saved(client,wid,new_identity,changed)
        ao=a['bpic19_outputs']['outputs'][0]['output'];bo=b['bpic19_outputs']['outputs'][0]['output']
        assert_profile(ao,kind)
        assert (new_identity['source_id']!=identity['source_id'])==(mutation in {'source_byte','clock'})
        assert (new_identity['preparation_id']!=identity['preparation_id'])==(mutation in {'source_byte','clock','parser','mapping'})
        assert ao['profile']['definition_id']!=bo['profile']['definition_id']
        assert a['revision']['saved_revision_id']!=b['revision']['saved_revision_id']
        assert bo['profile']['population']==dict(case_count=3,record_count=7,document_count=2,document_unknown_case_count=0)
        review=bo['profile']['source_review']
        if mutation=='end_boundary':assert review['projection']['row_ids']==sorted(ROW_IDS[position] for position in [1,3,5])
        else:assert review['retained']['case_ids']==(['C'] if mutation=='grain' else ['B','C'])
        if mutation=='unknown_horizon':
            assert review['horizon_state']=='unknown' and review['due_assessment']=='unavailable'
            assert not any(anomaly['state']=='after_trusted_horizon' for anomaly in review['anomalies'])
        if mutation=='clock':assert review['clock_kind']==review['interpretation']['inclusion']['timestamp_kind']=='wall_clock'
        for snapshot in [a,b]:
            reopened=client.post('/api/investigations/reopen',json=envelope('reopen_investigation_request',workspace_id=wid,saved_revision_id=snapshot['revision']['saved_revision_id']))
            assert reopened.status_code==200,reopened.text
            assert reopened.json()['revision']==snapshot['revision']
            assert reopened.json()['bpic19_outputs']==snapshot['bpic19_outputs']


def test_h7_presentation_order_preserves_definition_and_source_support(tmp_path):
    workspace=tmp_path/'workspace';workspace.mkdir()
    with TestClient(create_app()) as client:
        wid,identity=prepare(client,workspace)
        definition=query();definition['profile_columns']=[4,5,8]
        a=reviewed(client,wid,identity,definition)
        definition['profile_columns']=[8,5,4]
        b=reviewed(client,wid,identity,definition)
        assert a['profile']['definition_id']==b['profile']['definition_id']
        assert_profile(a,'all_source');assert_profile(b,'all_source')


def inventory(workspace):
    return {str(p.relative_to(workspace)):p.read_bytes() for p in workspace.rglob('*') if p.is_file()}


def test_h7_literal_row_ids_have_auditable_independent_canonical_seeds():
    source_id='source.v1:sha256:40818bff00acb4692d4ff1c6fb7ba42e4d6143d727b0e31747a8ce2442039fd0'
    assert 'source.v1:sha256:'+hashlib.sha256(source()).hexdigest()==source_id
    for position,expected in enumerate(ROW_IDS):
        seed='{"format_version":1,"source_id":"'+source_id+'","source_position":'+str(position)+'}'
        assert 'row.v1:sha256:'+hashlib.sha256(seed.encode('ascii')).hexdigest()==expected


def test_h7_missing_derived_preparation_recovers_exact_A_not_current_B(tmp_path):
    workspace=tmp_path/'workspace';workspace.mkdir()
    with TestClient(create_app()) as client:
        wid,identity=prepare(client,workspace)
        a=saved(client,wid,identity,query('document_start'))
        _,other=prepare(client,workspace,time_policy=policies('iso8601',None,cutoff='2028-01-01T00:00:00Z'))
        b=saved(client,wid,other,query('item_start'))
        assert identity['preparation_id']!=other['preparation_id']
        assert a['revision']!=b['revision']
    path=workspace/'preparations'/(identity['preparation_id'].split(':')[-1]+'.json')
    original=json.loads(path.read_bytes());path.unlink()
    before=inventory(workspace)
    with TestClient(create_app()) as fresh:
        assert fresh.post('/api/workspaces/open',json=envelope('open_workspace_request',path=str(workspace))).status_code==200
        for snapshot,kind in [(a,'document_start'),(b,'item_start')]:
            response=fresh.post('/api/investigations/reopen',json=envelope('reopen_investigation_request',workspace_id=wid,saved_revision_id=snapshot['revision']['saved_revision_id']))
            assert response.status_code==200,response.text
            assert response.json()['revision']==snapshot['revision']
            assert response.json()['bpic19_outputs']==snapshot['bpic19_outputs']
            assert_profile(response.json()['bpic19_outputs']['outputs'][0]['output'],kind)
    recovered=json.loads(path.read_bytes())
    assert {k:v for k,v in recovered.items() if k!='stored_utc'}=={k:v for k,v in original.items() if k!='stored_utc'}
    assert datetime.fromisoformat(recovered['stored_utc'].replace('Z','+00:00')).tzinfo is not None
    after=inventory(workspace);del after[str(path.relative_to(workspace))]
    assert after==before


@pytest.mark.parametrize('mutation,status,code',[('incomplete',404,'preparation_unavailable'),('invalid',404,'preparation_unavailable'),('different',409,'preparation_changed')])
def test_h7_missing_preparation_recipe_guard_never_substitutes_defaults(tmp_path,mutation,status,code):
    workspace=tmp_path/'workspace';workspace.mkdir()
    with TestClient(create_app()) as client:
        wid,identity=prepare(client,workspace)
        a=saved(client,wid,identity,query('document_start'))
    path=workspace/'preparations'/(identity['preparation_id'].split(':')[-1]+'.json');path.unlink()
    revision=workspace/'investigations/revisions'/(a['revision']['saved_revision_id'].split(':')[-1]+'.json')
    damaged=json.loads(revision.read_bytes())
    if mutation=='incomplete':del damaged['preparation']['policies']
    elif mutation=='invalid':damaged['preparation']['mapping']['case_column']=999
    else:damaged['preparation']['mapping']['context_columns']=[]
    revision.write_text(json.dumps(damaged));before=inventory(workspace)
    with TestClient(create_app()) as fresh:
        assert fresh.post('/api/workspaces/open',json=envelope('open_workspace_request',path=str(workspace))).status_code==200
        response=fresh.post('/api/investigations/reopen',json=envelope('reopen_investigation_request',workspace_id=wid,saved_revision_id=a['revision']['saved_revision_id']))
        assert response.status_code==status and response.json()['code']==code,response.text
        assert response.json()['field']=='saved_revision_id',response.text
    assert not path.exists() and inventory(workspace)==before


@pytest.mark.parametrize('mutation,code', [('missing','artifact_unavailable'),('checksum','checksum_mismatch'),('source_missing','artifact_unavailable'),('source_checksum','checksum_mismatch'),('preparation_checksum','checksum_mismatch'),('preparation_malformed','checksum_mismatch'),('preparation_unreadable','artifact_unavailable')])
def test_h7_stopped_disposable_artifact_fault_refuses_without_overwriting(tmp_path,mutation,code):
    workspace=tmp_path/'workspace';workspace.mkdir()
    with TestClient(create_app()) as client:
        wid,identity=prepare(client,workspace)
        snapshot=saved(client,wid,identity,query('document_start'))
    revision=snapshot['revision']['saved_revision_id']
    path=workspace/'investigations/revisions'/(revision.split(':')[-1]+'.json')
    revisions=path.parent
    damaged=json.loads(path.read_bytes());output=damaged['results']['bpic19_pipeline']['outputs'][0]
    if mutation.startswith('source_'):
        path=workspace/'sources'/(identity['source_id'].split(':')[-1]+'.csv')
    elif mutation.startswith('preparation_'):
        path=workspace/'preparations'/(identity['preparation_id'].split(':')[-1]+'.json')
    if mutation.endswith('missing') and mutation!='missing':path.unlink()
    elif mutation=='preparation_unreadable':path.unlink();path.mkdir()
    elif mutation=='preparation_checksum':
        descriptor=json.loads(path.read_bytes());descriptor['preparation']['mapping']['context_columns']=[]
        path.write_text(json.dumps(descriptor))
    elif mutation=='preparation_malformed' or mutation=='source_checksum':path.write_bytes(path.read_bytes()+b'!')
    else:
        if mutation=='missing':del output['output']
        else:output['output']['profile']['source_review']['retained']['case_ids']=['A']
        path.write_text(json.dumps(damaged))
    injected='directory' if path.is_dir() else path.read_bytes() if path.exists() else None
    before={p.name:p.read_bytes() for p in revisions.glob('*.json')}
    with TestClient(create_app()) as fresh:
        assert fresh.post('/api/workspaces/open',json=envelope('open_workspace_request',path=str(workspace))).status_code==200
        refusal=fresh.post('/api/investigations/reopen',json=envelope('reopen_investigation_request',workspace_id=wid,saved_revision_id=revision))
        assert refusal.status_code==409 and refusal.json()['code']==code,refusal.text
        field='base_identity.source_id' if mutation.startswith('source_') else 'saved_revision_id' if mutation.startswith('preparation_') else 'results.bpic19_pipeline.outputs.0'
        assert refusal.json()['field']==field,refusal.text
    assert ('directory' if path.is_dir() else path.read_bytes() if path.exists() else None)==injected
    assert {p.name:p.read_bytes() for p in revisions.glob('*.json')}==before


@pytest.mark.skipif(os.name!='posix',reason='The H7 qualification tool and its ps shim use the POSIX process table and process groups.')
@pytest.mark.parametrize('mode',['primary','success'])
@pytest.mark.parametrize('ps_failure',[False,True])
def test_h7_cleanup_diagnostic_fault_preserves_primary_and_reaps_actual_service(tmp_path,mode,ps_failure):
    root=Path(__file__).resolve().parents[3]
    env={**os.environ,'TMPDIR':str(tmp_path),'PYTHONPATH':os.pathsep.join(str(root/p) for p in ['apps/api/src','packages/analytics/src'])}
    if ps_failure:
        shim=tmp_path/'ps'
        shim.write_text('#!/bin/sh\nexit 23\n');shim.chmod(0o700)
        env['PATH']=str(tmp_path)+os.pathsep+env['PATH']
    process=subprocess.Popen([sys.executable,str(root/'tools/qualify_issue103.py'),'--cleanup-control',mode],env=env,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
    try:
        stdout,stderr=process.communicate(timeout=40)
        cleanup=json.loads(stdout.splitlines()[-1])
        service=cleanup['services'][0]
        assert service['exit'] is not None
        with pytest.raises(ProcessLookupError):os.kill(service['pid'],0)
        for port in cleanup['ports']:
            with socket.socket() as sock:assert sock.connect_ex(('127.0.0.1',port))!=0
    finally:
        try:os.killpg(process.pid,signal.SIGKILL)
        except ProcessLookupError:pass
        process.wait(timeout=5)
    assert process.returncode!=0,stdout+stderr
    cleanup=json.loads(stdout.splitlines()[-1])
    assert cleanup['all_services_waited'] and cleanup['browser_survivors']==([] if not ps_failure else None)
    assert cleanup['ports_closed']==cleanup['ports'] and len(cleanup['services'])==1
    assert any('IsADirectoryError' in error for error in cleanup['errors'])
    assert any('CalledProcessError' in error for error in cleanup['errors'])==ps_failure
    if mode=='primary':
        assert 'RuntimeError: issue103_control_primary' in stderr
        assert 'Cleanup diagnostics:' in stderr
        assert 'RuntimeError: owned_cleanup_incomplete:' not in stderr
    else:
        assert 'RuntimeError: owned_cleanup_incomplete:' in stderr
        assert 'RuntimeError: issue103_control_primary' not in stderr


def test_h7_definition_mutations_and_typed_source_refusals(tmp_path):
    workspace=tmp_path/'workspace';workspace.mkdir()
    with TestClient(create_app()) as client:
        wid,identity=prepare(client,workspace)
        definitions=[]
        for kind in ['all_source','document_start','item_start','record_projection']:
            given=envelope('bpic19_profile_request',workspace_id=wid,identity=identity,query=query(kind))
            response=client.post('/api/investigations/bpic19-profile',json=given)
            assert response.status_code==200,response.text
            assert_profile(response.json(),kind)
            definitions.append(response.json()['profile']['definition_id'])
        assert len(set(definitions))==4
        for field,value in [('profile_name','Changed named profile'),('horizon',dict(timestamp_kind='utc_instant',value='2019-01-28T00:00:00Z',provenance='Changed evidence'))]:
            changed=query();changed['source_interpretation'][field]=value
            response=client.post('/api/investigations/bpic19-profile',json=envelope('bpic19_profile_request',workspace_id=wid,identity=identity,query=changed))
            assert response.status_code==200,response.text
            assert response.json()['profile']['definition_id']!=definitions[0]
        for field,value,code,location,message in [
            ('policy_id','execute.arbitrary.v99','unsupported_policy','query.source_interpretation.policy_id','This named source interpretation policy is not supported.'),
            ('horizon',dict(timestamp_kind='utc_instant',value='2019-01-28T00:00:00Z',provenance=None),'invalid_parameter','query.source_interpretation.horizon.provenance','A trusted observation horizon requires reviewed evidence or provenance.')]:
            changed=deepcopy(query());changed['source_interpretation'][field]=value
            response=client.post('/api/investigations/bpic19-profile',json=envelope('bpic19_profile_request',workspace_id=wid,identity=identity,query=changed))
            assert response.status_code==422,response.text
            assert response.json()['code']==code,response.text
            assert response.json()['field']==location,response.text
            assert response.json()['message']==message,response.text


def test_h7_same_naive_bytes_distinct_declared_offsets_preserve_raw_lineage(tmp_path):
    workspace=tmp_path/'workspace';workspace.mkdir()
    with TestClient(create_app()) as client:
        naive=source().replace(b'Z',b'')
        wid,utc=prepare(client,workspace,content=naive,time_policy=policies('iso8601',0))
        _,offset=prepare(client,workspace,content=naive,time_policy=policies('iso8601',60))
        assert utc['source_id']==offset['source_id']
        assert utc['preparation_id']!=offset['preparation_id']
        snapshots=[saved(client,wid,identity,query()) for identity in [utc,offset]]
        assert snapshots[0]['bpic19_outputs']['outputs'][0]['definition_id']!=snapshots[1]['bpic19_outputs']['outputs'][0]['definition_id']
        for identity,instant in [(utc,'1948-01-01T00:00:00Z'),(offset,'1947-12-31T23:00:00Z')]:
            response=client.post('/api/investigations/case-evidence',json=envelope('imported_case_evidence_request',workspace_id=wid,identity=identity,case_id='A'))
            assert response.status_code==200,response.text
            rows=response.json()['records']
            assert [row['original_cells'][0] for row in rows]==['h1','h2','h3']
            assert rows[0]['original_cells'][3]=='1948-01-01T00:00:00'
            assert rows[0]['utc_instant']==instant
        for snapshot in snapshots:
            response=client.post('/api/investigations/reopen',json=envelope('reopen_investigation_request',workspace_id=wid,saved_revision_id=snapshot['revision']['saved_revision_id']))
            assert response.status_code==200,response.text
            assert response.json()['bpic19_outputs']==snapshot['bpic19_outputs']


def test_h7_declared_origin_field_record_lineage_mutations_remain_reopenable(tmp_path):
    workspace=tmp_path/'workspace';workspace.mkdir()
    with TestClient(create_app()) as client:
        wid,identity=prepare(client,workspace)
        duplicated=source().replace(b'Standard',b'"3-way match, invoice before GR"')
        _,origin=prepare(client,workspace,content=duplicated)
        _,other=prepare(client,workspace,content=duplicated.replace(b'user_1',b'user_2'))
        snapshots=[];definitions=[]
        for preparation,column,provenance in [(origin,4,'Literal position and case correspondence'),(origin,5,'Literal position and case correspondence'),(other,4,'Literal position and case correspondence'),(origin,4,'Separately reviewed provenance')]:
            definition=query()
            definition['category_lineage']=dict(policy_id='bpic19.same_position_category_lineage.v1',origin_preparation_id=preparation['preparation_id'],origin_column_index=column,provenance=provenance)
            snapshot=saved(client,wid,identity,definition);snapshots.append(snapshot)
            output=snapshot['bpic19_outputs']['outputs'][0]['output'];assert_profile(output,'all_source')
            lineage=output['profile']['definition']['category_lineage']
            assert lineage['origin_source_id']==preparation['source_id']
            assert lineage['verified_record_count']==7
            assert lineage['column_index']==4 and lineage['origin_column_index']==column
            assert lineage['provenance']==provenance
            definitions.append(output['profile']['definition_id'])
        assert len(set(definitions))==4
        for snapshot in snapshots:
            response=client.post('/api/investigations/reopen',json=envelope('reopen_investigation_request',workspace_id=wid,saved_revision_id=snapshot['revision']['saved_revision_id']))
            assert response.status_code==200,response.text
            assert response.json()['bpic19_outputs']==snapshot['bpic19_outputs']
