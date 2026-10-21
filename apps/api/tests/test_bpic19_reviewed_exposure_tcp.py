"""Exact T27 original-row controls over real TCP and two distinct OS processes.

No public prepared-feature route, evaluator stub, source-report execution or
built-browser/full-source qualification is claimed by this finite receipt.
"""
from copy import deepcopy
import csv
import hashlib
import io
import json
import os
from pathlib import Path
import socket
import zipfile

import httpx
import pytest

from import_requests import envelope
from test_bpic19_pipeline_http import start_process
from test_bpic19_reviewed_exposure import original_csv, review, selected, score, ROLES, HEADERS
from test_bpic19_scoring_http import prepare, read


def literal_row_ids(raw, positions):
    source = "source.v1:sha256:" + hashlib.sha256(raw).hexdigest()
    return ["row.v1:sha256:" + hashlib.sha256(json.dumps({"format_version": 1, "source_id": source, "source_position": position},
              sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest() for position in positions]


def exported(client, wid, run_id):
    response = client.post("/api/investigations/bpic19-export", json={**read(wid, run_id), "message_type": "bpic19_export_request"})
    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "application/zip"
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        return {name: archive.read(name) for name in archive.namelist()}


def tree(folder):
    return {str(path.relative_to(folder)): hashlib.sha256(path.read_bytes()).hexdigest() for path in folder.rglob("*") if path.is_file()}


@pytest.mark.parametrize("kind", ["item_025_25", "document_05_75", "p95_19_5"])
def test_original_value_controls_actual_exit_fresh_pid_exact_reopen_and_native_exports(tmp_path, kind):
    amounts = {"A":10,"B":90} if kind == "item_025_25" else {"A":10,"B":20,"C":90} if kind == "document_05_75" else {"A":10,"B":20}
    documents = {"A":"D","B":"D","C":"E"} if kind == "document_05_75" else None
    raw = original_csv(amounts, documents)
    rows = list(csv.reader(io.StringIO(raw.decode())))[1:]
    folder = tmp_path/"workspace"; folder.mkdir()
    with socket.socket() as sock: sock.bind(("127.0.0.1",0)); port=sock.getsockname()[1]
    first,_=start_process(port)
    live = httpx.Client(base_url=f"http://127.0.0.1:{port}",timeout=30)
    try:
        wid,base=prepare(live,folder,raw)
        parent=selected(live,wid,base,None)
        roles=deepcopy(ROLES)
        if kind == "p95_19_5": roles["net_worth"]=None
        reducer="maximum_absolute_event_value" if kind == "p95_19_5" else "unique_creation_value"
        ref=review(live,wid,parent,reducer,fit="selected",roles=roles)
        count=score(live,wid,base,population=parent)
        exposure_request=envelope("bpic19_score_request",workspace_id=wid,base_identity=base,named_population={"name":"Original reviewed value control","identity":parent},
            roles=roles,settings={"profile":"paper","criteria_family":"full","view":"Balanced","mode":"flat","gamma":0,"group_by":["company","spend_area"],"min_cases":1,
                "volume":"exposure","exposure_policy":"max_absolute_p95" if kind == "p95_19_5" else "creation_unique_value"},case_offset=0,case_limit=100,exposure_review=ref)
        response=live.post("/api/investigations/bpic19-score",json=exposure_request);assert response.status_code==200,response.text
        exposure=response.json()
        cases=exposure["report"]["case_page"]["cases"]
        assert len(cases)==len(amounts) and [case["case_id"] for case in cases]==list(amounts)
        assert [case["score"] for case in cases]==pytest.approx([.9,.95,1] if len(amounts)==3 else [.9,.95],abs=1e-8)
        expected_reference=.95 if kind=="document_05_75" else .925
        assert count["report"]["mean_score"]==exposure["report"]["mean_score"]==pytest.approx(expected_reference,abs=1e-8)
        by_company=lambda answer:{row["company"]:row for row in answer["report"]["groups"]}
        if kind=="item_025_25":
            assert by_company(count)["A"]["volume"]==1
            assert by_company(count)["A"]["PI"]==pytest.approx(.025,abs=1e-8)
            assert by_company(exposure)["A"]["volume"]==10
            assert by_company(exposure)["A"]["PI"]==pytest.approx(.25,abs=1e-8)
            assert by_company(count)["B"]["PI"]==by_company(exposure)["B"]["PI"]==0
        if kind=="document_05_75":
            d=lambda answer:next(row for row in answer["report"]["documents"] if row["document"]=="D")
            assert d(count)["mean_score"]==pytest.approx(.925,abs=1e-8)
            assert d(count)["volume"]==2 and d(exposure)["volume"]==30
            assert d(count)["PI"]==pytest.approx(.05,abs=1e-8) and d(exposure)["PI"]==pytest.approx(.75,abs=1e-8)
        receipt=exposure["report"]["exposure_calibration"]
        assert receipt["source_field"]==12 and receipt["source_column_name"]==HEADERS[12] and receipt["source_unit"]=="EUR"
        assert receipt["reviewed_measure_definition_id"]==ref["definition_id"] and receipt["reviewed_population_identity"]==parent
        assert receipt["fit_population_identity"]==parent
        assert receipt["source_value_missing_policy"]=="unavailable"
        creation_positions=[0,5,9] if len(amounts)==3 else [0,5]
        for case,position in zip(cases,creation_positions):
            assert case["value_evidence"]["creation_value"]["row_ids"]==literal_row_ids(raw,[position])
            c06=next(c for c in case["criteria"] if c["criterion_id"]=="C06")
            assert c06["row_ids"]==literal_row_ids(raw,[4]) if case["case_id"]=="A" else c06["row_ids"]==[]
        if kind=="p95_19_5":
            assert receipt["cutoff"]==pytest.approx(19.5,abs=1e-8)
            assert receipt["quantile_method"]=="linear" and receipt["quantile_position"]==.95
            assert receipt["population_case_ids"]==["A","B"] and receipt["population_identity"]==parent
            assert by_company(exposure)["A"]["volume"]==pytest.approx(10/19.5,abs=1e-8) and by_company(exposure)["B"]["volume"]==1
            assert receipt["value_row_ids"]==literal_row_ids(raw,range(9))
        source_history={}
        for case in amounts:
            response=live.post("/api/investigations/case-evidence",json=envelope("imported_case_evidence_request",workspace_id=wid,identity=base,case_id=case))
            assert response.status_code==200,response.text
            records=response.json()["records"]
            positions=[i for i,row in enumerate(rows) if row[0]==case]
            assert [row["source_position"] for row in records]==positions
            assert [row["row_id"] for row in records]==literal_row_ids(raw,positions)
            assert [row["original_cells"] for row in records]==[rows[i] for i in positions]
            source_history[case]=records
        selection=parent; predicates=[]; retained=[count,exposure]
        if kind=="p95_19_5":
            selection=selected(live,wid,base,["A"],["A","B"]);predicates=[{"kind":"case_id_in","case_ids":["A"],"negate":False}]
            response=live.post("/api/investigations/bpic19-score",json={**exposure_request,"named_population":{"name":"A after full-parent fit","identity":selection}})
            assert response.status_code==200,response.text
            child=response.json();retained.append(child)
            assert child["report"]["exposure_calibration"]==receipt
            assert by_company(child)["A"]["volume"]==pytest.approx(10/19.5,abs=1e-8)
        actions=[{"operation":"bpic19_score","identity":a["named_population"]["identity"],"definition_id":a["definition_id"],
            "selection_prefix_length":1 if a["named_population"]["identity"]==selection and predicates else 0,
            "query":{"run_id":a["run_id"],"case_offset":0,"case_limit":100}} for a in retained]
        save=envelope("save_investigation_request",workspace_id=wid,investigation_id=None,expected_revision_id=None,name="Exact original value "+kind,
            base_identity=base,selection_identity=selection,selection_recipe={"parent_case_ids":list(amounts),"predicates":predicates},
            context_policy="incident.context.first_record_in_declared_order.v1",comparison=None,notes="Independent original event fixture; native PI is not financial loss.",bookmarks=[],
            bpic19_pipeline={"schema_version":1,"actions":actions})
        saved_response=live.post("/api/investigations/save",json=save);assert saved_response.status_code==200,saved_response.text
        saved=saved_response.json()
        archives={a["run_id"]:exported(live,wid,a["run_id"]) for a in retained}
        before=tree(folder)
    finally:
        live.close();first.terminate();first.wait(timeout=15)
    assert first.returncode is not None
    second,_=start_process(port);fresh=httpx.Client(base_url=f"http://127.0.0.1:{port}",timeout=30)
    try:
        assert first.pid!=second.pid
        opened=fresh.post("/api/workspaces/open",json=envelope("open_workspace_request",path=str(folder)));assert opened.status_code==200,opened.text
        reopened=fresh.post("/api/investigations/reopen",json=envelope("reopen_investigation_request",workspace_id=wid,saved_revision_id=saved["revision"]["saved_revision_id"]))
        assert reopened.status_code==200,reopened.text
        assert reopened.json()["revision"]==saved["revision"] and reopened.json()["bpic19_outputs"]==saved["bpic19_outputs"]
        assert reopened.json()["restored_selection"]["kept"]["case_ids"]==(["A"] if kind=="p95_19_5" else list(amounts))
        for a in retained:
            reread=fresh.post("/api/investigations/bpic19-read",json={**read(wid,a["run_id"]),"case_limit":100});assert reread.status_code==200,reread.text
            actual=reread.json()
            assert actual["report"]==a["report"] and actual["definition"]==a["definition"] and actual["snapshot"]==a["snapshot"]
            assert exported(fresh,wid,a["run_id"])==archives[a["run_id"]]
        for case,records in source_history.items():
            evidence=fresh.post("/api/investigations/case-evidence",json=envelope("imported_case_evidence_request",workspace_id=wid,identity=base,case_id=case))
            assert evidence.status_code==200 and evidence.json()["records"]==records
        assert tree(folder)==before
        destination=os.environ.get("WISE_BPIC19_EXPOSURE_PROOF_DIR")
        if destination:
            proof=Path(destination);proof.mkdir(parents=True,exist_ok=True)
            (proof/(kind+".json")).write_text(json.dumps({"fixture":kind,"source_sha256":hashlib.sha256(raw).hexdigest(),"first_pid":first.pid,
                "first_exit":first.returncode,"second_pid":second.pid,"saved_revision":saved,"native_answers":retained,
                "raw_histories":source_history,"unchanged_workspace_sha256":before,"browser_qualified":False,"full_source_qualified":False},indent=2))
    finally:fresh.close();second.terminate();second.wait(timeout=15)
