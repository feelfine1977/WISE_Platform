"""#125 export and replay of a frozen analyst pipeline, at public HTTP.

Expected values are written from the rows below by hand. Parent items [A, B]; the analyst keeps [A].
A after-GR with order, goods receipt, invoice and clearing on 2018-01-01..04; B before-GR without a clearing.
The pipeline is a profile of [A] and a native Completion run of [A] (C01 invoice, C02 clearing, C03 receipt, equal
Balanced weights): every check passes, so A scores 1 with coverage 1.
"""

import csv
import hashlib
import io
import json
import socket

import httpx
from fastapi.testclient import TestClient

from wise_platform_api.app import create_app
from import_requests import envelope
from test_bpic19_pipeline_http import start_process
from test_bpic19_scoring_http import given, prepare

AFTER, BEFORE = "3-way match, invoice after GR", "3-way match, invoice before GR"
ITEMS = {"A": (AFTER, [("Create Purchase Order Item", "01-01"), ("Record Goods Receipt", "01-02"), ("Record Invoice Receipt", "01-03"), ("Clear Invoice", "01-04")]),
         "B": (BEFORE, [("Create Purchase Order Item", "01-01"), ("Record Invoice Receipt", "01-02"), ("Record Goods Receipt", "01-03")])}
PROFILE_ROLES = {"item_category": 3, "item_type": 6, "goods_receipt": 4, "gr_based_iv": 5, "purchasing_document": 1, "item": 2, "source_case": 0}
KEEP_A = {"kind": "case_id_in", "case_ids": ["A"], "negate": False}
CLAIM = {"claim_id": "paper-completion", "report_id": "wise-paper", "source_locator": "WISE_12_10_2026.pdf, PDF page 26, Table 4",
         "claim": "Reported completion screening statement; not rerun here.", "claim_level": "reported_not_rerun"}


def literal(amount: int = 10) -> bytes:
    output = io.StringIO(newline="")
    writer = csv.writer(output)
    writer.writerow(["case", "case Purchasing Document", "case Item", "case Item Category", "case Goods Receipt", "case GR-Based IV",
                     "case Item Type", "case Company", "case Spend area text", "activity", "time", "event org:resource", "event Cumulative net worth (EUR)"])
    for case, (category, events) in ITEMS.items():
        for activity, date in events:
            writer.writerow([case, "D" + case, "00010", category, "true", "true", "Standard", "0000", "Packaging", activity, f"2018-{date}T00:00:00Z", "user_1", amount])
    return output.getvalue().encode()


def frozen(client, workspace, raw=None):
    """Open the literal, select [A], review its profile and score it natively."""
    wid, base = prepare(client, workspace, literal() if raw is None else raw)
    selected = client.post("/api/investigations/select-cases", json=envelope("select_cases_request", workspace_id=wid, identity=base,
                                                                             parent_case_ids=None, predicates=[KEEP_A])).json()
    query = {"roles": PROFILE_ROLES, "profile_columns": None, "policy_id": "bpic19.all_raw_case_attributes.v1"}
    profile = client.post("/api/investigations/bpic19-profile", json=envelope("bpic19_profile_request", workspace_id=wid,
        identity=selected["identity"], query=query)).json()["profile"]
    return wid, base, selected, query, profile


def score(client, wid, base, selected, **settings):
    request = given(wid, base, criteria_family="completion", **settings)
    request["named_population"] = {"name": "Kept item A", "identity": selected["identity"]}
    reply = client.post("/api/investigations/bpic19-score", json=request)
    assert reply.status_code == 200, reply.text
    return reply.json()


def actions(selected, query, profile, run):
    return [{"operation": "bpic19_profile", "identity": selected["identity"], "query": query, "definition_id": profile["definition_id"], "selection_prefix_length": 1},
            {"operation": "bpic19_score", "identity": selected["identity"], "definition_id": run["definition_id"], "selection_prefix_length": 1,
             "query": {"run_id": run["run_id"], "case_offset": 0, "case_limit": 50, "group_offset": 0, "group_limit": 50}}]


def save_request(wid, base, selected, pipeline, notes, previous=None, presentation=None):
    return envelope("save_investigation_request", workspace_id=wid,
        investigation_id=previous and previous["revision"]["investigation_id"],
        expected_revision_id=previous and previous["revision"]["saved_revision_id"],
        name="T23 frozen pipeline", base_identity=base, selection_identity=selected["identity"],
        selection_recipe={"parent_case_ids": selected["parent"]["case_ids"], "predicates": [KEEP_A]},
        context_policy="incident.context.first_record_in_declared_order.v1", comparison=None, notes=notes, bookmarks=[],
        bpic19_pipeline=pipeline, **({"presentation_state": presentation} if presentation else {}))


def native_zip(port, wid, run_id):
    reply = httpx.post(f"http://127.0.0.1:{port}/api/investigations/bpic19-export", json=envelope("bpic19_export_request",
                       workspace_id=wid, run_id=run_id, case_offset=0, case_limit=50), timeout=60)
    assert reply.status_code == 200, reply.text
    return reply.content


def test_t23_every_artifact_declares_one_frozen_revision_and_identities_follow_meaning(tmp_path):
    workspace = tmp_path / "workspace"; workspace.mkdir()
    with TestClient(create_app()) as client:
        wid, base, selected, query, profile = frozen(client, workspace)
        run = score(client, wid, base, selected)
        # The service's selection answer is the exported scope: parent [A, B], selected [A].
        assert (selected["parent"]["case_ids"], selected["kept"]["case_ids"], selected["kept"]["case_count"]) == (["A", "B"], ["A"], 1)
        pipeline = {"schema_version": 1, "actions": actions(selected, query, profile, run), "literature_claims": [{**CLAIM, "compared_run_id": run["run_id"]}]}
        saved = client.post("/api/investigations/save", json=save_request(wid, base, selected, pipeline, "Frozen [A]"))
        assert saved.status_code == 200, saved.text
        saved = saved.json()
        content = saved["revision"]["content"]
        # 23-AC01: the recipe names S and P, the parent and selected scope, D and R; the manifest's outputs carry the same.
        assert (content["base_identity"]["source_id"], content["base_identity"]["preparation_id"]) == (base["source_id"], base["preparation_id"])
        assert (content["selection_recipe"]["parent_case_ids"], content["selection_recipe"]["predicates"], content["selection_identity"]) == \
               (["A", "B"], [KEEP_A], selected["identity"])
        profile_output, score_output = (entry["output"] for entry in saved["bpic19_outputs"]["outputs"])
        assert [entry["definition_id"] for entry in saved["bpic19_outputs"]["outputs"]] == [profile["definition_id"], run["definition_id"]]
        assert (profile_output["profile"]["population"]["case_count"], score_output["run_id"], score_output["named_population"]["identity"]) == (1, run["run_id"], selected["identity"])
        a = score_output["report"]["case_page"]["cases"]
        assert ([case["case_id"] for case in a], a[0]["score"], score_output["report"]["mean_coverage"]) == (["A"], 1, 1)
        # Raw witness IDs from the export open the same complete original history (23-E06).
        evidence = client.post("/api/investigations/case-evidence", json=envelope("imported_case_evidence_request",
            workspace_id=wid, identity=selected["identity"], case_id="A")).json()
        assert sorted(record["row_id"] for record in evidence["records"]) == sorted(a[0]["record_row_ids"]) and len(a[0]["record_row_ids"]) == 4
        # 23-AC08: the literature statement stays reported_not_rerun, beside the run it names; an invented run is refused.
        assert saved["bpic19_outputs"]["literature_claims"] == [{**CLAIM, "compared_run_id": run["run_id"]}]
        invented = {**pipeline, "literature_claims": [{**CLAIM, "compared_run_id": "score-run.v1:sha256:" + "0" * 64}]}
        refused = client.post("/api/investigations/save", json=save_request(wid, base, selected, invented, "Invented"))
        assert (refused.json()["code"], refused.json()["field"]) == ("identity_mismatch", "bpic19_pipeline.literature_claims.0.compared_run_id")
        # 23-AC05: only a viewport change keeps the analytical revision.
        viewport = {"active_view": "process_map", "table_sorts": [], "flow_artifact_sha256": None, "graph_positions": None}
        again = client.post("/api/investigations/save", json=save_request(wid, base, selected, pipeline, "Frozen [A]", saved, viewport)).json()
        assert (again["revision"]["saved_revision_id"], again["semantic_change"]) == (saved["revision"]["saved_revision_id"], False)
        # A weight (view) and a selector are meaning: new definitions and runs; A stays reopenable.
        weighted = score(client, wid, base, selected, view="Operations")
        parent = client.post("/api/investigations/select-cases", json=envelope("select_cases_request", workspace_id=wid, identity=base,
                                                                               parent_case_ids=None, predicates=[])).json()
        both = score(client, wid, base, parent)
        assert len({run["definition_id"], weighted["definition_id"]}) == 2 and len({run["run_id"], weighted["run_id"], both["run_id"]}) == 3
        reopened = client.post("/api/investigations/reopen", json=envelope("reopen_investigation_request", workspace_id=wid,
            saved_revision_id=saved["revision"]["saved_revision_id"]))
        assert reopened.json()["bpic19_outputs"] == saved["bpic19_outputs"]
        # 23-E02 and E07: an unknown action or schema is refused by field before anything runs.
        for change, code, field in ((lambda p: p["actions"].append({**p["actions"][0], "operation": "notebook_python"}), "unsupported_action", "bpic19_pipeline.actions.2.operation"),
                                    (lambda p: p.update(schema_version=2), None, "bpic19_pipeline.schema_version")):
            bad = json.loads(json.dumps(pipeline))
            change(bad)
            refused = client.post("/api/investigations/save", json=save_request(wid, base, selected, bad, "Refused"))
            assert refused.status_code >= 400 and refused.json()["field"] == field and (code is None or refused.json()["code"] == code), refused.text
    # One changed source byte is a new source, preparation and run.
    other = tmp_path / "other"; other.mkdir()
    with TestClient(create_app()) as client:
        wid2, base2, selected2, _, _ = frozen(client, other, literal(11))
        changed = score(client, wid2, base2, selected2)
        assert base2["source_id"] != base["source_id"] and base2["preparation_id"] != base["preparation_id"] and changed["run_id"] != run["run_id"]


def test_t23_revision_b_replaces_a_and_both_replay_exactly_in_a_different_process(tmp_path):
    with socket.socket() as reserving:
        reserving.bind(("127.0.0.1", 0))
        port = reserving.getsockname()[1]
    workspace = tmp_path / "workspace"; workspace.mkdir()
    first, client = start_process(port)
    try:
        wid, base, selected, query, profile = frozen(client, workspace)
        run_a = score(client, wid, base, selected)
        a = client.post("/api/investigations/save", json=save_request(wid, base, selected,
            {"schema_version": 1, "actions": actions(selected, query, profile, run_a)}, "Revision A")).json()
        # 23-E07: run B (Operations view) is saved on A with A's revision; a save naming the outdated A is refused.
        run_b = score(client, wid, base, selected, view="Operations")
        pipeline_b = {"schema_version": 1, "actions": actions(selected, query, profile, run_b)}
        b = client.post("/api/investigations/save", json=save_request(wid, base, selected, pipeline_b, "Revision B", a))
        assert b.status_code == 200, b.text
        b = b.json()
        stale = client.post("/api/investigations/save", json=save_request(wid, base, selected, pipeline_b, "Against A", a))
        assert (stale.status_code, stale.json()["code"], stale.json()["field"]) == (409, "revision_conflict", "expected_revision_id")
        assert [entry["definition_id"] for entry in b["bpic19_outputs"]["outputs"]] == [profile["definition_id"], run_b["definition_id"]]
        assert b["bpic19_outputs"]["outputs"][1]["output"]["run_id"] == run_b["run_id"]
        zips = {run["run_id"]: hashlib.sha256(native_zip(port, wid, run["run_id"])).hexdigest() for run in (run_a, run_b)}
    finally:
        first.terminate()
        first.wait(timeout=15)
    assert first.returncode is not None
    second, fresh = start_process(port)
    try:
        assert second.pid != first.pid
        assert fresh.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(workspace))).status_code == 200
        # 23-B05 and E04: both revisions replay with identical revisions, outputs and native archive bytes.
        for saved in (a, b):
            reopened = fresh.post("/api/investigations/reopen", json=envelope("reopen_investigation_request",
                workspace_id=wid, saved_revision_id=saved["revision"]["saved_revision_id"]))
            assert reopened.status_code == 200, reopened.text
            assert (reopened.json()["revision"], reopened.json()["bpic19_outputs"]) == (saved["revision"], saved["bpic19_outputs"])
        assert {run_id: hashlib.sha256(native_zip(port, wid, run_id)).hexdigest() for run_id in zips} == zips
    finally:
        second.terminate()
        second.wait(timeout=15)
