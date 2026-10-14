"""Actual imported case-list HTTP source/identity/distribution qualification."""
from copy import deepcopy
import csv
import io
import json
from pathlib import Path

from fastapi.testclient import TestClient
from jsonschema import Draft202012Validator,FormatChecker
import pytest

from wise_platform_api.app import create_app
from import_requests import envelope,policies

ROOT=Path(__file__).resolve().parents[3]
RAW=(ROOT/"tests/fixtures/case-list-v1.csv").read_bytes()
LIST=Draft202012Validator(json.loads((ROOT/"contracts/case-list.schema.json").read_text()),format_checker=FormatChecker())
IMPORT=Draft202012Validator(json.loads((ROOT/"contracts/import.schema.json").read_text()),format_checker=FormatChecker())
SELECTION=Draft202012Validator(json.loads((ROOT/"contracts/selection.schema.json").read_text()),format_checker=FormatChecker())
ROUTE="/api/investigations/case-list"


def checked(response,request,validator=IMPORT,kind=None):
    assert response.status_code==200,response.text
    body=response.json();validator.validate(body)
    assert body["request_id"]==request["request_id"] and body["query_revision"]==request["query_revision"]
    if kind is not None:assert body["message_type"]==kind
    return body


def opened(client,path,wall=False):
    path.mkdir()
    r=envelope("open_workspace_request","open",path=str(path));w=checked(client.post("/api/workspaces/open",json=r),r)
    metadata=envelope("upload_source_metadata","upload",workspace_id=w["workspace_id"],filename="case-list-v1.csv")
    raw=RAW.replace(b"Z,",b",") if wall else RAW
    source=checked(client.put("/api/sources",params=metadata,content=raw,headers={"Content-Type":"application/octet-stream"}),metadata)["source"]
    p=policies("iso8601",offset=None,tolerant=True,cutoff="2026-10-06T00:00:00Z")
    if wall:p["time"]={"id":"incident.time.wall_clock_as_recorded.v1","parameters":{"format":"iso8601","timezone":"none_as_recorded","snapshot_cutoff_local":"2026-10-06T00:00:00"}}
    r=envelope("confirm_mapping_request","confirm",workspace_id=w["workspace_id"],source_id=source["source_id"],dialect={"encoding":"utf-8","delimiter":",","quotechar":'"',"header":"first_record"},mapping={"case_column":0,"activity_column":1,"timestamp_column":2,"sequence_column":3,"context_columns":[4]},policies=p,accept_report_issues=True)
    prepared=checked(client.post("/api/preparations",json=r),r)
    assert prepared["state"]=="ready"
    r=envelope("open_population_request","population",workspace_id=w["workspace_id"],preparation_id=prepared["preparation"]["preparation_id"])
    base=checked(client.post("/api/investigations/open-population",json=r),r)
    assert base["population"]=={"case_ids":list("ABCDEF"),"case_count":6,"record_count":12}
    return w,base


@pytest.fixture
def bundle(tmp_path):
    with TestClient(create_app()) as client:
        w,b=opened(client,tmp_path/"workspace")
        yield client,w,b


def select(bundle,predicates=(),parent=None,revision=2):
    c,w,b=bundle;r=envelope("select_cases_request","select",revision,workspace_id=w["workspace_id"],identity=b["identity"],parent_case_ids=parent,predicates=list(predicates))
    return checked(c.post("/api/investigations/select-cases",json=r),r,SELECTION,"selection_answer")


def request(w,identity,offset=0,limit=2,search=None,field="observed_span_hours",direction="descending",distribution=None,revision=3):
    query={"search_text":search,"sort":{"field":field,"direction":direction},"offset":offset,"limit":limit}
    if distribution is not None:query["distribution"]=distribution
    return envelope("case_list_request","list-"+str(offset),revision,workspace_id=w["workspace_id"],identity=deepcopy(identity),query=query)


def listed(bundle,selected=None,**kwargs):
    c,w,b=bundle;r=request(w,(selected or b)["identity"],**kwargs)
    LIST.validate(r);answer=checked(c.post(ROUTE,json=r),r,LIST,"case_list_answer")
    assert answer["identity"]==r["identity"] and answer["query"]==r["query"]
    return answer


def denied(response,code=None):
    assert 400<=response.status_code<500,response.text
    body=response.json();LIST.validate(body)
    assert body["message_type"]=="case_list_refusal" and body["operation"]=="case_list"
    if code is not None:assert body["code"]==code
    assert body["message"] and type(body["retryable"]) is bool
    return body


def test_actual_route_literal_pages_witnesses_generic_context_and_unchanged_query(bundle):
    selected=select(bundle)
    pages=[listed(bundle,selected,offset=o) for o in (0,2,4)]
    assert [r["case_id"] for p in pages for r in p["rows"]]==list("ABCDFE")
    assert [p["next_offset"] for p in pages]==[2,4,None]
    assert all(p["parent_identity"]==selected["parent_identity"] for p in pages)
    assert all(p["distribution"]==pages[0]["distribution"] for p in pages)
    assert pages[0]["context_columns"]==[{"column_index":4,"name":"opening_context"}]
    assert pages[0]["parent_time_range"]=={"timestamp_kind":"utc_instant","earliest_recorded_timestamp":"2026-10-01T00:00:00Z","latest_recorded_timestamp":"2026-10-05T00:00:00Z"}
    byid={r["case_id"]:r for p in pages for r in p["rows"]}
    c,w,_=bundle
    for cid in ("A","C"):
        r=envelope("imported_case_evidence_request","evidence",2,workspace_id=w["workspace_id"],identity=selected["identity"],case_id=cid)
        evidence=checked(c.post("/api/investigations/case-evidence",json=r),r)
        witness=byid[cid]["time_summary"]["maximum_gap_witness"]
        pair=[evidence["records"][i] for i in ((1,2) if cid=="A" else (0,1))]
        assert (witness["from_row_id"],witness["to_row_id"])==tuple(row["row_id"] for row in pair)
        assert (witness["from_activity"],witness["to_activity"])==tuple(row["activity"] for row in pair)
        assert byid[cid]["maximum_gap_context"]=={"from_context":pair[0]["context"],"to_context":pair[1]["context"]}
    assert byid["C"]["time_summary"]["maximum_gap_witness"]["share_of_observed_span"] is None
    assert byid["E"]["time_summary"]["unavailable_timestamp_record_count"]==1
    assert byid["D"]["time_summary"]["maximum_gap_witness"] is None


def test_real_filtered_list_retains_full_history_and_parent_bins_before_search_page(bundle):
    selected=select(bundle,[{"kind":"case_start_in_window","window":{"timestamp_kind":"utc_instant","start_inclusive":"2026-10-01T00:00:00Z","end_exclusive":"2026-10-02T00:00:00Z"},"negate":False}])
    assert selected["kept"]=={"case_ids":["A","C","F"],"case_count":3,"record_count":7}
    a=listed(bundle,selected,search="A",limit=1)
    assert a["population_case_count"]==3 and a["population_record_count"]==7 and a["total_matching_case_count"]==1
    assert [b["parent_case_count"] for b in a["distribution"]["bins"]]==[3,1,1,0,0,0]
    assert [b["kept_case_count"] for b in a["distribution"]["bins"]]==[2,0,1,0,0,0]
    assert a["rows"][0]["time_summary"]["last_recorded_timestamp"]=="2026-10-03T00:00:00Z"
    gap=listed(bundle,selected,distribution={"measure":"maximum_adjacent_raw_gap_hours","edges_hours":[0,1,24,168]})
    assert gap["distribution"]["unavailable"]["parent_case_count"]==3
    assert gap["distribution"]["unavailable"]["kept_case_count"]==1
    empty=listed(bundle,selected,search="not-in-source",offset=10)
    assert empty["rows"]==[] and empty["next_offset"] is None
    assert empty["distribution"]==a["distribution"]


def test_named_small_parent_and_fresh_application_base_read_do_not_expand(bundle,tmp_path):
    c,w,b=bundle
    selected=select(bundle,[{"kind":"case_id_in","case_ids":["A"],"negate":False}],parent=["A","E"])
    answer=listed(bundle,selected)
    assert answer["parent_identity"]==selected["parent_identity"]
    assert answer["distribution"]["parent_case_count"]==2 and answer["distribution"]["kept_case_count"]==1
    assert answer["parent_time_range"]["latest_recorded_timestamp"]=="2026-10-03T00:00:00Z"
    with TestClient(create_app()) as fresh:
        reopen=envelope("open_workspace_request","reopen",path=w["path"])
        checked(fresh.post("/api/workspaces/open",json=reopen),reopen)
        r=request(w,b["identity"],limit=200)
        body=checked(fresh.post(ROUTE,json=r),r,LIST)
        assert body["population_case_count"]==6
        denied(fresh.post(ROUTE,json=request(w,selected["identity"])),"population_unavailable")


def test_wall_clock_is_preserved_and_empty_parent_is_valid(tmp_path):
    with TestClient(create_app()) as c:
        w,b=opened(c,tmp_path/"wall",wall=True);bundle=c,w,b
        body=listed(bundle,limit=200)
        assert body["parent_time_range"]["timestamp_kind"]=="wall_clock"
        assert body["parent_time_range"]["earliest_recorded_timestamp"]=="2026-10-01T00:00:00"
        assert body["rows"][0]["time_summary"]["observed_span_hours"]==48
        empty=listed(bundle,select(bundle,parent=[]))
        assert empty["parent_time_range"] is None and empty["population_case_count"]==0 and empty["rows"]==[]


@pytest.mark.parametrize("field",["source_id","preparation_id","representation_id","case_dictionary_id","population_id","implementation_version"],ids=str)
def test_actual_list_checks_full_identity(bundle,field):
    c,w,b=bundle;r=request(w,b["identity"])
    r["identity"][field]="9.9.9" if field=="implementation_version" else r["identity"][field].rsplit(":",1)[0]+":"+"0"*64
    body=denied(c.post(ROUTE,json=r))
    assert body["code"] in {"identity_mismatch","preparation_unavailable","source_unavailable","population_unavailable"}


@pytest.mark.parametrize("change",["null-distribution","duplicate-edges","nonzero-edge","unsorted-edges","too-many-edges","bool-edge","bool-offset","too-large-limit","unknown-sort","extra-field","revision-bool","revision-overflow","unicode-version"],ids=str)
def test_strict_source_guards_refuse_without_losing_current_reading(bundle,change):
    c,w,b=bundle;r=request(w,b["identity"])
    if change=="null-distribution":r["query"]["distribution"]=None
    elif change in {"duplicate-edges","nonzero-edge","unsorted-edges","too-many-edges","bool-edge"}:
        r["query"]["distribution"]={"measure":"observed_span_hours","edges_hours":{"duplicate-edges":[0,1,1],"nonzero-edge":[1],"unsorted-edges":[0,24,1],"too-many-edges":list(range(33)),"bool-edge":[0,True]}[change]}
    elif change=="bool-offset":r["query"]["offset"]=True
    elif change=="too-large-limit":r["query"]["limit"]=201
    elif change=="unknown-sort":r["query"]["sort"]["field"]="resolution_time"
    elif change=="extra-field":r["query"]["completion"]="resolved"
    elif change=="revision-bool":r["query_revision"]=True
    elif change=="revision-overflow":r["query_revision"]=9007199254740992
    else:r["identity"]["implementation_version"]="١.٢.٣"
    denied(c.post(ROUTE,json=r))
    assert listed(bundle,limit=200)["population_case_count"]==6


@pytest.mark.parametrize("lexical",["1e400","NaN","Infinity"],ids=["overflow","nan","infinity"])
def test_nonfinite_json_distribution_denied_before_evaluation(bundle,lexical):
    c,w,b=bundle;r=request(w,b["identity"],distribution={"measure":"observed_span_hours","edges_hours":[0,1]})
    text=json.dumps(r).replace('[0, 1]','[0, '+lexical+']')
    denied(c.post(ROUTE,content=text.encode(),headers={"Content-Type":"application/json"}),"invalid_request")


def test_same_size_source_mutation_denies_cached_list_and_foreign_workspace(bundle,tmp_path):
    c,w,b=bundle
    assert listed(bundle)["population_case_count"]==6
    csv_files=list(Path(w["path"]).rglob("*.csv"));assert len(csv_files)==1
    source=csv_files[0];original=source.read_bytes();changed=original.replace(b"Request",b"Changed",1);assert len(changed)==len(original)
    source.write_bytes(changed)
    try:
        denied(c.post(ROUTE,json=request(w,b["identity"])),"source_unavailable")
    finally:source.write_bytes(original)
    other=tmp_path/"other";other.mkdir();r=envelope("open_workspace_request","other",path=str(other));foreign=checked(c.post("/api/workspaces/open",json=r),r)
    denied(c.post(ROUTE,json=request(foreign,b["identity"])),"preparation_unavailable")


def test_concurrent_reads_keep_query_revision_selection_and_frozen_parent_isolated(bundle):
    from concurrent.futures import ThreadPoolExecutor
    c,w,_=bundle
    a=select(bundle,[{"kind":"case_id_in","case_ids":["A"],"negate":False}],parent=["A","E"])
    b=select(bundle,[{"kind":"case_id_in","case_ids":["B"],"negate":False}],revision=3)
    ra=request(w,a["identity"],revision=10);ra["request_id"]="concurrent-a"
    rb=request(w,b["identity"],field="first_recorded_time",direction="ascending",revision=11);rb["request_id"]="concurrent-b"
    with ThreadPoolExecutor(max_workers=2) as pool:
        fa=pool.submit(c.post,ROUTE,json=ra);fb=pool.submit(c.post,ROUTE,json=rb)
        answer_a=checked(fa.result(),ra,LIST);answer_b=checked(fb.result(),rb,LIST)
    for answer,selected,cid,parent_count in [(answer_a,a,"A",2),(answer_b,b,"B",6)]:
        assert answer["identity"]==selected["identity"] and answer["parent_identity"]==selected["parent_identity"]
        assert [row["case_id"] for row in answer["rows"]]==[cid]
        assert answer["distribution"]["parent_case_count"]==parent_count
    assert answer_a["query"]==ra["query"] and answer_b["query"]==rb["query"]
