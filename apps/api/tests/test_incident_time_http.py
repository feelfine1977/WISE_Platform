"""Complete time diagnostics through the existing retained-case HTTP seam."""

from copy import deepcopy

from fastapi.testclient import TestClient
import pytest

from wise_platform_api.app import create_app
from test_incident_time_contracts import NEGATIVES, POSITIVES, FIXTURES, read, validator
from test_import_acceptance import envelope
from test_selection_acceptance import select


def checked(response):
    assert response.status_code == 200, response.text
    return response.json()


def imported(client, path, kind):
    path.mkdir()
    workspace = checked(client.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(path))))
    wid = workspace["workspace_id"]
    metadata = envelope("upload_source_metadata", workspace_id=wid, filename=f"{kind}.csv")
    source = checked(client.put("/api/sources", params=metadata, content=(FIXTURES / f"{kind}.csv").read_bytes(),
                                headers={"Content-Type": "application/octet-stream"}))
    request = read(f"{kind}-prepare-request.json")
    request["workspace_id"] = wid
    assert request["source_id"] == source["source"]["source_id"]
    prepared = checked(client.post("/api/preparations", json=request))
    assert prepared["state"] == "ready"
    population = checked(client.post("/api/investigations/open-population", json=envelope(
        "open_population_request", workspace_id=wid, preparation_id=prepared["preparation"]["preparation_id"])))
    return wid, population


def evidence_request(expected, wid):
    return {key: value for key, value in expected.items()
            if key in ("schema_version", "request_id", "query_revision", "identity", "case_id")} | {
                "workspace_id": wid, "message_type": "imported_case_evidence_request"}


@pytest.mark.parametrize("kind", ["utc_instant", "wall_clock"])
def test_entire_native_answers_match_literal_expectations(tmp_path, kind):
    with TestClient(create_app()) as client:
        wid, population = imported(client, tmp_path / "workspace", kind)
        for case in POSITIVES:
            if not case["native_reachable"] or not case["name"].startswith(kind + ":"):
                continue
            expected = deepcopy(read(case["expected_answer"]))
            assert population["identity"] == expected["identity"]
            expected["workspace_id"] = wid
            response = client.post("/api/investigations/case-evidence", json=evidence_request(expected, wid))
            assert checked(response) == expected


def durable_bytes(path):
    return {file.relative_to(path): file.read_bytes() for file in path.rglob("*") if file.is_file()}


@pytest.mark.parametrize("kind", ["utc_instant", "wall_clock"])
def test_selected_populations_supply_identical_whole_history_diagnostics_without_writes(tmp_path, kind):
    path = tmp_path / "workspace"
    with TestClient(create_app()) as client:
        wid, base = imported(client, path, kind)
        predicates = [{"kind": "case_id_in", "case_ids": ["A", "D", "Missing", "AllUnlabelled"], "negate": False}]
        selected = select(client, {"workspace_id": wid}, base, predicates)
        assert selected["kept"] == {"case_ids": ["A", "AllUnlabelled", "D", "Missing"], "case_count": 4, "record_count": 10}
        before = durable_bytes(path)
        for case_id in selected["kept"]["case_ids"]:
            expected = read(f"positive/{kind}-{case_id}.json")
            expected["workspace_id"] = wid
            request = evidence_request(expected, wid)
            assert checked(client.post("/api/investigations/case-evidence", json=request)) == expected
            request["identity"] = selected["identity"]
            expected["identity"] = selected["identity"]
            assert checked(client.post("/api/investigations/case-evidence", json=request)) == expected
        assert durable_bytes(path) == before


@pytest.mark.parametrize("name", ["explicit-null-field", "missing-required-clock", "gap-exact-disagreement",
                                  "unknown-usable-key-discarded", "huge-float-tie-wrong-first-witness",
                                  "unknown-span-invented", "unknown-unavailable-count-wrong"])
def test_broken_producer_projection_uses_existing_typed_computation_failure(tmp_path, monkeypatch, name):
    from wise_platform_api import imports as imports_module

    mutation = next(case for case in NEGATIVES if case["name"] == name)
    expected = read(mutation["base_positive"])
    malicious = read(mutation["malicious_full_wire"])
    with TestClient(create_app()) as client:
        wid, base = imported(client, tmp_path / "workspace", "utc_instant")
        request = evidence_request(expected, wid)
        before = durable_bytes(tmp_path / "workspace")
        with monkeypatch.context() as patch:
            patch.setattr(imports_module, "incident_time_diagnostics", lambda *args: deepcopy(malicious["incident_time"]))
            response = client.post("/api/investigations/case-evidence", json=request)
        assert response.status_code == 500
        refusal = response.json()
        validator().validate(refusal)
        assert refusal == {"schema_version": 1, "message_type": "import_refusal", "request_id": request["request_id"],
                           "query_revision": request["query_revision"], "workspace_id": wid,
                           "operation": "case_evidence", "code": "computation_failed",
                           "message": "The answer could not be computed. Try again; if it fails again, the application needs to be repaired.",
                           "field": None, "retryable": True}
        assert durable_bytes(tmp_path / "workspace") == before
        expected["workspace_id"] = wid
        assert checked(client.post("/api/investigations/case-evidence", json=request)) == expected


@pytest.mark.parametrize("selected_population", [False, True])
def test_native_producer_and_boundary_exceptions_and_corrupted_outer_evidence_fail_closed(tmp_path, monkeypatch, selected_population):
    from wise_platform_api import imports as imports_module

    with TestClient(create_app()) as client:
        wid, base = imported(client, tmp_path / "workspace", "utc_instant")
        identity = base["identity"]
        if selected_population:
            identity = select(client, {"workspace_id": wid}, base,
                              [{"kind": "case_id_in", "case_ids": ["A"], "negate": False}])["identity"]
        expected = read("positive/utc_instant-A.json")
        request = evidence_request(expected, wid) | {"identity": identity}
        def broken(*args, **kwargs):
            raise ValueError("The prepared value violates its invariant.")

        for name in ("incident_time_diagnostics", "validate_incident_time_answer"):
            with monkeypatch.context() as patch:
                patch.setattr(imports_module, name, broken)
                response = client.post("/api/investigations/case-evidence", json=request)
            assert response.status_code == 500
            assert response.json()["code"] == "computation_failed"
            assert "incident_time" not in response.json()
        name = "open_selected_case" if selected_population else "open_prepared_case"
        original = getattr(imports_module, name)
        def corrupt(*args):
            evidence = original(*args)
            evidence["records"][0]["original_cells"][0] = "changed"
            return evidence

        before = durable_bytes(tmp_path / "workspace")
        with monkeypatch.context() as patch:
            patch.setattr(imports_module, name, corrupt)
            response = client.post("/api/investigations/case-evidence", json=request)
        assert response.status_code == 500 and response.json()["code"] == "computation_failed"
        assert durable_bytes(tmp_path / "workspace") == before
        assert checked(client.post("/api/investigations/case-evidence", json=request))["incident_time"] == expected["incident_time"]


def test_identity_case_and_request_refusals_precede_diagnostics(tmp_path, monkeypatch):
    from wise_platform_api import imports as imports_module

    with TestClient(create_app()) as client:
        wid, base = imported(client, tmp_path / "workspace", "utc_instant")
        selected = select(client, {"workspace_id": wid}, base,
                          [{"kind": "case_id_in", "case_ids": ["A"], "negate": False}])
        request = evidence_request(read("positive/utc_instant-A.json"), wid)
        def unexpected(*args):
            pytest.fail("Diagnostics must follow successful retained-case checks.")

        monkeypatch.setattr(imports_module, "incident_time_diagnostics", unexpected)
        for changed, status, code in [
            ({"identity": dict(base["identity"], population_id="population.v1:sha256:" + "0" * 64)}, 409, "identity_mismatch"),
            ({"identity": selected["identity"], "case_id": "B"}, 404, "case_not_found"),
            ({"case_id": "absent"}, 404, "case_not_found"),
            ({"identity": {}}, 400, "invalid_request"),
        ]:
            response = client.post("/api/investigations/case-evidence", json=request | changed)
            assert response.status_code == status and response.json()["code"] == code
            assert "incident_time" not in response.json()
