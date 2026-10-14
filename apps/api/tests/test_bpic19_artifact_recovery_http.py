"""Native failure codes and bounded historical metadata, independently from raw evidence."""
from copy import deepcopy
import hashlib
import json
import socket

from fastapi.testclient import TestClient
from jsonschema import Draft202012Validator
import pytest

from import_requests import envelope
from test_bpic19_scoring_http import prepare, given, read
from test_bpic19_pipeline_http import start_process
from wise_platform_api.app import create_app

ROUTE = '/api/investigations/recover-metadata'
ROOT = __import__('pathlib').Path(__file__).resolve().parents[3]
VALIDATOR = Draft202012Validator(json.loads((ROOT/'contracts/saving.schema.json').read_text()))


def seed(client, folder):
    wid, identity = prepare(client, folder)
    native = client.post('/api/investigations/bpic19-score', json=given(wid, identity))
    assert native.status_code == 200, native.text
    native = native.json()
    source_request = envelope('imported_case_evidence_request', workspace_id=wid, identity=identity, case_id='A')
    evidence = client.post('/api/investigations/case-evidence', json=source_request)
    assert evidence.status_code == 200, evidence.text
    evidence = evidence.json()
    selected = client.post('/api/investigations/select-cases', json=envelope('select_cases_request', workspace_id=wid, identity=identity, parent_case_ids=None, predicates=[])).json()
    action = {'operation':'bpic19_score', 'identity':identity, 'definition_id':native['definition_id'],
              'query':{'run_id':native['run_id'], 'case_offset':0, 'case_limit':100}}
    notes = '😀'*4001 + ' END: recorded hypothesis, not adopted'
    claim = {'claim_id':'reported-r04','report_id':'R04','source_locator':'Merged PDF 82',
             'claim':'Reported complete population; no rerun claim.', 'claim_level':'reported_not_rerun','compared_run_id':native['run_id']}
    save = envelope('save_investigation_request',workspace_id=wid,investigation_id=None,expected_revision_id=None,
        name='Immutable native question',base_identity=identity,selection_identity=selected['identity'],
        selection_recipe={'parent_case_ids':selected['parent']['case_ids'],'predicates':[]},
        context_policy='incident.context.first_record_in_declared_order.v1',comparison=None,notes=notes,
        bookmarks=[{'label':'Original A control witness','identity':identity,'case_id':'A',
                    'row_ids':[evidence['records'][0]['row_id']],'note':'A separate saved annotation.'}],
        bpic19_pipeline={'schema_version':1,'actions':[action],'literature_claims':[claim]})
    saved = client.post('/api/investigations/save',json=save)
    assert saved.status_code == 200,saved.text
    answer = saved.json()
    recover = envelope('recover_investigation_metadata_request',workspace_id=wid,saved_revision_id=answer['revision']['saved_revision_id'],
                      page={'notes_offset':0,'bookmarks_offset':0,'claims_offset':0})
    artifact = folder/'score-run-artifacts'/next(ref['filename'] for ref in native['snapshot']['artifacts'] if ref['kind']=='cases')
    return wid, identity, native, save, answer, recover, source_request, evidence, artifact


def immutable_receipt(folder):
    return {str(p.relative_to(folder)):hashlib.sha256(p.read_bytes()).hexdigest() for p in (folder/'investigations').rglob('*.json')}


@pytest.mark.parametrize('mutation,code',[('missing','artifact_unavailable'),('size','checksum_mismatch'),('digest','checksum_mismatch')])
def test_native_and_saved_failures_preserve_exact_codes_and_recover_only_unaffected_metadata(tmp_path,monkeypatch,mutation,code):
    folder=tmp_path/'workspace';folder.mkdir()
    with TestClient(create_app()) as client:
        wid, identity, native, save, saved, recover, source_request, evidence, artifact=seed(client,folder)
        before=immutable_receipt(folder); original=artifact.read_bytes()
        if mutation=='missing':artifact.unlink()
        elif mutation=='size':artifact.write_bytes(b'changed')
        else:artifact.write_bytes(bytes([original[0]^1])+original[1:])
        changed=artifact.read_bytes() if artifact.exists() else None
        monkeypatch.setattr('wise_platform_api.bpic19_scoring.evaluate_features',lambda *a,**kw:pytest.fail('A failed read/recovery must never rescore'))
        direct=client.post('/api/investigations/bpic19-read',json=read(wid,native['run_id']))
        assert direct.status_code==409 and direct.json()['code']==code,direct.text
        reopened=client.post('/api/investigations/reopen',json=envelope('reopen_investigation_request',workspace_id=wid,saved_revision_id=saved['revision']['saved_revision_id']))
        assert reopened.status_code==409 and reopened.json()['code']==code,reopened.text
        VALIDATOR.validate(reopened.json())
        assert reopened.json()['field']=='bpic19_pipeline.actions.0.query.run_id'
        update={**save,'investigation_id':saved['revision']['investigation_id'],'expected_revision_id':saved['revision']['saved_revision_id'],'notes':'Never publish this changed note'}
        refused=client.post('/api/investigations/save',json=update)
        assert refused.status_code==409 and refused.json()['code']==code,refused.text
        metadata=client.post(ROUTE,json=recover)
        assert metadata.status_code==200,metadata.text
        body=metadata.json();VALIDATOR.validate(body)
        assert body['status']=='historical_metadata_only' and body['metadata_integrity']=='saved_content_hash_verified'
        assert body['outputs_restored'] is body['selection_restored'] is body['source_verified'] is False
        assert 'bpic19_outputs' not in body and 'restored_selection' not in body and 'revision' not in body
        assert body['metadata']['notes']=={'offset':0,'total':len(save['notes']),'text':'😀'*4000,'next_offset':4000}
        next_page=deepcopy(recover);next_page['page']['notes_offset']=4000
        suffix=client.post(ROUTE,json=next_page)
        assert suffix.status_code==200 and suffix.json()['metadata']['notes']['text']=='😀 END: recorded hypothesis, not adopted'
        assert body['metadata']['bookmarks']['items'][0]['row_ids']==save['bookmarks'][0]['row_ids']
        assert body['metadata']['literature_claims']['items']==save['bpic19_pipeline']['literature_claims']
        raw=client.post('/api/investigations/case-evidence',json=source_request)
        assert raw.status_code==200 and raw.json()['records']==evidence['records']
        assert immutable_receipt(folder)==before
        assert (artifact.read_bytes() if artifact.exists() else None)==changed
        assert len(list((folder/'score-runs').glob('*.json')))==1


def test_metadata_integrity_source_failures_and_malformed_page_remain_distinct(tmp_path):
    folder=tmp_path/'workspace';folder.mkdir()
    with TestClient(create_app()) as client:
        wid, identity, native, save, saved, recover, source_request, evidence, artifact=seed(client,folder)
        (folder/'sources'/f"{identity['source_id'].split(':')[-1]}.csv").unlink()
        reopened=client.post('/api/investigations/reopen',json=envelope('reopen_investigation_request',workspace_id=wid,saved_revision_id=saved['revision']['saved_revision_id']))
        assert reopened.status_code==409 and reopened.json()['code']=='artifact_unavailable',reopened.text
        metadata=client.post(ROUTE,json=recover);assert metadata.status_code==200
        raw=client.post('/api/investigations/case-evidence',json=source_request)
        assert raw.status_code==404 and raw.json()['code']=='source_unavailable',raw.text
        for wrong in [{'notes_offset':True,'bookmarks_offset':0,'claims_offset':0}, {'notes_offset':-1,'bookmarks_offset':0,'claims_offset':0}, {**recover['page'],'execute':'shell'}]:
            response=client.post(ROUTE,json={**recover,'page':wrong})
            assert response.status_code==400 and response.json()['code']=='invalid_request'
        revision=next((folder/'investigations/revisions').glob('*.json'));data=json.loads(revision.read_text());data['content']['notes']='tampered';revision.write_text(json.dumps(data))
        refused=client.post(ROUTE,json=recover)
        assert refused.status_code==422 and refused.json()['code']=='malformed_saved_revision'
        assert json.loads(revision.read_text())['content']['notes']=='tampered'


def test_actual_process_exit_keeps_recovery_historical_and_source_evidence_independent(tmp_path):
    folder=tmp_path/'workspace';folder.mkdir()
    with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
    first,client=start_process(port)
    try:
        wid, identity, native, save, saved, recover, source_request, evidence, artifact=seed(client,folder)
        artifact.unlink();before=immutable_receipt(folder)
    finally:first.terminate();first.wait(timeout=15)
    second,fresh=start_process(port)
    try:
        assert first.returncode is not None and first.pid!=second.pid
        fresh.post('/api/workspaces/open',json=envelope('open_workspace_request',path=str(folder)))
        refused=fresh.post('/api/investigations/reopen',json=envelope('reopen_investigation_request',workspace_id=wid,saved_revision_id=saved['revision']['saved_revision_id']))
        assert refused.status_code==409 and refused.json()['code']=='artifact_unavailable'
        metadata=fresh.post(ROUTE,json=recover);assert metadata.status_code==200
        assert metadata.json()['outputs_restored'] is False and metadata.json()['metadata']['notes']['text']=='😀'*4000
        raw=fresh.post('/api/investigations/case-evidence',json=source_request)
        assert raw.status_code==200 and raw.json()['records']==evidence['records']
        assert immutable_receipt(folder)==before and not artifact.exists()
    finally:second.terminate();second.wait(timeout=15)
