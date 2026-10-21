"""#120 inferred ordinal invoice episodes, paired by original eventID, at public HTTP.

Expected values are written from the rows below by hand (stages goods receipt → invoice → clearing, the kth
occurrence of each by ascending eventID). Source positions are one-based, as in original_ids():
R 1 GR d1, 2 IR d2, 3 Change Price d3, 4 CI d4, 5 GR d5, 6 IR d6, 7 CI d8 (two episodes; position 3 is not a stage);
Z 8 GR d1, 9 IR d1, 10 CI d3 (zero first lag); V 11 GR d5, 12 IR d3, 13 CI d6 (reversed first lag);
M 14 GR d1, 15 IR d2 (no clearing); A 16 GR, 17 IR, both eventID 70 (ambiguous order);
K 18 GR d1, 19 IR d2, 20 Cancel Invoice Receipt d3, 21 CI d4.
"""

from copy import deepcopy
import socket

from fastapi.testclient import TestClient

from wise_platform_api.app import create_app
from import_requests import envelope
from test_bpic19_operators_http import ORDINAL, ROUTE, VALIDATOR, original_ids, prepare, request
from test_bpic19_pipeline_http import start_process

AFTER = '"3-way match, invoice after GR"'
GR, IR, CI = "Record Goods Receipt", "Record Invoice Receipt", "Clear Invoice"
ROWS = [("R", GR, 1, 10), ("R", IR, 2, 11), ("R", "Change Price", 3, 12), ("R", CI, 4, 13), ("R", GR, 5, 14), ("R", IR, 6, 15), ("R", CI, 8, 16),
        ("Z", GR, 1, 20), ("Z", IR, 1, 21), ("Z", CI, 3, 22),
        ("V", GR, 5, 30), ("V", IR, 3, 31), ("V", CI, 6, 32),
        ("M", GR, 1, 40), ("M", IR, 2, 41),
        ("A", GR, 1, 70), ("A", IR, 2, 70),
        ("K", GR, 1, 80), ("K", IR, 2, 81), ("K", "Cancel Invoice Receipt", 3, 82), ("K", CI, 4, 83)]
# Constant profile columns after the operator's own, so the built purchasing view can review a profile over them.
RAW = ("case,activity,time,eventID,category,value,case Item Type,case Goods Receipt,case GR-Based Inv. Verif.,case Purchasing Document,case Item\n"
       + "".join(f"{case},{activity},2018-01-{day:02d}T00:00:00,{event},{AFTER},100,Standard,true,true,D{case},1\n" for case, activity, day, event in ROWS)).encode()
PROFILE_ROLES = {"item_category": 4, "item_type": 6, "goods_receipt": 7, "gr_based_iv": 8, "purchasing_document": 9, "item": 10, "source_case": None}


def ordinal(client, wid, identity, **recipe):
    reply = client.post(ROUTE, json=request(wid, identity, {**ORDINAL, **recipe}, limit=100))
    assert reply.status_code == 200, reply.text
    VALIDATOR.validate(reply.json())
    return reply.json(), {case["case_id"]: case for case in reply.json()["cases"]}


def lags(observation):
    return [observation["intervals"][name]["recorded_difference_days"] for name in ("stage_1_to_2", "stage_2_to_3")]


def test_t18_kth_occurrences_and_every_outcome_with_its_witnesses(tmp_path):
    workspace = tmp_path / "workspace"; workspace.mkdir()
    r = original_ids(RAW, len(ROWS))
    with TestClient(create_app()) as client:
        wid, identity = prepare(client, workspace, RAW)
        answer, cases = ordinal(client, wid, identity)
        # 18-B01: R's first and second goods receipts, invoices and clearings pair by ascending eventID.
        first, second = cases["R"]["observations"]
        assert (first["ordinal"], first["stage_row_ids"], lags(first)) == (1, [r[1], r[2], r[4]], [1, 2])
        assert (second["ordinal"], second["stage_row_ids"], lags(second)) == (2, [r[5], r[6], r[7]], [1, 2])
        assert first["native_invoice_id"] is None and first["observation_id"] != second["observation_id"]
        # T18-AC07: the unselected Change Price stays in R's complete history; nothing is cropped to the endpoints.
        assert cases["R"]["record_row_ids"] == [r[n] for n in range(1, 8)] and r[3] not in first["stage_row_ids"]
        evidence = client.post("/api/investigations/case-evidence", json=envelope("imported_case_evidence_request",
            workspace_id=wid, identity=identity, case_id="R"))
        assert sorted(record["row_id"] for record in evidence.json()["records"]) == sorted(r[n] for n in range(1, 8))
        # 18-B03: a zero lag is legitimate; a reversed lag keeps its signed difference without a value; a missing
        # clearing is unmatched; an ambiguous eventID leaves the item unknown with its witnesses.
        zero = cases["Z"]["observations"][0]
        assert (zero["state"], zero["intervals"]["stage_1_to_2"]["value"], zero["intervals"]["stage_1_to_2"]["available"], lags(zero)) == ("matched", 0, True, [0, 2])
        reversed_ = cases["V"]["observations"][0]
        assert (reversed_["state"], reversed_["intervals"]["stage_1_to_2"]["value"], lags(reversed_)[0]) == ("reversed", None, -2)
        missing = cases["M"]["observations"][0]
        assert (missing["state"], missing["reason"]) == ("unmatched", "unmatched_endpoint")
        assert (cases["A"]["state"], cases["A"]["reason"], cases["A"]["observations"]) == ("unknown", "ambiguous_event_id", [])
        assert sorted(cases["A"]["unknown_row_ids"]) == sorted([r[16], r[17]])
        # Cancellation retained: K's tuple is evaluated.
        assert cases["K"]["observations"][0]["stage_row_ids"] == [r[18], r[19], r[21]]


def test_t18_order_cancellation_and_unsupported_recipes(tmp_path):
    workspace = tmp_path / "workspace"; workspace.mkdir()
    r = original_ids(RAW, len(ROWS))
    with TestClient(create_app()) as client:
        wid, identity = prepare(client, workspace, RAW)
        by_event, _ = ordinal(client, wid, identity)
        by_time, timed = ordinal(client, wid, identity, order="timestamp_source_position")
        excluded, cases = ordinal(client, wid, identity, cancellation="exclude_item")
        # 18-B01: timestamp order is a different recipe, not a fallback.
        assert len({by_event["definition_id"], by_time["definition_id"], excluded["definition_id"]}) == 3
        # The source-compatible exclusion keeps K with its cancellation witness and its whole history.
        k = cases["K"]
        assert (k["state"], k["reason"], k["excluded_row_ids"], k["observations"]) == ("excluded", "cancellation_case", [r[20]], [])
        assert k["record_row_ids"] == [r[18], r[19], r[20], r[21]]
        # 18-E02: an unknown recipe choice, close-on-clearing and a missing eventID role are refused by field.
        for change, field in ((lambda q: q["recipe"].update(cancellation="exclude_r04_v2"), "query.recipe.cancellation"),
                              (lambda q: q["recipe"].update(order="close_on_clearing"), "query.recipe.order"),
                              (lambda q: q["roles"].update(event_id=None), "query.roles.event_id")):
            bad = request(wid, identity, ORDINAL, limit=100)
            change(bad["query"])
            refused = client.post(ROUTE, json=bad)
            assert (refused.status_code, refused.json()["field"]) == (400, field), refused.text
            assert "cases" not in refused.json()
        newer = request(wid, identity, ORDINAL, limit=100)
        newer["query"]["policy_id"] = "bpic19.declared_operators.v2"
        refused = client.post(ROUTE, json=newer)
        assert (refused.json()["code"], refused.json()["field"]) == ("unsupported_policy", "query.policy_id")


def test_t18_saved_exclusion_profile_and_episodes_survive_a_different_process(tmp_path):
    with socket.socket() as reserving:
        reserving.bind(("127.0.0.1", 0))
        port = reserving.getsockname()[1]
    workspace = tmp_path / "workspace"; workspace.mkdir()
    first, client = start_process(port)
    try:
        wid, identity = prepare(client, workspace, RAW)
        given = request(wid, identity, {**ORDINAL, "cancellation": "exclude_item"}, limit=100)
        answer = client.post(ROUTE, json=given).json()
        selected = client.post("/api/investigations/select-cases", json=envelope("select_cases_request", workspace_id=wid,
            identity=identity, parent_case_ids=None, predicates=[])).json()
        save = envelope("save_investigation_request", workspace_id=wid, investigation_id=None, expected_revision_id=None,
            name="T18 ordinal episodes", base_identity=identity, selection_identity=selected["identity"],
            selection_recipe={"parent_case_ids": selected["parent"]["case_ids"], "predicates": []},
            context_policy="incident.context.first_record_in_declared_order.v1", comparison=None, notes="Synthetic T18 rows",
            bookmarks=[], bpic19_pipeline={"schema_version": 1, "actions": [{"operation": "bpic19_ordinal", "identity": identity,
                "query": given["query"], "definition_id": answer["definition_id"]}]})
        saved = client.post("/api/investigations/save", json=save)
        assert saved.status_code == 200, saved.text
        saved = saved.json()
        # An unknown operator version in a saved recipe is refused before anything is written.
        bad = deepcopy(save)
        bad["bpic19_pipeline"]["actions"][0]["operation"] = "bpic19_ordinal_v2"
        assert client.post("/api/investigations/save", json=bad).status_code >= 400
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
        # T18-AC08: roles, recipe, exclusion, episode identities, signed differences and witnesses are unchanged.
        output = reopened.json()["bpic19_outputs"]["outputs"][0]["output"]
        assert (output["definition"]["roles"]["event_id"], output["definition"]["recipe"]["cancellation"], output["definition"]["recipe"]["ties"]) == (3, "exclude_item", "source_position")
        before = {case["case_id"]: case for case in answer["cases"]}
        after = {case["case_id"]: case for case in output["cases"]}
        for case in ("R", "Z", "V"):
            assert [(o["observation_id"], o["stage_row_ids"], lags(o)) for o in after[case]["observations"]] == \
                   [(o["observation_id"], o["stage_row_ids"], lags(o)) for o in before[case]["observations"]]
        assert (after["K"]["state"], after["K"]["excluded_row_ids"]) == ("excluded", before["K"]["excluded_row_ids"])
        assert fresh.post(ROUTE, json=given).json()["cases"] == answer["cases"]
    finally:
        second.terminate()
        second.wait(timeout=15)
