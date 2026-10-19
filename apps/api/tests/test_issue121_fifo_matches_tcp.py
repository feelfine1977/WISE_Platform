"""#121 FIFO-consuming invoice matches compared with ordinal pairing, at public HTTP.

Expected values are written from the rows below by hand. Source positions are one-based, as in original_ids():
P 1 c0 CI d0, 2 g1 GR d1, 3 i1 IR d2, 4 c1 CI d3, 5 g2 GR d4, 6 i2 IR d5, 7 c2 CI d6 (eventIDs 1–7);
Q 8 GR d1, 9 IR d1 (same instant), 10 CI d2; W 11 GR d1, 12 IR with no time, 13 CI d3;
K 14 GR d1, 15 IR d2, 16 Cancel Invoice Receipt d3, 17 CI d4.
"""

from copy import deepcopy
import socket

from fastapi.testclient import TestClient

from wise_platform_api.app import create_app
from import_requests import envelope
from test_bpic19_operators_http import FIFO, ORDINAL, ROUTE, VALIDATOR, original_ids, prepare, request
from test_bpic19_pipeline_http import start_process

AFTER = '"3-way match, invoice after GR"'
GR, IR, CI = "Record Goods Receipt", "Record Invoice Receipt", "Clear Invoice"
ROWS = [("P", CI, 0, 1), ("P", GR, 1, 2), ("P", IR, 2, 3), ("P", CI, 3, 4), ("P", GR, 4, 5), ("P", IR, 5, 6), ("P", CI, 6, 7),
        ("Q", GR, 1, 8), ("Q", IR, 1, 9), ("Q", CI, 2, 10),
        ("W", GR, 1, 11), ("W", IR, None, 12), ("W", CI, 3, 13),
        ("K", GR, 1, 14), ("K", IR, 2, 15), ("K", "Cancel Invoice Receipt", 3, 16), ("K", CI, 4, 17)]
RAW = ("case,activity,time,eventID,category,value,case Item Type,case Goods Receipt,case GR-Based Inv. Verif.,case Purchasing Document,case Item\n"
       + "".join(f"{case},{activity},{'' if day is None else f'2018-01-{day + 1:02d}T00:00:00'},{event},{AFTER},100,Standard,true,true,D{case},1\n"
                 for case, activity, day, event in ROWS)).encode()
PROFILE_ROLES = {"item_category": 4, "item_type": 6, "goods_receipt": 7, "gr_based_iv": 8, "purchasing_document": 9, "item": 10, "source_case": None}
TIMED_FIFO = {**FIFO, "order": "timestamp_source_position"}
COMPARE = "/api/investigations/bpic19-recipe-comparison"


def operator(client, wid, identity, recipe):
    given = request(wid, identity, recipe, limit=100)
    reply = client.post(ROUTE, json=given)
    assert reply.status_code == 200, reply.text
    VALIDATOR.validate(reply.json())
    return given, reply.json(), {case["case_id"]: case for case in reply.json()["cases"]}


def episodes(case):
    return [(o["state"], o["stage_row_ids"]) for o in case["observations"]]


def lags(observation):
    return [observation["intervals"][name]["recorded_difference_days"] for name in ("stage_1_to_2", "stage_2_to_3")]


def test_t19_fifo_consumes_in_order_while_ordinal_pairs_by_occurrence(tmp_path):
    workspace = tmp_path / "workspace"; workspace.mkdir()
    r = original_ids(RAW, len(ROWS))
    with TestClient(create_app()) as client:
        wid, identity = prepare(client, workspace, RAW)
        _, fifo, fifo_cases = operator(client, wid, identity, TIMED_FIFO)
        _, ordinal, ordinal_cases = operator(client, wid, identity, ORDINAL)
        # T19-AC01: FIFO consumes complete triples in order and leaves the leading clearing c0 unmatched.
        assert episodes(fifo_cases["P"]) == [("matched", [r[2], r[3], r[4]]), ("matched", [r[5], r[6], r[7]])]
        assert [lags(o) for o in fifo_cases["P"]["observations"]] == [[1, 1], [1, 1]]
        assert fifo_cases["P"]["unmatched_row_ids"] == [r[1]]
        # Ordinal pairs the kth occurrences, so c0 and c1 close the two cycles: both reversed, signed differences kept.
        # The third clearing has no third receipt or invoice: an unmatched episode.
        assert episodes(ordinal_cases["P"]) == [("reversed", [r[2], r[3], r[1]]), ("reversed", [r[5], r[6], r[4]]), ("unmatched", [None, None, r[7]])]
        assert [lags(o) for o in ordinal_cases["P"]["observations"][:2]] == [[1, -2], [1, -2]]
        assert ordinal_cases["P"]["unmatched_row_ids"] == [r[7]]
        assert (fifo["definition_id"], fifo["result_id"]) != (ordinal["definition_id"], ordinal["result_id"])
        assert fifo["definition_id"] != ordinal["definition_id"] and fifo["result_id"] != ordinal["result_id"]
        # 19-B03: an equal-time goods receipt and invoice match with a legitimate zero lag.
        q = fifo_cases["Q"]["observations"][0]
        assert (q["stage_row_ids"], q["intervals"]["stage_1_to_2"]["value"], q["intervals"]["stage_1_to_2"]["available"]) == ([r[8], r[9], r[10]], 0, True)


def test_t19_unknown_chronology_cancellation_modes_and_tie_policy(tmp_path):
    workspace = tmp_path / "workspace"; workspace.mkdir()
    r = original_ids(RAW, len(ROWS))
    with TestClient(create_app()) as client:
        wid, identity = prepare(client, workspace, RAW)
        _, timed, cases = operator(client, wid, identity, TIMED_FIFO)
        # T19-AC06: an invoice without a time leaves W's timestamp-order FIFO unknown, with its witness.
        assert (cases["W"]["state"], cases["W"]["reason"], cases["W"]["observations"]) == ("unknown", "unknown_chronology", [])
        assert r[12] in cases["W"]["unknown_row_ids"]
        # Cancellation retained keeps K's triple with its cancellation counted; excluding it is a new definition.
        assert episodes(cases["K"]) == [("matched", [r[14], r[15], r[17]])] and cases["K"]["totals"]["cancellation_count"]["value"] == 1
        _, excluded, excluded_cases = operator(client, wid, identity, {**TIMED_FIFO, "cancellation": "exclude_item"})
        assert (excluded_cases["K"]["state"], excluded_cases["K"]["reason"], excluded_cases["K"]["excluded_row_ids"]) == ("excluded", "cancellation_case", [r[16]])
        assert excluded["definition_id"] != timed["definition_id"]
        # 19-B03: strict time is its own tie policy and identity.
        _, strict, _ = operator(client, wid, identity, {**TIMED_FIFO, "ties": "strict_time"})
        assert strict["definition_id"] != timed["definition_id"]
        bad = request(wid, identity, {**TIMED_FIFO, "ties": "nearest"}, limit=100)
        refused = client.post(ROUTE, json=bad)
        assert (refused.status_code, refused.json()["field"]) == (400, "query.recipe.ties"), refused.text


def comparison_request(client, wid, identity):
    references = []
    for recipe in (ORDINAL, TIMED_FIFO):
        given, answer, _ = operator(client, wid, identity, recipe)
        references.append({"definition_id": answer["definition_id"], "query": given["query"]})
    return envelope("bpic19_recipe_comparison_request", workspace_id=wid, identity=identity,
                    query={"policy_id": "bpic19.ordinal_fifo_comparison.v1", "ordinal": references[0], "fifo": references[1]})


def test_t19_comparison_shows_both_supports_and_survives_a_different_process(tmp_path):
    with socket.socket() as reserving:
        reserving.bind(("127.0.0.1", 0))
        port = reserving.getsockname()[1]
    workspace = tmp_path / "workspace"; workspace.mkdir()
    first, client = start_process(port)
    try:
        wid, identity = prepare(client, workspace, RAW)
        given = comparison_request(client, wid, identity)
        reply = client.post(COMPARE, json=given)
        assert reply.status_code == 200, reply.text
        compared = reply.json()["comparison"]
        # T19-AC07: both complete answers, with their own denominators, unmatched counts and signed intervals.
        sides = {side["operation"]: side for side in (compared["first"], compared["second"])}
        assert set(sides) == {"bpic19_ordinal", "bpic19_fifo"}
        p = {name: next(case for case in side["cases"] if case["case_id"] == "P") for name, side in sides.items()}
        assert (p["bpic19_ordinal"]["totals"]["unmatched_event_count"]["value"], p["bpic19_fifo"]["totals"]["unmatched_event_count"]["value"]) == (1, 1)
        assert [lags(o)[1] for o in p["bpic19_ordinal"]["observations"]] == [-2, -2, None]
        assert all(side["population_case_count"] == 4 for side in sides.values())
        selected = client.post("/api/investigations/select-cases", json=envelope("select_cases_request", workspace_id=wid,
            identity=identity, parent_case_ids=None, predicates=[])).json()
        actions = [{"operation": "bpic19_operator_comparison", "identity": identity, "query": given["query"], "definition_id": reply.json()["definition_id"]}]
        saved = client.post("/api/investigations/save", json=envelope("save_investigation_request", workspace_id=wid,
            investigation_id=None, expected_revision_id=None, name="T19 FIFO and ordinal", base_identity=identity,
            selection_identity=selected["identity"], selection_recipe={"parent_case_ids": selected["parent"]["case_ids"], "predicates": []},
            context_policy="incident.context.first_record_in_declared_order.v1", comparison=None, notes="Synthetic T19 rows",
            bookmarks=[], bpic19_pipeline={"schema_version": 1, "actions": actions}))
        assert saved.status_code == 200, saved.text
        saved = saved.json()
        swapped = deepcopy(given)
        swapped["query"]["ordinal"], swapped["query"]["fifo"] = given["query"]["fifo"], given["query"]["ordinal"]
        assert client.post(COMPARE, json=swapped).status_code == 422
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
        assert fresh.post(COMPARE, json=given).json()["comparison"] == compared
    finally:
        second.terminate()
        second.wait(timeout=15)
