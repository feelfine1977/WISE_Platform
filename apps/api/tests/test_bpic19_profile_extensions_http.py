from copy import deepcopy

from fastapi.testclient import TestClient
from wise_platform_api.app import create_app
from import_requests import envelope
from test_bpic19_profile_http import prepare_source, request
from test_bpic19_profile_extensions import many_values_source, reported_definition


def test_public_attribute_pages_explicit_singleton_whole_item_and_reported_claims(tmp_path):
    path=tmp_path/'workspace';path.mkdir()
    with TestClient(create_app()) as client:
        wid,identity=prepare_source(client,path,many_values_source())
        given=request(wid,identity)
        given['query'].update(profile_columns=[10],attribute_view={'column_index':10,'offset':12,'limit':12,'select_value':False,'value':None},include_zero_cells=True,source_interpretation=reported_definition())
        result=client.post('/api/investigations/bpic19-profile',json=given);assert result.status_code==200,result.text
        profile=result.json()['profile'];assert profile['attribute_view']['values'][0]['value']=='z-singleton'
        assert [figure['count'] for figure in profile['source_review']['reported_populations']]==[190283,189584,699]
        selected=deepcopy(given);selected['query']['attribute_view'].update(select_value=True,value='z-singleton')
        answer=client.post('/api/investigations/bpic19-profile',json=selected);assert answer.status_code==200,answer.text
        ids=answer.json()['profile']['attribute_view']['selection']['case_ids'];assert ids==['D12_1']
        kept=client.post('/api/investigations/select-cases',json=envelope('select_cases_request',workspace_id=wid,identity=identity,parent_case_ids=None,predicates=[{'kind':'case_id_in','case_ids':ids,'negate':False}]))
        assert kept.status_code==200 and kept.json()['kept']['record_count']==2
        evidence=client.post('/api/investigations/case-evidence',json=envelope('imported_case_evidence_request',workspace_id=wid,identity=kept.json()['identity'],case_id='D12_1'))
        assert evidence.status_code==200
        assert [row['original_cells'][10] for row in evidence.json()['records']]==['z-singleton','common-00']
        invalid=deepcopy(given);invalid['query']['attribute_view']['limit']=101
        refused=client.post('/api/investigations/bpic19-profile',json=invalid);assert refused.json()['code']=='invalid_request'
