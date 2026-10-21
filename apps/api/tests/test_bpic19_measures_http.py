"""Literal source oracles across import, frozen selection and raw-measure HTTP boundaries."""
import csv
import io
import json
from pathlib import Path

from fastapi.testclient import TestClient
from jsonschema import Draft202012Validator
from wise_platform_api.app import create_app
from import_requests import envelope, policies, wall_policies

ROOT = Path(__file__).resolve().parents[3]
VALIDATOR = Draft202012Validator(json.loads((ROOT / "contracts/bpic19-measures.schema.json").read_text()))
ROUTE = "/api/investigations/bpic19-measures"
ROLES = {"item_category": 3, "resource": 4, "net_worth": 5, "purchasing_document": 6, "company": 7, "spend_area": 8}


def source():
    stream = io.StringIO(newline="")
    writer = csv.writer(stream)
    writer.writerow(["case", "activity", "time", "case Item Category", "event org:resource", "event Cumulative net worth (EUR)", "case Purchasing Document", "case Company", "case Spend area text"])
    writer.writerows([
        ["a", "Record Invoice Receipt", "2018-01-01T00:00:00", "3-way match, invoice after GR", "user_1", 10, "D", "C", "Packaging"],
        ["a", "Clear Invoice", "2018-01-03T00:00:00", "3-way match, invoice after GR", "batch_1", 10, "D", "C", "Packaging"],
        ["b", "Record Invoice Receipt", "", "2-way match", "legacy_system", 20, "E", "C", "Logistics"],
    ])
    return stream.getvalue().encode()


def prepare_source(client, workspace, raw=None, time_policies=None):
    opened = client.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(workspace)))
    wid = opened.json()["workspace_id"]
    stored = client.put("/api/sources", params=envelope("upload_source_metadata", workspace_id=wid, filename="measure-literal.csv"), content=source() if raw is None else raw, headers={"Content-Type": "application/octet-stream"})
    assert stored.status_code == 200, stored.text
    prepared = client.post("/api/preparations", json=envelope("confirm_mapping_request", workspace_id=wid,
        source_id=stored.json()["source"]["source_id"], dialect={"encoding": "utf-8", "delimiter": ",", "quotechar": '"', "header": "first_record"},
        mapping={"case_column": 0, "activity_column": 1, "timestamp_column": 2, "sequence_column": None, "context_columns": [3,6,7,8]},
        policies=wall_policies("iso8601", "2027-01-01T00:00:00") if time_policies is None else time_policies, accept_report_issues=True))
    assert prepared.status_code == 200 and prepared.json()["state"] == "ready", prepared.text
    population = client.post("/api/investigations/open-population", json=envelope("open_population_request", workspace_id=wid, preparation_id=prepared.json()["preparation"]["preparation_id"]))
    assert population.status_code == 200, population.text
    return wid, population.json()["identity"]


def request(wid, identity, profile="paper_v1", offset=0):
    return envelope("bpic19_measures_request", "literal-measures-"+str(offset), 2, workspace_id=wid, identity=identity,
        query={"policy_id": "bpic19.source_witnessed_measures.v1", "measure_profile": profile, "roles": ROLES, "offset": offset, "limit": 1, "calibration_population": "parent"})


def test_http_witnesses_missing_time_and_paging_then_reopen(tmp_path):
    workspace = tmp_path / "workspace"; workspace.mkdir()
    with TestClient(create_app()) as client:
        wid, identity = prepare_source(client, workspace)
        given = request(wid, identity)
        response = client.post(ROUTE, json=given)
        assert response.status_code == 200, response.text
        first = response.json(); VALIDATOR.validate(first)
        assert first["population_case_count"] == 2 and first["population_record_count"] == 3
        assert first["cases"][0]["measures"]["invoice_to_clearing_days"]["value"] == 2
        assert len(first["cases"][0]["measures"]["invoice_to_clearing_days"]["row_ids"]) == 2
        assert first["summaries"]["invoice_count"]["available_case_count"] == 2
        assert first["summaries"]["invoice_to_clearing_days"]["unavailable_case_count"] == 1
        page = client.post(ROUTE, json=request(wid, identity, offset=1))
        assert page.status_code == 200, page.text
        second = page.json(); VALIDATOR.validate(second)
        assert second["result_id"] == first["result_id"] and second["summaries"] == first["summaries"]
        assert second["cases"][0]["measures"]["invoice_count"]["value"] == 1
        assert second["cases"][0]["measures"]["user_event_count"]["reason"] == "incomplete_resource_attribution"
    with TestClient(create_app()) as fresh:
        fresh.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(workspace)))
        replayed = fresh.post(ROUTE, json=given)
        assert replayed.status_code == 200, replayed.text
        assert replayed.json()["result_id"] == first["result_id"]


def test_selected_historical_population_uses_frozen_parent_calibration(tmp_path):
    workspace = tmp_path / "workspace"; workspace.mkdir()
    with TestClient(create_app()) as client:
        wid, identity = prepare_source(client, workspace)
        selected = client.post("/api/investigations/select-cases", json=envelope("select_cases_request", "keep-a", 3, workspace_id=wid,
            identity=identity, parent_case_ids=None, predicates=[{"kind": "case_id_in", "case_ids": ["a"], "negate": False}]))
        assert selected.status_code == 200, selected.text
        response = client.post(ROUTE, json=request(wid, selected.json()["identity"], "historical_v1"))
        assert response.status_code == 200, response.text
        answer = response.json(); VALIDATOR.validate(answer)
        assert answer["definition"]["calibration"]["case_count"] == 2
        assert answer["definition"]["calibration"]["quantile"] == 19.5
        assert answer["cases"][0]["historical_measures"]["exposure_norm"]["value"] == 10/19.5
        assert answer["cases"][0]["record_count"] == 2


def test_invalid_role_types_indices_and_foreign_population_refuse(tmp_path):
    workspace = tmp_path / "workspace"; workspace.mkdir()
    with TestClient(create_app()) as client:
        wid, identity = prepare_source(client, workspace)
        bad = request(wid, identity); bad["query"]["roles"] = {**ROLES, "resource": True}
        refused = client.post(ROUTE, json=bad)
        assert refused.status_code == 400 and refused.json()["field"] == "query.roles.resource"
        bad = request(wid, identity); bad["query"]["roles"] = {**ROLES, "resource": 99}
        refused = client.post(ROUTE, json=bad)
        assert refused.status_code == 400 and refused.json()["code"] == "invalid_parameter"
        bad = request(wid, {**identity, "population_id": "population.v1:sha256:"+"f"*64})
        refused = client.post(ROUTE, json=bad)
        assert refused.status_code == 404 and refused.json()["code"] == "population_unavailable"


LITERAL = b'''case,activity,time,case Item Category,event org:resource,event Cumulative net worth (EUR),case Purchasing Document,case Company,case Spend area text
A,Record Invoice Receipt,2018-01-01T00:00:00,, USER_1 ,100,D,001,Packaging
A,Record Invoice Receipt,2018-01-01T00:00:00,,user_1,100,D,001,Packaging
A,Clear Invoice,2018-01-02T00:00:00,,batch_2,100,D,001,Packaging
A,Change Price,2018-01-03T00:00:00,,user_2,100,D,001,Packaging
A,Change Quantity,2018-01-04T00:00:00,,user_2,100,D,001,Packaging
A,Cancel Invoice Receipt,2018-01-05T00:00:00,,user_2,100,D,001,Packaging
B,Vendor creates invoice,2018-01-01T00:00:00,,robot,10,E,1,Packaging
C,Other,,,,,F,1,Packaging
D,Record Invoice Receipt,2018-01-01T00:00:00,,user_1,NaN,G,1,Packaging
D,,2018-01-02T00:00:00,,NONE,0,G,1,Packaging
S,A,2018-01-01T00:00:00,,user_1,0,H,1,Packaging
S,B,2018-01-01T01:00:00,,user_1,0,H,1,Packaging
S,B,2018-01-01T01:00:00,,user_1,0,H,1,Packaging
S,B,2018-01-01T02:00:00,,user_1,0,H,1,Packaging
S,A,2018-01-01T03:00:00,,user_1,0,H,1,Packaging
V,Create Purchase Order Item,2018-01-01T00:00:00,,user_1,100,I,1,Packaging
V,Create Purchase Order Item,2018-01-02T00:00:00,,batch_1,100,I,1,Packaging
X,Create Purchase Order Item,2018-01-01T00:00:00,,user_1,100,J,1,Packaging
X,Create Purchase Order Item,2018-01-02T00:00:00,,user_1,120,J,1,Packaging
'''


def literal_row_ids():
    """Independent original-row identity oracle from the published content format."""
    import hashlib
    source_id = "source.v1:sha256:" + hashlib.sha256(LITERAL).hexdigest()
    return {position: "row.v1:sha256:" + hashlib.sha256(json.dumps({"format_version": 1, "source_id": source_id, "source_position": position - 1}, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest() for position in range(1, 20)}


def test_literal_http_selectors_coverage_minima_actors_values_and_suppression(tmp_path):
    workspace = tmp_path / "literal"; workspace.mkdir()
    with TestClient(create_app()) as client:
        wid, identity = prepare_source(client, workspace, LITERAL)
        given = request(wid, identity); given["query"]["limit"] = 100
        answer = client.post(ROUTE, json=given)
        assert answer.status_code == 200, answer.text
        answer = answer.json(); VALIDATOR.validate(answer)
        cases = {case["case_id"]: case for case in answer["cases"]}
        rows = literal_row_ids()
        assert answer["population_case_count"] == 7 and answer["population_record_count"] == 19
        assert cases["A"]["activity_measure"]["count"]["value"] == 2
        assert cases["A"]["activity_measure"]["matching_row_ids"] == [rows[1], rows[2]]
        assert cases["A"]["measures"]["selected_interval"]["value"] == 1
        assert cases["A"]["milestones"]["source"]["row_ids"] == [rows[1], rows[2]]
        assert cases["A"]["record_row_ids"] == [rows[i] for i in range(1, 7)]
        assert cases["B"]["activity_measure"]["count"]["value"] == 0
        assert cases["B"]["activity_measure"]["absence_row_ids"] == [rows[7]]
        assert cases["C"]["activity_measure"]["count"]["value"] == 0
        assert cases["C"]["activity_measure"]["absence_row_ids"] == [rows[8]]
        assert cases["D"]["activity_measure"]["count"]["value"] is None
        assert cases["D"]["activity_measure"]["presence"]["value"] == 1
        assert cases["D"]["activity_measure"]["repeated_presence"]["value"] is None
        assert cases["D"]["activity_measure"]["unknown_row_ids"] == [rows[10]]
        assert cases["A"]["actor_records"][0]["raw"] == " USER_1 "
        assert cases["A"]["actor_records"][0]["normalized"] == "user_1"
        assert cases["A"]["actor_summary"]["known_user_event_count"] == 5
        assert cases["A"]["actor_summary"]["distinct_normalized_user_count"] == 2
        assert cases["D"]["actor_summary"]["unknown_event_count"] == 1
        assert cases["D"]["measures"]["user_event_count"]["lower_bound"] == 1
        assert cases["D"]["amount_records"][0]["state"] == "invalid_nonfinite"
        assert cases["D"]["measures"]["exposure"]["value"] is None
        assert cases["V"]["measures"]["creation_value"]["value"] == 100
        assert cases["V"]["measures"]["creation_value"]["row_ids"] == [rows[16], rows[17]]
        assert cases["X"]["measures"]["creation_value"]["state"] == "conflicting"
        assert cases["S"]["representations"]["exact_sequence"] == ["A", "B", "B", "B", "A"]
        assert cases["S"]["representations"]["signature_suppressed_row_ids"] == [rows[13], rows[14], rows[15]]
        assert cases["A"]["context"]["company"]["value"] == "001"
        union = {**given, "query": {**given["query"], "activity_selector": ["Record Invoice Receipt", "Vendor creates invoice"], "activity_operator": "presence"}}
        changed = client.post(ROUTE, json=union)
        assert changed.status_code == 200, changed.text
        changed = changed.json(); VALIDATOR.validate(changed)
        assert changed["definition_id"] != answer["definition_id"]
        assert next(case for case in changed["cases"] if case["case_id"] == "B")["measures"]["selected_activity"]["value"] == 1
        page = {**union, "query": {**union["query"], "offset": 5, "limit": 2}}
        paged = client.post(ROUTE, json=page)
        assert paged.status_code == 200, paged.text
        paged = paged.json(); VALIDATOR.validate(paged)
        assert paged["result_id"] == changed["result_id"]
        assert paged["activity_cohorts"] == changed["activity_cohorts"]
        assert [case["case_id"] for case in paged["cases"]] == ["V", "X"]
        unique_event = {**given, "query": {**given["query"], "value_reducer": "unique_creation_event", "value_unit": "EUR", "value_band_edges": [10, 20]}}
        event = client.post(ROUTE, json=unique_event)
        assert event.status_code == 200, event.text
        event = event.json(); VALIDATOR.validate(event)
        assert next(case for case in event["cases"] if case["case_id"] == "V")["measures"]["selected_value"]["reason"] == "creation_event_not_unique"
        assert event["definition"]["value_unit"] == "EUR"
        assert event["definition"]["creation_conflict_policy"] == "unique_creation_event"


def test_literal_http_unsupported_definition_and_role_refusals_preserve_prior_answer(tmp_path):
    workspace = tmp_path / "refusals"; workspace.mkdir()
    with TestClient(create_app()) as client:
        wid, identity = prepare_source(client, workspace, LITERAL)
        given = request(wid, identity)
        baseline = client.post(ROUTE, json=given).json()
        for field, unsupported in [("activity_operator", "net_count"), ("interval_policy", "first_after"), ("value_reducer", "first_creation"), ("representation_policy", "selected_label_omission")]:
            bad = {**given, "query": {**given["query"], field: unsupported}}
            response = client.post(ROUTE, json=bad)
            assert response.status_code == 400, response.text
            VALIDATOR.validate(response.json())
            assert response.json()["code"] == "unsupported_definition"
        missing = {**given, "query": {**given["query"], "roles": {**ROLES, "activity": None}}}
        response = client.post(ROUTE, json=missing)
        assert response.status_code == 400 and response.json()["code"] == "role_unavailable"
        assert response.json()["field"] == "query.roles.activity"
        unsupported = {**given, "query": {**given["query"], "policy_id": "future.v9"}}
        response = client.post(ROUTE, json=unsupported)
        assert response.status_code == 400 and response.json()["code"] == "unsupported_policy"
        replay = client.post(ROUTE, json=given)
        assert replay.status_code == 200
        assert replay.json()["result_id"] == baseline["result_id"]
        assert replay.json()["cases"] == baseline["cases"]


def test_literal_http_five_item_frozen_p95_and_subset_normalization(tmp_path):
    raw = b'''case,activity,time,case Item Category,event org:resource,event Cumulative net worth (EUR),case Purchasing Document,case Company,case Spend area text
A,Create Purchase Order Item,2018-01-01T00:00:00,,user_1,,D,001,Packaging
B,Create Purchase Order Item,2018-01-01T00:00:00,,user_1,10,E,001,Packaging
C,Create Purchase Order Item,2018-01-01T00:00:00,,user_1,20,F,001,Packaging
D,Create Purchase Order Item,2018-01-01T00:00:00,,user_1,30,G,001,Packaging
E,Create Purchase Order Item,2018-01-01T00:00:00,,user_1,40,H,001,Packaging
'''
    workspace = tmp_path / "calibration"; workspace.mkdir()
    with TestClient(create_app()) as client:
        wid, identity = prepare_source(client, workspace, raw)
        given = request(wid, identity, "historical_v1"); given["query"]["limit"] = 100
        full = client.post(ROUTE, json=given)
        assert full.status_code == 200, full.text
        full = full.json(); VALIDATOR.validate(full)
        calibration = full["definition"]["calibration"]
        assert calibration["population_case_ids"] == ["A", "B", "C", "D", "E"]
        assert calibration["quantile"] == calibration["denominator"] == 38
        assert calibration["missing_case_count"] == 1
        assert [case["historical_measures"]["exposure_norm"]["value"] for case in full["cases"]] == [0, 10 / 38, 20 / 38, 30 / 38, 1]
        kept = client.post("/api/investigations/select-cases", json=envelope("select_cases_request", "keep-bc", 3, workspace_id=wid,
            identity=identity, parent_case_ids=None, predicates=[{"kind": "case_id_in", "case_ids": ["B", "C"], "negate": False}]))
        assert kept.status_code == 200, kept.text
        selected_request = request(wid, kept.json()["identity"], "historical_v1"); selected_request["query"]["limit"] = 100
        selected = client.post(ROUTE, json=selected_request)
        assert selected.status_code == 200, selected.text
        selected = selected.json(); VALIDATOR.validate(selected)
        assert selected["definition"]["calibration"] == calibration
        assert selected["definition_id"] == full["definition_id"]
        assert selected["result_id"] != full["result_id"]
        assert [case["historical_measures"]["exposure_norm"]["value"] for case in selected["cases"]] == [10 / 38, 20 / 38]
        recalibrate = {**selected_request, "query": {**selected_request["query"], "calibration_population": "selected"}}
        fresh = client.post(ROUTE, json=recalibrate)
        assert fresh.status_code == 200, fresh.text
        assert fresh.json()["definition"]["calibration"]["quantile"] == 19.5
        assert fresh.json()["definition_id"] != selected["definition_id"]


def test_literal_http_minimum_before_admission_bad_parse_reversal_and_clock(tmp_path):
    raw = b'''case,activity,time,case Item Category,event org:resource,event Cumulative net worth (EUR),case Purchasing Document,case Company,case Spend area text
O,Record Invoice Receipt,1948-01-01T00:00:00,,user_1,1,D,001,Packaging
O,Record Invoice Receipt,2018-01-01T00:00:00,,user_1,1,D,001,Packaging
O,Clear Invoice,2018-01-02T00:00:00,,user_1,1,D,001,Packaging
P,Record Invoice Receipt,unparseable,,user_1,1,E,001,Packaging
P,Record Invoice Receipt,2018-01-01T00:00:00,,user_1,1,E,001,Packaging
P,Clear Invoice,2018-01-02T00:00:00,,user_1,1,E,001,Packaging
R,Record Invoice Receipt,2018-01-10T00:00:00,,user_1,1,F,001,Packaging
R,Clear Invoice,2018-01-09T00:00:00,,user_1,1,F,001,Packaging
R,Clear Invoice,2018-01-11T00:00:00,,user_1,1,F,001,Packaging
T,Record Invoice Receipt,2020-01-01T00:00:00,,user_1,1,G,001,Packaging
T,Clear Invoice,2020-01-02T00:00:00,,user_1,1,G,001,Packaging
Z,Record Invoice Receipt,2017-01-01T00:00:00,,user_1,1,H,001,Packaging
Z,Clear Invoice,2017-01-01T21:36:00,,user_1,1,H,001,Packaging
'''
    workspace = tmp_path / "endpoints"; workspace.mkdir()
    with TestClient(create_app()) as client:
        wid, identity = prepare_source(client, workspace, raw)
        given = request(wid, identity); given["query"]["limit"] = 100
        response = client.post(ROUTE, json=given)
        assert response.status_code == 200, response.text
        response = response.json(); VALIDATOR.validate(response)
        cases = {case["case_id"]: case for case in response["cases"]}
        assert cases["O"]["milestones"]["source"]["timestamp"] == "1948-01-01T00:00:00"
        assert cases["O"]["milestones"]["source"]["endpoint_state"] == "out_of_range"
        assert len(cases["O"]["milestones"]["source"]["later_row_ids"]) == 1
        assert cases["P"]["measures"]["selected_interval"]["value"] == 1
        assert len(cases["P"]["milestones"]["source"]["unparseable_row_ids"]) == 1
        assert cases["R"]["measures"]["selected_interval"]["value"] is None
        assert cases["R"]["measures"]["selected_interval"]["recorded_difference_days"] == -1
        assert cases["R"]["measures"]["selected_interval"]["interval_state"] == "reversed"
        assert cases["T"]["milestones"]["source"]["endpoint_state"] == "out_of_range"
        assert cases["Z"]["measures"]["selected_interval"]["value"] == .9
        assert response["summaries"]["selected_interval"]["available_case_count"] == 2
        assert response["summaries"]["selected_interval"]["unavailable_case_count"] == 3
        assert response["summaries"]["selected_interval"]["median"] == .95
    instant = b'''case,activity,time,case Item Category,event org:resource,event Cumulative net worth (EUR),case Purchasing Document,case Company,case Spend area text
I,Record Invoice Receipt,2018-01-01T01:00:00+01:00,,user_1,1,D,001,Packaging
I,Clear Invoice,2018-01-01T00:00:00Z,,user_1,1,D,001,Packaging
'''
    with TestClient(create_app()) as client:
        wid, identity = prepare_source(client, workspace, instant, policies("iso8601", None))
        response = client.post(ROUTE, json=request(wid, identity))
        assert response.status_code == 200, response.text
        response = response.json(); VALIDATOR.validate(response)
        assert response["definition"]["clock_kind"] == "utc_instant"
        assert response["cases"][0]["measures"]["selected_interval"]["value"] == 0
