"""#110 qualified resource proxies over literal actor cells, at public HTTP.

Every expected value is written from the actor cells below by hand. Each item's records are dated in order,
except T, whose second record has an unparseable time.
"""

from copy import deepcopy
import json
from pathlib import Path
import socket

from fastapi.testclient import TestClient

from wise_platform_api.app import create_app
from import_requests import envelope
from test_bpic19_measures_http import ROUTE, VALIDATOR, prepare_source, request
from test_bpic19_pipeline_http import start_process

ITEMS = {
    "A": ["user_1", "user_1", "batch_2", "user_2"],
    "B": ["batch_1", "batch_2"],
    "C": [" USER_1 ", "user_1", " batch_2 "],
    "D": ["user_1", "NONE"],
    "E": ["robot", "user_1"],
    "F": ["user_1", "user_1", "user_2"],
    "G": ["user_1", "user_2", "user_1"],
    "H": ["NONE", "", "user_1_extra", "robot", "batch_x", "user_12", "batch_003"],
    "K": ["user_1", "user_2", "user_3", "batch_1", "NONE"],
    "T": ["user_1", "user_2"],
}
ACTIVITIES = ["Record Invoice Receipt", "Change Price", "Clear Invoice", "Change Quantity", "Record Goods Receipt", "Cancel Invoice Receipt", "Vendor creates invoice"]


def _line(case, index, actor):
    time = "not-a-time" if (case, index) == ("T", 1) else f"2018-01-0{index + 1}T00:00:00"
    return f'{case},{ACTIVITIES[index]},{time},,"{actor}",10,D{case},1,Packaging\n'


LITERAL = ("case,activity,time,case Item Category,event org:resource,event Cumulative net worth (EUR),case Purchasing Document,case Company,case Spend area text\n"
           + "".join(_line(case, index, actor) for case, actors in ITEMS.items() for index, actor in enumerate(actors))).encode()
BROWSER_ANSWER = Path(__file__).resolve().parents[3] / "apps/web/src/bpic19/t08-resource-answer.json"


def measured(client, wid, identity, profile="paper_v1", **query):
    given = request(wid, identity, profile)
    given["query"].update({"limit": 100, **query})
    response = client.post(ROUTE, json=given)
    assert response.status_code == 200, response.text
    VALIDATOR.validate(response.json())
    return given, response.json(), {case["case_id"]: case for case in response.json()["cases"]}


def summary(case):
    actors = case["actor_summary"]
    return (actors["event_count"], actors["known_user_event_count"], actors["distinct_normalized_user_count"],
            actors["batch_event_count"], actors["unknown_event_count"], actors["available"])


def test_t08_strict_paper_attribution_counts_breadth_and_shares(tmp_path):
    folder = tmp_path / "workspace"; folder.mkdir()
    with TestClient(create_app()) as client:
        wid, base = prepare_source(client, folder, LITERAL)
        _, answer, cases = measured(client, wid, base)
        # T08-AC01: four events, three by users, two distinct users, one batch, none unknown.
        assert summary(cases["A"]) == (4, 3, 2, 1, 0, True)
        assert (cases["A"]["measures"]["user_event_count"]["value"], cases["A"]["measures"]["distinct_user_count"]["value"]) == (3, 2)
        # T08-AC02: batch-only is a known zero, not missing effort.
        assert summary(cases["B"]) == (2, 0, 0, 2, 0, True)
        assert (cases["B"]["measures"]["user_event_count"]["value"], cases["B"]["measures"]["user_event_count"]["available"]) == (0, True)
        assert (cases["B"]["measures"]["distinct_user_count"]["value"], cases["B"]["measures"]["distinct_user_count"]["available"]) == (0, True)
        # T08-AC03: whitespace and case are normalized; the original cells are kept as they were.
        assert summary(cases["C"]) == (3, 2, 1, 1, 0, True)
        assert [actor["raw"] for actor in cases["C"]["actor_records"]] == [" USER_1 ", "user_1", " batch_2 "]
        assert [actor["normalized"] for actor in cases["C"]["actor_records"]] == ["user_1", "user_1", "batch_2"]
        # T08-AC04: only a whole user_N or batch_N cell is attributed.
        assert [actor["classification"] for actor in cases["H"]["actor_records"]] == ["unknown"] * 5 + ["user", "batch"]
        assert summary(cases["H"]) == (7, 1, 1, 1, 5, False)
        # T08-AC05: an unrelated unknown actor makes effort unavailable; the invoice count is unaffected.
        d = cases["D"]["measures"]
        assert (d["user_event_count"]["value"], d["user_event_count"]["available"], d["user_event_count"]["lower_bound"]) == (None, False, 1)
        assert (d["distinct_user_count"]["available"], d["user_event_count"]["reason"]) == (False, "incomplete_resource_attribution")
        assert cases["D"]["actor_summary"]["unknown_event_count"] == 1
        assert (d["invoice_count"]["value"], d["invoice_count"]["available"]) == (1, True)
        # T08-AC06, strict half: robot is not a user identity.
        assert summary(cases["E"]) == (2, 1, 1, 0, 1, False)
        # T08-AC07: breadth is the same for both orders; no transition count is reported under its name.
        for case in ("F", "G"):
            assert (cases[case]["measures"]["user_event_count"]["value"], cases[case]["measures"]["distinct_user_count"]["value"]) == (3, 2)
            assert not any("transition" in name or "handoff" in name for name in cases[case]["measures"])
        # T08-AC08: batch/all keeps unknown actors in its denominator; batch/human is a separately named share.
        a = cases["A"]["actor_summary"]
        assert (a["batch_all_share"], a["batch_all_denominator"], a["batch_human_ratio"], a["batch_human_denominator"]) == (1 / 4, 4, 1 / 3, 3)
        k = cases["K"]["actor_summary"]
        assert (k["batch_all_share"], k["batch_all_denominator"], k["unknown_event_count"]) == (1 / 5, 5, 1)
        # T08-AC10: actor counts need no chronology, so one unparseable time leaves them available.
        assert summary(cases["T"]) == (2, 2, 2, 0, 0, True)
        assert cases["T"]["measures"]["distinct_user_count"]["value"] == 2
        public = {key: value for key, value in answer.items() if key not in ("request_id", "query_revision", "workspace_id")}
        assert public == json.loads(BROWSER_ANSWER.read_text(encoding="utf-8"))


def test_t08_historical_prefix_attribution_is_a_separate_definition(tmp_path):
    folder = tmp_path / "workspace"; folder.mkdir()
    with TestClient(create_app()) as client:
        wid, base = prepare_source(client, folder, LITERAL)
        _, strict, strict_cases = measured(client, wid, base)
        _, historical, cases = measured(client, wid, base, "historical_v1")
        assert historical["definition_id"] != strict["definition_id"]
        assert (strict["definition"]["measure_profile"], historical["definition"]["measure_profile"]) == ("paper_v1", "historical_v1")
        # T08-AC06: the historical prefix rule counts robot as a human; strict attribution does not.
        e = cases["E"]["historical_measures"]
        assert (e["historical_manual_touch_count"]["value"], e["historical_distinct_human_resources"]["value"]) == (2, 2)
        assert strict_cases["E"]["measures"]["user_event_count"]["available"] is False
        # T08-AC03: the historical raw-string identity sees two humans in C; the corrected profile sees one.
        assert cases["C"]["historical_measures"]["historical_distinct_human_resources"]["value"] == 2
        assert strict_cases["C"]["measures"]["distinct_user_count"]["value"] == 1
        # Both keep the original labels.
        assert [actor["raw"] for actor in cases["E"]["actor_records"]] == ["robot", "user_1"]


def test_t08_refusals_name_the_resource_role_and_change_nothing(tmp_path):
    folder = tmp_path / "workspace"; folder.mkdir()
    with TestClient(create_app()) as client:
        wid, base = prepare_source(client, folder, LITERAL)
        given, answer, _ = measured(client, wid, base)
        for change, code in ((lambda q: q["roles"].update(resource=99), "invalid_parameter"),
                             (lambda q: q["roles"].update(resource=True), "invalid_request")):
            bad = deepcopy(given)
            change(bad["query"])
            refused = client.post(ROUTE, json=bad)
            assert refused.status_code == 400 and refused.json()["code"] == code, refused.text
            assert refused.json()["field"].startswith("query.roles")
            assert "cases" not in refused.json()
        # Without a resource role, effort is unavailable with its reason; the other measures stay.
        _, unbound, cases = measured(client, wid, base, roles={**given["query"]["roles"], "resource": None})
        assert cases["A"]["measures"]["user_event_count"]["reason"] == "role_unmapped"
        assert cases["A"]["measures"]["invoice_count"]["value"] == 1
        assert unbound["definition_id"] != answer["definition_id"]
        again = client.post(ROUTE, json=given)
        assert again.status_code == 200 and again.json()["cases"] == answer["cases"]


def test_t08_both_attributions_survive_save_and_a_different_process(tmp_path):
    with socket.socket() as reserving:
        reserving.bind(("127.0.0.1", 0))
        port = reserving.getsockname()[1]
    folder = tmp_path / "workspace"; folder.mkdir()
    first, client = start_process(port)
    try:
        wid, base = prepare_source(client, folder, LITERAL)
        strict_query, strict, _ = measured(client, wid, base)
        historical_query, historical, _ = measured(client, wid, base, "historical_v1")
        actions = [{"operation": "bpic19_measures", "identity": base, "query": query["query"], "definition_id": answer["definition_id"]}
                   for query, answer in ((strict_query, strict), (historical_query, historical))]
        selected = client.post("/api/investigations/select-cases", json=envelope("select_cases_request", workspace_id=wid,
            identity=base, parent_case_ids=None, predicates=[]))
        saved = client.post("/api/investigations/save", json=envelope("save_investigation_request", workspace_id=wid,
            investigation_id=None, expected_revision_id=None, name="Strict and historical actors", base_identity=base,
            selection_identity=selected.json()["identity"], selection_recipe={"parent_case_ids": selected.json()["parent"]["case_ids"], "predicates": []},
            context_policy="incident.context.first_record_in_declared_order.v1", comparison=None, notes="Synthetic T08 actors",
            bookmarks=[], bpic19_pipeline={"schema_version": 1, "actions": actions}))
        assert saved.status_code == 200, saved.text
        saved = saved.json()
    finally:
        first.terminate()
        first.wait(timeout=15)
    assert first.returncode is not None
    second, fresh = start_process(port)
    try:
        assert second.pid != first.pid
        assert fresh.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(folder))).status_code == 200
        reopened = fresh.post("/api/investigations/reopen", json=envelope("reopen_investigation_request",
            workspace_id=wid, saved_revision_id=saved["revision"]["saved_revision_id"]))
        assert reopened.status_code == 200, reopened.text
        assert reopened.json()["bpic19_outputs"] == saved["bpic19_outputs"]
        outputs = {output["output"]["definition"]["measure_profile"]: output["output"] for output in reopened.json()["bpic19_outputs"]["outputs"]}
        paper = {case["case_id"]: case for case in outputs["paper_v1"]["cases"]}
        assert summary(paper["B"]) == (2, 0, 0, 2, 0, True)  # the known zero
        assert summary(paper["D"]) == (2, 1, 1, 0, 1, False)  # the mixed, unavailable item
        assert [actor["raw"] for actor in paper["C"]["actor_records"]] == [" USER_1 ", "user_1", " batch_2 "]
        assert {case["case_id"]: case for case in outputs["historical_v1"]["cases"]}["E"]["historical_measures"]["historical_manual_touch_count"]["value"] == 2
        assert outputs["paper_v1"]["definition_id"] != outputs["historical_v1"]["definition_id"]
    finally:
        second.terminate()
        second.wait(timeout=15)
