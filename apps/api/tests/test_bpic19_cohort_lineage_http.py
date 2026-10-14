"""Saved H7 parent exclusions remain evidence of a two-prefix child after real restart."""
from copy import deepcopy
import csv
import io
import socket

from fastapi.testclient import TestClient
from wise_platform_api.app import create_app
from wise_platform_analytics.bpic19_cohorts import default_query
from import_requests import envelope, wall_policies
from test_bpic19_pipeline_http import start_process

FIRST={"kind":"case_id_in","case_ids":["C"],"negate":False}
SECOND={"kind":"contains_activity","activity":"Clear Invoice","negate":False}


def h7():
    stream=io.StringIO();writer=csv.writer(stream);writer.writerow(["case","activity","time","category","document"])
    category="3-way match, invoice before GR"
    writer.writerows([
      ["A","Vendor creates invoice","1948-01-01T00:00:00",category,"D"],
      ["A","Create Purchase Order Item","2018-01-01T00:00:00",category,"D"],
      ["A","Clear Invoice","2020-01-02T00:00:00",category,"D"],
      ["B","Create Purchase Order Item","2018-01-02T00:00:00",category,"D"],
      ["B","Record Goods Receipt","2018-01-03T00:00:00",category,"D"],
      ["C","Create Purchase Order Item","2018-01-02T00:00:00",category,"E"],
      ["C","Clear Invoice","2018-01-04T00:00:00",category,"E"]])
    return stream.getvalue().encode()


def setup_lineage(client,folder):
    opened=client.post('/api/workspaces/open',json=envelope('open_workspace_request',path=str(folder)));assert opened.status_code==200,opened.text
    wid=opened.json()['workspace_id']
    stored=client.put('/api/sources',params=envelope('upload_source_metadata',workspace_id=wid,filename='literal-H7.csv'),content=h7(),headers={'Content-Type':'application/octet-stream'});assert stored.status_code==200,stored.text
    ready=client.post('/api/preparations',json=envelope('confirm_mapping_request',workspace_id=wid,source_id=stored.json()['source']['source_id'],dialect={'encoding':'utf-8','delimiter':',','quotechar':'"','header':'first_record'},mapping={'case_column':0,'activity_column':1,'timestamp_column':2,'sequence_column':None,'context_columns':[3,4]},policies=wall_policies('iso8601','2027-01-01T00:00:00'),accept_report_issues=True));assert ready.status_code==200,ready.text
    pop=client.post('/api/investigations/open-population',json=envelope('open_population_request',workspace_id=wid,preparation_id=ready.json()['preparation']['preparation_id']));assert pop.status_code==200,pop.text
    base=pop.json()['identity'];parent=pop.json()['population']['case_ids'];assert parent==['A','B','C']
    query=default_query({'item_category':3,'purchasing_document':4},'wall_clock')
    query['inclusion'].update(kind='document_start_window',start_inclusive='2018-01-01T00:00:00')
    def measured(identity, position):
        result=client.post('/api/investigations/bpic19-cohorts',json=envelope('bpic19_cohorts_request',workspace_id=wid,identity=identity,query=query));assert result.status_code==200,result.text
        return {'operation':'bpic19_cohorts','identity':identity,'query':deepcopy(query),'definition_id':result.json()['definition_id'],'selection_prefix_length':position},result.json()
    actions=[];action,parent_answer=measured(base,None);actions.append(action)
    assert parent_answer['cohorts']['inclusion']['excluded']['case_ids']==['A','B']
    assert parent_answer['cohorts']['inclusion']['excluded']['record_count']==5
    sibling=next(row for row in parent_answer['cohorts']['page']['items'] if row['case_id']=='B')
    assert sibling['inclusion_witnesses'][0]['case_id']=='A'
    for i,predicates in enumerate([[FIRST],[FIRST,SECOND]],1):
        selected=client.post('/api/investigations/select-cases',json=envelope('select_cases_request',workspace_id=wid,identity=base,parent_case_ids=parent,predicates=predicates));assert selected.status_code==200,selected.text
        assert selected.json()['kept']['case_ids']==['C'] and selected.json()['kept']['record_count']==2
        action,_=measured(selected.json()['identity'],i);actions.append(action)
    assert actions[1]['definition_id']==actions[2]['definition_id']
    assert actions[1]['identity']!=actions[2]['identity']
    given=envelope('save_investigation_request',workspace_id=wid,investigation_id=None,expected_revision_id=None,name='H7 parent proof and two-prefix child',base_identity=base,selection_identity=selected.json()['identity'],selection_recipe={'parent_case_ids':parent,'predicates':[FIRST,SECOND]},context_policy='incident.context.first_record_in_declared_order.v1',comparison=None,notes='Independent synthetic literal H7',bookmarks=[],bpic19_pipeline={'schema_version':1,'actions':actions})
    return given,parent_answer,measured


def test_save_replays_legitimate_intermediate_prefix_only_and_rejects_tamper_foreign_duplicate(tmp_path):
    folder=tmp_path/'workspace';folder.mkdir()
    with TestClient(create_app()) as client:
        given,parent_answer,measured=setup_lineage(client,folder)
        response=client.post('/api/investigations/save',json=given);assert response.status_code==200,response.text
        outputs=response.json()['bpic19_outputs']['outputs'];assert len(outputs)==3
        assert outputs[0]['output']['cohorts']==parent_answer['cohorts']
        assert outputs[1]['definition_id']==outputs[2]['definition_id'] and outputs[1]['sha256']!=outputs[2]['sha256']
        # The raw prepared base and the computed empty recipe have different
        # identities even when both contain every source item. Position zero
        # names the latter; null names only the former.
        frozen=client.post('/api/investigations/select-cases',json=envelope('select_cases_request',workspace_id=given['workspace_id'],identity=given['base_identity'],parent_case_ids=given['selection_recipe']['parent_case_ids'],predicates=[]))
        assert frozen.status_code==200,frozen.text
        assert frozen.json()['identity']!=given['base_identity']
        at_zero,_=measured(frozen.json()['identity'],0)
        with_zero=deepcopy(given)
        with_zero['bpic19_pipeline']['actions'].insert(1,at_zero)
        accepted_zero=client.post('/api/investigations/save',json=with_zero)
        assert accepted_zero.status_code==200,accepted_zero.text
        assert len(accepted_zero.json()['bpic19_outputs']['outputs'])==4
        for bad_length in [0,100,None]:
            bad=deepcopy(given);bad['bpic19_pipeline']['actions'][2]['selection_prefix_length']=bad_length
            refused=client.post('/api/investigations/save',json=bad)
            assert refused.status_code==409 and refused.json()['code']=='identity_mismatch',refused.text
            assert refused.json()['field'].endswith('selection_prefix_length')
        foreign=client.post('/api/investigations/select-cases',json=envelope('select_cases_request',workspace_id=given['workspace_id'],identity=given['base_identity'],parent_case_ids=given['selection_recipe']['parent_case_ids'],predicates=[{'kind':'case_id_in','case_ids':['B'],'negate':False}]))
        assert foreign.status_code==200
        outside,_=measured(foreign.json()['identity'],1)
        bad=deepcopy(given);bad['bpic19_pipeline']['actions'][1]=outside
        refused=client.post('/api/investigations/save',json=bad);assert refused.status_code==409 and refused.json()['code']=='identity_mismatch'
        # Legacy unpositioned reference is still checked against the computed allow-list, not the global registry.
        del bad['bpic19_pipeline']['actions'][1]['selection_prefix_length']
        refused=client.post('/api/investigations/save',json=bad);assert refused.status_code==409 and refused.json()['code']=='identity_mismatch'
        bad=deepcopy(given);bad['bpic19_pipeline']['actions'].append(deepcopy(bad['bpic19_pipeline']['actions'][2]))
        refused=client.post('/api/investigations/save',json=bad);assert refused.json()['code']=='invalid_parameter',refused.text
        # Old saved actions without position metadata remain source-replay compatible.
        legacy=deepcopy(given)
        for action in legacy['bpic19_pipeline']['actions']:action.pop('selection_prefix_length')
        legacy['name']='Legacy verified prefix reference'
        accepted=client.post('/api/investigations/save',json=legacy);assert accepted.status_code==200,accepted.text


def test_actual_new_serving_pid_reopens_parent_exclusion_witness_and_child_outputs(tmp_path):
    folder=tmp_path/'workspace';folder.mkdir()
    with socket.socket() as socket_:
        socket_.bind(('127.0.0.1',0));port=socket_.getsockname()[1]
    first,client=start_process(port)
    try:
        given,parent_answer,_=setup_lineage(client,folder)
        saved=client.post('/api/investigations/save',json=given);assert saved.status_code==200,saved.text
        artifact=saved.json()
    finally:
        first.terminate();first.wait(timeout=15)
    assert first.returncode is not None
    second,fresh=start_process(port)
    try:
        assert second.pid!=first.pid
        opened=fresh.post('/api/workspaces/open',json=envelope('open_workspace_request',path=str(folder)));assert opened.status_code==200
        reopened=fresh.post('/api/investigations/reopen',json=envelope('reopen_investigation_request',workspace_id=given['workspace_id'],saved_revision_id=artifact['revision']['saved_revision_id']));assert reopened.status_code==200,reopened.text
        result=reopened.json()
        assert result['revision']==artifact['revision'] and result['bpic19_outputs']==artifact['bpic19_outputs']
        assert result['restored_selection']['kept']['case_ids']==['C'] and result['restored_selection']['kept']['record_count']==2
        parent=result['bpic19_outputs']['outputs'][0]['output']
        assert parent['cohorts']==parent_answer['cohorts']
        witness=next(i for i in parent['cohorts']['page']['items'] if i['case_id']=='B')['inclusion_witnesses'][0]
        evidence=fresh.post('/api/investigations/case-evidence',json=envelope('imported_case_evidence_request',workspace_id=given['workspace_id'],identity=parent['identity'],case_id=witness['case_id']))
        assert evidence.status_code==200,evidence.text
        rows=evidence.json()['records'];assert len(rows)==3
        assert rows[0]['row_id']==witness['row_ids'][0] and rows[0]['original_cells'][2]=='1948-01-01T00:00:00'
    finally:
        second.terminate();second.wait(timeout=15)
