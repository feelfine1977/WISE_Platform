"""#128 occurrence-quantified recorded-event rules A→B, at public HTTP.

Expected values are written from the rows below by hand. Source positions are one-based, as in original_ids();
each row's eventID is its position. Default rule: eventual response A→B, every activation, partner reuse,
equal time allowed, no activation is NotActivated, all flows.
M 1 A d1, 2 B d2, 3 A d3 (multiple occurrences: a1→b1, a2 unmatched); E 4 A d1, 5 B d1 (equal time, lag 0);
N 6 B d1, 7 X d2 (no activation); P 8 A d1, 9 X d2 (missing partner); U 10 A d1, 11 B with an unparseable time.
"""

import json
import socket

from fastapi.testclient import TestClient

from wise_platform_api.app import create_app
from import_requests import envelope
from test_bpic19_operators_http import RULE, ROUTE, VALIDATOR, original_ids, prepare, request
from test_bpic19_pipeline_http import start_process

AFTER = '"3-way match, invoice after GR"'
ROWS = [("M", "A", "2018-01-01T00:00:00"), ("M", "B", "2018-01-02T00:00:00"), ("M", "A", "2018-01-03T00:00:00"),
        ("E", "A", "2018-01-01T00:00:00"), ("E", "B", "2018-01-01T00:00:00"),
        ("N", "B", "2018-01-01T00:00:00"), ("N", "X", "2018-01-02T00:00:00"),
        ("P", "A", "2018-01-01T00:00:00"), ("P", "X", "2018-01-02T00:00:00"),
        ("U", "A", "2018-01-01T00:00:00"), ("U", "B", "not-a-time")]
RAW = ("case,activity,time,eventID,category,value,case Item Type,case Goods Receipt,case GR-Based Inv. Verif.,case Purchasing Document,case Item\n"
       + "".join(f"{case},{activity},{time},{index + 1},{AFTER},10,Standard,true,true,D{case},1\n"
                 for index, (case, activity, time) in enumerate(ROWS))).encode()
PROFILE_ROLES = {"item_category": 4, "item_type": 6, "goods_receipt": 7, "gr_based_iv": 8, "purchasing_document": 9, "item": 10, "source_case": None}


def rule(client, wid, identity, **recipe):
    given = request(wid, identity, {**RULE, **recipe}, limit=100)
    reply = client.post(ROUTE, json=given)
    assert reply.status_code == 200, reply.text
    VALIDATOR.validate(reply.json())
    return given, reply.json(), {case["case_id"]: case for case in reply.json()["cases"]}


def occurrences(case):
    return [(o["state"], o["reason"], o["activation_row_ids"], o["response_row_ids"]) for o in case["observations"]]


def test_t26_quantifiers_and_the_three_distinct_absences(tmp_path):
    workspace = tmp_path / "workspace"; workspace.mkdir()
    r = original_ids(RAW, len(ROWS))
    with TestClient(create_app()) as client:
        wid, identity = prepare(client, workspace, RAW)
        _, every, cases = rule(client, wid, identity)
        # 26-B01/B03: every activation is its own occurrence with its activation and partner rows.
        assert occurrences(cases["M"]) == [("matched", None, [r[1]], [r[2]]), ("unmatched", "no_recorded_partner", [r[3]], [])]
        assert (cases["M"]["truth"], cases["M"]["activation_count"]) == ("false", 2)
        _, some, some_cases = rule(client, wid, identity, quantifier="some")
        assert some_cases["M"]["truth"] == "true" and occurrences(some_cases["M"]) == occurrences(cases["M"])
        # Equal time is a legitimate zero lag under allow-equal and no partner under strict.
        e = cases["E"]["observations"][0]
        assert (e["state"], e["response_row_ids"], e["intervals"]["relation_lag"]["value"]) == ("matched", [r[5]], 0)
        _, strict, strict_cases = rule(client, wid, identity, ties="strict")
        assert (strict_cases["E"]["truth"], occurrences(strict_cases["E"])) == ("false", [("unmatched", "no_recorded_partner", [r[4]], [])])
        # 26-B02: no activation, a recorded nonmatch and unknown chronology stay three different states.
        assert (cases["N"]["state"], cases["N"]["reason"], cases["N"]["truth"], cases["N"]["observations"]) == ("not_activated", "no_known_activation", None, [])
        assert (cases["P"]["state"], cases["P"]["truth"], occurrences(cases["P"])) == ("evaluated", "false", [("unmatched", "no_recorded_partner", [r[8]], [])])
        u = cases["U"]
        assert (u["state"], u["reason"], u["truth"]) == ("unknown", "unknown_rule_support", "unknown")
        assert (u["observations"][0]["state"], u["observations"][0]["reason"], u["observations"][0]["unknown_row_ids"]) == ("unknown", "potential_unknown_partner", [r[11]])
        # Logical vacuity is a separate, declared definition; it is not an observed satisfying example.
        _, logical, logical_cases = rule(client, wid, identity, vacuity="logical")
        assert (logical_cases["N"]["reason"], logical_cases["N"]["truth"]) == ("logical_empty_quantification", "true")
        # Absence in a finite snapshot is descriptive only: no obligation, overdue or breach is stated.
        assert not {"overdue", "breach", "obligation", "grade"} & {word.strip('",:{}[]').lower() for word in json.dumps(every["cases"]).split()}
        # Occurrence support (5 activations, 2 unmatched) is not item support (P and M are the 2 false items).
        summary = every["summary"]
        assert (summary["activation_count"], summary["observation_state_counts"]) == (5, {"matched": 2, "unmatched": 2, "unknown": 1})
        assert (summary["case_state_counts"], summary["truth_case_counts"]) == ({"evaluated": 3, "not_activated": 1, "unknown": 1}, {"true": 1, "false": 2, "unknown": 1})
        # 26-B03: the complete item history stays, with the unmatched activation named.
        assert (cases["M"]["record_row_ids"], cases["M"]["unmatched_row_ids"]) == ([r[1], r[2], r[3]], [r[3]])
        evidence = client.post("/api/investigations/case-evidence", json=envelope("imported_case_evidence_request",
            workspace_id=wid, identity=identity, case_id="P"))
        assert sorted(record["row_id"] for record in evidence.json()["records"]) == sorted([r[8], r[9]])
        # 26-B01 and E05: each meaning-bearing choice is its own definition; a page is not.
        _, consume, _ = rule(client, wid, identity, reuse="consume")
        _, direct, _ = rule(client, wid, identity, position="raw_direct")
        _, precedence, _ = rule(client, wid, identity, relation="precedence")
        _, swapped, _ = rule(client, wid, identity, left_activities=["B"], right_activities=["A"])
        ids = [answer["definition_id"] for answer in (every, some, strict, logical, consume, direct, precedence, swapped)]
        assert len(set(ids)) == len(ids)
        page = request(wid, identity, RULE, limit=2)
        page["query"]["offset"] = 2
        assert client.post(ROUTE, json=page).json()["definition_id"] == every["definition_id"]


def test_t26_normative_grading_needs_an_admitted_method_binding(tmp_path):
    workspace = tmp_path / "workspace"; workspace.mkdir()
    with TestClient(create_app()) as client:
        wid, identity = prepare(client, workspace, RAW)
        descriptive, before, _ = rule(client, wid, identity)
        # 26-B04: a normative request without an admitted actual Method binding is refused; no grade or breach appears.
        refused = client.post(ROUTE, json={**descriptive, "intent": "normative_admission"})
        assert (refused.status_code, refused.json()["code"], refused.json()["field"]) == (409, "method_binding_unavailable", "intent"), refused.text
        assert not {"score", "grade", "breach", "cases"} & refused.json().keys()
        # The descriptive answer stays available and unchanged.
        assert client.post(ROUTE, json=descriptive).json() == before


def test_t26_refusals_name_their_field(tmp_path):
    workspace = tmp_path / "workspace"; workspace.mkdir()
    with TestClient(create_app()) as client:
        wid, identity = prepare(client, workspace, RAW)
        for change, field in ((lambda q: q["recipe"].update(left_activities=["A", "A"]), "query.recipe.left_activities"),
                              (lambda q: q["recipe"].update(right_activities=[]), "query.recipe.right_activities"),
                              (lambda q: q["recipe"].update(quantifier="most"), "query.recipe.quantifier"),
                              (lambda q: q["recipe"].update(position="projected"), "query.recipe.position"),
                              (lambda q: (q["recipe"].update(flow_scope="after_gr"), q["roles"].update(item_category=None)), "query.roles.item_category"),
                              (lambda q: q["roles"].update(net_worth=99), "query.roles.net_worth"),
                              (lambda q: q.update(limit=0), "query.limit")):
            bad = request(wid, identity, RULE, limit=100)
            change(bad["query"])
            refused = client.post(ROUTE, json=bad)
            assert (refused.status_code, refused.json()["field"]) == (400, field), refused.text
            assert "cases" not in refused.json()


def test_t26_saved_rules_survive_a_different_process(tmp_path):
    with socket.socket() as reserving:
        reserving.bind(("127.0.0.1", 0))
        port = reserving.getsockname()[1]
    workspace = tmp_path / "workspace"; workspace.mkdir()
    first, client = start_process(port)
    try:
        wid, identity = prepare(client, workspace, RAW)
        given, answer, every = rule(client, wid, identity)
        selected = client.post("/api/investigations/select-cases", json=envelope("select_cases_request", workspace_id=wid,
            identity=identity, parent_case_ids=None, predicates=[])).json()

        def save(query, definition_id, notes, previous=None):
            return client.post("/api/investigations/save", json=envelope("save_investigation_request", workspace_id=wid,
                investigation_id=previous and previous["revision"]["investigation_id"],
                expected_revision_id=previous and previous["revision"]["saved_revision_id"],
                name="T26 quantified rule", base_identity=identity, selection_identity=selected["identity"],
                selection_recipe={"parent_case_ids": selected["parent"]["case_ids"], "predicates": []},
                context_policy="incident.context.first_record_in_declared_order.v1", comparison=None, notes=notes,
                bookmarks=[], bpic19_pipeline={"schema_version": 1, "actions": [{"operation": "bpic19_rule", "identity": identity,
                    "query": query, "definition_id": definition_id}]}))

        a = save(given["query"], answer["definition_id"], "Synthetic T26 rows, every occurrence")
        assert a.status_code == 200, a.text
        a = a.json()
        # 26-E07: revision B with the existential quantifier replaces A only with the current expected revision.
        some_query, some_answer, some = rule(client, wid, identity, quantifier="some")
        b = save(some_query["query"], some_answer["definition_id"], "Synthetic T26 rows, some occurrence", a)
        assert b.status_code == 200, b.text
        b = b.json()
        outdated = save(some_query["query"], some_answer["definition_id"], "Written against revision A", a)
        assert outdated.status_code == 409, outdated.text
        assert [o["output"]["definition_id"] for o in b["bpic19_outputs"]["outputs"]] == [some_answer["definition_id"]]
    finally:
        first.terminate()
        first.wait(timeout=15)
    assert first.returncode is not None
    second, fresh = start_process(port)
    try:
        assert second.pid != first.pid
        assert fresh.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(workspace))).status_code == 200
        # 26-B05: multiple-occurrence, equal-time, no-activation, missing-partner and unknown-clock items come back exactly.
        for saved, expected, quantifier in ((a, every, "every"), (b, some, "some")):
            reopened = fresh.post("/api/investigations/reopen", json=envelope("reopen_investigation_request",
                workspace_id=wid, saved_revision_id=saved["revision"]["saved_revision_id"]))
            assert reopened.status_code == 200, reopened.text
            assert reopened.json()["bpic19_outputs"] == saved["bpic19_outputs"]
            output = reopened.json()["bpic19_outputs"]["outputs"][0]["output"]
            assert output["definition"]["recipe"]["quantifier"] == quantifier
            after = {case["case_id"]: case for case in output["cases"]}
            assert {case: (after[case]["state"], after[case]["truth"], occurrences(after[case])) for case in "MENPU"} == \
                   {case: (expected[case]["state"], expected[case]["truth"], occurrences(expected[case])) for case in "MENPU"}
            assert after["U"]["observations"][0]["unknown_row_ids"] == expected["U"]["observations"][0]["unknown_row_ids"]
        assert fresh.post(ROUTE, json=given).json()["cases"] == answer["cases"]
    finally:
        second.terminate()
        second.wait(timeout=15)
