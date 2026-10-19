"""#129 count and exposure-scaled priorities: each value recipe states its own result, none substitutes for another.

Expected values are written from the rows below by hand. E2 has two Create Purchase Order Item records of 100;
V2 two of 100 and 120 (in that source order); M one creation of 10 followed by a goods receipt observing 20;
document D4 holds S1 (creation 10 then three observations of 10) and S2 (creation 20).
"""

import csv
import io

from fastapi.testclient import TestClient
import pytest

from wise_platform_api.app import create_app
from import_requests import envelope
from test_bpic19_measures_http import ROUTE as MEASURES
from test_bpic19_scoring_http import ROLES, VALIDATOR, given, prepare

AFTER, CREATE = "3-way match, invoice after GR", "Create Purchase Order Item"


def item(case, document, events):
    return [[case, document, "00010", AFTER, "true", "true", "Standard", "0000", "Packaging", activity, f"2018-01-0{index + 1}T00:00:00Z", "user_1", value]
            for index, (activity, value) in enumerate(events)]


def literal(*items) -> bytes:
    output = io.StringIO(newline="")
    writer = csv.writer(output)
    writer.writerow(["case", "case Purchasing Document", "case Item", "case Item Category", "case Goods Receipt",
                     "case GR-Based IV", "case Item Type", "case Company", "case Spend area text", "activity", "time",
                     "event org:resource", "event Cumulative net worth (EUR)"])
    for rows in items:
        writer.writerows(rows)
    return output.getvalue().encode()


SOURCE = literal(item("E2", "D1", [(CREATE, 100), (CREATE, 100), ("Record Invoice Receipt", 100)]),
                 item("V2", "D2", [(CREATE, 100), (CREATE, 120)]),
                 item("M", "D3", [(CREATE, 10), ("Record Goods Receipt", 20)]),
                 item("S1", "D4", [(CREATE, 10), ("Record Goods Receipt", 10), ("Record Invoice Receipt", 10), ("Clear Invoice", 10)]),
                 item("S2", "D4", [(CREATE, 20)]))
MEASURE_ROLES = {key: ROLES[key] for key in ("item_category", "purchasing_document", "company", "spend_area", "resource", "net_worth", "value")}


def values(client, wid, identity, reducer):
    given_ = envelope("bpic19_measures_request", workspace_id=wid, identity=identity, query={
        "policy_id": "bpic19.source_witnessed_measures.v1", "measure_profile": "paper_v1", "roles": MEASURE_ROLES,
        "offset": 0, "limit": 100, "calibration_population": "parent", "value_reducer": reducer, "value_unit": "EUR"})
    reply = client.post(MEASURES, json=given_)
    assert reply.status_code == 200, reply.text
    return {case["case_id"]: case["measures"]["selected_value"] for case in reply.json()["cases"]}, reply.json()["definition_id"]


def subset(client, wid, identity, case_ids):
    return client.post("/api/investigations/select-cases", json=envelope("select_cases_request", workspace_id=wid,
        identity=identity, parent_case_ids=None, predicates=[{"kind": "case_id_in", "case_ids": case_ids, "negate": False}])).json()["identity"]


def exposure(client, wid, identity, population, policy):
    request = given(wid, identity, criteria_family="completion", group_by=["document"], volume="exposure", exposure_policy=policy, min_cases=1)
    request["named_population"] = {"name": "Valued items", "identity": population}
    return client.post("/api/investigations/bpic19-score", json=request)


def test_t27_each_value_recipe_states_its_own_result(tmp_path):
    workspace = tmp_path / "workspace"; workspace.mkdir()
    with TestClient(create_app(static_dir=tmp_path / "unbuilt")) as client:
        wid, identity = prepare(client, workspace, SOURCE)
        event, event_id = values(client, wid, identity, "unique_creation_event")
        unique, unique_id = values(client, wid, identity, "unique_creation_value")
        first, first_id = values(client, wid, identity, "first_creation_source_position")
        maximum, maximum_id = values(client, wid, identity, "maximum_absolute_event_value")
        # T27-AC01: two creation events leave the unique-event recipe unavailable even with equal values.
        assert (event["E2"]["value"], event["E2"]["reason"]) == (None, "creation_event_not_unique")
        assert (unique["E2"]["value"], unique["E2"]["available"]) == (100, True)
        # 100 and 120: no unique value; the declared first witness gives 100.
        assert (unique["V2"]["value"], unique["V2"]["state"]) == (None, "conflicting")
        assert (first["V2"]["value"], first["V2"]["first_candidate_source_position"]) == (100, 3)
        # One creation of 10 later observed at 20: creation recipes give 10, maximum absolute gives 20.
        assert (event["M"]["value"], unique["M"]["value"], first["M"]["value"], maximum["M"]["value"]) == (10, 10, 10, 20)
        assert len({event_id, unique_id, first_id, maximum_id}) == 4


def test_t27_document_exposure_sums_item_creation_values_not_events(tmp_path):
    workspace = tmp_path / "workspace"; workspace.mkdir()
    with TestClient(create_app(static_dir=tmp_path / "unbuilt")) as client:
        wid, identity = prepare(client, workspace, SOURCE)
        valued = subset(client, wid, identity, ["S1", "S2"])
        runs = {}
        for policy in ("creation_value", "creation_unique_value", "creation_unique_event"):
            reply = exposure(client, wid, identity, valued, policy)
            assert reply.status_code == 200, reply.text
            VALIDATOR.validate(reply.json())
            runs[policy] = reply.json()
            # T27-AC06: 10 + 20, not the 60 recorded across S1's and S2's events.
            assert [(row["document"], row["volume"], row["n_cases"]) for row in reply.json()["report"]["documents"]] == [("D4", 30, 2)]
            calibration = reply.json()["report"]["exposure_calibration"]
            assert (calibration["policy"], calibration["population_case_ids"], calibration["missing_policy"]) == (policy, ["S1", "S2"], "refuse")
        # 27-E05: each recipe is its own definition; a count ranking is another.
        count = client.post("/api/investigations/bpic19-score", json={**given(wid, identity, criteria_family="completion", group_by=["document"], min_cases=1),
                                                                       "named_population": {"name": "Valued items", "identity": valued}}).json()
        assert len({run["definition_id"] for run in runs.values()} | {count["definition_id"]}) == 4
        assert [row["volume"] for row in count["report"]["documents"]] == [2]


def test_t27_an_unavailable_value_refuses_exposure_ranking_with_its_reason(tmp_path):
    workspace = tmp_path / "workspace"; workspace.mkdir()
    with TestClient(create_app(static_dir=tmp_path / "unbuilt")) as client:
        wid, identity = prepare(client, workspace, SOURCE)
        everything = subset(client, wid, identity, ["E2", "V2", "M", "S1", "S2"])
        # 27-E02: E2's two creation events leave unique-event exposure unavailable; no value is substituted.
        refused = exposure(client, wid, identity, everything, "creation_unique_event")
        assert refused.status_code == 400 and refused.json()["code"] == "invalid_parameter"
        assert refused.json()["field"] == "settings.exposure_policy" and "unavailable" in refused.json()["message"]
        assert "report" not in refused.json()
        # The explicitly separate maximum-absolute recipe is admitted on the same items.
        assert exposure(client, wid, identity, everything, "max_absolute_p95").status_code == 200
