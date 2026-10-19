"""#111 source-witnessed item values over literal amount cells, at public HTTP.

Every expected value is written from the cells below by hand. Each item has one Create Purchase Order Item
record carrying its amount, except C (two creations, 10 and 20) and P (a 2017 creation of 30 before a 2018
invoice). The three B items share the value 10.
"""

from copy import deepcopy
import hashlib
import json
from pathlib import Path
import socket

from fastapi.testclient import TestClient

from wise_platform_api.app import create_app
from import_requests import envelope
from test_bpic19_measures_http import ROUTE, VALIDATOR, prepare_source, request
from test_bpic19_pipeline_http import start_process

CREATE = "Create Purchase Order Item"
ROWS = [("N", CREATE, "2018-01-01T00:00:00", "-5"), ("Z", CREATE, "2018-01-01T00:00:00", "0"), ("M", CREATE, "2018-01-01T00:00:00", ""),
        ("X1", CREATE, "2018-01-01T00:00:00", "NaN"), ("X2", CREATE, "2018-01-01T00:00:00", "Infinity"), ("X3", CREATE, "2018-01-01T00:00:00", "-Infinity"),
        ("B1", CREATE, "2018-01-03T00:00:00", "10"), ("B2", CREATE, "2018-01-01T00:00:00", "10"), ("B3", CREATE, "2018-01-02T00:00:00", "10"),
        ("C", CREATE, "2018-01-01T00:00:00", "10"), ("C", CREATE, "2018-01-02T00:00:00", "20"),
        ("P", CREATE, "2017-12-30T00:00:00", "30"), ("P", "Record Invoice Receipt", "2018-01-02T00:00:00", "30")]
LITERAL = ("case,activity,time,case Item Category,event org:resource,event Cumulative net worth (EUR),case Purchasing Document,case Company,case Spend area text\n"
           + "".join(f"{case},{activity},{time},,user_1,{amount},D{case},1,Packaging\n" for case, activity, time, amount in ROWS)).encode()
BROWSER_ANSWER = Path(__file__).resolve().parents[3] / "apps/web/src/bpic19/t09-values-answer.json"
VALUES = {"value_reducer": "unique_creation_value", "value_unit": "EUR", "value_band_edges": [10, 20]}


def rows():
    source_id = "source.v1:sha256:" + hashlib.sha256(LITERAL).hexdigest()
    return {position: "row.v1:sha256:" + hashlib.sha256(json.dumps({"format_version": 1, "source_id": source_id,
            "source_position": position - 1}, sort_keys=True, separators=(",", ":")).encode()).hexdigest() for position in range(1, len(ROWS) + 1)}


def measured(client, wid, identity, profile="paper_v1", **query):
    given = request(wid, identity, profile)
    given["query"].update({"limit": 100, **VALUES, **query})
    response = client.post(ROUTE, json=given)
    assert response.status_code == 200, response.text
    VALIDATOR.validate(response.json())
    return given, response.json(), {case["case_id"]: case for case in response.json()["cases"]}


def selected(client, wid, base, parent, predicates=()):
    response = client.post("/api/investigations/select-cases", json=envelope("select_cases_request", workspace_id=wid,
        identity=base, parent_case_ids=parent, predicates=list(predicates)))
    assert response.status_code == 200, response.text
    return response.json()


def value(case, name):
    measure = case["measures"][name]
    return measure["value"], measure["available"], measure["reason"]


def test_t09_creation_and_maximum_absolute_values_with_their_states(tmp_path):
    folder = tmp_path / "workspace"; folder.mkdir()
    r = rows()
    with TestClient(create_app()) as client:
        wid, base = prepare_source(client, folder, LITERAL)
        _, answer, cases = measured(client, wid, base)
        # T09-AC05: negative and zero are known values; a missing cell is unavailable, not zero.
        assert (value(cases["N"], "creation_value"), value(cases["N"], "exposure")) == ((-5, True, None), (5, True, None))
        assert (value(cases["Z"], "creation_value"), value(cases["Z"], "exposure")) == ((0, True, None), (0, True, None))
        assert value(cases["M"], "creation_value")[:2] == (None, False) and value(cases["M"], "exposure")[:2] == (None, False)
        # T09-AC06: non-finite text is invalid; the raw cell stays and no number is invented.
        for case, raw in (("X1", "NaN"), ("X2", "Infinity"), ("X3", "-Infinity")):
            assert value(cases[case], "creation_value") == (None, False, "invalid_nonfinite")
            assert [(amount["raw"], amount["value"], amount["state"]) for amount in cases[case]["amount_records"]] == [(raw, None, "invalid_nonfinite")]
            assert cases[case]["measures"]["creation_value"]["invalid_row_ids"] == cases[case]["record_row_ids"]
        public = json.dumps({key: item for key, item in answer.items() if key not in ("request_id", "query_revision", "workspace_id")}, allow_nan=False)
        assert "NaN" not in public.replace('"NaN"', "") and "Infinity" not in public.replace('"Infinity"', "").replace('"-Infinity"', "")
        # T09-AC13: two different creation values conflict; the maximum absolute value names its winner.
        conflict = cases["C"]["measures"]["creation_value"]
        assert (conflict["value"], conflict["state"], conflict["row_ids"]) == (None, "conflicting", [r[10], r[11]])
        exposure = cases["C"]["measures"]["exposure"]
        assert (exposure["value"], exposure["winner_row_ids"], exposure["row_ids"]) == (20, [r[11]], [r[10], r[11]])
        assert [amount["raw"] for amount in cases["C"]["amount_records"]] == ["10", "20"]
        assert answer["definition"]["value_unit"] == "EUR"
        # T09-AC10: tied values fall in one band whatever their order or IDs.
        bands = {band["band_index"]: band["case_ids"] for band in answer["value_bands"]}
        assert bands == {0: ["N", "Z"], 1: ["B1", "B2", "B3"], 2: ["P"]}
        assert sorted(answer["value_band_unavailable_case_ids"]) == ["C", "M", "X1", "X2", "X3"]
        # T09-AC11: the 2017 creation is in P's original history and is used with its lineage.
        assert value(cases["P"], "creation_value") == (30, True, None)
        assert cases["P"]["measures"]["creation_value"]["row_ids"] == [r[12]]
        assert json.loads(BROWSER_ANSWER.read_text(encoding="utf-8")) == {key: item for key, item in answer.items()
                                                                           if key not in ("request_id", "query_revision", "workspace_id")}


def test_t09_historical_compatibility_and_calibration_are_named_separately(tmp_path):
    folder = tmp_path / "workspace"; folder.mkdir()
    with TestClient(create_app()) as client:
        wid, base = prepare_source(client, folder, LITERAL)
        _, paper, _ = measured(client, wid, base)
        parent = selected(client, wid, base, ["M", "Z"])
        _, historical, cases = measured(client, wid, parent["identity"], "historical_v1", calibration_population="selected")
        assert historical["definition_id"] != paper["definition_id"]
        # T09-AC05: the historical proxy fills a missing amount with 0, and says so.
        m = cases["M"]["historical_measures"]["exposure_abs_max"]
        assert (m["value"], m["missing_fill_row_ids"]) == (0, cases["M"]["record_row_ids"])
        assert value(cases["M"], "exposure")[:2] == (None, False)
        # T09-AC09: an all-zero calibration parent has q95 0, divisor 1 and normalized values 0.
        calibration = historical["definition"]["calibration"]
        assert (calibration["case_count"], calibration["quantile"], calibration["denominator"], calibration["missing_case_count"]) == (2, 0, 1, 1)
        assert calibration["finite_guard"] == "panel_guard_not_present_in_original_historical_helper"
        assert [cases[case]["historical_measures"]["exposure_norm"]["value"] for case in ("M", "Z")] == [0, 0]
        empty = selected(client, wid, base, ["M", "Z"], [{"kind": "contains_activity", "activity": "Never recorded", "negate": False}])
        given = request(wid, empty["identity"], "historical_v1")
        given["query"].update({"limit": 100, **VALUES, "calibration_population": "selected"})
        refused = client.post(ROUTE, json=given)
        assert (refused.status_code, refused.json()["code"], refused.json()["field"]) == (400, "empty_calibration", "query.calibration_population")
        assert "cases" not in refused.json()


def test_t09_every_value_field_is_a_new_definition_and_refusals_name_it(tmp_path):
    folder = tmp_path / "workspace"; folder.mkdir()
    with TestClient(create_app()) as client:
        wid, base = prepare_source(client, folder, LITERAL)
        given, answer, _ = measured(client, wid, base)
        seen = {answer["definition_id"]}
        for name, change in {"reducer": {"value_reducer": "maximum_absolute_event_value"}, "unit": {"value_unit": "USD"},
                             "bands": {"value_band_edges": [5, 20]}, "event reducer": {"value_reducer": "unique_creation_event"},
                             "value role": {"roles": {**given["query"]["roles"], "net_worth": None, "value": None}}}.items():
            _, changed, _ = measured(client, wid, base, **change)
            assert changed["definition_id"] not in seen, name
            seen.add(changed["definition_id"])
        _, paged, _ = measured(client, wid, base, offset=3, limit=2)
        assert paged["definition_id"] == answer["definition_id"]
        for change, field in (({"value_band_edges": [20, 10]}, "query.value_band_edges"), ({"value_unit": " "}, "query.value_unit"),
                              ({"value_reducer": "mean_creation_value"}, "query.value_reducer")):
            bad = deepcopy(given)
            bad["query"].update(change)
            refused = client.post(ROUTE, json=bad)
            assert (refused.json()["code"], refused.json()["field"]) == ("unsupported_definition", field), refused.text
        unknown = deepcopy(given)
        unknown["query"]["value_representation"] = "event_projection"
        assert client.post(ROUTE, json=unknown).json()["code"] == "invalid_request"
        assert client.post(ROUTE, json=given).json()["cases"] == answer["cases"]


def test_t09_value_definitions_survive_save_and_a_different_process(tmp_path):
    with socket.socket() as reserving:
        reserving.bind(("127.0.0.1", 0))
        port = reserving.getsockname()[1]
    folder = tmp_path / "workspace"; folder.mkdir()
    first, client = start_process(port)
    try:
        wid, base = prepare_source(client, folder, LITERAL)
        parent = selected(client, wid, base, ["M", "Z"])
        paper_query, paper, _ = measured(client, wid, base)
        historical_query, historical, _ = measured(client, wid, parent["identity"], "historical_v1", calibration_population="selected")
        actions = [{"operation": "bpic19_measures", "identity": base, "query": paper_query["query"], "definition_id": paper["definition_id"]},
                   {"operation": "bpic19_measures", "identity": parent["identity"], "query": historical_query["query"],
                    "definition_id": historical["definition_id"], "selection_prefix_length": 0}]
        saved = client.post("/api/investigations/save", json=envelope("save_investigation_request", workspace_id=wid,
            investigation_id=None, expected_revision_id=None, name="Item values", base_identity=base,
            selection_identity=parent["identity"], selection_recipe={"parent_case_ids": ["M", "Z"], "predicates": []},
            context_policy="incident.context.first_record_in_declared_order.v1", comparison=None, notes="Synthetic T09 amounts",
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
        paper_out, historical_out = (output["output"] for output in reopened.json()["bpic19_outputs"]["outputs"])
        cases = {case["case_id"]: case for case in paper_out["cases"]}
        assert [amount["raw"] for amount in cases["X2"]["amount_records"]] == ["Infinity"]
        assert {band["band_index"]: band["case_ids"] for band in paper_out["value_bands"]}[1] == ["B1", "B2", "B3"]
        assert (paper_out["definition"]["value_band_edges"], paper_out["definition"]["value_unit"]) == ([10, 20], "EUR")
        calibration = historical_out["definition"]["calibration"]
        assert (calibration["population_case_ids"], calibration["quantile"], calibration["denominator"]) == (["M", "Z"], 0, 1)
    finally:
        second.terminate()
        second.wait(timeout=15)
