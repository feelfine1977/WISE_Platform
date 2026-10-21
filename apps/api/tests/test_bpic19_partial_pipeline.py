"""An unresolved source formula cannot silently become a complete analyst run."""
from copy import deepcopy
import json
from pathlib import Path
import socket
from fastapi.testclient import TestClient
from import_requests import envelope
from test_bpic19_pipeline_http import save_request, start_process
from wise_platform_api.app import create_app

GATE = json.loads((Path(__file__).parents[1] / 'src/wise_platform_api/bpic19_reference/source-method-gate.json').read_text())

def partial_recipe(client, folder):
    given = save_request(client, folder)
    counts = given['bpic19_pipeline']['actions'][1]
    exact_query = {**counts['query'], 'representation_policy':'exact'}
    exact = client.post('/api/investigations/bpic19-measures', json=envelope('bpic19_measures_request',workspace_id=given['workspace_id'],identity=counts['identity'],query=exact_query))
    assert exact.status_code == 200, exact.text
    gate = {'operation':'bpic19_method_gate','identity':counts['identity'],**deepcopy(GATE)}
    given['bpic19_pipeline']['actions'] = [counts, gate, {**counts,'query':exact_query,'definition_id':exact.json()['definition_id']}]
    return given

def test_all_required_refuses_source_step_before_any_admitted_execution_and_partial_names_omission(tmp_path, monkeypatch):
    folder=tmp_path/'workspace';folder.mkdir()
    with TestClient(create_app()) as client:
        given=partial_recipe(client,folder)
        from wise_platform_api.bpic19_measures import Bpic19Measures
        original=Bpic19Measures.measures
        def forbidden(*args): raise AssertionError('require_all must admit all source steps before computing counts')
        monkeypatch.setattr(Bpic19Measures,'measures',forbidden)
        refused=client.post('/api/investigations/save',json=given)
        assert refused.status_code==400 and refused.json()['code']=='unsupported_policy',refused.text
        assert refused.json()['field']=='bpic19_pipeline.actions.1.query'
        assert 'Step 2' in refused.json()['message'] and 'weights' in refused.json()['message']
        assert not list((folder/'investigations/revisions').glob('*.json'))
        monkeypatch.setattr(Bpic19Measures,'measures',original)
        given['bpic19_pipeline']['replay_mode']='partial'
        admitted=client.post('/api/investigations/save',json=given)
        assert admitted.status_code==200,admitted.text
        manifest=admitted.json()['bpic19_outputs']
        assert manifest['claim_level']=='partial' and len(manifest['outputs'])==2
        assert manifest['omissions']==[{'step':2,'operation':'bpic19_method_gate','definition_id':GATE['definition_id'],'identity':given['base_identity'],**{k:GATE['query'][k] for k in ('method_id','source_locator','gate_reason')}}]
        complete=deepcopy(given);complete['bpic19_pipeline']['actions'].pop(1);complete['bpic19_pipeline']['replay_mode']='require_all'
        full=client.post('/api/investigations/save',json=complete)
        assert full.status_code==200,full.text
        assert full.json()['bpic19_outputs']['claim_level']=='complete_registered_pipeline'
        assert full.json()['bpic19_outputs']['run_id']!=manifest['run_id']
        bad=deepcopy(given);bad['bpic19_pipeline']['actions'][2]['definition_id']='forged'
        assert client.post('/api/investigations/save',json=bad).status_code==409
        bad=deepcopy(given);bad['bpic19_pipeline']['actions'][1]['query']['execute']='unreviewed source code'
        assert client.post('/api/investigations/save',json=bad).status_code==400
        only=deepcopy(given);only['bpic19_pipeline']['actions']=[only['bpic19_pipeline']['actions'][1]]
        assert client.post('/api/investigations/save',json=only).status_code==400

def test_actual_distinct_pid_reopens_exact_partial_manifest(tmp_path):
    folder=tmp_path/'workspace';folder.mkdir()
    with socket.socket() as sock: sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
    first,client=start_process(port)
    try:
        given=partial_recipe(client,folder);given['bpic19_pipeline']['replay_mode']='partial'
        saved=client.post('/api/investigations/save',json=given);assert saved.status_code==200,saved.text
        answer=saved.json()
    finally: first.terminate();first.wait(timeout=15)
    second,fresh=start_process(port)
    try:
        assert first.returncode is not None and first.pid!=second.pid
        fresh.post('/api/workspaces/open',json=envelope('open_workspace_request',path=str(folder)))
        reopened=fresh.post('/api/investigations/reopen',json=envelope('reopen_investigation_request',workspace_id=given['workspace_id'],saved_revision_id=answer['revision']['saved_revision_id']))
        assert reopened.status_code==200,reopened.text
        assert reopened.json()['bpic19_outputs']==answer['bpic19_outputs']
        assert reopened.json()['revision']==answer['revision']
    finally: second.terminate();second.wait(timeout=15)

def test_every_registered_request_is_admitted_before_first_dispatch(tmp_path,monkeypatch):
    folder=tmp_path/'workspace';folder.mkdir()
    with TestClient(create_app()) as client:
        given=save_request(client,folder)
        given['bpic19_pipeline']['actions'][1]['query']['injected_unknown_parameter']='must be refused before profile computes'
        from wise_platform_api.bpic19_profiles import Bpic19Profiles
        def forbidden(*args):raise AssertionError('No service may dispatch before all request boundaries are admitted')
        monkeypatch.setattr(Bpic19Profiles,'profile',forbidden)
        reply=client.post('/api/investigations/save',json=given)
        assert reply.status_code==400 and reply.json()['code']=='invalid_parameter',reply.text
        assert reply.json()['field']=='bpic19_pipeline.actions.1.query'
        assert not list((folder/'investigations/revisions').glob('*.json'))

def test_unregistered_notebook_action_has_named_refusal_before_execution(tmp_path):
    folder=tmp_path/'workspace';folder.mkdir()
    with TestClient(create_app()) as client:
        given=save_request(client,folder);given['bpic19_pipeline']['actions'][0]['operation']='notebook_python'
        reply=client.post('/api/investigations/save',json=given)
        assert reply.status_code==400 and reply.json()['code']=='unsupported_action',reply.text
        assert reply.json()['field']=='bpic19_pipeline.actions.0.operation'
        assert not list((folder/'investigations/revisions').glob('*.json'))

def test_literature_claim_cannot_name_an_unretained_or_invented_run(tmp_path,monkeypatch):
    folder=tmp_path/'workspace';folder.mkdir()
    with TestClient(create_app()) as client:
        given=save_request(client,folder)
        given['bpic19_pipeline']['literature_claims']=[{'claim_id':'report1','report_id':'R01','source_locator':'Synthetic source page1','claim':'Reported analyst observation','claim_level':'reported_not_rerun','compared_run_id':'invented-run'}]
        from wise_platform_api.bpic19_profiles import Bpic19Profiles
        def forbidden(*args):raise AssertionError('An invented literature/run link must be refused before any service dispatch')
        monkeypatch.setattr(Bpic19Profiles,'profile',forbidden)
        reply=client.post('/api/investigations/save',json=given)
        assert reply.status_code==409 and reply.json()['code']=='identity_mismatch',reply.text
        assert reply.json()['field']=='bpic19_pipeline.literature_claims.0.compared_run_id'
        assert not list((folder/'investigations/revisions').glob('*.json'))
