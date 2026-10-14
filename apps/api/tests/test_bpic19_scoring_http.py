"""Independent raw records → real HTTP → packed Method → durable artifacts.

These finite fixtures are not full-source or built-browser qualification receipts.
"""
import csv
from copy import deepcopy
import io
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
import zipfile

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient
from jsonschema import Draft202012Validator
import pytest
import httpx

from wise_platform_api.bpic19_scoring import register_bpic19_scoring_routes
from wise_platform_api.imports import Imports
from import_requests import envelope, policies

ROOT = Path(__file__).resolve().parents[3]
VALIDATOR = Draft202012Validator(json.loads((ROOT / "contracts/bpic19-scoring.schema.json").read_text()))
ROLES = {"source_case": 0, "purchasing_document": 1, "item": 2, "item_category": 3,
         "goods_receipt": 4, "gr_based_iv": 5, "item_type": 6, "company": 7, "spend_area": 8,
         "resource": 11, "net_worth": 12, "value": 12}
SETTINGS = {"profile": "paper", "criteria_family": "full", "view": "Balanced", "mode": "flat", "gamma": 0,
            "group_by": ["company", "spend_area"], "min_cases": 1, "volume": "cases", "exposure_policy": "max_absolute_p95"}


def app():
    application = FastAPI()
    imports = Imports(forbidden=())
    # The real import service and real scoring routes, with no evaluator mock.
    @application.post("/api/workspaces/open")
    async def open_workspace(request: Request):
        answer = imports.open_workspace(await request.body())
        return JSONResponse(answer.body, status_code=answer.status)
    @application.put("/api/sources")
    async def upload(request: Request):
        answer = imports.upload_source(request.query_params.multi_items(), request.headers.get("content-type"), await request.body())
        return JSONResponse(answer.body, status_code=answer.status)
    @application.post("/api/preparations")
    async def confirm(request: Request):
        answer = imports.confirm_mapping(await request.body())
        return JSONResponse(answer.body, status_code=answer.status)
    @application.post("/api/investigations/open-population")
    async def population(request: Request):
        answer = imports.open_population(await request.body())
        return JSONResponse(answer.body, status_code=answer.status)
    register_bpic19_scoring_routes(application, imports)
    return application


def raw_source(extra=()):
    """F29-Raw: 19 independent original records, four flows, mixed document D."""
    cases = {
        "A": ("D", "00010", "3-way match, invoice after GR", "true", "true", "Packaging", 10,
              [("Record Goods Receipt", "01-01", "user_1"), ("Vendor creates invoice", "01-11", "user_2"),
               ("Record Invoice Receipt", "01-21", "UNKNOWN"), ("Clear Invoice", "03-22", "batch_1")]),
        "B": ("D", "00020", "3-way match, invoice before GR", "true", "true", "Packaging", 20,
              [("Create Purchase Order Item", "01-01", "user_1"), ("Record Invoice Receipt", "01-02", "user_1"),
               ("Record Goods Receipt", "01-03", "batch_1"), ("Remove Payment Block", "01-05", "batch_1"), ("Clear Invoice", "01-10", "user_2")]),
        "C": ("E", "00010", "2-way match", "false", "false", "Logistics", 30,
              [("Create Purchase Order Item", "01-01", "user_3"), ("Vendor creates invoice", "01-02", "user_3"),
               ("Record Invoice Receipt", "01-03", "batch_1"), ("Record Goods Receipt", "01-04", "user_4"), ("Clear Invoice", "01-05", "user_4")]),
        "D": ("F", "00010", "Consignment", "true", "false", "MRO", 40,
              [("Create Purchase Order Item", "01-01", "batch_1"), ("Record Goods Receipt", "01-02", "batch_1"),
               ("Cancel Goods Receipt", "01-03", "batch_1"), ("Delete Purchase Order Item", "01-04", "batch_1"), ("Clear Invoice", "01-05", "batch_1")]),
    }
    output = io.StringIO(newline="")
    writer = csv.writer(output)
    writer.writerow(["case", "case Purchasing Document", "case Item", "case Item Category", "case Goods Receipt",
                     "case GR-Based IV", "case Item Type", "case Company", "case Spend area text", "activity", "time",
                     "event org:resource", "event Cumulative net worth (EUR)"])
    for case, (doc, item, category, gr, iv, spend, amount, events) in cases.items():
        for activity, date, resource in events:
            writer.writerow([case, doc, item, category, gr, iv, "Standard", "0000", spend, activity,
                             "2018-" + date + "T00:00:00Z", resource, amount])
    writer.writerows(extra)
    return output.getvalue().encode()


def prepare(client, workspace, raw=None):
    wid = client.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(workspace))).json()["workspace_id"]
    source = client.put("/api/sources", params=envelope("upload_source_metadata", workspace_id=wid, filename="f29-raw.csv"),
                        content=raw_source() if raw is None else raw, headers={"Content-Type": "application/octet-stream"})
    assert source.status_code == 200, source.text
    confirmed = client.post("/api/preparations", json=envelope("confirm_mapping_request", workspace_id=wid,
        source_id=source.json()["source"]["source_id"], dialect={"encoding": "utf-8", "delimiter": ",", "quotechar": '"', "header": "first_record"},
        mapping={"case_column": 0, "activity_column": 9, "timestamp_column": 10, "sequence_column": None, "context_columns": [1,2,3,4,5,6,7,8,11,12]},
        policies=policies("iso8601", None), accept_report_issues=True))
    assert confirmed.status_code == 200, confirmed.text
    opened = client.post("/api/investigations/open-population", json=envelope("open_population_request", workspace_id=wid,
        preparation_id=confirmed.json()["preparation"]["preparation_id"]))
    assert opened.status_code == 200, opened.text
    return wid, opened.json()["identity"]


def given(wid, identity, **settings):
    return envelope("bpic19_score_request", "native-1", 1, workspace_id=wid, base_identity=identity,
                    named_population={"name": "F29 raw four flows", "identity": identity}, roles=deepcopy(ROLES),
                    settings={**SETTINGS, **settings}, case_offset=0, case_limit=100)


def read(wid, run_id, **fields):
    return envelope("bpic19_read_request", "native-read", 2, workspace_id=wid, run_id=run_id, case_offset=0, case_limit=100, **fields)


def criterion(case, key):
    return next(c for c in case["criteria"] if c["criterion_id"] == key)


def test_all_29_raw_cells_four_flows_all_views_and_distinct_invoice_witnesses(tmp_path):
    workspace = tmp_path / "workspace"; workspace.mkdir()
    with TestClient(app()) as client:
        wid, identity = prepare(client, workspace)
        response = client.post("/api/investigations/bpic19-score", json=given(wid, identity, profile="historical", mode="layer_balanced", view="Finance"))
        assert response.status_code == 200, response.text
        answer = response.json(); VALIDATOR.validate(answer)
        cases = {c["case_id"]: c for c in answer["report"]["case_page"]["cases"]}
        # Literal scope oracle in source catalogue order. O = outside scope;
        # these constants do not call the production raw or scoring operators.
        expected = {
            "c_l1_invoice_present": [0,0,0,None], "c_l1_clear_invoice_present": [0,0,0,None],
            "c_l1_goods_or_ses_present": [0,0,None,None],
            "c_l2_df1_invoice_after_goods": [0,None,None,None], "c_l2_df2_release_after_goods": [None,0,None,None],
            "c_l2_2way_no_goods_expected": [None,None,1,None], "c_l2_consignment_no_clear_invoice": [None,None,None,1],
            "c_l3_df1_goods_to_invoice_days": [0,None,None,None], "c_l3_invoice_to_clear_days": [2/3,0,0,None],
            "c_l3_df2_goods_to_rpb_days": [None,0,None,None], "c_l3_df2_rpb_to_clear_days": [None,0,None,None],
            "c_l4_goods_fragmentation": [0,0,None,0], "c_l4_change_approval_repeats": [0,0,0,0],
            "c_l4_repeated_invoice_receipt": [0,0,0,None], "c_l4_change_payment_terms_repeats": [0,0,0,0],
            "c_l5_cancel_invoice_receipt": [0,0,0,None], "c_l5_cancel_goods_receipt": [0,0,None,1],
            "c_l5_delete_item": [0,0,0,1], "c_l5_debit_memo": [0,0,0,0], "c_l5_credit_memo": [0,0,0,0],
            "c_l6_change_price": [0,0,0,0], "c_l6_change_quantity": [0,0,0,0],
            "c_l6_high_exposure_memo": [0,0,0,0], "c_l6_high_exposure_price_change": [0,0,0,0],
            "c_l7_manual_touches": [0,0,0,0], "c_l7_distinct_human_resources": [.25,0,0,0],
            "c_l7_total_events": [0,0,0,0], "c_l7_manual_share": [.5,.2,.6,0],
            "c_l6_bal_networth_volatility": [0,0,0,None],
        }
        raw = {
            "c_l1_invoice_present": [2,1,2,0], "c_l1_clear_invoice_present": [1,1,1,1],
            "c_l1_goods_or_ses_present": [1,1,1,1],
            "c_l2_df1_invoice_after_goods": [0,1,1,None], "c_l2_df2_release_after_goods": [None,0,None,None],
            "c_l2_2way_no_goods_expected": [1,1,1,1], "c_l2_consignment_no_clear_invoice": [1,1,1,1],
            "c_l3_df1_goods_to_invoice_days": [10,None,None,None], "c_l3_invoice_to_clear_days": [70,8,3,None],
            "c_l3_df2_goods_to_rpb_days": [None,2,None,None], "c_l3_df2_rpb_to_clear_days": [None,5,None,None],
            "c_l4_goods_fragmentation": [1,1,1,1], "c_l4_change_approval_repeats": [0,0,0,0],
            "c_l4_repeated_invoice_receipt": [1,1,1,0], "c_l4_change_payment_terms_repeats": [0,0,0,0],
            "c_l5_cancel_invoice_receipt": [0,0,0,0], "c_l5_cancel_goods_receipt": [0,0,0,1],
            "c_l5_delete_item": [0,0,0,1], "c_l5_debit_memo": [0,0,0,0], "c_l5_credit_memo": [0,0,0,0],
            "c_l6_change_price": [0,0,0,0], "c_l6_change_quantity": [0,0,0,0],
            "c_l6_high_exposure_memo": [0,0,0,0], "c_l6_high_exposure_price_change": [0,0,0,0],
            "c_l7_manual_touches": [3,3,4,0], "c_l7_distinct_human_resources": [3,2,2,0],
            "c_l7_total_events": [4,5,5,5], "c_l7_manual_share": [.75,.6,.8,0], "c_l6_bal_networth_volatility": [0,0,0,0],
        }
        weights = {"Finance": [.24,.08,.24,.06,.08,.24,.06], "Logistics": [.08,.24,.22,.22,.08,.04,.12],
                   "Compliance": [.12,.30,.10,.06,.26,.06,.10], "Automation": [.06,.08,.10,.28,.06,.08,.34]}
        layer_penalties = {"A": [0,0,1/2.8,0,0,0,.725/4.4], "B": [0,0,0,0,0,0,.18/4.4],
                           "C": [0,1,0,0,0,0,.54/4.4], "D": [None,1,None,0,2.1/4.5,0,0]}
        for position, (key, case) in enumerate(cases.items()):
            assert len(case["criteria"]) == 29
            assert case["coverage"] == 1
            for cid, values in expected.items():
                verdict = criterion(case, cid)
                assert verdict["measurement"] == (pytest.approx(raw[cid][position], abs=1e-8) if raw[cid][position] is not None else None)
                assert set(verdict["row_ids"]) <= set(case["record_row_ids"])
                if values[position] is not None:
                    assert verdict["measurement_evidence"].get("available", True)
                if values[position] is None:
                    assert verdict["reason"] == "out_of_scope" and verdict["deviation"] is None
                else:
                    assert verdict["deviation"] == pytest.approx(values[position], abs=1e-8)
                    assert verdict["in_scope"] and verdict["reason"] == "evaluated"
            for view, layer_weights in weights.items():
                eligible = [(p,w) for p,w in zip(layer_penalties[key], layer_weights) if p is not None]
                expected_score = 1 - sum(p*w for p,w in eligible)/sum(w for _,w in eligible)
                assert case["scores"][view] == pytest.approx(expected_score, abs=1e-8)
        assert criterion(cases["A"], "c_l3_invoice_to_clear_days")["measurement"] == 70
        assert criterion(cases["A"], "c_l7_manual_touches")["measurement"] == 3
        assert criterion(cases["A"], "c_l7_distinct_human_resources")["measurement"] == 3
        assert criterion(cases["A"], "c_l7_manual_share")["measurement"] == .75
        assert [sum(c["in_scope"] for c in cases[key]["criteria"]) for key in "ABCD"] == [24,25,20,16]
        paper = client.post("/api/investigations/bpic19-score", json=given(wid, identity)).json()
        a = paper["report"]["case_page"]["cases"][0]
        assert criterion(a,"C04")["measurement"] == 60
        assert criterion(a,"C04")["row_ids"][0] != criterion(cases["A"],"c_l3_invoice_to_clear_days")["row_ids"][0]
        assert criterion(a,"C09")["deviation"] is None
        assert paper["run_id"] != answer["run_id"]


def test_native_runs_reopen_without_evaluation_export_complete_and_corrupt_artifact_refuses(tmp_path, monkeypatch):
    workspace = tmp_path / "workspace"; workspace.mkdir()
    with TestClient(app()) as client:
        wid, identity = prepare(client, workspace)
        reply = client.post("/api/investigations/bpic19-score", json=given(wid, identity))
        assert reply.status_code == 200, reply.text
        answer = reply.json()
        member = client.post("/api/investigations/bpic19-read", json=read(wid, answer["run_id"], case_filter={"group_values": {"document": "D"}}))
        assert member.status_code == 200, member.text
        assert [c["case_id"] for c in member.json()["report"]["case_page"]["cases"]] == ["A", "B"]
        assert member.json()["report"]["mean_score"] == answer["report"]["mean_score"]
        export_request = {**read(wid, answer["run_id"]), "message_type": "bpic19_export_request"}
        exported = client.post("/api/investigations/bpic19-export", json=export_request)
        assert exported.status_code == 200
        with zipfile.ZipFile(io.BytesIO(exported.content)) as archive:
            manifest = json.loads(archive.read("manifest.json"))
            assert manifest["identity"]["run_id"] == answer["run_id"]
            assert len(archive.namelist()) == 1 + len(manifest["snapshot"]["artifacts"])
    # Distinct service object coverage, not an OS-process durability receipt.
    monkeypatch.setattr("wise_platform_api.bpic19_scoring.evaluate_features", lambda *a, **k: pytest.fail("Read must not evaluate"))
    with TestClient(app()) as fresh:
        assert fresh.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(workspace))).status_code == 200
        reopened = fresh.post("/api/investigations/bpic19-read", json=read(wid, answer["run_id"]))
        assert reopened.status_code == 200, reopened.text
        assert reopened.json()["report"] == answer["report"]
        ref = next(r for r in answer["snapshot"]["artifacts"] if r["kind"] == "cases")
        artifact = workspace / "score-run-artifacts" / ref["filename"]
        artifact.write_bytes(b"changed")
        refused = fresh.post("/api/investigations/bpic19-read", json=read(wid, answer["run_id"]))
        assert refused.status_code == 409 and refused.json()["code"] == "artifact_unavailable"
        assert artifact.read_bytes() == b"changed"


def test_partial_families_known_presence_and_local_unknown_counts_through_http(tmp_path):
    workspace = tmp_path / "workspace"; workspace.mkdir()
    raw = raw_source([
        ["X","G","1","3-way match, invoice after GR","true","true","Standard","0000","Missing labels","Record Invoice Receipt","2018-01-01T00:00:00Z","batch_1",10],
        ["X","G","1","3-way match, invoice after GR","true","true","Standard","0000","Missing labels","Record Goods Receipt","2018-01-01T00:00:00Z","batch_1",10],
        ["X","G","1","3-way match, invoice after GR","true","true","Standard","0000","Missing labels","","2018-01-02T00:00:00Z","batch_1",10],
        ["X","G","1","3-way match, invoice after GR","true","true","Standard","0000","Missing labels","Cancel Invoice Receipt","2018-01-03T00:00:00Z","batch_1",10],
    ])
    with TestClient(app()) as client:
        wid, identity = prepare(client, workspace, raw)
        answers = []
        for family, count in (("completion",3),("completion_timing",5),("completion_rework_effort",8),("full",10)):
            reply = client.post("/api/investigations/bpic19-score", json=given(wid, identity, criteria_family=family))
            assert reply.status_code == 200, reply.text
            a = reply.json(); answers.append(a)
            assert a["report"]["admitted_criterion_count"] == count
            x = next(c for c in a["report"]["case_page"]["cases"] if c["case_id"] == "X")
            assert criterion(x,"C01")["deviation"] == criterion(x,"C03")["deviation"] == 0
            assert criterion(x,"C02")["deviation"] is None
            if count == 3:
                assert x["score"] == 1 and x["coverage"] == pytest.approx(2/3)
                assert criterion(x,"C01")["effective_weight"] == .5
            if family in {"completion_rework_effort","full"}:
                assert criterion(x,"C06")["deviation"] == 1
                assert criterion(x,"C07")["deviation"] is None
                assert criterion(x,"C08")["deviation"] is None
                assert criterion(x,"C01")["measurement_evidence"]["unknown_row_ids"]
        assert len({a["definition_id"] for a in answers}) == 4
        bad = given(wid, identity); bad["roles"]["resource"] = True
        refused = client.post("/api/investigations/bpic19-score", json=bad)
        assert refused.status_code == 400 and refused.json()["code"] == "invalid_request"
        VALIDATOR.validate(refused.json())


def test_public_application_actual_process_exit_and_fresh_pid_reopens_snapshot(tmp_path):
    """Real root HTTP routing and distinct OS processes; browser remains a separate receipt."""
    workspace = tmp_path / "workspace"; workspace.mkdir()
    env = {**os.environ, "PYTHONPATH": str(ROOT / "apps/api/src") + os.pathsep + str(ROOT / "packages/analytics/src")}
    def start():
        with socket.socket() as sock:
            sock.bind(("127.0.0.1",0)); port = sock.getsockname()[1]
        process = subprocess.Popen([sys.executable,"-m","uvicorn","wise_platform_api.app:create_app","--factory",
                                    "--host","127.0.0.1","--port",str(port),"--log-level","warning"],
                                   cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        client = httpx.Client(base_url=f"http://127.0.0.1:{port}", timeout=30)
        for _ in range(100):
            if process.poll() is not None: raise AssertionError("The real public service could not start")
            try:
                if client.get("/api/health").status_code == 200: return process,client
            except httpx.TransportError: pass
            time.sleep(.05)
        process.terminate(); process.wait(timeout=10)
        raise AssertionError("The real public service did not become ready")
    first, client = start()
    try:
        wid, identity = prepare(client, workspace)
        scored = client.post("/api/investigations/bpic19-score", json=given(wid,identity))
        assert scored.status_code == 200, scored.text
        original = scored.json()
    finally:
        client.close(); first.terminate(); first.wait(timeout=10)
    assert first.poll() is not None
    second, fresh = start()
    try:
        assert second.pid != first.pid
        assert fresh.post("/api/workspaces/open", json=envelope("open_workspace_request",path=str(workspace))).status_code == 200
        reopened = fresh.post("/api/investigations/bpic19-read",json=read(wid,original["run_id"]))
        assert reopened.status_code == 200, reopened.text
        assert reopened.json()["report"] == original["report"]
        assert reopened.json()["definition"] == original["definition"]
        assert reopened.json()["snapshot"] == original["snapshot"]
    finally:
        fresh.close(); second.terminate(); second.wait(timeout=10)


def test_scored_signature_join_retains_exact_baseline_and_never_refits_on_inspection(tmp_path):
    workspace = tmp_path / "workspace"; workspace.mkdir()
    extra = []
    for case, sequence in (("X",["A","B","A"]),("Y",["A","B"])):
        for day, label in enumerate(sequence,1):
            extra.append([case,"G",case,"3-way match, invoice after GR","true","true","Standard","0000","Synthetic path",label,
                          f"2018-01-0{day}T00:00:00Z","batch_1",10])
    with TestClient(app()) as client:
        wid,identity=prepare(client,workspace,raw_source(extra))
        reply=client.post("/api/investigations/bpic19-score",json=given(wid,identity))
        assert reply.status_code == 200,reply.text
        answer=reply.json();VALIDATOR.validate(answer)
        exact=[group for group in answer["report"]["representation_scores"]["exact"] if group["sequence"] in [["A","B","A"],["A","B"]]]
        assert len(exact) == 2 and all(group["member_count"] == 1 for group in exact)
        signature=next(group for group in answer["report"]["representation_scores"]["signature"] if group["sequence"] == ["A","B"])
        assert signature["member_count"] == signature["scored_case_count"] == 2
        assert signature["record_count"] == 5 and signature["unscored_case_count"] == 0
        assert signature["mean_score"] == .625
        assert signature["native_penalty_mass"]["C01"] == .25
        assert signature["global_mean"] == answer["report"]["mean_score"]
        inspected=client.post("/api/investigations/bpic19-read",json=read(wid,answer["run_id"],case_filter={"representation_group":{"kind":"signature","group_id":signature["group_id"]}}))
        assert inspected.status_code == 200,inspected.text
        assert [case["case_id"] for case in inspected.json()["report"]["case_page"]["cases"]] == ["X","Y"]
        assert inspected.json()["run_id"] == answer["run_id"]
        assert inspected.json()["report"]["mean_score"] == answer["report"]["mean_score"]


def test_exact_creation_exposure_recipes_and_parent_linear_p95_are_distinct_through_http(tmp_path):
    workspace=tmp_path/"workspace";workspace.mkdir()
    rows=list(csv.reader(io.StringIO(raw_source().decode())))[:1]
    events={"X":[("Create Purchase Order Item",1,100),("Create Purchase Order Item",2,100),("Record Goods Receipt",3,100),
                 ("Record Invoice Receipt",4,100),("Clear Invoice",5,100),("Cancel Invoice Receipt",6,120)],
            "Y":[("Create Purchase Order Item",1,90),("Record Goods Receipt",2,90),("Record Invoice Receipt",3,90),("Clear Invoice",4,90)]}
    for case,history in events.items():
        for activity,day,value in history:
            rows.append([case,case,"1","3-way match, invoice after GR","true","true","Standard",case,"Packaging",activity,
                         f"2018-01-0{day}T00:00:00Z","batch_1",str(value)])
    output=io.StringIO(newline="");csv.writer(output).writerows(rows)
    with TestClient(app()) as client:
        wid,identity=prepare(client,workspace,output.getvalue().encode())
        count=client.post("/api/investigations/bpic19-score",json=given(wid,identity)).json()
        failed=client.post("/api/investigations/bpic19-score",json=given(wid,identity,volume="exposure",exposure_policy="creation_unique_event"))
        assert failed.status_code == 400 and "cannot become zero" in failed.json()["message"]
        valued=client.post("/api/investigations/bpic19-score",json=given(wid,identity,volume="exposure",exposure_policy="creation_unique_value"))
        assert valued.status_code == 200,valued.text
        result=valued.json();assert result["run_id"] != count["run_id"]
        assert result["report"]["mean_score"] == count["report"]["mean_score"] == .95
        x=next(group for group in result["report"]["groups"] if group["company"] == "X")
        assert x["mean_score"] == .9 and x["volume"] == 100 and x["PI"] == pytest.approx(5)
        normalized=client.post("/api/investigations/bpic19-score",json=given(wid,identity,volume="exposure",exposure_policy="max_absolute_p95"))
        assert normalized.status_code == 200,normalized.text
        receipt=normalized.json()["report"]["exposure_calibration"]
        assert receipt["cutoff"] == 118.5 and receipt["quantile_method"] == "linear"
        assert receipt["population_case_ids"] == ["X","Y"]
