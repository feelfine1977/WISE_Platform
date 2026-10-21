"""#124 milestone waiting occupancy over a trusted horizon, at public HTTP.

Expected values are written from the rows below by hand. Days count from 2018-01-01 (day 0) on the source's wall clock;
the preparation's trusted snapshot cutoff is 2018-01-21. Activation A, response B, first to first, horizon [day 0, day 6).
Source positions are one-based, as in original_ids():
A 1 A d0, 2 Change Price d1, 3 B d2; B 4 A d2, 5 B d4; C 6 A d1, 7 Change Price d2, 8 B d3; D 9 A d2, 10 B d2 (zero);
E 11 A d1 (no response); F 12 A d1, 13 B with no time; G 14 A d4, 15 B d2 (reversed).
"""

import socket
from copy import deepcopy

from fastapi.testclient import TestClient

from wise_platform_api.app import create_app
from import_requests import envelope
from test_bpic19_operators_http import ROUTE, VALIDATOR, WAITING, original_ids, prepare, request
from test_bpic19_pipeline_http import start_process

AFTER = '"3-way match, invoice after GR"'
ROWS = [("A", "A", 0), ("A", "Change Price", 1), ("A", "B", 2), ("B", "A", 2), ("B", "B", 4),
        ("C", "A", 1), ("C", "Change Price", 2), ("C", "B", 3), ("D", "A", 2), ("D", "B", 2), ("E", "A", 1),
        ("F", "A", 1), ("F", "B", None), ("G", "A", 4), ("G", "B", 2)]
RAW = ("case,activity,time,eventID,category,value,case Item Type,case Goods Receipt,case GR-Based Inv. Verif.,case Purchasing Document,case Item\n"
       + "".join(f"{case},{activity},{'' if day is None else f'2018-01-{day + 1:02d}T00:00:00'},{index + 1},{AFTER},10,Standard,true,true,D{case},1\n"
                 for index, (case, activity, day) in enumerate(ROWS))).encode()
PROFILE_ROLES = {"item_category": 4, "item_type": 6, "goods_receipt": 7, "gr_based_iv": 8, "purchasing_document": 9, "item": 10, "source_case": None}
COMPLETED = {**WAITING, "completion": "completed_only", "horizon_provenance": None}
CENSORED = WAITING
DAY = "2018-01-{:02d}T00:00:00".format


def waiting(client, wid, identity, recipe=COMPLETED, **change):
    given = request(wid, identity, {**recipe, **change}, limit=100)
    reply = client.post(ROUTE, json=given)
    assert reply.status_code == 200, reply.text
    VALIDATOR.validate(reply.json())
    return given, reply.json(), {case["case_id"]: case for case in reply.json()["cases"]}


def observation(case):
    o = case["observations"][0]
    return o["state"], o["reason"], o["activation_row_ids"], o["response_row_ids"], o["start"], o["end"]


def group(answer, key):
    return next(item for item in answer["selection_groups"] if item["key"] == key)


def opened(client, workspace):
    wid, base = prepare(client, workspace, RAW)
    parent = client.post("/api/investigations/select-cases", json=envelope("select_cases_request", workspace_id=wid, identity=base,
                                                                           parent_case_ids=None, predicates=[])).json()
    return wid, base, parent


def test_t22_retrospective_and_censored_occupancy_with_complete_peak_items(tmp_path):
    workspace = tmp_path / "workspace"; workspace.mkdir()
    r = original_ids(RAW, len(ROWS))
    with TestClient(create_app()) as client:
        wid, _, parent = opened(client, workspace)
        _, answer, cases = waiting(client, wid, parent["identity"])
        occupancy = answer["summary"]["occupancy"]
        # 22-B01: half-open [activation, response); D's equal times are a valid zero; B's start meets A's end without a
        # transient extra count; F's missing response time and G's reversed interval add nothing.
        assert [(s["start"], s["end"], s["occupancy"]) for s in occupancy["segments"]] == \
               [(DAY(1), DAY(2), 1), (DAY(2), DAY(3), 2), (DAY(3), DAY(4), 2), (DAY(4), DAY(5), 1), (DAY(5), DAY(7), 0)]
        assert (occupancy["available_interval_count"], occupancy["positive_duration_count"], occupancy["zero_duration_count"]) == (4, 3, 1)
        assert (occupancy["item_days"], occupancy["duration_weighted_mean"], occupancy["duration_weighted_lower_median"]) == (6, 1, 1)
        assert (occupancy["peak"], occupancy["peak_start"], occupancy["peak_end"], occupancy["peak_case_ids"]) == (2, DAY(2), DAY(3), ["A", "C"])
        # 22-AC06 and B04: the earliest peak keeps A and C whole: four endpoints plus their two Change Price records.
        peak = group(answer, "peak")
        assert (peak["case_ids"], peak["case_count"], peak["record_count"]) == (["A", "C"], 2, 6)
        assert (cases["A"]["record_row_ids"], cases["C"]["record_row_ids"]) == ([r[1], r[2], r[3]], [r[6], r[7], r[8]])
        assert observation(cases["A"])[2:4] == ([r[1]], [r[3]]) and observation(cases["C"])[2:4] == ([r[6]], [r[8]])
        evidence = client.post("/api/investigations/case-evidence", json=envelope("imported_case_evidence_request",
            workspace_id=wid, identity=parent["identity"], case_id="C")).json()
        assert sorted(record["row_id"] for record in evidence["records"]) == sorted([r[6], r[7], r[8]])
        # 22-B03: a missing response never means a known completion.
        assert observation(cases["D"])[:2] == ("zero", None)
        assert observation(cases["E"])[:4] == ("excluded", "no_recorded_response", [r[11]], [])
        assert observation(cases["F"])[:2] == ("unknown", "unknown_response_time")
        assert cases["F"]["observations"][0]["unknown_row_ids"] == [r[13]]
        g = cases["G"]["observations"][0]
        assert (g["state"], g["reason"], g["intervals"]["waiting_duration"]["recorded_difference_days"], g["start"]) == ("reversed", "reversed_interval", -2, None)
        # 22-B02: the right-censored question is its own definition; E stays open to the trusted horizon with no response row.
        _, censored, censored_cases = waiting(client, wid, parent["identity"], CENSORED)
        assert censored["definition_id"] != answer["definition_id"]
        assert observation(censored_cases["E"]) == ("censored", "trusted_horizon_right_censor", [r[11]], [], DAY(2), DAY(7))
        assert censored_cases["E"]["observations"][0]["intervals"]["waiting_duration"]["value"] == 5
        assert observation(censored_cases["F"])[:2] == ("unknown", "unknown_response_time")
        c_occupancy = censored["summary"]["occupancy"]
        assert (c_occupancy["peak"], c_occupancy["peak_case_ids"], c_occupancy["item_days"]) == (3, ["A", "C", "E"], 11)
        assert abs(c_occupancy["duration_weighted_mean"] - 11 / 6) < 1e-12
        assert (group(censored, "peak")["case_ids"], group(censored, "peak")["record_count"]) == (["A", "C", "E"], 7)
        # The cutoff receipt: the declared horizon, its provenance and the preparation's trusted cutoff.
        recipe = censored["definition"]["recipe"]
        assert (recipe["horizon_end"], recipe["horizon_provenance"], censored["catalogue"]["trusted_cutoff"], censored["catalogue"]["clock_kind"]) == \
               (DAY(7), WAITING["horizon_provenance"], "2018-01-21T00:00:00", "wall_clock")


def test_t22_clock_horizon_refusals_and_identities(tmp_path):
    workspace = tmp_path / "workspace"; workspace.mkdir()
    with TestClient(create_app()) as client:
        wid, _, parent = opened(client, workspace)
        identity = parent["identity"]
        _, answer, _ = waiting(client, wid, identity)
        # 22-AC07: zoned boundaries on a wall-clock source are refused, never converted.
        for change, code, field in (({"horizon_end": DAY(7) + "Z"}, "incompatible_clock", "query.recipe.horizon_end"),
                                    ({"horizon_start": DAY(1) + "+01:00"}, "incompatible_clock", "query.recipe.horizon_start"),
                                    # B's response on day 4 lies after a day-3 horizon: refused, not silently clipped.
                                    ({"horizon_end": DAY(4)}, "incompatible_horizon", "query.recipe.horizon_end"),
                                    # A censoring horizon beyond the trusted cutoff.
                                    ({**CENSORED, "horizon_end": DAY(22)}, "incompatible_horizon", "query.recipe.horizon_end")):
            refused = client.post(ROUTE, json=request(wid, identity, {**COMPLETED, **change}, limit=100))
            assert (refused.json()["code"], refused.json()["field"]) == (code, field), refused.text
            assert "cases" not in refused.json()
        # The explicit clip projection is a separate, admitted definition.
        _, clipped, clipped_cases = waiting(client, wid, identity, horizon_end=DAY(4), horizon_policy="clip")
        assert clipped["definition_id"] != answer["definition_id"]
        assert observation(clipped_cases["B"])[4:] == (DAY(3), DAY(4))
        # Changing the cutoff or the endpoint operator is a new definition and result; a page is not.
        _, later, _ = waiting(client, wid, identity, horizon_end=DAY(8))
        _, last, _ = waiting(client, wid, identity, endpoints="first_last")
        assert len({answer["definition_id"], later["definition_id"], last["definition_id"]}) == 3
        assert len({answer["result_id"], later["result_id"], last["result_id"]}) == 3
        page = request(wid, identity, COMPLETED, limit=2)
        page["query"]["offset"] = 2
        assert client.post(ROUTE, json=page).json()["definition_id"] == answer["definition_id"]
        # 22-E02: each refused setting names its field.
        for change, field in (({"activation_activities": ["A", "A"]}, "query.recipe.activation_activities"),
                              ({"completion": "live_queue"}, "query.recipe.completion"),
                              ({**CENSORED, "horizon_provenance": None}, "query.recipe.horizon_provenance"),
                              ({"horizon_start": "2018-01-01"}, "query.recipe.horizon_start")):
            refused = client.post(ROUTE, json=request(wid, identity, {**COMPLETED, **change}, limit=100))
            assert (refused.status_code, refused.json()["field"]) == (400, field), refused.text


def test_t22_kept_censored_peak_survives_a_different_process(tmp_path):
    with socket.socket() as reserving:
        reserving.bind(("127.0.0.1", 0))
        port = reserving.getsockname()[1]
    workspace = tmp_path / "workspace"; workspace.mkdir()
    r = original_ids(RAW, len(ROWS))
    first, client = start_process(port)
    try:
        wid, base, parent = opened(client, workspace)
        given, censored, before = waiting(client, wid, parent["identity"], CENSORED)
        predicate = {"kind": "case_id_in", "case_ids": ["A", "C", "E"], "negate": False}
        child = client.post("/api/investigations/select-cases", json=envelope("select_cases_request", workspace_id=wid, identity=base,
                                                                              parent_case_ids=None, predicates=[predicate])).json()
        # 22-B04: the kept peak is a typed step tied to this waiting answer and its earliest peak group.
        action = {"operation": "bpic19_waiting", "identity": parent["identity"], "query": given["query"], "definition_id": censored["definition_id"],
                  "selection_prefix_length": 0, "selection_keep": {"policy_id": "bpic19.operator_group_keep.v1", "step_index": 0,
                                                                   "group": {"kind": "operator_group", "key": "peak"}}}

        def save(actions, notes, previous=None, selection=child, predicates=(predicate,)):
            return client.post("/api/investigations/save", json=envelope("save_investigation_request", workspace_id=wid,
                investigation_id=previous and previous["revision"]["investigation_id"],
                expected_revision_id=previous and previous["revision"]["saved_revision_id"],
                name="T22 waiting occupancy", base_identity=base, selection_identity=selection["identity"],
                selection_recipe={"parent_case_ids": parent["parent"]["case_ids"], "predicates": list(predicates)},
                context_policy="incident.context.first_record_in_declared_order.v1", comparison=None, notes=notes,
                bookmarks=[], bpic19_pipeline={"schema_version": 1, "actions": actions}))

        for change, code in ((lambda k: k["group"].update(key="observation_censored"), "selection_mismatch"),
                             (lambda k: k["group"].update(key="no_such_group"), "invalid_parameter"),
                             (lambda k: k.update(policy_id="bpic19.association_set_keep.v1"), "unsupported_policy")):
            bad = deepcopy(action)
            change(bad["selection_keep"])
            refused = save([bad], "Refused keep")
            assert refused.status_code >= 400 and refused.json()["code"] == code, refused.text
        saved_a = save([action], "Censored peak kept")
        assert saved_a.status_code == 200, saved_a.text
        saved_a = saved_a.json()
        # 22-E07: the retrospective run B replaces A only with A's current revision.
        completed_query, completed, after_b = waiting(client, wid, parent["identity"])
        plain = {"operation": "bpic19_waiting", "identity": parent["identity"], "query": completed_query["query"], "definition_id": completed["definition_id"]}
        saved_b = save([plain], "Retrospective occupancy", saved_a, parent, ())
        assert saved_b.status_code == 200, saved_b.text
        saved_b = saved_b.json()
        assert save([plain], "Written against revision A", saved_a, parent, ()).status_code == 409
        assert [o["definition_id"] for o in saved_b["bpic19_outputs"]["outputs"]] == [completed["definition_id"]]
    finally:
        first.terminate()
        first.wait(timeout=15)
    assert first.returncode is not None
    second, fresh = start_process(port)
    try:
        assert second.pid != first.pid
        assert fresh.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(workspace))).status_code == 200
        # 22-AC08 and B05: clock, horizon, completion rule, every state, the peak and its witnesses come back exactly.
        for saved, answer, cases, completion in ((saved_a, censored, before, "right_censored"), (saved_b, completed, after_b, "completed_only")):
            reopened = fresh.post("/api/investigations/reopen", json=envelope("reopen_investigation_request",
                workspace_id=wid, saved_revision_id=saved["revision"]["saved_revision_id"]))
            assert reopened.status_code == 200, reopened.text
            assert reopened.json()["bpic19_outputs"] == saved["bpic19_outputs"]
            output = reopened.json()["bpic19_outputs"]["outputs"][0]["output"]
            assert (output["definition"]["recipe"]["completion"], output["catalogue"]["clock_kind"], output["catalogue"]["trusted_cutoff"]) == \
                   (completion, "wall_clock", "2018-01-21T00:00:00")
            assert output["summary"]["occupancy"] == answer["summary"]["occupancy"]
            assert {case["case_id"]: observation(case) for case in output["cases"]} == {key: observation(case) for key, case in cases.items()}
        kept = fresh.post("/api/investigations/reopen", json=envelope("reopen_investigation_request",
            workspace_id=wid, saved_revision_id=saved_a["revision"]["saved_revision_id"])).json()
        assert kept["revision"]["content"]["selection_recipe"]["predicates"] == [predicate]
        assert kept["bpic19_outputs"]["outputs"][0]["output"]["summary"]["occupancy"]["peak_case_ids"] == ["A", "C", "E"]
        e = next(case for case in kept["bpic19_outputs"]["outputs"][0]["output"]["cases"] if case["case_id"] == "E")
        assert observation(e) == ("censored", "trusted_horizon_right_censor", [r[11]], [], DAY(2), DAY(7))
    finally:
        second.terminate()
        second.wait(timeout=15)
