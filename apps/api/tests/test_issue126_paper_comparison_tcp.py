"""#126 a paper comparison keeps its differences explicit, at public HTTP.

Over one literal (the four-flow scoring source), the paper's ten-criterion flat run and the historical notebook's
29-criterion layer-balanced run stay separate definitions and runs, each naming its profile, norm, settings and
calibration population. Report 12's case/item counts and Report 13's many-cycle intervals are kept as reported
statements that were not rerun, and the R13 weighted many-to-many step stays a named omission.
"""

from copy import deepcopy
import json
from pathlib import Path
import socket

from fastapi.testclient import TestClient

from wise_platform_api.app import create_app
from import_requests import envelope
from test_bpic19_pipeline_http import start_process
from test_bpic19_scoring_http import given, prepare, raw_source

GATE = json.loads((Path(__file__).parents[1] / "src/wise_platform_api/bpic19_reference/source-method-gate.json").read_text())
CLAIMS = [{"claim_id": "r12-units", "report_id": "R12", "source_locator": "merged_reports.pdf, Report 12",
           "claim": "65,200 cases versus 218,821 items, with disputed alignment partitions; unresolved source fact.", "claim_level": "reported_not_rerun"},
          {"claim_id": "r13-intervals", "report_id": "R13", "source_locator": "merged_reports.pdf, Report 13",
           "claim": "708,415 many-cycle intervals with undefined approximate timestamp weights; not the paper's 251,734 items or C04.",
           "claim_level": "reported_not_rerun"}]


def runs(client, wid, base, selected):
    answers = {}
    for name, settings in (("paper", {}), ("historical", {"profile": "historical", "view": "Finance", "mode": "layer_balanced"})):
        request = given(wid, base, **settings)
        request["named_population"] = {"name": "Literal four flows", "identity": selected["identity"]}
        reply = client.post("/api/investigations/bpic19-score", json=request)
        assert reply.status_code == 200, reply.text
        answers[name] = reply.json()
    return answers


def action(selected, answer):
    return {"operation": "bpic19_score", "identity": selected["identity"], "definition_id": answer["definition_id"], "selection_prefix_length": 0,
            "query": {"run_id": answer["run_id"], "case_offset": 0, "case_limit": 50, "group_offset": 0, "group_limit": 50}}


def save_request(wid, base, selected, pipeline, notes, previous=None):
    return envelope("save_investigation_request", workspace_id=wid,
        investigation_id=previous and previous["revision"]["investigation_id"],
        expected_revision_id=previous and previous["revision"]["saved_revision_id"],
        name="T24 paper comparison", base_identity=base, selection_identity=selected["identity"],
        selection_recipe={"parent_case_ids": selected["parent"]["case_ids"], "predicates": []},
        context_policy="incident.context.first_record_in_declared_order.v1", comparison=None, notes=notes, bookmarks=[], bpic19_pipeline=pipeline)


def test_t24_paper_and_notebook_runs_and_reported_claims_stay_separate_across_a_restart(tmp_path):
    with socket.socket() as reserving:
        reserving.bind(("127.0.0.1", 0))
        port = reserving.getsockname()[1]
    workspace = tmp_path / "workspace"; workspace.mkdir()
    first, client = start_process(port)
    try:
        wid, base = prepare(client, workspace, raw_source())
        selected = client.post("/api/investigations/select-cases", json=envelope("select_cases_request", workspace_id=wid, identity=base,
                                                                                 parent_case_ids=None, predicates=[])).json()
        answers = runs(client, wid, base, selected)
        paper, historical = answers["paper"], answers["historical"]
        # T24-AC07: profile, norm, criteria, aggregation and calibration population differ and are each named.
        assert (paper["report"]["profile_id"], historical["report"]["profile_id"]) == ("bpic19.paper.2026-10-12.v1", "bpic19.notebook.1.0-paper-aligned.v1")
        assert (paper["report"]["requested_criterion_count"], historical["report"]["requested_criterion_count"]) == (10, 29)
        assert (paper["report"]["settings"]["mode"], historical["report"]["settings"]["mode"]) == ("flat", "layer_balanced")
        assert (paper["snapshot"]["workload_admission"]["includes_calibration_parent"], historical["snapshot"]["workload_admission"]["includes_calibration_parent"]) == (False, True)
        assert paper["definition_id"] != historical["definition_id"] and paper["run_id"] != historical["run_id"]
        gate = {"operation": "bpic19_method_gate", "identity": selected["identity"], **deepcopy(GATE)}
        pipeline = {"schema_version": 1, "actions": [action(selected, paper), gate, action(selected, historical)],
                    "literature_claims": [{**claim, "compared_run_id": paper["run_id"]} for claim in CLAIMS]}
        # 24-B03: the unresolved R13 step is never run silently: all-required refuses it by step ...
        refused = client.post("/api/investigations/save", json=save_request(wid, base, selected, pipeline, "Require all"))
        assert (refused.status_code, refused.json()["code"], refused.json()["field"]) == (400, "unsupported_policy", "bpic19_pipeline.actions.1.query")
        # ... and a partial pipeline names it as an omission beside the reported, not rerun, statements.
        a = client.post("/api/investigations/save", json=save_request(wid, base, selected, {**pipeline, "replay_mode": "partial"}, "Paper comparison"))
        assert a.status_code == 200, a.text
        a = a.json()
        manifest = a["bpic19_outputs"]
        assert manifest["claim_level"] == "partial" and [o["method_id"] for o in manifest["omissions"]] == [GATE["query"]["method_id"]]
        assert manifest["omissions"][0]["gate_reason"] == GATE["query"]["gate_reason"]
        assert [claim["claim_level"] for claim in manifest["literature_claims"]] == ["reported_not_rerun"] * 2
        assert [o["output"]["run_id"] for o in manifest["outputs"]] == [paper["run_id"], historical["run_id"]]
        # 24-E07: revision B (paper only) replaces A only with A's revision.
        b = client.post("/api/investigations/save", json=save_request(wid, base, selected, {"schema_version": 1, "actions": [action(selected, paper)]}, "Paper only", a))
        assert b.status_code == 200, b.text
        b = b.json()
        stale = client.post("/api/investigations/save", json=save_request(wid, base, selected, {"schema_version": 1, "actions": [action(selected, paper)]}, "Against A", a))
        assert (stale.status_code, stale.json()["code"]) == (409, "revision_conflict")
        assert [o["output"]["run_id"] for o in b["bpic19_outputs"]["outputs"]] == [paper["run_id"]]
    finally:
        first.terminate()
        first.wait(timeout=15)
    assert first.returncode is not None
    second, fresh = start_process(port)
    try:
        assert second.pid != first.pid
        assert fresh.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(workspace))).status_code == 200
        for saved in (a, b):
            reopened = fresh.post("/api/investigations/reopen", json=envelope("reopen_investigation_request",
                workspace_id=wid, saved_revision_id=saved["revision"]["saved_revision_id"]))
            assert reopened.status_code == 200, reopened.text
            assert (reopened.json()["revision"], reopened.json()["bpic19_outputs"]) == (saved["revision"], saved["bpic19_outputs"])
    finally:
        second.terminate()
        second.wait(timeout=15)
