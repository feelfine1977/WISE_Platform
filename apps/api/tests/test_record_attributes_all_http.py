"""Actual HTTP preparation, same-row selection, raw evidence and fresh-PID saved replay."""
from copy import deepcopy
import hashlib
import json
import socket

from import_requests import envelope, wall_policies
from test_bpic19_operators_restart import start, stop

RAW = b"""item,activity,time,GR,IV
K,A,2018-01-01T00:00:00,true,false
K,B,2018-01-02T00:00:00,false,true
P,A,bad-time,true,true
P,B,2018-01-02T00:00:00,false,false
M,A,2018-01-01T00:00:00,true,
L,A,2018-01-01T00:00:00,true,Unknown
"""
PREDICATE = {"kind": "record_attributes_all", "policy_id": "incident.raw.same_record_all.v1",
             "conditions": [{"column_index": 3, "values": ["true"]}, {"column_index": 4, "values": ["true"]}], "negate": False}


def prepare(client, workspace):
    opened = client.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(workspace)))
    assert opened.status_code == 200, opened.text
    wid = opened.json()["workspace_id"]
    uploaded = client.put("/api/sources", params=envelope("upload_source_metadata", workspace_id=wid, filename="flags.csv"), content=RAW,
                          headers={"Content-Type": "application/octet-stream"})
    assert uploaded.status_code == 200, uploaded.text
    prepared = client.post("/api/preparations", json=envelope("confirm_mapping_request", workspace_id=wid,
        source_id="source.v1:sha256:" + hashlib.sha256(RAW).hexdigest(),
        dialect={"encoding": "utf-8", "delimiter": ",", "quotechar": '"', "header": "first_record"},
        mapping={"case_column": 0, "activity_column": 1, "timestamp_column": 2, "sequence_column": None, "context_columns": []},
        policies=wall_policies("iso8601", "2018-01-03T00:00:00"), accept_report_issues=True))
    assert prepared.status_code == 200, prepared.text
    prepared = prepared.json()
    assert prepared["state"] == "ready", prepared
    response = client.post("/api/investigations/open-population", json=envelope("open_population_request", workspace_id=wid,
                           preparation_id=prepared["preparation"]["preparation_id"]))
    assert response.status_code == 200, response.text
    return wid, response.json()["identity"]


def test_real_http_same_record_strict_negation_witnesses_save_and_pid_restart(tmp_path):
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0)); port = sock.getsockname()[1]
    workspace = tmp_path / "same-record"; workspace.mkdir()
    first, client = start(port)
    try:
        wid, identity = prepare(client, workspace)
        request = envelope("select_cases_request", workspace_id=wid, identity=identity, parent_case_ids=None, predicates=[PREDICATE])
        response = client.post("/api/investigations/select-cases", json=request)
        assert response.status_code == 200, response.text
        answer = response.json()
        assert answer["kept"] == {"case_ids": ["P"], "case_count": 1, "record_count": 2}
        assert answer["removed"]["case_ids"] == ["K", "L", "M"]
        assert answer["unevaluable"]["case_ids"] == []
        rows = answer["predicate_results"][0]["record_evidence"]["cases"]
        assert len(rows) == 1 and rows[0]["case_id"] == "P" and len(rows[0]["matching_row_ids"]) == 1
        evidence = client.post("/api/investigations/case-evidence", json=envelope("imported_case_evidence_request", workspace_id=wid,
            identity=answer["identity"], case_id="P"))
        assert evidence.status_code == 200, evidence.text
        # Complete original history, including bad time and nonmatching sibling.
        raw_rows = evidence.json()["records"]
        assert len(raw_rows) == 2
        assert {tuple(row["original_cells"][-2:]) for row in raw_rows} == {("true", "true"), ("false", "false")}
        negative = deepcopy(request); negative["predicates"][0]["negate"] = True
        response = client.post("/api/investigations/select-cases", json=negative)
        assert response.status_code == 200, response.text
        assert response.json()["kept"]["case_ids"] == ["K", "L", "M"]
        for change in [lambda p: p["conditions"][0].update(column_index=True),
                       lambda p: p["conditions"][0].update(values=["true", "true"]),
                       lambda p: p["conditions"][0].update(column_index=99),
                       lambda p: p["conditions"][1].update(column_index=3),
                       lambda p: p.update(policy_id="guess"), lambda p: p.update(injected_code="return true")]:
            invalid = deepcopy(request); change(invalid["predicates"][0])
            refused = client.post("/api/investigations/select-cases", json=invalid)
            assert refused.status_code == 422 and refused.json()["code"] == "invalid_predicate", refused.text
        recipe = {"parent_case_ids": ["K", "L", "M", "P"], "predicates": [PREDICATE]}
        saved = client.post("/api/investigations/save", json=envelope("save_investigation_request", workspace_id=wid,
            investigation_id=None, expected_revision_id=None, name="Same original record", base_identity=identity,
            selection_identity=answer["identity"], selection_recipe=recipe,
            context_policy="incident.context.first_record_in_declared_order.v1", comparison=None,
            notes="Literal T03-AC08 with raw blank and Unknown", bookmarks=[]))
        assert saved.status_code == 200, saved.text
        saved = saved.json()
        original_pid = first.pid
        exported = workspace / "same-record-receipt.json"
        exported.write_text(json.dumps(saved, sort_keys=True))
    finally:
        stop(first, client)
    second, client = start(port)
    try:
        assert second.pid != original_pid and first.returncode is not None
        opened = client.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(workspace)))
        assert opened.status_code == 200, opened.text
        reopened = client.post("/api/investigations/reopen", json=envelope("reopen_investigation_request",
            workspace_id=opened.json()["workspace_id"], saved_revision_id=saved["revision"]["saved_revision_id"]))
        assert reopened.status_code == 200, reopened.text
        reopened = reopened.json()
        assert reopened["restored_selection"]["identity"] == answer["identity"]
        assert reopened["restored_selection"]["predicate_results"] == answer["predicate_results"]
        assert reopened["restored_selection"]["kept"] == answer["kept"]
        assert reopened["revision"] == json.loads(exported.read_text())["revision"]
    finally:
        stop(second, client)
