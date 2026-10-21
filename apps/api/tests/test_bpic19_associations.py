"""Literal source fields → actual packed Method → frozen association descriptors."""
import csv
import io
from pathlib import Path
import json

from fastapi.testclient import TestClient
import pytest

from wise_platform_api import method
from wise_platform_api.bpic19_method import Bpic19Assessment, _transport
from wise_platform_api.bpic19_scoring import _store_artifact
from wise_platform_api.bpic19_associations import analyse_associations
from wise_platform_analytics.preparation import content_identity
from test_bpic19_scoring_http import app, prepare, read, raw_source, SETTINGS
from import_requests import envelope

VALUES={"t1":(.5,1),"t2":(0,None),"t3":(None,.5),"t4":(1,0),"t5":(0,0),"c1":(.25,0),"c2":(0,0)}


def literal_native_run(imports,wid,identity):
    """An independent two-Metric fixture; no arbitrary norm is accepted by an API."""
    prepared=imports.prepared(wid,identity["preparation_id"])[0]
    features=[]
    for cid in sorted(prepared.histories):
        original=prepared.histories[cid][0]
        measurements={}
        for key,column in (("A",13),("B",14)):
            cell=original.original_cells[column]
            value=float(cell) if cell else None
            measurements[key]={"value":value,"available":value is not None,"reason":None if value is not None else "empty_original_numeric_cell",
                               "row_ids":[original.row_id],"unit":"normalized_fixture_measurement","raw":cell,"source_column":column}
        features.append({"case_id":cid,"flow":"DF1","document":cid,"company":"target" if cid.startswith("t") else "comparator",
                         "spend_area":"Literal","record_count":1,"record_row_ids":[original.row_id],"measures":measurements, "representations":{"available":True,"exact_sequence":[original.activity],"first_occurrence_signature":[original.activity]}})
    norm={"schema_version":3,"missing_values":"three_valued","name":"independent.association.raw-numeric-fields.v1","version":"1","scoring_mode":"flat",
          "layers":[{"id":"Measurements"}],"views":[{"name":"Balanced","constraint_weights":{"A":.75,"B":.25}}],
          "constraints":[{"id":key,"layer":"Measurements","type":"metric","params":{"attribute":key,"threshold":0,"width":1,"direction":"high"}} for key in ("A","B")]}
    wise=method._wise();native_norm=wise.Norm.from_dict(norm);native_norm.validate()
    result=wise.score(_transport(features,None),native_norm,mode="flat",derive=False);result.check_decomposition()
    assessment=Bpic19Assessment({f["case_id"]:f for f in features},result,norm,"Balanced",0,["company","spend_area"],1,"cases",None,[])
    report=assessment.report(case_limit=1,group_limit=100000);report["requested_criterion_count"]=2;report["case_page"]["cases"]=[]
    workspace=imports.opened_workspace(wid)
    definition={"kind":"bpic19.native-snapshot.v3","norm":norm,"settings":SETTINGS,"roles":{},"base_identity":identity,"source_recipe":"literal original raw numeric columns 13/14; native metrics only"}
    did=content_identity("definition-version",definition);definition["definition_version_id"]=did;workspace.store_definition(definition)
    ids=sorted(prepared.histories)
    index={"case_ids":ids,"parent_case_ids":ids,"contexts":{f["case_id"]:{key:f[key] for key in ("company","spend_area","document")} for f in features},
           "criterion_members":{key:{"evaluated":result.violations.index[result.violations[key].notna()].tolist(),"positive":result.violations.index[result.violations[key].gt(0)].tolist(),"unavailable":result.violations.index[result.violations[key].isna()].tolist()} for key in ("A","B")}}
    refs=[_store_artifact(workspace,report,"report"),_store_artifact(workspace,index,"membership")]
    for chunk in assessment.case_chunks(500):refs.append({**_store_artifact(workspace,chunk,"cases"),"offset":chunk["offset"],"count":len(chunk["cases"])})
    rid=content_identity("score-run",{"fixture":"literal F21","definition":did,"identity":identity})
    run={"identity":{"run_id":rid,"format":"bpic19.native-snapshot.v3","definition_version_id":did,"base_identity":identity,"parent_identity":identity,"population_identity":identity},
         "definition_version":definition,"named_population":{"name":"Literal seven original items","identity":identity},"snapshot":{"format":"bpic19.native-snapshot.v3","artifacts":refs,"case_count":len(ids),"chunk_size":500}}
    workspace.store_run(run)
    return assessment,rid


def original_source(values=VALUES):
    rows=list(csv.reader(io.StringIO(raw_source().decode())))[:1]
    rows[0]+= ["Raw A","Raw B"]
    for cid,(a,b) in values.items():
        rows.append([cid,cid,"1","3-way match, invoice after GR","true","true","Standard","target" if cid.startswith("t") else "comparator","Literal","Observe numeric fields","2018-01-01T00:00:00Z","batch_1",10,"" if a is None else a,"" if b is None else b])
    output=io.StringIO(newline="");csv.writer(output).writerows(rows);return output.getvalue().encode()


def query(mode="jointly_eligible",support=1):
    return {"policy_id":"bpic19.frozen_native_associations.v1","target":{"name":"Target T","case_ids":["t1","t2","t3","t4","t5"]},
            "comparator":{"name":"Comparator C","case_ids":["c1","c2"]},"criteria":["A","B"],"positive_threshold":0,"min_support":support,"pair_mode":mode,"pooled_sd":True}


def test_literal_eligibility_native_contributions_contrasts_legacy_and_zero_variance(tmp_path):
    # Build raw source through the actual import service; then use the real native
    # two-Metric fixture so contributions cannot be a parallel platform scorer.
    from wise_platform_api.imports import Imports
    imports=Imports(forbidden=());workspace=tmp_path/"workspace";workspace.mkdir()
    with TestClient(app()) as client:
        wid,identity=prepare(client,workspace,original_source())
    imports.open_workspace(json.dumps(envelope("open_workspace_request",path=str(workspace))).encode())
    assessment,_=literal_native_run(imports,wid,identity)
    cases={cid:assessment.case(cid) for cid in VALUES}
    analysis=analyse_associations(cases,assessment.norm_document,query())
    a=analysis["populations"]["target"]["criteria"]["A"]
    assert (a["total_case_count"],a["eligible_case_count"],a["positive_case_count"],a["unavailable_case_count"])==(5,4,2,1)
    assert a["total_case_prevalence"]==.4 and a["eligible_firing_rate"]==.5
    assert a["eligible_mean_severity"]==.375 and a["conditional_positive_severity"]==.75 and a["unweighted_severity_sum"]==1.5
    assert a["unavailable_case_ids"]==["t3"]
    pair=analysis["accepted_pairs"][0]
    assert pair["universe_case_ids"]==["t1","t4","t5"] and pair["intersection_case_ids"]==["t1"] and pair["union_case_ids"]==["t1","t4"]
    assert pair["jaccard"]==.5 and pair["lift"]==1.5
    target=analysis["populations"]["target"]
    assert [row["native_penalty"] for row in target["native_item_penalties"]]==[.625,0,.5,.75,0]
    assert target["native_penalty_mass"]==1.875
    assert a["native_contribution_sum"]==1.125 and target["criteria"]["B"]["native_contribution_sum"]==.75
    contrast=analysis["contrasts"][0]
    assert contrast["mean_difference"]==.25 and contrast["eligible_firing_difference"]==0
    assert contrast["total_prevalence_difference"]==pytest.approx(-.1)
    assert a["raw_measurement_statistics"]["median"]==.25
    assert analysis["populations"]["comparator"]["criteria"]["A"]["raw_measurement_statistics"]["median"]==.125
    assert contrast["raw_median_difference"]==.125
    legacy=analyse_associations(cases,assessment.norm_document,query("legacy_total_case"))["accepted_pairs"][0]
    assert legacy["universe_case_count"]==5 and legacy["union_case_ids"]==["t1","t3","t4"]
    assert legacy["jaccard"]==pytest.approx(1/3) and legacy["lift"]==1.25
    suppressed=analyse_associations(cases,assessment.norm_document,query(support=2))
    assert suppressed["accepted_pairs"]==[] and suppressed["suppressed_pairs"][0]["intersection_case_ids"]==["t1"]
    zero_workspace=tmp_path/"zero-workspace";zero_workspace.mkdir()
    zero_values={cid:(1 if cid.startswith("t") else 0,b) for cid,(_,b) in VALUES.items()}
    with TestClient(app()) as client:zwid,zidentity=prepare(client,zero_workspace,original_source(zero_values))
    imports.open_workspace(json.dumps(envelope("open_workspace_request",path=str(zero_workspace))).encode())
    zero_assessment,_=literal_native_run(imports,zwid,zidentity)
    zero_cases={cid:zero_assessment.case(cid) for cid in zero_values}
    magnitude=analyse_associations(zero_cases,zero_assessment.norm_document,query())["contrasts"][0]
    assert magnitude["mean_difference"]==1 and magnitude["pooled_sample_sd_magnitude"]["value"] is None
    assert magnitude["pooled_sample_sd_magnitude"]["reason"]=="zero_pooled_variance"


def test_association_http_derived_run_reuses_native_chunks_and_reopens_exact_recipe(tmp_path,monkeypatch):
    from wise_platform_api.imports import Imports
    from wise_platform_api.bpic19_scoring import register_bpic19_scoring_routes
    from fastapi import FastAPI,Request
    from fastapi.responses import JSONResponse
    workspace=tmp_path/"workspace";workspace.mkdir()
    with TestClient(app()) as initial:wid,identity=prepare(initial,workspace,original_source())
    imports=Imports(forbidden=());imports.open_workspace(json.dumps(envelope("open_workspace_request",path=str(workspace))).encode())
    _,rid=literal_native_run(imports,wid,identity)
    application=FastAPI();register_bpic19_scoring_routes(application,imports)
    q=query();q["target"]["selector"]={"kind":"case_ids","case_ids":q["target"].pop("case_ids")};q["comparator"]["selector"]={"kind":"case_ids","case_ids":q["comparator"].pop("case_ids")}
    given=envelope("bpic19_association_request","associate",3,workspace_id=wid,run_id=rid,query=q,case_offset=0,case_limit=100)
    monkeypatch.setattr("wise_platform_api.bpic19_scoring.evaluate_features",lambda *a,**k:pytest.fail("Association must never rescore"))
    with TestClient(application) as client:
        response=client.post("/api/investigations/bpic19-associate",json=given)
        assert response.status_code==200,response.text
        answer=response.json();assert answer["run_id"]!=rid
        analysis=answer["report"]["association_analysis"]
        assert analysis["source_native_run_id"]==rid and analysis["accepted_pairs"][0]["lift"]==1.5
        selected=client.post("/api/investigations/bpic19-read",json=read(wid,answer["run_id"],case_filter={"association_set":{"population":"target","state":"all","pair":{"left":"A","right":"B","set":"intersection"}}}))
        assert selected.status_code==200,selected.text
        assert [case["case_id"] for case in selected.json()["report"]["case_page"]["cases"]]==["t1"]
        source_chunks={ref["sha256"] for ref in imports.opened_workspace(wid).run(rid)["snapshot"]["artifacts"] if ref["kind"]=="cases"}
        assert source_chunks=={ref["sha256"] for ref in answer["snapshot"]["artifacts"] if ref["kind"]=="cases"}
    with TestClient(app()) as fresh:
        fresh.post("/api/workspaces/open",json=envelope("open_workspace_request",path=str(workspace)))
        reopened=fresh.post("/api/investigations/bpic19-read",json=read(wid,answer["run_id"]))
        assert reopened.status_code==200,reopened.text
        assert reopened.json()["report"]["association_analysis"]==analysis


def test_actual_public_process_restart_reopens_frozen_association_and_review(tmp_path):
    import os,socket,subprocess,sys,time,httpx,zipfile
    from wise_platform_api.imports import Imports
    from test_bpic19_scoring_http import ROOT
    workspace=tmp_path/"workspace";workspace.mkdir()
    with TestClient(app()) as initial:wid,identity=prepare(initial,workspace,original_source())
    imports=Imports(forbidden=());imports.open_workspace(json.dumps(envelope("open_workspace_request",path=str(workspace))).encode())
    _,rid=literal_native_run(imports,wid,identity)
    env={**os.environ,"PYTHONPATH":str(ROOT/"apps/api/src")+os.pathsep+str(ROOT/"packages/analytics/src")}
    def start():
        with socket.socket() as sock:sock.bind(("127.0.0.1",0));port=sock.getsockname()[1]
        process=subprocess.Popen([sys.executable,"-m","uvicorn","wise_platform_api.app:create_app","--factory","--host","127.0.0.1","--port",str(port),"--log-level","warning"],cwd=ROOT,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        client=httpx.Client(base_url=f"http://127.0.0.1:{port}",timeout=30)
        for _ in range(100):
            if process.poll() is not None:raise AssertionError("Public API exited before readiness")
            try:
                if client.get("/api/health").status_code==200:return process,client
            except httpx.TransportError:pass
            time.sleep(.05)
        process.terminate();process.wait(timeout=10);raise AssertionError("Public API not ready")
    first,client=start()
    try:
        client.post("/api/workspaces/open",json=envelope("open_workspace_request",path=str(workspace)))
        q=query();q["target"]["selector"]={"kind":"case_ids","case_ids":q["target"].pop("case_ids")};q["comparator"]["selector"]={"kind":"case_ids","case_ids":q["comparator"].pop("case_ids")}
        response=client.post("/api/investigations/bpic19-associate",json=envelope("bpic19_association_request",workspace_id=wid,run_id=rid,query=q,case_offset=0,case_limit=100))
        assert response.status_code==200,response.text
        associated=response.json();original_row=associated["report"]["case_page"]["cases"][0]
        evidence={"case_ids":[original_row["case_id"]],"row_ids":original_row["record_row_ids"],"criterion_ids":["A"]}
        empty={"case_ids":[],"row_ids":[],"criterion_ids":[]}
        review={"policy_id":"bpic19.user_entered_interpretation.v1","mandatory_controls":[{"criterion_id":"A","mandatory":True,"rationale":"Explicit owner rule","evidence":evidence}],"findings":[{"id":"finding-1","title":"Review recorded difference","observation":{"status":"observed","note":"Mean severity difference .25","evidence":evidence},"proposed_change":{"status":"proposed","note":"Investigate timing","evidence":empty},"adoption":{"status":"unknown","note":"","evidence":empty},"tested_outcome":{"status":"untested","note":"","evidence":empty}}]}
        reply=client.post("/api/investigations/bpic19-review",json=envelope("bpic19_review_request",workspace_id=wid,run_id=associated["run_id"],review=review,case_offset=0,case_limit=100))
        assert reply.status_code==200,reply.text
        reviewed=reply.json();assert reviewed["run_id"]!=associated["run_id"]
        assert reviewed["report"]["case_page"]==associated["report"]["case_page"]
        assert reviewed["report"]["association_analysis"]==associated["report"]["association_analysis"]
        bad=json.loads(json.dumps(review));bad["findings"][0]["observation"]["evidence"]["row_ids"]=["another-source-row"]
        refused=client.post("/api/investigations/bpic19-review",json=envelope("bpic19_review_request",workspace_id=wid,run_id=reviewed["run_id"],review=bad,case_offset=0,case_limit=100))
        assert refused.status_code==400
        export=client.post("/api/investigations/bpic19-export",json=envelope("bpic19_export_request",workspace_id=wid,run_id=reviewed["run_id"],case_offset=0,case_limit=100))
        assert export.status_code==200
        with zipfile.ZipFile(io.BytesIO(export.content)) as archive:
            manifest=json.loads(archive.read("manifest.json"));assert manifest["identity"]["run_id"]==reviewed["run_id"]
            assert manifest["definition_version"]["derived_recipe"]["review"]==review
    finally:client.close();first.terminate();first.wait(timeout=10)
    assert first.poll() is not None
    second,fresh=start()
    try:
        assert second.pid!=first.pid
        fresh.post("/api/workspaces/open",json=envelope("open_workspace_request",path=str(workspace)))
        response=fresh.post("/api/investigations/bpic19-read",json=read(wid,reviewed["run_id"]))
        assert response.status_code==200,response.text
        reopened=response.json();assert reopened["report"]==reviewed["report"]
        assert reopened["definition"]==reviewed["definition"] and reopened["snapshot"]==reviewed["snapshot"]
        selected=fresh.post("/api/investigations/bpic19-read",json=read(wid,reviewed["run_id"],case_filter={"association_set":{"population":"target","state":"all","pair":{"left":"A","right":"B","set":"intersection"}}}))
        assert [case["case_id"] for case in selected.json()["report"]["case_page"]["cases"]]==["t1"]
    finally:fresh.close();second.terminate();second.wait(timeout=10)


def test_literal_native_representation_penalty_mean_mass_and_unscored_members(tmp_path):
    from wise_platform_api.imports import Imports
    workspace=tmp_path/"workspace";workspace.mkdir()
    values={"t1":(.2,None),"t2":(.8,None),"c1":(None,None)}
    with TestClient(app()) as client:wid,identity=prepare(client,workspace,original_source(values))
    imports=Imports(forbidden=());imports.open_workspace(json.dumps(envelope("open_workspace_request",path=str(workspace))).encode())
    assessment,_=literal_native_run(imports,wid,identity)
    for kind in ("exact","signature"):
        group=assessment.representation_scores(kind)[0]
        assert group["member_count"]==3 and group["scored_case_count"]==2 and group["unscored_case_count"]==1
        assert group["mean_score"]==pytest.approx(.5)
        assert group["mean_penalty"]==pytest.approx(.5) and group["summed_penalty_mass"]==pytest.approx(1)
        assert group["native_penalty_mass"]["A"]==pytest.approx(1)


def test_paper_all_evaluable_medians_and_df2_packaging_context_complement_never_rescore(tmp_path,monkeypatch):
    from datetime import datetime,timedelta,timezone
    from test_bpic19_scoring_http import given
    rows=list(csv.reader(io.StringIO(raw_source().decode())))[:1]
    for cid,flow,spend,lag in (("P1","after","Packaging",10),("P2","before","Packaging",90),("P3","before","Packaging",None),("O1","after","Outside",70),("O2","before","Outside",30)):
        events=[("Record Goods Receipt",0),("Record Invoice Receipt",1)]+([] if lag is None else [("Clear Invoice",lag+1)])
        for label,day in events:
            rows.append([cid,cid,"1",f"3-way match, invoice {flow} GR","true","true","Standard","0000",spend,label,(datetime(2018,1,1,tzinfo=timezone.utc)+timedelta(days=day)).isoformat(),"batch_1",100])
    source=io.StringIO(newline="");csv.writer(source).writerows(rows)
    workspace=tmp_path/"workspace";workspace.mkdir()
    with TestClient(app()) as client:
        wid,identity=prepare(client,workspace,source.getvalue().encode())
        response=client.post("/api/investigations/bpic19-score",json=given(wid,identity))
        assert response.status_code==200,response.text
        native=response.json()
        monkeypatch.setattr("wise_platform_api.bpic19_scoring.evaluate_features",lambda *a,**k:pytest.fail("Median comparison must never rescore"))
        q={"policy_id":"bpic19.frozen_native_associations.v1","target":{"name":"All Packaging","selector":{"kind":"group","group_values":{"spend_area":"Packaging"}}},"comparator":{"name":"All outside Packaging","selector":{"kind":"outside_target"}},"criteria":["C04"],"positive_threshold":0,"min_support":1,"pair_mode":"jointly_eligible","pooled_sd":True}
        first=client.post("/api/investigations/bpic19-associate",json=envelope("bpic19_association_request",workspace_id=wid,run_id=native["run_id"],query=q,case_offset=0,case_limit=100))
        assert first.status_code==200,first.text
        p=first.json()["report"]["association_analysis"]["populations"]
        assert (p["target"]["case_count"],p["target"]["criteria"]["C04"]["eligible_case_count"])==(3,2)
        assert p["target"]["criteria"]["C04"]["raw_measurement_statistics"]["median"]==50
        assert p["target"]["criteria"]["C04"]["positive_case_ids"]==["P2"]  # positive-only median would be90
        assert p["comparator"]["criteria"]["C04"]["raw_measurement_statistics"]["median"]==50
        q["target"]={"name":"DF2 Packaging","selector":{"kind":"group","group_values":{"flow":"DF2","spend_area":"Packaging"}}}
        q["comparator"]={"name":"DF2 outside Packaging","selector":{"kind":"group","group_values":{"flow":"DF2"},"exclude_group_values":{"spend_area":"Packaging"}}}
        second=client.post("/api/investigations/bpic19-associate",json=envelope("bpic19_association_request",workspace_id=wid,run_id=native["run_id"],query=q,case_offset=0,case_limit=100))
        assert second.status_code==200,second.text
        result=second.json();analysis=result["report"]["association_analysis"];p=analysis["populations"]
        assert p["target"]["case_ids"]==["P2","P3"] and p["comparator"]["case_ids"]==["O2"]
        assert p["target"]["criteria"]["C04"]["eligible_case_ids"]==["P2"]
        assert p["target"]["criteria"]["C04"]["unavailable_case_ids"]==["P3"]
        assert p["target"]["criteria"]["C04"]["raw_measurement_statistics"]["median"]==90
        assert p["comparator"]["criteria"]["C04"]["raw_measurement_statistics"]["median"]==30
        assert analysis["contrasts"][0]["raw_median_difference"]==60
        assert result["report"]["mean_score"]==native["report"]["mean_score"]
        assert result["report"]["groups"]==native["report"]["groups"]
        assert result["report"]["case_page"]==native["report"]["case_page"]
        assert result["report"]["norm_fingerprint"]==native["report"]["norm_fingerprint"]
