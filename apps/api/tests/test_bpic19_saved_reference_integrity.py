"""Independent saved BPIC reference corruption, cache and replay boundaries.

All mutations affect newly created synthetic workspaces. No supplied notebook,
human report program, live source or production workspace is executed/changed.
The four-item native fixture uses an explicit test-only chunk size of one;
production chunk size remains 500. These are HTTP contract tests, not browser
or full BPIC source qualification.
"""

from copy import deepcopy
import hashlib
import json
from pathlib import Path
import socket

from fastapi.testclient import TestClient
import pytest

from import_requests import envelope
from test_bpic19_artifact_recovery_http import ROUTE, VALIDATOR, seed
from test_bpic19_pipeline_http import save_request, start_process
from test_bpic19_recipe_comparison_http import pair_request, cohort_pair, save_pair
from test_bpic19_partial_pipeline import partial_recipe
from test_bpic19_operators_http import prepare as prepare_operator, request as operator_request
from test_bpic19_scoring_http import read
from wise_platform_api.app import create_app
from wise_platform_api.workspace import Workspace, Problem


def tree(folder):
    return {str(path.relative_to(folder)): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in folder.rglob("*") if path.is_file()}


def reopen(wid, saved):
    return envelope("reopen_investigation_request", workspace_id=wid,
                    saved_revision_id=saved["revision"]["saved_revision_id"])


def update(save, saved):
    return {**deepcopy(save), "investigation_id": saved["revision"]["investigation_id"],
            "expected_revision_id": saved["revision"]["saved_revision_id"], "notes": "A refused update must not publish."}


def native_reference(folder, identity, native, kind):
    if kind in {"source_csv", "source_descriptor"}:
        return folder / "sources" / (identity["source_id"].split(":")[-1] + (".csv" if kind == "source_csv" else ".json"))
    if kind == "definition":
        return folder / "definitions" / (native["definition_id"].split(":")[-1] + ".json")
    if kind == "run":
        return folder / "score-runs" / (native["run_id"].split(":")[-1] + ".json")
    refs = [ref for ref in native["snapshot"]["artifacts"] if ref["kind"] == ("cases" if kind == "later_chunk" else kind)]
    return folder / "score-run-artifacts" / refs[-1]["filename"]


def damage(path, mutation):
    original = path.read_bytes()
    if mutation == "missing":
        path.unlink()
    elif mutation == "size":
        path.write_bytes(b"damaged")
    elif mutation == "digest":
        path.write_bytes(bytes([original[0] ^ 1]) + original[1:])
    return original


@pytest.mark.parametrize("kind,mutation,code", [
    (kind, mutation, "artifact_unavailable" if kind == "source_descriptor" else code)
    for kind in ["source_csv", "source_descriptor", "definition", "run", "report", "membership", "later_chunk"]
    for mutation, code in [("missing", "artifact_unavailable"), ("size", "checksum_mismatch"), ("digest", "checksum_mismatch"), ("unreadable", "artifact_unavailable")]
])
def test_saved_references_have_typed_integrity_and_independent_historical_metadata(tmp_path, monkeypatch, kind, mutation, code):
    monkeypatch.setattr("wise_platform_api.bpic19_scoring._CHUNK_SIZE", 1)
    folder = tmp_path / "workspace"
    folder.mkdir()
    with TestClient(create_app()) as client:
        wid, identity, native, save, saved, recover, raw_request, evidence, _ = seed(client, folder)
        path = native_reference(folder, identity, native, kind)
        damage(path, mutation)
        damaged_tree = tree(folder)
        monkeypatch.setattr("wise_platform_api.bpic19_scoring.evaluate_features", lambda *args, **kwargs: pytest.fail("Saved-reference refusal/recovery must not evaluate Method"))
        with monkeypatch.context() as denied:
            if mutation == "unreadable":
                original_read, original_open = Path.read_bytes, Path.open
                def read_bytes(self):
                    if self == path: raise PermissionError("synthetic unreadable declared reference")
                    return original_read(self)
                def open_file(self, *args, **kwargs):
                    if self == path: raise PermissionError("synthetic unreadable declared reference")
                    return original_open(self, *args, **kwargs)
                denied.setattr(Path, "read_bytes", read_bytes)
                denied.setattr(Path, "open", open_file)
            for route, request in [("/api/investigations/reopen", reopen(wid, saved)), ("/api/investigations/save", save), ("/api/investigations/save", update(save, saved))]:
                refused = client.post(route, json=request)
                assert refused.status_code == 409 and refused.json()["code"] == code, refused.text
                if kind in {"source_csv", "source_descriptor"}:
                    assert refused.json()["field"] == "base_identity.source_id"
                VALIDATOR.validate(refused.json())
            historical = client.post(ROUTE, json=recover)
            assert historical.status_code == 200, historical.text
            body = historical.json()
            VALIDATOR.validate(body)
            assert body["status"] == "historical_metadata_only"
            assert body["metadata_integrity"] == "saved_content_hash_verified"
            assert body["outputs_restored"] is body["selection_restored"] is body["source_verified"] is False
            assert body["metadata"]["bookmarks"]["items"][0]["row_ids"] == save["bookmarks"][0]["row_ids"]
            assert body["metadata"]["literature_claims"]["items"] == save["bpic19_pipeline"]["literature_claims"]
            original = client.post("/api/investigations/case-evidence", json=raw_request)
            if kind in {"source_csv", "source_descriptor"}:
                assert original.status_code == 404 and original.json()["code"] == "source_unavailable", original.text
            else:
                assert original.status_code == 200 and original.json()["records"] == evidence["records"], original.text
        assert tree(folder) == damaged_tree
        assert len(list((folder / "score-runs").glob("*.json"))) == (0 if kind == "run" and mutation == "missing" else 1)
        assert len(list((folder / "investigations/revisions").glob("*.json"))) == 1


@pytest.mark.parametrize("field,value", [("filename", ""), ("source_id", "foreign"), ("byte_count", "not an integer"), ("stored_utc", None)])
def test_malformed_source_descriptor_shape_is_unavailable_not_a_claimed_descriptor_checksum(tmp_path, monkeypatch, field, value):
    folder = tmp_path / "workspace"
    folder.mkdir()
    with TestClient(create_app()) as client:
        wid, identity, native, save, saved, recover, raw_request, _, _ = seed(client, folder)
        path = native_reference(folder, identity, native, "source_descriptor")
        descriptor = json.loads(path.read_text())
        descriptor[field] = value
        path.write_text(json.dumps(descriptor))
        before = tree(folder)
        monkeypatch.setattr("wise_platform_api.bpic19_scoring.evaluate_features", lambda *args, **kwargs: pytest.fail("An unavailable source descriptor must not evaluate native output"))
        refused = client.post("/api/investigations/save", json=save)
        assert refused.status_code == 409 and refused.json()["code"] == "artifact_unavailable", refused.text
        assert refused.json()["field"] == "base_identity.source_id"
        assert identity["source_id"] in refused.json()["message"]
        reopened = client.post("/api/investigations/reopen", json=reopen(wid, saved))
        assert reopened.status_code == 409 and reopened.json()["code"] == "artifact_unavailable", reopened.text
        assert reopened.json()["field"] == "base_identity.source_id"
        assert identity["source_id"] in reopened.json()["message"]
        historical = client.post(ROUTE, json=recover)
        assert historical.status_code == 200 and historical.json()["outputs_restored"] is False
        raw = client.post("/api/investigations/case-evidence", json=raw_request)
        assert raw.status_code == 404 and raw.json()["code"] == "source_unavailable", raw.text
        assert tree(folder) == before


@pytest.mark.parametrize("kind,code", [("source_descriptor", "artifact_unavailable"), ("definition", "checksum_mismatch"), ("run", "checksum_mismatch")])
def test_excessively_nested_reference_json_keeps_its_typed_failure_without_repair(tmp_path, monkeypatch, kind, code):
    folder = tmp_path / "workspace"
    folder.mkdir()
    with TestClient(create_app()) as client:
        wid, identity, native, save, saved, recover, raw_request, evidence, _ = seed(client, folder)
        path = native_reference(folder, identity, native, kind)
        path.write_bytes(b"[" * 16000 + b"0" + b"]" * 16000)
        before = tree(folder)
        monkeypatch.setattr("wise_platform_api.bpic19_scoring.evaluate_features", lambda *args, **kwargs: pytest.fail("Malformed-depth reference handling must not evaluate Method"))
        for route, request in [("/api/investigations/reopen", reopen(wid, saved)), ("/api/investigations/save", save), ("/api/investigations/save", update(save, saved))]:
            refused = client.post(route, json=request)
            assert refused.status_code == 409 and refused.json()["code"] == code, refused.text
            VALIDATOR.validate(refused.json())
        historical = client.post(ROUTE, json=recover)
        assert historical.status_code == 200 and historical.json()["outputs_restored"] is False
        raw = client.post("/api/investigations/case-evidence", json=raw_request)
        if kind == "source_descriptor":
            assert raw.status_code == 404 and raw.json()["code"] == "source_unavailable", raw.text
        else:
            assert raw.status_code == 200 and raw.json()["records"] == evidence["records"], raw.text
        assert tree(folder) == before


@pytest.mark.parametrize("kind", ["definition", "run"])
@pytest.mark.parametrize("mutation", ["missing", "digest"])
def test_ordinary_native_read_keeps_existing_reference_codes(tmp_path, kind, mutation):
    folder = tmp_path / "workspace"
    folder.mkdir()
    with TestClient(create_app()) as client:
        wid, identity, native, *_ = seed(client, folder)
        path = native_reference(folder, identity, native, kind)
        damage(path, mutation)
        expected = "definition_unavailable" if kind == "definition" else "run_unavailable"
        direct = client.post("/api/investigations/bpic19-read", json=read(wid, native["run_id"]))
        assert direct.json()["code"] == expected, direct.text
        assert direct.status_code == (409 if kind == "definition" else 404)


@pytest.mark.parametrize("kind", ["definition", "run"])
def test_valid_json_native_wrapper_with_changed_payload_fails_its_existing_checksum(tmp_path, monkeypatch, kind):
    folder = tmp_path / "workspace"
    folder.mkdir()
    with TestClient(create_app()) as client:
        wid, identity, native, save, saved, recover, raw_request, evidence, _ = seed(client, folder)
        path = native_reference(folder, identity, native, kind)
        stored = json.loads(path.read_text())
        stored["record"]["independent_changed_payload"] = "Its old recorded SHA is deliberately retained"
        path.write_text(json.dumps(stored))
        before = tree(folder)
        monkeypatch.setattr("wise_platform_api.bpic19_scoring.evaluate_features", lambda *args, **kwargs: pytest.fail("A checksum-invalid wrapper must never be evaluated"))
        refused = client.post("/api/investigations/reopen", json=reopen(wid, saved))
        assert refused.status_code == 409 and refused.json()["code"] == "checksum_mismatch", refused.text
        assert client.post(ROUTE, json=recover).status_code == 200
        raw = client.post("/api/investigations/case-evidence", json=raw_request)
        assert raw.status_code == 200 and raw.json()["records"] == evidence["records"]
        assert tree(folder) == before


def test_simultaneous_source_definition_run_and_later_output_failure_recovers_only_metadata(tmp_path, monkeypatch):
    monkeypatch.setattr("wise_platform_api.bpic19_scoring._CHUNK_SIZE", 1)
    folder = tmp_path / "workspace"
    folder.mkdir()
    with TestClient(create_app()) as client:
        wid, identity, native, save, saved, recover, raw_request, evidence, _ = seed(client, folder)
        source = native_reference(folder, identity, native, "source_csv")
        original_source = source.read_bytes()
        for kind in ("source_csv", "definition", "run", "later_chunk"):
            damage(native_reference(folder, identity, native, kind), "missing")
        monkeypatch.setattr("wise_platform_api.bpic19_scoring.evaluate_features", lambda *args, **kwargs: pytest.fail("No reconstruction/rescore of native references is allowed"))
        damaged_tree = tree(folder)
        refused = client.post("/api/investigations/reopen", json=reopen(wid, saved))
        assert refused.status_code == 409 and refused.json()["code"] == "artifact_unavailable"
        raw = client.post("/api/investigations/case-evidence", json=raw_request)
        assert raw.status_code == 404 and raw.json()["code"] == "source_unavailable"
        historical = client.post(ROUTE, json=recover)
        assert historical.status_code == 200 and historical.json()["outputs_restored"] is False
        assert tree(folder) == damaged_tree
        # Restore only the original synthetic source, explicitly in the test.
        # The application must not use it to reconstruct missing native assets.
        source.write_bytes(original_source)
        restored_tree = tree(folder)
        raw = client.post("/api/investigations/case-evidence", json=raw_request)
        assert raw.status_code == 200 and raw.json()["records"] == evidence["records"]
        refused = client.post("/api/investigations/reopen", json=reopen(wid, saved))
        assert refused.status_code == 409 and refused.json()["code"] == "artifact_unavailable"
        assert tree(folder) == restored_tree


@pytest.mark.parametrize("cache", ["warm", "fresh"])
def test_changed_preparation_descriptor_is_refused_without_cached_data_or_repair(tmp_path, monkeypatch, cache):
    folder = tmp_path / "workspace"
    folder.mkdir()
    with TestClient(create_app()) as first:
        wid, identity, native, save, saved, recover, raw_request, _, _ = seed(first, folder)
        path = folder / "preparations" / (identity["preparation_id"].split(":")[-1] + ".json")
        stored = json.loads(path.read_text())
        stored["preparation"]["mapping"]["context_columns"] = []
        path.write_text(json.dumps(stored))
        damaged_tree = tree(folder)
        monkeypatch.setattr("wise_platform_api.bpic19_scoring.evaluate_features", lambda *args, **kwargs: pytest.fail("Changed preparation must not evaluate"))
        with TestClient(create_app()) as fresh:
            client = first if cache == "warm" else fresh
            if cache == "fresh":
                assert client.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(folder))).status_code == 200
            for route, request in [("/api/investigations/reopen", reopen(wid, saved)), ("/api/investigations/save", save), ("/api/investigations/save", update(save, saved))]:
                refused = client.post(route, json=request)
                assert refused.status_code == 409 and refused.json()["code"] == "checksum_mismatch", refused.text
            direct = client.post("/api/investigations/open-population", json=envelope("open_population_request", workspace_id=wid, preparation_id=identity["preparation_id"]))
            assert direct.status_code == 404 and direct.json()["code"] == "preparation_unavailable", direct.text
            historical = client.post(ROUTE, json=recover)
            assert historical.status_code == 200 and historical.json()["outputs_restored"] is False
        assert tree(folder) == damaged_tree


def test_missing_preparation_still_reconstructs_exact_saved_recipe_in_new_application(tmp_path, monkeypatch):
    folder = tmp_path / "workspace"
    folder.mkdir()
    with TestClient(create_app()) as first:
        wid, identity, native, save, saved, *_ = seed(first, folder)
        path = folder / "preparations" / (identity["preparation_id"].split(":")[-1] + ".json")
        descriptor = json.loads(path.read_text())["preparation"]
        path.unlink()
        before = tree(folder)
    monkeypatch.setattr("wise_platform_api.bpic19_scoring.evaluate_features", lambda *args, **kwargs: pytest.fail("Preparation reconstruction must not rescore the stored native run"))
    with TestClient(create_app()) as fresh:
        assert fresh.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(folder))).status_code == 200
        restored = fresh.post("/api/investigations/reopen", json=reopen(wid, saved))
        assert restored.status_code == 200, restored.text
        assert restored.json()["revision"] == saved["revision"]
        assert restored.json()["bpic19_outputs"] == saved["bpic19_outputs"]
        assert json.loads(path.read_text())["preparation"] == descriptor
        after = tree(folder)
        assert {key: value for key, value in after.items() if not key.startswith("preparations/")} == before


@pytest.mark.parametrize("mutation,code", [("malformed", "checksum_mismatch"), ("unreadable", "artifact_unavailable")])
def test_existing_damaged_preparation_is_not_reconstructed_over_its_file(tmp_path, monkeypatch, mutation, code):
    folder = tmp_path / "workspace"
    folder.mkdir()
    with TestClient(create_app()) as client:
        wid, identity, native, save, saved, recover, *_ = seed(client, folder)
        path = folder / "preparations" / (identity["preparation_id"].split(":")[-1] + ".json")
        if mutation == "malformed": path.write_bytes(b"not the preparation JSON")
        before = tree(folder)
        monkeypatch.setattr("wise_platform_api.bpic19_scoring.evaluate_features", lambda *args, **kwargs: pytest.fail("An existing damaged preparation must never rescore"))
        with monkeypatch.context() as denied:
            if mutation == "unreadable":
                original_open = Path.open
                def open_file(self, *args, **kwargs):
                    if self == path: raise PermissionError("synthetic unreadable preparation")
                    return original_open(self, *args, **kwargs)
                denied.setattr(Path, "open", open_file)
            refused = client.post("/api/investigations/reopen", json=reopen(wid, saved))
            assert refused.status_code == 409 and refused.json()["code"] == code, refused.text
            historical = client.post(ROUTE, json=recover)
            assert historical.status_code == 200 and historical.json()["outputs_restored"] is False
        assert tree(folder) == before


@pytest.mark.parametrize("mutation,code", [("payload", "checksum_mismatch"), ("sha", "checksum_mismatch"), ("missing", "artifact_unavailable"), ("coherent_different", "identity_mismatch")])
def test_recorded_output_payload_sha_and_whole_manifest_are_distinct(tmp_path, monkeypatch, mutation, code):
    folder = tmp_path / "workspace"
    folder.mkdir()
    with TestClient(create_app()) as client:
        save = save_request(client, folder)
        saved = client.post("/api/investigations/save", json=save).json()
        path = next((folder / "investigations/revisions").glob("*.json"))
        record = json.loads(path.read_text())
        output = record["results"]["bpic19_pipeline"]["outputs"][0]
        if mutation in {"payload", "coherent_different"}:
            output["output"]["profile"]["population"]["case_count"] = 999
        if mutation == "sha": output["sha256"] = "0" * 64
        if mutation == "missing": record["results"]["bpic19_pipeline"]["outputs"].pop(0)
        if mutation == "coherent_different":
            output["sha256"] = hashlib.sha256(json.dumps(output["output"], ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()
        path.write_text(json.dumps(record))
        changed_tree = tree(folder)
        if mutation != "coherent_different":
            monkeypatch.setattr("wise_platform_api.bpic19_profiles.Bpic19Profiles.profile", lambda *args, **kwargs: pytest.fail("Output integrity must be verified before replay"))
        refused = client.post("/api/investigations/reopen", json=reopen(save["workspace_id"], saved))
        assert refused.status_code == 409 and refused.json()["code"] == code, refused.text
        if mutation != "coherent_different":
            refused_update = client.post("/api/investigations/save", json=update(save, saved))
            assert refused_update.status_code == 409 and refused_update.json()["code"] == code, refused_update.text
        recovered = client.post(ROUTE, json=envelope("recover_investigation_metadata_request", workspace_id=save["workspace_id"], saved_revision_id=saved["revision"]["saved_revision_id"], page={"notes_offset": 0, "bookmarks_offset": 0, "claims_offset": 0}))
        assert recovered.status_code == 200 and recovered.json()["outputs_restored"] is False
        assert tree(folder) == changed_tree


def operator_save(client, folder):
    wid, identity = prepare_operator(client, folder)
    operator = client.post("/api/investigations/bpic19-operators", json=operator_request(wid, identity))
    assert operator.status_code == 200, operator.text
    operator = operator.json()
    measure_query = {"policy_id": "bpic19.source_witnessed_measures.v1", "measure_profile": "paper_v1", "roles": None, "offset": 0, "limit": 10, "calibration_population": "parent"}
    measures = client.post("/api/investigations/bpic19-measures", json=envelope("bpic19_measures_request", workspace_id=wid, identity=identity, query=measure_query))
    assert measures.status_code == 200, measures.text
    selected = client.post("/api/investigations/select-cases", json=envelope("select_cases_request", workspace_id=wid, identity=identity, parent_case_ids=None, predicates=[])).json()
    return envelope("save_investigation_request", workspace_id=wid, investigation_id=None, expected_revision_id=None,
        name="Independent finite ordinal recipe", base_identity=identity, selection_identity=selected["identity"],
        selection_recipe={"parent_case_ids": selected["parent"]["case_ids"], "predicates": []},
        context_policy="incident.context.first_record_in_declared_order.v1", comparison=None, notes="Protected operator definition, not an external model file", bookmarks=[],
        bpic19_pipeline={"schema_version": 1, "actions": [
            {"operation": "bpic19_measures", "identity": identity, "definition_id": measures.json()["definition_id"], "query": measure_query},
            {"operation": "bpic19_ordinal", "identity": identity, "definition_id": operator["definition_id"], "query": operator_request(wid, identity)["query"]}]})


def test_disabled_formerly_registered_operator_refuses_before_any_dispatch_and_keeps_metadata(tmp_path, monkeypatch):
    folder = tmp_path / "workspace"
    folder.mkdir()
    with TestClient(create_app()) as client:
        save = operator_save(client, folder)
        response = client.post("/api/investigations/save", json=save)
        assert response.status_code == 200, response.text
        saved = response.json()
        before = tree(folder)
        monkeypatch.setattr("wise_platform_api.bpic19_operators.Bpic19Operators.operators", None)
        monkeypatch.setattr("wise_platform_api.bpic19_measures.Bpic19Measures.measures", lambda *args, **kwargs: pytest.fail("All finite bindings must be available before the first dispatch"))
        for route, request in [("/api/investigations/reopen", reopen(save["workspace_id"], saved)), ("/api/investigations/save", save)]:
            refused = client.post(route, json=request)
            assert refused.status_code == 409 and refused.json()["code"] == "artifact_unavailable", refused.text
            assert refused.json()["field"] == "bpic19_pipeline.actions.1.operation"
        recovered = client.post(ROUTE, json=envelope("recover_investigation_metadata_request", workspace_id=save["workspace_id"], saved_revision_id=saved["revision"]["saved_revision_id"], page={"notes_offset": 0, "bookmarks_offset": 0, "claims_offset": 0}))
        assert recovered.status_code == 200 and recovered.json()["metadata"]["notes"]["text"] == save["notes"]
        assert tree(folder) == before
        unknown = deepcopy(save)
        unknown["bpic19_pipeline"]["actions"][1]["operation"] = "external_model_python"
        refused = client.post("/api/investigations/save", json=unknown)
        assert refused.status_code == 400 and refused.json()["code"] == "unsupported_action", refused.text


@pytest.mark.parametrize("kind", ["operator", "cohort"])
def test_declared_comparison_inner_binding_is_preflighted_without_replacement(tmp_path, monkeypatch, kind):
    folder = tmp_path / "workspace"
    folder.mkdir()
    with TestClient(create_app()) as client:
        query = pair_request(client, folder)
        if kind == "cohort": query = cohort_pair(client, query)
        response = client.post("/api/investigations/bpic19-recipe-comparison", json=query)
        assert response.status_code == 200, response.text
        save = save_pair(client, query, [response.json()])
        response = client.post("/api/investigations/save", json=save)
        assert response.status_code == 200, response.text
        saved = response.json()
        before = tree(folder)
        dependency = "wise_platform_api.bpic19_operators.Bpic19Operators.operators" if kind == "operator" else "wise_platform_api.bpic19_cohorts.Bpic19Cohorts.cohorts"
        monkeypatch.setattr(dependency, None)
        monkeypatch.setattr("wise_platform_api.bpic19_recipe_comparison.Bpic19RecipeComparisons.compare", lambda *args, **kwargs: pytest.fail("A comparison must not dispatch with an unavailable inner binding"))
        refused = client.post("/api/investigations/reopen", json=reopen(query["workspace_id"], saved))
        assert refused.status_code == 409 and refused.json()["code"] == "artifact_unavailable", refused.text
        assert refused.json()["field"] == "bpic19_pipeline.actions.0.operation"
        assert tree(folder) == before


def test_tampered_operator_definition_invalidates_metadata_content_without_execution(tmp_path, monkeypatch):
    folder = tmp_path / "workspace"
    folder.mkdir()
    with TestClient(create_app()) as client:
        save = operator_save(client, folder)
        saved = client.post("/api/investigations/save", json=save).json()
        path = next((folder / "investigations/revisions").glob("*.json"))
        record = json.loads(path.read_text())
        record["content"]["bpic19_pipeline"]["actions"][1]["query"]["recipe"]["receipt"] = "invoice"
        path.write_text(json.dumps(record))
        before = tree(folder)
        monkeypatch.setattr("wise_platform_api.bpic19_operators.Bpic19Operators.operators", lambda *args, **kwargs: pytest.fail("Tampered protected content must never execute"))
        for route, request in [("/api/investigations/reopen", reopen(save["workspace_id"], saved)), (ROUTE, envelope("recover_investigation_metadata_request", workspace_id=save["workspace_id"], saved_revision_id=saved["revision"]["saved_revision_id"], page={"notes_offset": 0, "bookmarks_offset": 0, "claims_offset": 0}))]:
            refused = client.post(route, json=request)
            assert refused.status_code == 422 and refused.json()["code"] == "malformed_saved_revision", refused.text
        raw = client.post("/api/investigations/case-evidence", json=envelope("imported_case_evidence_request", workspace_id=save["workspace_id"], identity=save["base_identity"], case_id="a"))
        assert raw.status_code == 200 and len(raw.json()["records"]) == 4
        assert tree(folder) == before


def test_reference_integrity_invalid_identity_is_read_only_and_does_not_change_resolution_access(tmp_path):
    folder = tmp_path / "workspace"
    folder.mkdir()
    workspace = Workspace.open(str(folder))
    assert isinstance(workspace, Workspace)
    before = tree(folder)
    for kind in ("source", "definition", "run"):
        assert workspace.reference_integrity(kind, "../outside").state == "invalid_reference"
    assert workspace.definition("foreign") is None and workspace.run("foreign") is None
    assert isinstance(workspace.source("foreign"), Problem)
    assert tree(folder) == before


@pytest.mark.parametrize("fault", ["missing", "unreadable", "invalid_json", "invalid_unicode", "excessive_depth", "empty_object", "array", "query_array", "missing_locator", "empty_reason", "unknown_policy", "unknown_definition"])
def test_declared_admission_ledger_is_unavailable_without_a_descriptor_checksum(tmp_path, monkeypatch, fault):
    folder = tmp_path / "workspace"
    folder.mkdir()
    ledger = Path(__file__).parents[1] / "src/wise_platform_api/bpic19_reference/source-method-gate.json"
    ledger_before = ledger.read_bytes()
    document = json.loads(ledger_before)
    with TestClient(create_app()) as client:
        save = partial_recipe(client, folder)
        save["bpic19_pipeline"]["replay_mode"] = "partial"
        response = client.post("/api/investigations/save", json=save)
        assert response.status_code == 200, response.text
        saved = response.json()
        assert saved["bpic19_outputs"]["claim_level"] == "partial"
        before = tree(folder)
        original_read = Path.read_text
        def read_text(self, *args, **kwargs):
            if self != ledger: return original_read(self, *args, **kwargs)
            if fault == "missing": raise FileNotFoundError("Synthetic absent local admission ledger")
            if fault == "unreadable": raise PermissionError("Synthetic unreadable local admission ledger")
            if fault == "invalid_unicode": raise UnicodeDecodeError("utf-8", b"\xff", 0, 1, "Synthetic invalid local admission ledger encoding")
            if fault == "invalid_json": return "{bad"
            if fault == "excessive_depth": return "[" * 16000 + "0" + "]" * 16000
            if fault == "empty_object": return "{}"
            if fault == "array": return "[]"
            changed = deepcopy(document)
            if fault == "query_array": changed["query"] = []
            if fault == "missing_locator": changed["query"].pop("source_locator")
            if fault == "empty_reason": changed["query"]["gate_reason"] = " "
            if fault == "unknown_policy": changed["query"]["policy_id"] = "source_method_execute_now"
            if fault == "unknown_definition": changed["definition_id"] = "unregistered-default"
            return json.dumps(changed)
        monkeypatch.setattr(Path, "read_text", read_text)
        monkeypatch.setattr("wise_platform_api.bpic19_measures.Bpic19Measures.measures", lambda *args, **kwargs: pytest.fail("Unavailable admission ledger must refuse before dispatch"))
        for route, request in [("/api/investigations/reopen", reopen(save["workspace_id"], saved)), ("/api/investigations/save", save), ("/api/investigations/save", update(save, saved))]:
            refused = client.post(route, json=request)
            assert refused.status_code == 409 and refused.json()["code"] == "artifact_unavailable", refused.text
            assert refused.json()["field"] == "bpic19_pipeline.actions.1.query"
            VALIDATOR.validate(refused.json())
        historical = client.post(ROUTE, json=envelope("recover_investigation_metadata_request", workspace_id=save["workspace_id"], saved_revision_id=saved["revision"]["saved_revision_id"], page={"notes_offset": 0, "bookmarks_offset": 0, "claims_offset": 0}))
        assert historical.status_code == 200 and historical.json()["status"] == "historical_metadata_only"
        assert historical.json()["outputs_restored"] is False
        assert tree(folder) == before
        assert ledger.read_bytes() == ledger_before


def test_pipeline_without_declared_gate_never_reads_its_local_ledger(tmp_path, monkeypatch):
    folder = tmp_path / "workspace"
    folder.mkdir()
    with TestClient(create_app()) as client:
        save = save_request(client, folder)
        ledger = Path(__file__).parents[1] / "src/wise_platform_api/bpic19_reference/source-method-gate.json"
        original_read = Path.read_text
        def read_text(self, *args, **kwargs):
            if self == ledger: pytest.fail("An undeclared gate must not read the local admission ledger")
            return original_read(self, *args, **kwargs)
        monkeypatch.setattr(Path, "read_text", read_text)
        response = client.post("/api/investigations/save", json=save)
        assert response.status_code == 200, response.text
        saved = response.json()
        restored = client.post("/api/investigations/reopen", json=reopen(save["workspace_id"], saved))
        assert restored.status_code == 200 and restored.json()["bpic19_outputs"] == saved["bpic19_outputs"]


@pytest.mark.parametrize("error", [ValueError, RecursionError])
def test_valid_partial_ledger_does_not_reclassify_unrelated_execution_errors(tmp_path, monkeypatch, error):
    folder = tmp_path / "workspace"
    folder.mkdir()
    with TestClient(create_app()) as client:
        save = partial_recipe(client, folder)
        save["bpic19_pipeline"]["replay_mode"] = "partial"
        def unrelated_failure(*args, **kwargs):
            raise error("Independent synthetic analytical failure, not a ledger read")
        monkeypatch.setattr("wise_platform_api.bpic19_measures.Bpic19Measures.measures", unrelated_failure)
        refused = client.post("/api/investigations/save", json=save)
        assert refused.status_code == 500 and refused.json()["code"] == "computation_failed", refused.text
        assert not list((folder / "investigations/revisions").glob("*.json"))


@pytest.mark.parametrize("kind,mutation,code", [("source_csv", "missing", "artifact_unavailable"), ("definition", "digest", "checksum_mismatch"), ("run", "missing", "artifact_unavailable")])
def test_actual_tcp_new_pid_refuses_saved_reference_and_recovers_only_historical_content(tmp_path, kind, mutation, code):
    folder = tmp_path / "workspace"
    folder.mkdir()
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    first, client = start_process(port)
    try:
        wid, identity, native, save, saved, recover, raw_request, evidence, _ = seed(client, folder)
        damage(native_reference(folder, identity, native, kind), mutation)
        before = tree(folder)
    finally:
        first.terminate()
        first.wait(timeout=15)
    second, fresh = start_process(port)
    try:
        assert first.returncode is not None and first.pid != second.pid
        assert fresh.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(folder))).status_code == 200
        refused = fresh.post("/api/investigations/reopen", json=reopen(wid, saved))
        assert refused.status_code == 409 and refused.json()["code"] == code, refused.text
        historical = fresh.post(ROUTE, json=recover)
        assert historical.status_code == 200 and historical.json()["outputs_restored"] is False
        raw = fresh.post("/api/investigations/case-evidence", json=raw_request)
        if kind == "source_csv": assert raw.status_code == 404 and raw.json()["code"] == "source_unavailable", raw.text
        else: assert raw.status_code == 200 and raw.json()["records"] == evidence["records"], raw.text
        assert tree(folder) == before
    finally:
        second.terminate()
        second.wait(timeout=15)
