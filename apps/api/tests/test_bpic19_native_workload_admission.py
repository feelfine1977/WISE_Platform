"""Literal complete-history admission and complete native snapshot materialization.

These finite HTTP fixtures establish the policy and paging behavior, not actual
full-source capacity, cold/warm timings, browser cancellation or a runtime SLA.
"""
from copy import deepcopy
import csv
import hashlib
import io
import json

from fastapi.testclient import TestClient
import pytest

from wise_platform_api import bpic19_scoring as scoring
from wise_platform_api.app import create_app
from wise_platform_api.imports import Imports
from import_requests import envelope
from test_bpic19_scoring_http import VALIDATOR, criterion, given, prepare, raw_source, read


def application(monkeypatch, *, max_cases=4, max_retained_records=19):
    """Configure the real native service while retaining all ordinary root routes."""
    original = scoring.Bpic19Scoring
    services = []
    def configured(imports):
        service = original(imports, max_cases=max_cases, max_retained_records=max_retained_records)
        services.append(service)
        return service
    monkeypatch.setattr(scoring, "Bpic19Scoring", configured)
    return create_app(), services


def tree(path):
    return {str(file.relative_to(path)): hashlib.sha256(file.read_bytes()).hexdigest()
            for file in path.rglob("*") if file.is_file()}


def forbid_computation(monkeypatch):
    def forbidden(*args, **kwargs):
        pytest.fail("Admission/stored reading must not build raw features or evaluate native Method")
    for name in ("build_paper_features", "build_historical_features", "derive_case_measures", "evaluate_features"):
        monkeypatch.setattr(scoring, name, forbidden)


def select_a(client, wid, identity):
    selected = client.post("/api/investigations/select-cases", json=envelope(
        "select_cases_request", workspace_id=wid, identity=identity, parent_case_ids=None,
        predicates=[{"kind": "case_id_in", "case_ids": ["A"], "negate": False}]))
    assert selected.status_code == 200, selected.text
    assert selected.json()["kept"]["case_ids"] == ["A"]
    assert selected.json()["kept"]["record_count"] == 4
    return selected.json()["identity"]


def test_default_policy_is_exact_witnessed_counts_not_a_capacity_estimate():
    service = scoring.Bpic19Scoring(Imports(forbidden=()))
    assert (service.max_cases, service.max_retained_records) == (251734, 1595923)


@pytest.mark.parametrize("name", ["max_cases", "max_retained_records"])
@pytest.mark.parametrize("invalid", [0, -1, True, 1.0, None, "4", 2**53])
def test_invalid_local_admission_configuration_is_never_unlimited(name, invalid):
    with pytest.raises(ValueError, match=name):
        scoring.Bpic19Scoring(Imports(forbidden=()), **{name: invalid})


@pytest.mark.parametrize("settings", [{}, {"profile": "historical", "mode": "layer_balanced", "view": "Finance"}])
def test_exact_four_items_nineteen_records_are_admitted_and_exported(tmp_path, monkeypatch, settings):
    folder = tmp_path / "workspace"; folder.mkdir()
    app, _ = application(monkeypatch)
    with TestClient(app) as client:
        wid, identity = prepare(client, folder)
        response = client.post("/api/investigations/bpic19-score", json=given(wid, identity, **settings))
        assert response.status_code == 200, response.text
        answer = response.json(); VALIDATOR.validate(answer)
        assert answer["report"]["population_case_count"] == answer["report"]["scored_case_count"] == 4
        receipt = answer["snapshot"]["workload_admission"]
        assert (receipt["admitted_case_count"], receipt["admitted_record_count"]) == (4, 19)
        assert (receipt["selected_case_count"], receipt["selected_record_count"]) == (4, 19)
        assert receipt["max_cases"] == 4 and receipt["max_retained_records"] == 19
        assert receipt["policy_id"] == "bpic19.native_workload_admission.v1"
        assert receipt["includes_calibration_parent"] is (settings.get("profile") == "historical")
        # Independent raw witness/count controls: A contains one literal invoice
        # receipt and one vendor creation; the two profiles intentionally differ.
        a = next(case for case in answer["report"]["case_page"]["cases"] if case["case_id"] == "A")
        key = "c_l1_invoice_present" if settings else "C01"
        assert criterion(a, key)["measurement"] == (2 if settings else 1)
        exported = client.post("/api/investigations/bpic19-export", json={
            **read(wid, answer["run_id"]), "message_type": "bpic19_export_request"})
        assert exported.status_code == 200
        import zipfile
        with zipfile.ZipFile(io.BytesIO(exported.content)) as archive:
            assert json.loads(archive.read("manifest.json"))["snapshot"]["workload_admission"] == receipt


@pytest.mark.parametrize("limits", [{"max_cases": 3}, {"max_retained_records": 18}])
def test_over_limit_fresh_request_refuses_before_any_result_or_definition_write(tmp_path, monkeypatch, limits):
    folder = tmp_path / "workspace"; folder.mkdir()
    app, _ = application(monkeypatch, **limits)
    with TestClient(app) as client:
        wid, identity = prepare(client, folder)
        before = tree(folder)
        forbid_computation(monkeypatch)
        response = client.post("/api/investigations/bpic19-score", json=given(wid, identity))
        assert response.status_code == 400, response.text
        refused = response.json(); VALIDATOR.validate(refused)
        assert refused["code"] == "unsupported_policy" and refused["field"] == "named_population"
        assert "4 complete items and 19 retained original records" in refused["message"]
        assert f"{limits.get('max_cases', 4)} items and {limits.get('max_retained_records', 19)} records" in refused["message"]
        assert refused["retryable"] is False
        assert tree(folder) == before


def test_missing_activity_and_bad_time_records_count_toward_raw_limit(tmp_path, monkeypatch):
    rows = list(csv.reader(io.StringIO(raw_source().decode())))
    header = rows[0]
    a = [row for row in rows[1:] if row[0] == "A"]
    # Literal 4 observed events + 16 raw unknown events, all on the same item.
    unknown = deepcopy(a[0]); unknown[9:11] = ["", "not-a-time"]
    output = io.StringIO(); writer = csv.writer(output)
    writer.writerow(header); writer.writerows(a + [unknown] * 16)
    folder = tmp_path / "workspace"; folder.mkdir()
    app, _ = application(monkeypatch)
    with TestClient(app) as client:
        wid, identity = prepare(client, folder, output.getvalue().encode())
        before = tree(folder); forbid_computation(monkeypatch)
        response = client.post("/api/investigations/bpic19-score", json=given(wid, identity))
        assert response.status_code == 400, response.text
        assert response.json()["code"] == "unsupported_policy"
        assert "1 complete items and 20 retained original records" in response.json()["message"]
        assert tree(folder) == before


@pytest.mark.parametrize("settings", [
    {"profile": "historical", "mode": "layer_balanced", "view": "Finance"},
    {"volume": "exposure", "exposure_policy": "max_absolute_p95"},
])
@pytest.mark.parametrize("limits", [{"max_cases": 3}, {"max_retained_records": 18}])
def test_one_item_selection_still_counts_complete_fitted_parent(tmp_path, monkeypatch, settings, limits):
    folder = tmp_path / "workspace"; folder.mkdir()
    app, _ = application(monkeypatch, **limits)
    with TestClient(app) as client:
        wid, identity = prepare(client, folder)
        selected = select_a(client, wid, identity)
        request = given(wid, identity, **settings); request["named_population"]["identity"] = selected
        before = tree(folder); forbid_computation(monkeypatch)
        response = client.post("/api/investigations/bpic19-score", json=request)
        assert response.status_code == 400, response.text
        assert response.json()["code"] == "unsupported_policy"
        assert "4 complete items and 19 retained original records" in response.json()["message"]
        assert tree(folder) == before


def test_unfitted_paper_selection_does_not_count_unvisited_parent(tmp_path, monkeypatch):
    folder = tmp_path / "workspace"; folder.mkdir()
    app, _ = application(monkeypatch, max_cases=1, max_retained_records=4)
    with TestClient(app) as client:
        wid, identity = prepare(client, folder)
        selected = select_a(client, wid, identity)
        request = given(wid, identity); request["named_population"]["identity"] = selected
        response = client.post("/api/investigations/bpic19-score", json=request)
        assert response.status_code == 200, response.text
        admission = response.json()["snapshot"]["workload_admission"]
        assert admission["admitted_case_count"] == 1 and admission["admitted_record_count"] == 4
        assert admission["includes_calibration_parent"] is False


def test_lower_fresh_limit_preserves_stored_score_read_full_verification_export_and_resolution(tmp_path, monkeypatch):
    folder = tmp_path / "workspace"; folder.mkdir()
    app, services = application(monkeypatch)
    with TestClient(app) as client:
        wid, identity = prepare(client, folder)
        request = given(wid, identity)
        initial = client.post("/api/investigations/bpic19-score", json=request)
        assert initial.status_code == 200, initial.text
        answer = initial.json(); original_files = tree(folder)
        services[0].max_cases = 1; services[0].max_retained_records = 1
        forbid_computation(monkeypatch)
        # Exact same requested definition is a nonwriting stored read, not fresh
        # evaluation under the lowered local limits. Its receipt is immutable.
        same = client.post("/api/investigations/bpic19-score", json=request)
        assert same.status_code == 200 and same.json() == answer
        page = client.post("/api/investigations/bpic19-read", json=read(wid, answer["run_id"]))
        assert page.status_code == 200 and page.json()["snapshot"] == answer["snapshot"]
        verified = services[0].read_saved_snapshot(json.dumps(read(wid, answer["run_id"])).encode())
        assert verified.status == 200 and verified.body["snapshot"] == answer["snapshot"]
        exported = client.post("/api/investigations/bpic19-export", json={
            **read(wid, answer["run_id"]), "message_type": "bpic19_export_request"})
        assert exported.status_code == 200 and tree(folder) == original_files
        new_definition = client.post("/api/investigations/bpic19-score", json=given(wid, identity, gamma=20))
        assert new_definition.status_code == 400 and new_definition.json()["code"] == "unsupported_policy"
        assert tree(folder) == original_files
        # Ordinary Resolution uses its existing Method route and has no BPIC cap.
        from test_expectation_routes import LOG, DEFINITION, opened, validation, run_of
        ordinary = opened(client, wid, LOG)
        validated = client.post("/api/expectations/validate", json=validation(wid, ordinary, DEFINITION))
        assert validated.status_code == 200, validated.text
        ordinary_run = run_of(client, wid, ordinary, validated.json()["definition_version"])
        assert {case["case_id"]: case["value"] for case in ordinary_run["cases"]} == {
            "A": 0, "B": .5, "C": 1, "D": None, "E": None}
        assert ordinary_run["population"] == {"case_ids": ["A", "B", "C", "D", "E"], "case_count": 5, "record_count": 8}


def test_all_document_and_group_pages_survive_a_lowered_materialization_page_size(tmp_path, monkeypatch):
    folder = tmp_path / "workspace"; folder.mkdir()
    app, _ = application(monkeypatch)
    # Exact F29 has 3 documents (D: A+B, E: C, F: D) and 3 spend groups.
    # Size 2 forces a real second Method report page, without a huge fake log.
    monkeypatch.setattr(scoring, "_MATERIALIZATION_PAGE_SIZE", 2)
    with TestClient(app) as client:
        wid, identity = prepare(client, folder)
        response = client.post("/api/investigations/bpic19-score", json={
            **given(wid, identity), "group_offset": 0, "group_limit": 2})
        assert response.status_code == 200, response.text
        answer = response.json()
        assert answer["report"]["group_page"]["total"] == 3
        assert answer["report"]["group_page"]["document_total"] == 3
        page2 = client.post("/api/investigations/bpic19-read", json=read(
            wid, answer["run_id"], group_offset=2, group_limit=2))
        assert page2.status_code == 200, page2.text
        combined = answer["report"]["documents"] + page2.json()["report"]["documents"]
        assert sorted((row["document"], row["n_cases"], row["member_count"]) for row in combined) == [
            ("D", 2, 2), ("E", 1, 1), ("F", 1, 1)]
        groups = answer["report"]["groups"] + page2.json()["report"]["groups"]
        assert sorted((row["spend_area"], row["n_cases"]) for row in groups) == [
            ("Logistics", 1), ("MRO", 1), ("Packaging", 2)]
        assert len(answer["report"]["layer_drivers"] + page2.json()["report"]["layer_drivers"]) == 3
        for kind in ("exact", "signature"):
            first = answer["report"]["representation_scores"][kind]
            later = page2.json()["report"]["representation_scores"][kind]
            assert len(first + later) == 4
            assert len({row["group_id"] for row in first + later}) == 4
        beyond = client.post("/api/investigations/bpic19-read", json=read(
            wid, answer["run_id"], group_offset=4, group_limit=2))
        assert beyond.status_code == 200
        assert beyond.json()["report"]["documents"] == beyond.json()["report"]["groups"] == []
