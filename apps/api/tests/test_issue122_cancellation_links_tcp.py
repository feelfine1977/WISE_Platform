"""#122 latest-preceding cancellation links, at public HTTP.

Expected values are written from the rows below by hand. Source positions are one-based, as in original_ids();
each row's eventID is its position. Amounts are the cumulative net worth column.
C 1 IR d1 100, 2 IR d2 100, 3 Cancel d3 −100 (latest preceding is position 2);
T 4 IR d1 50, 5 IR d1 50, 6 Cancel d2 −50 (two equally latest receipts);
N 7 Cancel d1 −10 (nothing precedes it); Z 8 IR d1 0, 9 Cancel d2 −5 (zero and negative amounts);
D 10 IR d1 100, 11 Cancel d2 −100, 12 Cancel d3 −100 (two cancellations, one receipt);
M 13 IR d1 with no amount, 14 Cancel d2 −20.
"""

import socket

from fastapi.testclient import TestClient

from wise_platform_api.app import create_app
from import_requests import envelope
from test_bpic19_operators_http import CANCELLATION, ROUTE, VALIDATOR, original_ids, prepare, request
from test_bpic19_pipeline_http import start_process

AFTER = '"3-way match, invoice after GR"'
IR, CANCEL = "Record Invoice Receipt", "Cancel Invoice Receipt"
ROWS = [("C", IR, 1, 100), ("C", IR, 2, 100), ("C", CANCEL, 3, -100),
        ("T", IR, 1, 50), ("T", IR, 1, 50), ("T", CANCEL, 2, -50),
        ("N", CANCEL, 1, -10),
        ("Z", IR, 1, 0), ("Z", CANCEL, 2, -5),
        ("D", IR, 1, 100), ("D", CANCEL, 2, -100), ("D", CANCEL, 3, -100),
        ("M", IR, 1, None), ("M", CANCEL, 2, -20)]
RAW = ("case,activity,time,eventID,category,value,case Item Type,case Goods Receipt,case GR-Based Inv. Verif.,case Purchasing Document,case Item\n"
       + "".join(f"{case},{activity},2018-01-{day:02d}T00:00:00,{index + 1},{AFTER},{'' if amount is None else amount},Standard,true,true,D{case},1\n"
                 for index, (case, activity, day, amount) in enumerate(ROWS))).encode()
PROFILE_ROLES = {"item_category": 4, "item_type": 6, "goods_receipt": 7, "gr_based_iv": 8, "purchasing_document": 9, "item": 10, "source_case": None}


def links(client, wid, identity, **recipe):
    given = request(wid, identity, {**CANCELLATION, **recipe}, limit=100)
    reply = client.post(ROUTE, json=given)
    assert reply.status_code == 200, reply.text
    VALIDATOR.validate(reply.json())
    cases = {case["case_id"]: case for case in reply.json()["cases"]}
    return given, reply.json(), {case: [(o["state"], o["reason"], o["activation_row_ids"], o["response_row_ids"]) for o in item["observations"]]
                                 for case, item in cases.items()}


def test_t20_latest_preceding_links_ties_and_reuse(tmp_path):
    workspace = tmp_path / "workspace"; workspace.mkdir()
    r = original_ids(RAW, len(ROWS))
    with TestClient(create_app()) as client:
        wid, identity = prepare(client, workspace, RAW)
        _, answer, found = links(client, wid, identity)
        # 20-B01: the cancellation binds to the latest strictly earlier receipt; the earlier one stays free.
        assert found["C"] == [("matched", None, [r[3]], [r[2]])]
        # Equally latest receipts are ambiguous and consume nothing; no earlier receipt is unmatched.
        assert found["T"] == [("ambiguous", "tied_latest_candidates", [r[6]], [])]
        assert found["N"] == [("unmatched", "no_eligible_target", [r[7]], [])]
        # 20-B02: zero and negative amounts are valid data when amounts are ignored.
        assert found["Z"] == [("matched", None, [r[9]], [r[8]])]
        # Consumed receipts are used once: D's second cancellation has no receipt left.
        assert [state for state, *_ in found["D"]] == ["matched", "unmatched"]
        _, _, reused = links(client, wid, identity, reuse="allow")
        assert [state for state, *_ in reused["D"]] == ["matched", "matched"]
        # A one-day link falls outside a half-day window.
        _, _, windowed = links(client, wid, identity, max_window_days=0.5)
        assert windowed["C"][0][0] == "unmatched"
        summary = answer["summary"]["observation_state_counts"]
        assert summary == {"matched": 4, "ambiguous": 1, "unmatched": 2}


def test_t20_amount_filters_are_explicit_with_their_tolerance(tmp_path):
    workspace = tmp_path / "workspace"; workspace.mkdir()
    r = original_ids(RAW, len(ROWS))
    with TestClient(create_app()) as client:
        wid, identity = prepare(client, workspace, RAW)
        _, ignore, _ = links(client, wid, identity)
        _, opposite, opposed = links(client, wid, identity, amount_filter="opposite")
        _, equal, equalled = links(client, wid, identity, amount_filter="equal")
        # 20-B03: each amount rule is its own definition.
        assert len({ignore["definition_id"], opposite["definition_id"], equal["definition_id"]}) == 3
        # C's cancellation of −100 opposes its receipt of 100 exactly; it does not equal it.
        assert opposed["C"][0][:2] == ("matched", None) and equalled["C"][0][0] == "unmatched"
        # Z's −5 does not oppose 0 within tolerance 0, but does within 5.
        assert opposed["Z"][0][0] == "unmatched"
        _, _, tolerant = links(client, wid, identity, amount_filter="opposite", tolerance=5)
        assert tolerant["Z"][0][:4] == ("matched", None, [r[9]], [r[8]])
        # A receipt without an amount cannot be certified by an amount rule.
        assert opposed["M"][0][0] != "matched"


def test_t20_refusals_name_their_field(tmp_path):
    workspace = tmp_path / "workspace"; workspace.mkdir()
    with TestClient(create_app()) as client:
        wid, identity = prepare(client, workspace, RAW)
        for change, field in ((lambda q: q["recipe"].update(cancellation_activities=[IR]), "query.recipe.cancellation_activities"),
                              (lambda q: q["recipe"].update(tolerance=-1), "query.recipe.tolerance"),
                              (lambda q: q["recipe"].update(max_window_days=-2), "query.recipe.max_window_days"),
                              (lambda q: (q["recipe"].update(amount_filter="opposite"), q["roles"].update(net_worth=None)), "query.roles.net_worth"),
                              (lambda q: q["recipe"].update(ambiguity="nearest"), "query.recipe.ambiguity")):
            bad = request(wid, identity, CANCELLATION, limit=100)
            change(bad["query"])
            refused = client.post(ROUTE, json=bad)
            assert (refused.status_code, refused.json()["field"]) == (400, field), refused.text
            assert "cases" not in refused.json()


def test_t20_saved_links_survive_a_different_process(tmp_path):
    with socket.socket() as reserving:
        reserving.bind(("127.0.0.1", 0))
        port = reserving.getsockname()[1]
    workspace = tmp_path / "workspace"; workspace.mkdir()
    first, client = start_process(port)
    try:
        wid, identity = prepare(client, workspace, RAW)
        given, answer, found = links(client, wid, identity, amount_filter="opposite", tolerance=5)
        selected = client.post("/api/investigations/select-cases", json=envelope("select_cases_request", workspace_id=wid,
            identity=identity, parent_case_ids=None, predicates=[])).json()
        saved = client.post("/api/investigations/save", json=envelope("save_investigation_request", workspace_id=wid,
            investigation_id=None, expected_revision_id=None, name="T20 cancellation links", base_identity=identity,
            selection_identity=selected["identity"], selection_recipe={"parent_case_ids": selected["parent"]["case_ids"], "predicates": []},
            context_policy="incident.context.first_record_in_declared_order.v1", comparison=None, notes="Synthetic T20 rows",
            bookmarks=[], bpic19_pipeline={"schema_version": 1, "actions": [{"operation": "bpic19_cancellation", "identity": identity,
                "query": given["query"], "definition_id": answer["definition_id"]}]}))
        assert saved.status_code == 200, saved.text
        saved = saved.json()
    finally:
        first.terminate()
        first.wait(timeout=15)
    assert first.returncode is not None
    second, fresh = start_process(port)
    try:
        assert second.pid != first.pid
        assert fresh.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(workspace))).status_code == 200
        reopened = fresh.post("/api/investigations/reopen", json=envelope("reopen_investigation_request",
            workspace_id=wid, saved_revision_id=saved["revision"]["saved_revision_id"]))
        assert reopened.status_code == 200, reopened.text
        assert reopened.json()["bpic19_outputs"] == saved["bpic19_outputs"]
        output = reopened.json()["bpic19_outputs"]["outputs"][0]["output"]
        assert (output["definition"]["recipe"]["amount_filter"], output["definition"]["recipe"]["tolerance"]) == ("opposite", 5)
        assert {case["case_id"]: [(o["state"], o["reason"], o["activation_row_ids"], o["response_row_ids"]) for o in case["observations"]]
                for case in output["cases"]} == found
    finally:
        second.terminate()
        second.wait(timeout=15)
