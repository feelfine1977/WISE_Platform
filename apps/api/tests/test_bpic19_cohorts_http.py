"""The registered HTTP cohort route uses real durable imports and complete evidence."""
import json
from copy import deepcopy
from fastapi import FastAPI
from fastapi.testclient import TestClient
from jsonschema import Draft202012Validator
from pathlib import Path

from wise_platform_api.bpic19_cohorts import register_bpic19_cohort_routes
from wise_platform_api.imports import Imports
from wise_platform_analytics.bpic19_cohorts import default_query
from import_requests import envelope, wall_policies
from test_bpic19_profiles import source

ROUTE="/api/investigations/bpic19-cohorts"
ROOT=Path(__file__).resolve().parents[3]
SCHEMA=json.loads((ROOT/'contracts/bpic19-cohorts.schema.json').read_text())
VALIDATOR=Draft202012Validator(SCHEMA)


def encoded(obj): return json.dumps(obj).encode()


def app(imports):
    result=FastAPI();register_bpic19_cohort_routes(result,imports);return result


def prepared_import(imports, path):
    opened=imports.open_workspace(encoded(envelope("open_workspace_request",path=str(path))))
    assert opened.status==200,opened.body
    wid=opened.body['workspace_id']
    metadata=envelope("upload_source_metadata",workspace_id=wid,filename="cohorts.csv")
    uploaded=imports.upload_source([(k,str(v)) for k,v in metadata.items()],"application/octet-stream",source())
    assert uploaded.status==200,uploaded.body
    ready=imports.confirm_mapping(encoded(envelope("confirm_mapping_request",workspace_id=wid,source_id=uploaded.body['source']['source_id'],dialect={"encoding":"utf-8","delimiter":",","quotechar":'"',"header":"first_record"},mapping={"case_column":0,"activity_column":1,"timestamp_column":2,"sequence_column":None,"context_columns":list(range(3,10))},policies=wall_policies("iso8601","2027-01-01T00:00:00"),accept_report_issues=True)))
    assert ready.status==200 and ready.body['state']=='ready',ready.body
    opened=imports.open_population(encoded(envelope('open_population_request',workspace_id=wid,preparation_id=ready.body['preparation']['preparation_id'])))
    assert opened.status==200,opened.body
    return wid,opened.body['identity']


def given(wid,identity):
    return envelope('bpic19_cohorts_request','cohorts-http',1,workspace_id=wid,identity=identity,query=default_query({'item_category':3,'purchasing_document':7},'wall_clock'))


def test_http_contract_whole_items_refusals_and_durable_source_recomputation(tmp_path):
    workspace=tmp_path/'workspace';workspace.mkdir();imports=Imports();wid,identity=prepared_import(imports,workspace)
    request=given(wid,identity);VALIDATOR.validate(request)
    with TestClient(app(imports)) as client:
        response=client.post(ROUTE,json=request);assert response.status_code==200,response.text
        answer=response.json();VALIDATOR.validate(answer)
        assert answer['query']==request['query'] and answer['identity']==identity
        assert answer['cohorts']['original']['record_count']==14
        assert answer['cohorts']['selection']['case_ids']==['B_1','C_1','D1_1','D1_2','D2_1','D3_1','F_1','G_1','M_1','U_1']
        assert answer['definition_id']==answer['cohorts']['definition_id']
        bad=deepcopy(request);bad['query']['roles']['item_category']=True
        refused=client.post(ROUTE,json=bad);assert refused.status_code==400;VALIDATOR.validate(refused.json())
        bad=deepcopy(request);bad['query']['completion']['recipe']='financial_balance'
        refused=client.post(ROUTE,json=bad);assert refused.status_code==400 and refused.json()['code']=='invalid_request'
        bad=deepcopy(request);bad['identity']['population_id']='population.v1:sha256:'+'f'*64
        refused=client.post(ROUTE,json=bad);assert refused.status_code==409 and refused.json()['code']=='population_unavailable'
    # This is durable source recomputation, explicitly not the full saved-pipeline/fresh-PID receipt.
    fresh=Imports();opened=fresh.open_workspace(encoded(envelope('open_workspace_request',path=str(workspace))))
    assert opened.status==200
    with TestClient(app(fresh)) as client:
        replay=client.post(ROUTE,json=request);assert replay.status_code==200,replay.text
        assert replay.json()==answer


def test_a_memory_refusal_is_a_typed_retryable_503():
    # The budget refuses reading an evicted preparation with memory_unavailable; the cohort refusal must carry it.
    from wise_platform_api.bpic19_cohorts import _refused
    reply = _refused({"request_id": "cohorts-1", "query_revision": 1, "workspace_id": "workspace.v1:literal"},
                     "memory_unavailable", "Reading this preparation needs more memory than the service may use now.")
    assert reply.status == 503
    assert (reply.body["code"], reply.body["retryable"], reply.body["operation"]) == ("memory_unavailable", True, "bpic19_cohorts")
