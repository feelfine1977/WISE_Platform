"""Public declared-input arithmetic: genuine TCP, Method, storage and process exit."""
from copy import deepcopy
from fractions import Fraction
import hashlib
import io
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
import zipfile

import httpx

from import_requests import envelope

FIXTURE = Path(__file__).resolve().parents[3] / "tests/fixtures/bpic19-prepared-arithmetic"
INPUT = json.loads((FIXTURE / "input.json").read_text())
EXPECTED = json.loads((FIXTURE / "expected.json").read_text())
PREFIX = "/api/investigations/bpic19-prepared"
VIEWS = ("Finance", "Logistics", "Compliance", "Automation")
UNITS = {"elapsed_days":"days", "normalized_proxy":"normalized_proxy"}
SPECIAL = {"c_l2_df1_invoice_after_goods":"boolean_observation", "c_l2_df2_release_after_goods":"boolean_observation", "c_l7_manual_touches":"resource_proxy_events", "c_l7_distinct_human_resources":"resource_proxy_identities",
           "c_l7_manual_share":"share_of_original_events", "c_l6_bal_networth_volatility":"coefficient_of_variation"}


def rows():
    result=[]
    for flow in ("DF1","DF2","two_way","Consignment"):
        ref="declared-assessment:"+flow
        result.append({"assessment_item_id":"declared-"+flow,"assessment_row_ref":ref,"flow":flow,
            "measurements":{rule["criterion_id"]:{"state":"available","value":float(Fraction(str(rule["raw"]))) if rule["semantic_unit"] in {"elapsed_days","ratio","normalized_proxy"} else int(rule["raw"]),
                "reason":None,"unit":SPECIAL.get(rule["criterion_id"],UNITS.get(rule["semantic_unit"],"event_occurrences")),
                "provenance":{"kind":"declared_prepared_measurement","declaration_ref":rule["declared_measurement_ref"],"assessment_row_refs":[ref],"original_row_refs":[]}}
                for rule in INPUT["rules"]}})
    return result


def record(name,value):
    directory=os.environ.get("BPIC_PREPARED_EVIDENCE_DIR")
    if directory:
        path=Path(directory);path.mkdir(parents=True,exist_ok=True);(path/(name+".json")).write_text(json.dumps(value,indent=2)+"\n")


_HTTP_NUMBER = 0


def capture(response):
    """Optional external execution receipt; synthetic request/answer bytes only."""
    global _HTTP_NUMBER
    directory=os.environ.get("BPIC_PREPARED_EVIDENCE_DIR")
    if not directory:return
    response.read();_HTTP_NUMBER+=1;path=Path(directory);path.mkdir(parents=True,exist_ok=True)
    prefix="http-"+str(_HTTP_NUMBER).zfill(3)
    (path/(prefix+"-request.body")).write_bytes(response.request.content)
    (path/(prefix+"-response.body")).write_bytes(response.content)
    record(prefix,{"method":response.request.method,"path":response.request.url.path,"status":response.status_code,
        "request_sha256":hashlib.sha256(response.request.content).hexdigest(),"response_sha256":hashlib.sha256(response.content).hexdigest(),
        "response_bytes":len(response.content),"content_type":response.headers.get("content-type")})


def start(port, label):
    process=subprocess.Popen([sys.executable,"-m","uvicorn","wise_platform_api.app:create_app","--factory","--host","127.0.0.1","--port",str(port),"--log-level","error"],stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
    record(label+"-start",{"pid":process.pid,"port":port,"started_ns":time.time_ns()})
    for _ in range(200):
        assert process.poll() is None,process.stderr.read().decode()
        try:
            response=httpx.get(f"http://127.0.0.1:{port}/api/health",timeout=.2)
            if response.status_code==200:return process
        except httpx.HTTPError:pass
        time.sleep(.025)
    process.terminate();process.wait(timeout=5);raise AssertionError("Public server did not become ready")


def stop(process,label):
    process.terminate();code=process.wait(timeout=10);record(label+"-stop",{"pid":process.pid,"actual_exit_code":code,"alive":process.poll() is None,"stopped_ns":time.time_ns()})
    assert process.poll() is not None


def send(client,path,body,status=200):
    response=client.post(PREFIX+path,json=body)
    assert response.status_code==status,response.text
    return response.json()


def request(kind,wid,**values):return envelope("bpic19_prepared_"+kind+"_request",workspace_id=wid,**values)


def test_real_http_review_native_all_views_save_export_and_distinct_pid_reopen(tmp_path):
    folder=tmp_path/"workspace";folder.mkdir()
    with socket.socket() as sock:sock.bind(("127.0.0.1",0));port=sock.getsockname()[1]
    first=start(port,"first")
    try:
        with httpx.Client(base_url=f"http://127.0.0.1:{port}",timeout=30,event_hooks={"response":[capture]}) as client:
            opened=client.post("/api/workspaces/open",json=envelope("open_workspace_request",path=str(folder)));assert opened.status_code==200,opened.text
            wid=opened.json()["workspace_id"]
            reviewed=send(client,"/review",request("review",wid,rows=rows()))
            assert reviewed["basis"]["kind"]=="declared_prepared_attributes"
            assert reviewed["input"]["rows"]==rows()
            input_id=reviewed["input"]["content_id"]; references=[]; originals={}; export_bytes={}
            assert set(reviewed["basis"])=={"kind","input_id","assessment_item_ids"}
            for view in VIEWS:
                answer=send(client,"/run",request("run",wid,input_id=input_id,profile_id="bpic19.notebook.1.0-paper-aligned.v1",catalogue_sha256="498d0464d11ede078bf75818d0b329ff946077ffbe93a4b6f5f4aaf27eeddaef",mode="layer_balanced",view=view))
                references.append(answer["reference"]);originals[view]=answer
                assert len(answer["definition"]["criteria"])==29 and len(answer["definition"]["layer_weights"])==7
                assert answer["definition"]["method_artifact"]["eligible_release"] is False
                for case in answer["cases"]:
                    flow=case["flow"];cells={c["criterion_id"]:c for c in case["criteria"]}
                    assert {c:cell["native_in_scope"] for c,cell in cells.items()}==EXPECTED["flow_scope_matrix"][flow]
                    assert all(cell["native_evaluated"]==cell["native_in_scope"] for cell in cells.values())
                    assert case["coverage"]==1 and case["coverage_state"]=="complete"
                    assert not any(cell["provenance"]["original_row_refs"] for cell in cells.values())
                    assert abs(sum(x["value"] for x in case["layer_contributions"])-(1-case["score"]))<=1e-8
                    if flow=="DF1":
                        assert abs(case["score"]-float(Fraction(EXPECTED["baseline"]["scores"][view]["exact"])))<=1e-8
                        for c,expected in EXPECTED["baseline"]["criterion_contributions"][view].items():assert abs(cells[c]["native_penalty"]-float(Fraction(expected)))<=1e-8
                        for expected in EXPECTED["baseline"]["cells"]:
                            if expected["in_scope"]:assert abs(cells[expected["criterion_id"]]["native_deviation"]-float(Fraction(expected["deviation"])))<=1e-8
                page=send(client,"/read",request("read",wid,run_id=answer["reference"]["run_id"],offset=1,limit=1))
                assert page["cases"]==answer["cases"][1:2] and page["next_offset"]==2 and page["total"]==4
                for format in ["json","markdown","native_zip"]:
                    exported=client.post(PREFIX+"/export",json=request("export",wid,run_id=answer["reference"]["run_id"],format=format));assert exported.status_code==200,exported.text
                    export_bytes[(view,format)]=exported.content
                    if format=="json":
                        bundle=exported.json();assert bundle["reference"]==answer["reference"] and bundle["output"]["cases"]==answer["cases"]
                    elif format=="markdown":assert input_id in exported.text and "declared" in exported.text.lower()
                    else:
                        with zipfile.ZipFile(io.BytesIO(exported.content)) as archive:
                            manifest=json.loads(archive.read("manifest.json"));assert manifest["reference"]==answer["reference"]
                            for entry in manifest["files"]:assert hashlib.sha256(archive.read(entry["filename"])).hexdigest()==entry["sha256"]
            assert len({r["run_id"] for r in references})==4 and len({r["definition_id"] for r in references})==4
            # A real source supplies investigation context, with disjoint membership.
            from test_bpic19_scoring_http import prepare
            wid2,base=prepare(client,folder);assert wid2==wid
            population=client.post("/api/investigations/open-population",json=envelope("open_population_request",workspace_id=wid,preparation_id=base["preparation_id"])).json()
            context_ids=population["population"]["case_ids"];assert set(context_ids).isdisjoint(reviewed["basis"]["assessment_item_ids"])
            selected=client.post("/api/investigations/select-cases",json=envelope("select_cases_request",workspace_id=wid,identity=base,parent_case_ids=None,predicates=[]));assert selected.status_code==200,selected.text
            save=envelope("save_investigation_request",workspace_id=wid,investigation_id=None,expected_revision_id=None,name="Declared arithmetic, source context only",base_identity=base,selection_identity=selected.json()["identity"],selection_recipe={"parent_case_ids":context_ids,"predicates":[]},context_policy="incident.context.first_record_in_declared_order.v1",comparison=None,notes="Declared inputs are not raw event histories.",bookmarks=[],bpic19_prepared_assessments=references)
            saved=client.post("/api/investigations/save",json=save);assert saved.status_code==200,saved.text;saved=saved.json()
            assert saved["revision"]["content"]["bpic19_prepared_assessments"]==references
            assert saved["bpic19_prepared_outputs"]["assessment_item_ids"]==reviewed["basis"]["assessment_item_ids"]
            assert "bpic19_pipeline" not in saved["revision"]["content"]
            record("first-answer",{"input_id":input_id,"references":references,"saved_revision_id":saved["revision"]["saved_revision_id"],"workspace":str(folder),"context_ids":context_ids,"declared_ids":reviewed["basis"]["assessment_item_ids"]})
    finally:stop(first,"first")

    second=start(port,"second")
    try:
        assert second.pid!=first.pid and first.poll() is not None
        with httpx.Client(base_url=f"http://127.0.0.1:{port}",timeout=30,event_hooks={"response":[capture]}) as client:
            assert client.post("/api/workspaces/open",json=envelope("open_workspace_request",path=str(folder))).status_code==200
            reopened=client.post("/api/investigations/reopen",json=envelope("reopen_investigation_request",workspace_id=wid,saved_revision_id=saved["revision"]["saved_revision_id"]));assert reopened.status_code==200,reopened.text
            assert reopened.json()["revision"]==saved["revision"] and reopened.json()["bpic19_prepared_outputs"]==saved["bpic19_prepared_outputs"]
            for view,original in originals.items():
                reread=send(client,"/read",request("read",wid,run_id=original["reference"]["run_id"],offset=0,limit=100))
                for key in ["reference","basis","definition","cases"]:assert reread[key]==original[key]
                for format in ["json","markdown","native_zip"]:
                    exported=client.post(PREFIX+"/export",json=request("export",wid,run_id=original["reference"]["run_id"],format=format));assert exported.status_code==200,exported.text
                    assert exported.content==export_bytes[(view,format)]
            record("reopen-answer",{"first_pid":first.pid,"second_pid":second.pid,"references":references,"reopened_revision":reopened.json()["revision"]})
    finally:stop(second,"second")


def test_public_refusals_and_missing_values_preserve_declared_basis(tmp_path):
    from fastapi.testclient import TestClient
    from wise_platform_api.app import create_app
    folder=tmp_path/"workspace";folder.mkdir()
    with TestClient(create_app()) as client:
        wid=client.post("/api/workspaces/open",json=envelope("open_workspace_request",path=str(folder))).json()["workspace_id"]
        original=rows();reviewed=send(client,"/review",request("review",wid,rows=original))
        artifacts_before={p.name for p in (folder/"score-run-artifacts").glob("*")}
        displayed=send(client,"/review",request("review",wid,rows=original,presentation_order=list(reversed(reviewed["basis"]["assessment_item_ids"]))))
        assert displayed["input"]["content_id"]==reviewed["input"]["content_id"] and {p.name for p in (folder/"score-run-artifacts").glob("*")}==artifacts_before
        assert all(binding["label"].strip() for binding in displayed["bindings"])
        base=request("run",wid,input_id=reviewed["input"]["content_id"],profile_id="bpic19.notebook.1.0-paper-aligned.v1",catalogue_sha256="498d0464d11ede078bf75818d0b329ff946077ffbe93a4b6f5f4aaf27eeddaef",mode="layer_balanced",view="Finance")
        for change in [{"mode":"flat"},{"scores":[1]},{"norm":{"code":"anything"}},{"view":"custom"},{"layer_weights":[1]},{"rows":original}]:
            refused=send(client,"/run",{**base,**change},400);assert refused["code"]=="invalid_request"
        refused=send(client,"/run",{**base,"input_id":"bpic19-prepared-input.v1:sha256:"+"a"*64},404);assert refused["code"]=="input_unavailable"
        bad=deepcopy(original);bad[0]["measurements"]["c_l1_invoice_present"]["provenance"]["original_row_refs"]=[{"source_id":"source.v1:sha256:"+"a"*64,"row_id":"row.v1:sha256:"+"b"*64}]
        refused=send(client,"/review",request("review",wid,rows=bad),400);assert refused["code"]=="unsupported_policy"
        # A declared missing measurement is not a synthetic event or numeric zero.
        missing=deepcopy(original[:1]);missing[0]["measurements"]["c_l2_df1_invoice_after_goods"].update(state="unavailable",value=None,reason="missing_endpoint")
        reviewed_missing=send(client,"/review",request("review",wid,rows=missing));assert reviewed_missing["input"]["content_id"]!=reviewed["input"]["content_id"]
        answer=send(client,"/run",{**base,"input_id":reviewed_missing["input"]["content_id"]});case=answer["cases"][0];cell=next(c for c in case["criteria"] if c["criterion_id"]=="c_l2_df1_invoice_after_goods")
        assert cell["native_in_scope"] is True and cell["native_evaluated"] is False and cell["native_deviation"] is None
        assert cell["declared_reason"]=="missing_endpoint" and cell["declared_value"] is None
        assert case["coverage"] is None and case["coverage_state"]=="partial_not_qualified" and case["score_state"]=="partial_evidence"
        # A finite long duration is admitted without inventing an execution horizon.
        long=deepcopy(original[:1]);long[0]["measurements"]["c_l3_df1_goods_to_invoice_days"]["value"]=1000000
        long_review=send(client,"/review",request("review",wid,rows=long));long_answer=send(client,"/run",{**base,"input_id":long_review["input"]["content_id"]})
        cell=next(c for c in long_answer["cases"][0]["criteria"] if c["criterion_id"]=="c_l3_df1_goods_to_invoice_days");assert cell["native_evaluated"] is True and cell["native_deviation"]==1


def test_stored_input_corruption_refuses_without_rescore_or_repair(tmp_path,monkeypatch):
    from fastapi.testclient import TestClient
    from wise_platform_api.app import create_app
    from wise_platform_api import bpic19_prepared_runs as runs
    folder=tmp_path/"workspace";folder.mkdir()
    with TestClient(create_app()) as client:
        wid=client.post("/api/workspaces/open",json=envelope("open_workspace_request",path=str(folder))).json()["workspace_id"]
        reviewed=send(client,"/review",request("review",wid,rows=rows()))
        answer=send(client,"/run",request("run",wid,input_id=reviewed["input"]["content_id"],profile_id="bpic19.notebook.1.0-paper-aligned.v1",catalogue_sha256="498d0464d11ede078bf75818d0b329ff946077ffbe93a4b6f5f4aaf27eeddaef",mode="layer_balanced",view="Finance"))
        def forbidden(*args,**kwargs):raise AssertionError("Stored read/export must never invoke native scoring")
        monkeypatch.setattr(runs,"_native",forbidden)
        body=request("read",wid,run_id=answer["reference"]["run_id"],offset=0,limit=100)
        assert send(client,"/read",body)["cases"]==answer["cases"]
        exported=client.post(PREFIX+"/export",json=request("export",wid,run_id=answer["reference"]["run_id"],format="native_zip"));assert exported.status_code==200
        review_file=next((folder/"definitions").glob("*.json"));before=review_file.read_bytes();damaged=before[:-1]+b'!';review_file.write_bytes(damaged)
        refused=send(client,"/read",body,409);assert refused["code"]=="checksum_mismatch"
        assert review_file.read_bytes()==damaged
        review_file.write_bytes(before)
        run_file=folder/"score-runs"/(answer["reference"]["run_id"].rsplit(":",1)[1]+".json")
        run_before=run_file.read_bytes();run_file.write_bytes(run_before[:-1]+b'!')
        refused=send(client,"/read",body,409);assert refused["code"]=="checksum_mismatch";assert run_file.read_bytes()!=run_before
        run_file.write_bytes(run_before)
        run_record=json.loads(run_before)["record"];output=folder/"score-run-artifacts"/run_record["artifact"]["filename"];raw=output.read_bytes()
        output.unlink();refused=send(client,"/read",body,409);assert refused["code"]=="artifact_unavailable";assert not output.exists()
        output.write_bytes(raw[:-1]+bytes([raw[-1]^1]));refused=send(client,"/read",body,409);assert refused["code"]=="checksum_mismatch"
        output.write_bytes(raw)
        assert send(client,"/read",body)["cases"]==answer["cases"]


def test_saved_prepared_references_refuse_foreign_manifest_stale_revision_and_missing_artifact(tmp_path,monkeypatch):
    from fastapi.testclient import TestClient
    from wise_platform_api.app import create_app
    from wise_platform_api import bpic19_prepared_runs as runs
    from test_bpic19_scoring_http import prepare
    folder=tmp_path/"workspace";folder.mkdir()
    with TestClient(create_app()) as client:
        wid,base=prepare(client,folder)
        selected=client.post("/api/investigations/select-cases",json=envelope("select_cases_request",workspace_id=wid,identity=base,parent_case_ids=None,predicates=[])).json()
        reviewed=send(client,"/review",request("review",wid,rows=rows()))
        run=send(client,"/run",request("run",wid,input_id=reviewed["input"]["content_id"],profile_id="bpic19.notebook.1.0-paper-aligned.v1",catalogue_sha256="498d0464d11ede078bf75818d0b329ff946077ffbe93a4b6f5f4aaf27eeddaef",mode="layer_balanced",view="Finance"))
        def forbidden(*args,**kwargs):raise AssertionError("Saving/reopen cannot call Method scoring")
        monkeypatch.setattr(runs,"_native",forbidden)
        given=envelope("save_investigation_request",workspace_id=wid,investigation_id=None,expected_revision_id=None,name="Prepared references",base_identity=base,selection_identity=selected["identity"],selection_recipe={"parent_case_ids":["A","B","C","D"],"predicates":[]},context_policy="incident.context.first_record_in_declared_order.v1",comparison=None,notes="Context only",bookmarks=[],bpic19_prepared_assessments=[run["reference"]])
        for references,code in [(None,"invalid_request"),([run["reference"],run["reference"]],"invalid_request"),([{**run["reference"],"input_id":"bpic19-prepared-input.v1:sha256:"+"a"*64}],"identity_mismatch")]:
            reply=client.post("/api/investigations/save",json={**given,"bpic19_prepared_assessments":references});assert reply.status_code in {400,409},reply.text;assert reply.json()["code"]==code
        assert not list((folder/"investigations/revisions").glob("*.json"))
        saved=client.post("/api/investigations/save",json=given);assert saved.status_code==200,saved.text;saved=saved.json()
        update={**given,"investigation_id":saved["revision"]["investigation_id"],"expected_revision_id":saved["revision"]["saved_revision_id"],"notes":"New retained note"}
        later=client.post("/api/investigations/save",json=update);assert later.status_code==200,later.text
        stale=client.post("/api/investigations/save",json=update);assert stale.status_code==409 and stale.json()["code"]=="revision_conflict"
        old_bytes={p.name:p.read_bytes() for p in (folder/"investigations/revisions").glob("*.json")}
        run_file=folder/"score-runs"/(run["reference"]["run_id"].rsplit(":",1)[1]+".json");recorded=json.loads(run_file.read_bytes())["record"];artifact=folder/"score-run-artifacts"/recorded["artifact"]["filename"];artifact.unlink()
        refused=client.post("/api/investigations/reopen",json=envelope("reopen_investigation_request",workspace_id=wid,saved_revision_id=later.json()["revision"]["saved_revision_id"]));assert refused.status_code==409,refused.text;assert refused.json()["code"]=="artifact_unavailable"
        assert not artifact.exists() and {p.name:p.read_bytes() for p in (folder/"investigations/revisions").glob("*.json")}==old_bytes


def test_optional_presentation_null_is_not_an_implicit_default(tmp_path):
    from fastapi.testclient import TestClient
    from wise_platform_api.app import create_app
    folder=tmp_path/"workspace";folder.mkdir()
    with TestClient(create_app()) as client:
        wid=client.post("/api/workspaces/open",json=envelope("open_workspace_request",path=str(folder))).json()["workspace_id"]
        refused=send(client,"/review",request("review",wid,rows=rows(),presentation_order=None),400)
        assert refused["code"]=="invalid_request" and refused["field"]=="presentation_order"
