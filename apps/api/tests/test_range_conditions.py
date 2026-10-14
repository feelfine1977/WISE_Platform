"""Literal public-wire ranges; one descriptor keeps complete recorded histories."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from jsonschema import Draft202012Validator, FormatChecker
from wise_platform_api.app import create_app
from import_requests import envelope, policies, wall_policies

ROOT = Path(__file__).resolve().parents[3]
RAW = (ROOT / "tests/fixtures/incident-ranges.csv").read_bytes()
VALIDATORS = {name: Draft202012Validator(json.loads((ROOT / f"contracts/{name}.schema.json").read_text(encoding="utf-8")), format_checker=FormatChecker()) for name in ("selection", "import", "saving", "comparison")}
PARENT = list("ABCDEFGH")
PATH = {"kind": "directly_follows_lag_between", "source_activity": "Open", "target_activity": "Close", "minimum_hours": 4, "maximum_hours": 4, "quantifier": "any", "negate": False}


def post(c, route, request, schema="import", status=200):
    VALIDATORS[schema].validate(request)
    response = c.post(route, json=request)
    assert response.status_code == status, response.text
    answer = response.json()
    VALIDATORS[schema].validate(answer)
    assert answer["request_id"] == request["request_id"]
    assert answer["query_revision"] == request["query_revision"]
    return answer


def setup(c, folder, wall=False, raw=RAW, cutoff=None):
    folder.mkdir()
    wid = post(c, "/api/workspaces/open", envelope("open_workspace_request", path=str(folder)))["workspace_id"]
    raw = raw.replace(b"Z,", b",") if wall else raw
    response = c.put("/api/sources", params=envelope("upload_source_metadata", workspace_id=wid, filename="ranges.csv"), content=raw, headers={"Content-Type": "application/octet-stream"})
    assert response.status_code == 200
    pol = wall_policies("iso8601", cutoff or "2026-10-02T00:00:00") if wall else policies("iso8601", None, True, cutoff or "2026-10-02T00:00:00Z")
    prepared = post(c, "/api/preparations", envelope("confirm_mapping_request", workspace_id=wid, source_id=response.json()["source"]["source_id"], dialect={"encoding": "utf-8", "delimiter": ",", "quotechar": '"', "header": "first_record"}, mapping={"case_column": 0, "activity_column": 1, "timestamp_column": 2, "sequence_column": 3, "context_columns": []}, policies=pol, accept_report_issues=True))
    assert prepared["state"] == "ready"
    base = post(c, "/api/investigations/open-population", envelope("open_population_request", workspace_id=wid, preparation_id=prepared["preparation"]["preparation_id"]))
    return wid, base


def selection(c, wid, base, predicates, parent=PARENT):
    return post(c, "/api/investigations/select-cases", envelope("select_cases_request", "select-range", 2, workspace_id=wid, identity=base["identity"], parent_case_ids=parent, predicates=predicates), "selection")


def partition(answer):
    return tuple(answer[key]["case_ids"] for key in ("kept", "removed", "unevaluable"))


def snapshot(path):
    return {str(p.relative_to(path)): hashlib.sha256(p.read_bytes()).hexdigest() for p in path.rglob("*") if p.is_file()}


@pytest.mark.parametrize("wall", [False, True])
def test_literal_ranges_repeat_quantifiers_no_passage_unknown_raw_counts_and_full_histories(tmp_path, wall):
    with TestClient(create_app()) as c:
        wid, base = setup(c, tmp_path / "workspace", wall)
        before = snapshot(tmp_path / "workspace")
        expected = [
            ({"kind": "raw_record_count_between", "minimum_records": 2, "maximum_records": 3, "negate": False}, (["B", "D", "E", "F", "G"], ["A", "C", "H"], [])),
            ({"kind": "observed_span_between", "minimum_hours": 4, "maximum_hours": 6, "negate": False}, (["A", "B", "G"], ["C", "E", "F", "H"], ["D"])),
            ({"kind": "max_raw_gap_between", "minimum_hours": 0, "maximum_hours": 0, "negate": False}, (["E"], ["A", "B", "F", "G"], ["C", "D", "H"])),
            (PATH, (["A", "B", "G"], ["C", "E", "F", "H"], ["D"])),
            ({**PATH, "quantifier": "every"}, (["B", "G"], ["A", "C", "E", "F", "H"], ["D"])),
            ({**PATH, "minimum_hours": 0, "maximum_hours": None, "quantifier": "every"}, (["A", "B", "E", "F", "G"], ["C", "H"], ["D"])),
        ]
        for predicate, groups in expected:
            answer = selection(c, wid, base, [predicate])
            assert partition(answer) == groups
            assert len(answer["predicate_results"]) == 1
            assert answer["predicate_results"][0]["predicate"] == predicate
            negated = selection(c, wid, base, [{**predicate, "negate": True}])
            assert partition(negated) == (groups[1], groups[0], groups[2])
        # False dominates unknown; raw count remains known for D despite unavailable time.
        raw_false = {"kind": "raw_record_count_between", "minimum_records": 9, "maximum_records": None, "negate": False}
        assert partition(selection(c, wid, base, [PATH, raw_false])) == ([], PARENT, [])
        chosen = selection(c, wid, base, [PATH])
        graph = post(c, "/api/investigations/process-graph", envelope("process_graph_request", "range-graph", 2, workspace_id=wid, identity=chosen["identity"]), "selection")["graph"]
        assert graph["meta"]["selected_case_ids"] == ["A", "B", "G"]
        assert graph["meta"]["raw_record_count"] == 10
        assert next(e for e in graph["edges"] if e["payload"]["source_activity"] == "Open" and e["payload"]["target_activity"] == "Close")["metrics"]["count"] == 4
        evidence = post(c, "/api/investigations/case-evidence", envelope("imported_case_evidence_request", "range-evidence", 2, workspace_id=wid, identity=chosen["identity"], case_id="A"))
        assert len(evidence["records"]) == 5
        assert [r["activity"] for r in evidence["records"]] == ["Open", None, "Close", "Open", "Close"]
        assert snapshot(tmp_path / "workspace") == before
        canonical = selection(c, wid, base, [{**PATH, "minimum_hours": 4.0, "maximum_hours": 4.0}])
        assert canonical["identity"] == chosen["identity"]


def test_range_recipe_saves_and_replays_after_fresh_application_open(tmp_path):
    folder = tmp_path / "workspace"
    with TestClient(create_app()) as c:
        wid, base = setup(c, folder)
        predicates = [PATH, {"kind": "raw_record_count_between", "minimum_records": 3, "maximum_records": None, "negate": False}]
        selected = selection(c, wid, base, predicates)
        assert selected["kept"]["case_ids"] == ["A", "G"]
        saved = post(c, "/api/investigations/save", envelope("save_investigation_request", "save-ranges", 3, workspace_id=wid, investigation_id=None, expected_revision_id=None, name="Inclusive whole-incident ranges", base_identity=base["identity"], selection_identity=selected["identity"], selection_recipe={"parent_case_ids": PARENT, "predicates": predicates}, context_policy="incident.context.first_record_in_declared_order.v1", comparison=None, notes="", bookmarks=[]), "saving")
        revision = saved["revision"]["saved_revision_id"]
    with TestClient(create_app()) as fresh:
        reopened_workspace = post(fresh, "/api/workspaces/open", envelope("open_workspace_request", path=str(folder)))
        assert reopened_workspace["workspace_id"] == wid
        answer = post(fresh, "/api/investigations/reopen", envelope("reopen_investigation_request", "reopen-ranges", 4, workspace_id=wid, saved_revision_id=revision), "saving")
        assert answer["restored_selection"]["identity"] == selected["identity"]
        assert answer["restored_selection"]["kept"]["case_ids"] == ["A", "G"]
        assert answer["revision"]["content"]["selection_recipe"]["predicates"] == predicates


@pytest.mark.parametrize("change", [
    {"minimum_hours": -1}, {"maximum_hours": -1}, {"minimum_hours": "4"}, {"maximum_hours": True},
    {"quantifier": "all"}, {"quantifier": None}, {"negate": 1}, {"extra": 1}, {"source_activity": ""},
])
def test_closed_typed_range_request_refuses_malformed_values_before_workspace(change):
    with TestClient(create_app()) as c:
        p = {**PATH, **change}
        request = envelope("select_cases_request", "malformed-range", 2, workspace_id="workspace.v1:not-opened", identity={"source_id": "source.v1:sha256:" + "1" * 64, "preparation_id": "preparation.v1:sha256:" + "2" * 64, "representation_id": "representation.v1:sha256:" + "3" * 64, "case_dictionary_id": "case-dictionary.v1:sha256:" + "4" * 64, "population_id": "population.v1:sha256:" + "5" * 64, "implementation_version": "0.1.0"}, parent_case_ids=None, predicates=[p])
        assert not VALIDATORS["selection"].is_valid(request)
        response = c.post("/api/investigations/select-cases", json=request)
        assert response.status_code == 422
        body = response.json(); VALIDATORS["selection"].validate(body)
        assert body["code"] == "invalid_predicate"
        assert body["field"].startswith("predicates.0.")


def test_reversed_bounds_and_stale_identity_refuse_without_mutation(tmp_path):
    with TestClient(create_app()) as c:
        wid, base = setup(c, tmp_path / "workspace")
        before = snapshot(tmp_path / "workspace")
        request = envelope("select_cases_request", "bad-bounds", 2, workspace_id=wid, identity=base["identity"], parent_case_ids=PARENT, predicates=[{**PATH, "minimum_hours": 5}])
        response = c.post("/api/investigations/select-cases", json=request)
        assert (response.status_code, response.json()["code"]) == (422, "invalid_predicate")
        request["predicates"] = [PATH]
        for field in base["identity"]:
            request["identity"] = deepcopy(base["identity"])
            request["identity"][field] = "9.9.9" if field == "implementation_version" else request["identity"][field][:-1] + ("a" if request["identity"][field][-1] != "a" else "b")
            response = c.post("/api/investigations/select-cases", json=request)
            assert response.status_code in (404, 409)
            assert response.json()["code"] in ("preparation_unavailable", "identity_mismatch")
        assert snapshot(tmp_path / "workspace") == before


@pytest.mark.parametrize("wall", [False, True])
def test_actual_wire_exact_decimal_bound_distinguishes_rounded_equal_hours(tmp_path, wall):
    raw = ("case,activity,at,seq\n"
           "Micro,Open,2500-01-01T00:00:00Z,1\n"
           "Micro,Close,2500-01-01T04:00:00.000001Z,2\n"
           "Large,Open,0001-01-01T00:00:00Z,1\n"
           "Large,Close,4000-01-01T00:00:00Z,2\n"
           "LargePlus,Open,0001-01-01T00:00:00Z,1\n"
           "LargePlus,Close,4000-01-01T00:00:00.000001Z,2\n").encode()
    with TestClient(create_app()) as c:
        wid, base = setup(c, tmp_path / "precision", wall, raw, "9999-12-31T23:59:59.999999" + ("" if wall else "Z"))
        # 4.000000000277778 decimal hours is just ABOVE exactly 4h+1us,
        # although the existing descriptive float hours display equals that bound.
        p = {**PATH, "minimum_hours": 4.000000000277778, "maximum_hours": None}
        assert selection(c, wid, base, [p], ["Micro"])["kept"]["case_ids"] == []
        p.update(minimum_hours=0, maximum_hours=4.000000000277778)
        assert selection(c, wid, base, [p], ["Micro"])["kept"]["case_ids"] == ["Micro"]
        for kind in ("observed_span_between", "max_raw_gap_between"):
            p = {"kind": kind, "minimum_hours": 35054496, "maximum_hours": 35054496, "negate": False}
            assert partition(selection(c, wid, base, [p], ["Large", "LargePlus"])) == (["Large"], ["LargePlus"], [])


def test_reversed_bounds_fail_before_workspace_lookup():
    with TestClient(create_app()) as c:
        identity = {"source_id": "source.v1:sha256:" + "1" * 64, "preparation_id": "preparation.v1:sha256:" + "2" * 64, "representation_id": "representation.v1:sha256:" + "3" * 64, "case_dictionary_id": "case-dictionary.v1:sha256:" + "4" * 64, "population_id": "population.v1:sha256:" + "5" * 64, "implementation_version": "0.1.0"}
        for predicate in [{**PATH, "minimum_hours": 5}, {"kind": "raw_record_count_between", "minimum_records": 3, "maximum_records": 2, "negate": False}]:
            request = envelope("select_cases_request", "reversed-unopened", 1, workspace_id="workspace.v1:not-opened", identity=identity, parent_case_ids=None, predicates=[predicate])
            # Cross-bound order is a semantic guard documented by the source schema.
            VALIDATORS["selection"].validate(request)
            response = c.post("/api/investigations/select-cases", json=request)
            assert response.status_code == 422
            assert response.json()["code"] == "invalid_predicate"
            assert response.json()["field"].startswith("predicates.0.maximum_")


def test_new_ranges_stay_typed_in_saved_recipes_and_comparison_definitions():
    from test_saving_requests import save_request
    from test_comparison_routes import comparison, partition as comparison_partition
    predicates = [PATH, {"kind": "raw_record_count_between", "minimum_records": 2, "maximum_records": None, "negate": False}, {"kind": "observed_span_between", "minimum_hours": 0, "maximum_hours": 4, "negate": True}, {"kind": "max_raw_gap_between", "minimum_hours": 1, "maximum_hours": 4, "negate": False}]
    with TestClient(create_app()) as c:
        for predicate in predicates:
            saved = save_request(); saved["selection_recipe"]["predicates"] = [predicate]
            compared = comparison(saved["workspace_id"], {"identity": saved["base_identity"]}, comparison_partition([predicate]))
            for route, request, schema in [("/api/investigations/save", saved, "saving"), ("/api/investigations/compare-groups", compared, "comparison")]:
                VALIDATORS[schema].validate(request)
                response = c.post(route, json=request)
                assert (response.status_code, response.json()["code"]) == (404, "workspace_unavailable")
                # The same semantic cross-bound guard is applied at each nested seam.
                bad = deepcopy(request)
                path = bad["selection_recipe"]["predicates"] if schema == "saving" else bad["definition"]["predicates"]
                unit = "records" if predicate["kind"] == "raw_record_count_between" else "hours"
                path[0]["minimum_" + unit], path[0]["maximum_" + unit] = 4, 3
                refused = c.post(route, json=bad)
                assert 400 <= refused.status_code < 500
                VALIDATORS[schema].validate(refused.json())
                assert refused.json()["code"] != "workspace_unavailable"
                assert refused.json()["field"].endswith("predicates.0.maximum_" + unit)
