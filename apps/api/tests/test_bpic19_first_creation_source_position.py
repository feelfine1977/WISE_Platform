"""Literal PANEL original-source-position creation recipe, never R07 financial matching."""
import csv
import hashlib
import io
import json
import os
from pathlib import Path
import socket
import time
import zipfile

import httpx

from import_requests import envelope
from test_bpic19_pipeline_http import start_process
from test_bpic19_scoring_http import prepare, given, ROLES, read

POLICY = "first_creation_source_position"
EXPOSURE = "creation_first_source_position"
HEADERS = ["case concept:name", "case Purchasing Document", "case Item", "case Item Category",
           "case Goods Receipt", "case GR-Based Inv. Verif.", "case Item Type", "case Company",
           "case Spend area text", "event concept:name", "event time:timestamp", "event org:resource",
           "event Cumulative net worth (EUR)"]


def literal():
    def event(case, amount, day, activity="Create Purchase Order Item"):
        return [case, case, "001", "3-way match, invoice after GR", "TRUE", "TRUE", "Standard",
                case, "Panel occurrence proof", activity, "" if day is None else f"2018-01-{day:02}T00:00:00Z", "batch_1", amount]
    # A's first original creation is later in time. B's amounts share a timestamp.
    # Missing/invalid first cells cannot be replaced by later finite candidates.
    rows = [event("A", "100", 3), event("A", "120", 1), event("B", "100", 1), event("B", "120", 1),
            event("E", "100", 1), event("E", "100", 1), event("M", "", 2), event("M", "100", 1),
            event("I", "NaN", 2), event("I", "100", 1), event("P", "1,200", 2), event("P", "100", 1),
            event("N", "-5", 1), event("N", "9", 2), event("Z", "0", 1), event("Z", "9", 2),
            event("G", "10", 1), event("G", "20", 2, "Record Goods Receipt"),
            event("L", "100", 1), event("L", "Infinity", 2), event("U", "100", None), event("U", "120", 1)]
    stream = io.StringIO(newline=""); writer = csv.writer(stream); writer.writerow(HEADERS); writer.writerows(rows)
    return stream.getvalue().encode(), rows


def row_ids(raw, positions):
    source = "source.v1:sha256:" + hashlib.sha256(raw).hexdigest()
    return ["row.v1:sha256:" + hashlib.sha256(json.dumps({"format_version": 1, "source_id": source,
        "source_position": position}, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest() for position in positions]


def select(client, wid, base, ids, selected=None):
    request = envelope("select_cases_request", workspace_id=wid, identity=base, parent_case_ids=ids,
        predicates=[] if selected is None else [{"kind":"case_id_in", "case_ids":selected, "negate":False}])
    response = client.post("/api/investigations/select-cases", json=request)
    assert response.status_code == 200, response.text
    return response.json()


def measure(client, wid, parent, reducer):
    query = {"policy_id":"bpic19.source_witnessed_measures.v1", "measure_profile":"paper_v1", "roles":ROLES,
        "offset":0, "limit":100, "calibration_population":"selected", "value_reducer":reducer,
        "value_unit":"declared anonymized EUR", "value_band_edges":[10, 110]}
    response = client.post("/api/investigations/bpic19-measures", json=envelope("bpic19_measures_request",
        workspace_id=wid, identity=parent, query=query))
    assert response.status_code == 200, response.text
    answer = response.json()
    return answer, {"identity":parent, "query":query, "definition_id":answer["definition_id"]}


def native(client, wid, base, parent, review=None):
    request = given(wid, base, volume="exposure", exposure_policy=EXPOSURE)
    request["named_population"] = {"name":"Explicit panel first-source exposure", "identity":parent}
    if review is not None: request["exposure_review"] = review
    return client.post("/api/investigations/bpic19-score", json=request)


def evidence_recorder():
    """Optional qualification receipt output; normal tests write only tmp_path."""
    destination = os.environ.get("WISE_FIRST_CREATION_EVIDENCE")
    folder = None if destination is None else Path(destination)
    if folder is not None: folder.mkdir(parents=True, exist_ok=False)
    sequence = 0
    def record(name, value):
        if folder is not None:
            (folder / (name + ".json")).write_text(json.dumps(value, indent=2, allow_nan=False) + "\n")
    def received(response):
        nonlocal sequence
        response.read(); sequence += 1
        if folder is not None:
            name = f"http-{sequence:02}"
            request = response.request
            (folder / (name + "-request.body")).write_bytes(request.content)
            (folder / (name + "-response.body")).write_bytes(response.content)
            record(name, {"method": request.method, "path": request.url.path, "status": response.status_code,
                "request_sha256": hashlib.sha256(request.content).hexdigest(),
                "response_sha256": hashlib.sha256(response.content).hexdigest(), "observed_ns": time.time_ns()})
    return record, {"response": [received]} if folder is not None else {}


def exported(client, wid, run_id):
    response = client.post("/api/investigations/bpic19-export", json={**read(wid, run_id), "message_type":"bpic19_export_request"})
    assert response.status_code == 200, response.text
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        return {name: hashlib.sha256(archive.read(name)).hexdigest() for name in archive.namelist()}


def test_panel_source_position_is_distinct_finite_witnessed_and_survives_real_restart(tmp_path):
    raw, original = literal(); ids=["A","B","E","G","I","L","M","N","P","U","Z"]
    record, hooks = evidence_recorder()
    record("literal", {"source_sha256":hashlib.sha256(raw).hexdigest(), "headers":HEADERS, "rows":original,
        "expected_first_values":{"A":100,"B":100,"E":100,"G":10,"L":100,"U":100,"Z":0,"N":-5,"M":None,"I":None,"P":None}})
    workspace=tmp_path/"workspace"; workspace.mkdir()
    with socket.socket() as sock: sock.bind(("127.0.0.1",0)); port=sock.getsockname()[1]
    first,_=start_process(port)
    record("first-start", {"pid":first.pid,"port":port,"started_ns":time.time_ns()})
    try:
        with httpx.Client(base_url=f"http://127.0.0.1:{port}", timeout=30, event_hooks=hooks) as client:
            wid,base=prepare(client,workspace,raw); parent=select(client,wid,base,ids)["identity"]
            first_value,ref=measure(client,wid,parent,POLICY)
            cases={case["case_id"]:case for case in first_value["cases"]}
            policy=first_value["definition"]["first_creation_policy"]
            assert policy == {"policy_id":"bpic19.panel_first_creation_source_position.v1", "authority":"panel_product_decision",
                "order":"original_source_position_ascending", "duplicate_policy":"retain_all_creation_records",
                "selected_value_policy":"first_candidate_only_no_fallback", "negative_value_policy":"preserve_sign_in_raw_measure"}
            expected={"A":(100,0),"B":(100,2),"E":(100,4),"G":(10,16),"L":(100,18),"U":(100,20),"Z":(0,14),"N":(-5,12)}
            for cid,(value,position) in expected.items():
                m=cases[cid]["measures"]["selected_value"]
                assert m["available"] is True and m["value"]==value
                assert m["first_candidate_row_id"]==row_ids(raw,[position])[0]
                assert m["first_candidate_source_position"]==position
                assert m["winner_row_ids"]==row_ids(raw,[position])
                assert m["policy_id"]==policy["policy_id"] and m["reducer"]==POLICY
            for cid,reason,position in [("M","missing_value",6),("I","invalid_nonfinite",8),("P","invalid_numeric",10)]:
                m=cases[cid]["measures"]["selected_value"]
                assert m["value"] is None and m["available"] is False and m["reason"]==reason
                assert m["first_candidate_row_id"]==row_ids(raw,[position])[0]
                assert m["first_candidate_source_position"]==position and m["winner_row_ids"]==[]
            assert cases["A"]["measures"]["selected_value"]["row_ids"]==row_ids(raw,[0,1])
            assert cases["A"]["record_row_ids"]==row_ids(raw,[1,0])  # chronological view differs deliberately
            assert cases["B"]["measures"]["selected_value"]["candidate_count"]==2
            assert cases["E"]["measures"]["selected_value"]["row_ids"]==row_ids(raw,[4,5])  # no dedup
            assert cases["L"]["measures"]["selected_value"]["invalid_row_ids"]==row_ids(raw,[19])
            json.dumps(first_value,allow_nan=False)  # Textual NaN remains a raw witness, never a JSON number.
            old={};refs={POLICY:ref}
            for reducer in ["unique_creation_event","unique_creation_value","maximum_absolute_event_value"]:
                old[reducer],refs[reducer]=measure(client,wid,parent,reducer)
            assert len({first_value["definition_id"],*[a["definition_id"] for a in old.values()]})==4
            oldcases={r:{c["case_id"]:c for c in a["cases"]} for r,a in old.items()}
            assert oldcases["unique_creation_value"]["A"]["measures"]["selected_value"]["reason"]=="conflicting_creation_values"
            assert oldcases["unique_creation_event"]["E"]["measures"]["selected_value"]["reason"]=="creation_event_not_unique"
            assert oldcases["maximum_absolute_event_value"]["G"]["measures"]["selected_value"]["value"]==20
            for a in old.values():
                assert "first_creation_policy" not in a["definition"]
                assert all("first_candidate_row_id" not in c["measures"]["selected_value"] for c in a["cases"])
            # New native recipe is unusable without the exact explicitly reviewed panel receipt.
            eligible=["A","B","E","G","L","U","Z"]; child=select(client,wid,base,ids,eligible)
            missing=native(client,wid,base,child["identity"])
            assert missing.status_code in {400,409} and missing.json()["code"]=="unsupported_policy",missing.text
            mismatched=native(client,wid,base,child["identity"],refs["unique_creation_value"])
            assert mismatched.status_code in {400,409} and mismatched.json()["code"]=="unsupported_policy",mismatched.text
            for cid in ["M","I","P","N"]:
                invalid=select(client,wid,base,ids,[cid]); refused=native(client,wid,base,invalid["identity"],ref)
                assert refused.status_code in {400,409} and refused.json()["code"] in {"invalid_parameter","exposure_unavailable"},refused.text
            scored=native(client,wid,base,child["identity"],ref); assert scored.status_code==200,scored.text
            run=scored.json(); receipt=run["report"]["exposure_calibration"]
            assert receipt["policy"]==EXPOSURE and receipt["value_reducer"]==POLICY
            assert receipt["first_creation_policy"]==policy and receipt["source_unit"]=="declared anonymized EUR"
            nativecases={c["case_id"]:c for c in run["report"]["case_page"]["cases"]}
            assert nativecases["A"]["value_evidence"][EXPOSURE]==cases["A"]["measures"]["selected_value"]
            assert next(g for g in run["report"]["groups"] if g["company"]=="Z")["volume"]==0
            histories={}
            for cid in ids:
                evidence=client.post("/api/investigations/case-evidence",json=envelope("imported_case_evidence_request",workspace_id=wid,identity=parent,case_id=cid))
                assert evidence.status_code==200,evidence.text
                histories[cid]=evidence.json()["records"]
                assert {r["source_position"]:r["original_cells"] for r in histories[cid]}=={i:row for i,row in enumerate(original) if row[0]==cid}
            actions=[{"operation":"bpic19_measures","identity":parent,"definition_id":a["definition_id"],"query":refs[r]["query"],"selection_prefix_length":0} for r,a in [(POLICY,first_value),*old.items()]]
            actions.append({"operation":"bpic19_score","identity":child["identity"],"definition_id":run["definition_id"],"query":{"run_id":run["run_id"],"case_offset":0,"case_limit":100},"selection_prefix_length":1})
            request=envelope("save_investigation_request",workspace_id=wid,investigation_id=None,expected_revision_id=None,name="Panel first original-source creation",base_identity=base,selection_identity=child["identity"],selection_recipe={"parent_case_ids":ids,"predicates":[{"kind":"case_id_in","case_ids":eligible,"negate":False}]},context_policy="incident.context.first_record_in_declared_order.v1",comparison=None,notes="Panel source ordinal recipe; no R07 financial reconciliation or liability claim.",bookmarks=[],bpic19_pipeline={"schema_version":1,"actions":actions})
            saved=client.post("/api/investigations/save",json=request);assert saved.status_code==200,saved.text
            saved=saved.json()
            archive_hashes=exported(client,wid,run["run_id"])
    finally:
        first.terminate();first.wait(timeout=15)
        record("first-exit", {"pid":first.pid,"returncode":first.returncode,"alive":first.poll() is None,"observed_ns":time.time_ns()})
    assert first.returncode is not None
    second,_=start_process(port)
    record("second-start", {"pid":second.pid,"port":port,"started_ns":time.time_ns()})
    try:
        assert second.pid!=first.pid
        with httpx.Client(base_url=f"http://127.0.0.1:{port}",timeout=30,event_hooks=hooks) as client:
            assert client.post("/api/workspaces/open",json=envelope("open_workspace_request",path=str(workspace))).status_code==200
            reopened=client.post("/api/investigations/reopen",json=envelope("reopen_investigation_request",workspace_id=wid,saved_revision_id=saved["revision"]["saved_revision_id"]))
            assert reopened.status_code==200,reopened.text
            assert reopened.json()["revision"]==saved["revision"] and reopened.json()["bpic19_outputs"]==saved["bpic19_outputs"]
            reread=client.post("/api/investigations/bpic19-read",json={**read(wid,run["run_id"]),"case_limit":100})
            assert reread.status_code==200 and reread.json()["report"]==run["report"]
            assert exported(client,wid,run["run_id"])==archive_hashes
            for cid in ["A","B","M","I","U"]:
                response=client.post("/api/investigations/case-evidence",json=envelope("imported_case_evidence_request",workspace_id=wid,identity=parent,case_id=cid))
                assert response.status_code==200 and response.json()["records"]==histories[cid]
            record("verified", {"first_pid":first.pid,"second_pid":second.pid,"source_sha256":hashlib.sha256(raw).hexdigest(),
                "measure_definition_id":first_value["definition_id"],"native_run_id":run["run_id"],
                "saved_revision_id":saved["revision"]["saved_revision_id"],"native_export_entries":archive_hashes,
                "selected_case_ids":eligible,"exact_outputs_histories_and_exports_after_distinct_pid":True,
                "first_creation_policy":policy,"browser_full_source_qualified":False})
    finally:
        second.terminate();second.wait(timeout=15)
        record("second-exit", {"pid":second.pid,"returncode":second.returncode,"alive":second.poll() is None,"observed_ns":time.time_ns()})
    assert second.returncode is not None
