"""Read a kept immutable score run through HTTP without evaluating it again."""

from contextlib import contextmanager
from copy import deepcopy
import json

from fastapi.testclient import TestClient
import pytest

from wise_platform_api import method
from wise_platform_api.app import create_app
from wise_platform_api.generated.scoring import ReadScoreRunRequest
from test_import_acceptance import envelope
from test_saved_investigation_restart import open_workspace
from test_saved_result_integrity import corrupt_d5
from test_saved_score_restart import VALUES
from test_scoring_acceptance import (
    ROOT,
    VALIDATOR,
    definition,
    observe_real_lag_evaluations,
    ready,
    score,
    source_population,
)
from test_selection_acceptance import contains, select


READ = "/api/expectations/read-run"


def read_request(workspace, run_id, request_id="read-original-run", revision=20):
    request = envelope(
        "read_score_run_request", request_id, revision,
        workspace_id=workspace["workspace_id"], run_id=run_id,
    )
    VALIDATOR.validate(request)
    parsed = ReadScoreRunRequest.model_validate_json(json.dumps(request), strict=True)
    assert parsed.model_dump(mode="json") == request
    return request


def read(client, workspace, run_id, request_id="read-original-run", revision=20):
    request = read_request(workspace, run_id, request_id, revision)
    response = client.post(READ, json=request)
    assert response.status_code == 200, response.text
    answer = response.json()
    VALIDATOR.validate(answer)
    assert answer["message_type"] == "score_run_answer"
    for field in ("request_id", "query_revision", "workspace_id"):
        assert answer[field] == request[field]
    assert answer["run"]["identity"]["run_id"] == run_id
    return answer


def refused(client, request, code):
    response = client.post(READ, json=request)
    assert 400 <= response.status_code < 500, response.text
    answer = response.json()
    assert answer.get("message_type") == "scoring_refusal", answer
    VALIDATOR.validate(answer)
    assert answer["operation"] == "read_score_run"
    assert answer["code"] == code and answer["message"].strip()
    assert answer["request_id"] == request["request_id"]
    assert answer["workspace_id"] == request["workspace_id"]
    expected_revision = request["query_revision"] if type(request["query_revision"]) is int else None
    assert answer["query_revision"] == expected_revision
    assert "run" not in answer
    return answer


def kept_bytes(folder):
    return {path.relative_to(folder): path.read_bytes() for path in folder.rglob("*") if path.is_file()}


@contextmanager
def no_method_execution(monkeypatch):
    """Tripwires around the actual Method adapter; no result is substituted."""
    def forbidden(*args, **kwargs):
        pytest.fail("Reading a stored run must not check or evaluate a norm.")

    with monkeypatch.context() as patch:
        patch.setattr(method, "check", forbidden)
        patch.setattr(method, "score", forbidden)
        yield


@pytest.fixture
def kept_run(tmp_path):
    assert not tmp_path.resolve().is_relative_to(ROOT)
    folder = tmp_path / "Synthetic original score workspace"
    folder.mkdir()
    with observe_real_lag_evaluations() as evaluated:
        with TestClient(create_app(static_dir=tmp_path / "unbuilt-first")) as client:
            workspace = open_workspace(client, folder, "original-score-workspace")
            base = source_population(client, workspace)
            version = ready(client, workspace, base, base, definition(target=4, width=2))
            before = len(evaluated.calls)
            run = score(client, workspace, base, base, version)
            evaluated.assert_single_evaluation_since(before, sorted(VALUES), 19)
            assert {case["case_id"]: case["value"] for case in run["cases"]} == VALUES
            yield {
                "client": client, "workspace": workspace, "base": base,
                "version": version, "run": run, "folder": folder,
                "evaluated": evaluated,
            }


def test_read_original_run_after_filtering_preserves_values_population_and_calibration(kept_run, monkeypatch):
    state = kept_run
    selected = select(state["client"], state["workspace"], state["base"], [contains("Opened")])
    assert selected["kept"] == {
        "case_ids": sorted(set(VALUES) - {"NOOPEN"}), "case_count": 8, "record_count": 18,
    }
    original = deepcopy(state["run"])
    protected = kept_bytes(state["folder"])
    before = len(state["evaluated"].calls)
    with no_method_execution(monkeypatch):
        first = read(state["client"], state["workspace"], original["identity"]["run_id"], "read-after-filter", 21)
        second = read(state["client"], state["workspace"], original["identity"]["run_id"], "read-again", 22)
    assert first["run"] == second["run"] == original
    assert first["request_id"] != second["request_id"] and first["query_revision"] != second["query_revision"]
    assert first["run"]["population"] == {"case_ids": sorted(VALUES), "case_count": 9, "record_count": 19}
    assert first["run"]["identity"]["scored_population_identity"] == state["base"]["identity"]
    assert first["run"]["identity"]["calibration_id"] == original["calibration"]["calibration_id"]
    assert next(case for case in first["run"]["cases"] if case["case_id"] == "NOOPEN")["value"] is None
    assert len(state["evaluated"].calls) == before and kept_bytes(state["folder"]) == protected


def test_fresh_application_reads_a_selected_run_before_any_population_or_selection_query(kept_run, tmp_path, monkeypatch):
    state = kept_run
    selected = select(state["client"], state["workspace"], state["base"], [contains("Resolved")])
    assert selected["kept"] == {
        "case_ids": sorted(set(VALUES) - {"MISSING", "NOOPEN"}), "case_count": 7, "record_count": 17,
    }
    original = score(state["client"], state["workspace"], state["base"], selected, state["version"])
    assert original["identity"]["scored_population_identity"] == selected["identity"]
    before = len(state["evaluated"].calls)
    protected = kept_bytes(state["folder"])
    with TestClient(create_app(static_dir=tmp_path / "unbuilt-second")) as fresh:
        workspace = open_workspace(fresh, state["folder"], "fresh-score-workspace")
        assert workspace["workspace_id"] == state["workspace"]["workspace_id"]
        with no_method_execution(monkeypatch):
            answer = read(fresh, workspace, original["identity"]["run_id"], "read-kept-selected-run", 31)
        assert answer["run"] == original
    assert len(state["evaluated"].calls) == before and kept_bytes(state["folder"]) == protected


@pytest.mark.parametrize("missing", ["run", "foreign_workspace", "unopened_workspace"])
def test_run_reads_are_local_to_the_opened_workspace(kept_run, tmp_path, monkeypatch, missing):
    state = kept_run
    workspace = state["workspace"]
    run_id = state["run"]["identity"]["run_id"]
    if missing == "run":
        run_id = "score-run.v1:sha256:" + "0" * 64
        assert run_id != state["run"]["identity"]["run_id"]
    elif missing == "foreign_workspace":
        foreign = tmp_path / "Separate synthetic workspace"
        foreign.mkdir()
        workspace = open_workspace(state["client"], foreign, "foreign-score-workspace")
    else:
        workspace = {"workspace_id": "workspace.v1:unopened-local-workspace"}
    request = read_request(workspace, run_id, "read-unavailable-run", 41)
    before = len(state["evaluated"].calls)
    protected = kept_bytes(state["folder"])
    with no_method_execution(monkeypatch):
        refused(state["client"], request, "workspace_unavailable" if missing == "unopened_workspace" else "run_unavailable")
    assert len(state["evaluated"].calls) == before and kept_bytes(state["folder"]) == protected


def test_read_a_changed_score_artifact_refuses_without_repair_or_evaluation(kept_run, monkeypatch):
    state = kept_run
    run_path, changed_bytes = corrupt_d5(state["folder"], state["run"])
    request = read_request(state["workspace"], state["run"]["identity"]["run_id"], "read-changed-run", 51)
    protected = kept_bytes(state["folder"])
    before = len(state["evaluated"].calls)
    with no_method_execution(monkeypatch):
        refused(state["client"], request, "run_unavailable")
    assert run_path.read_bytes() == changed_bytes
    assert len(state["evaluated"].calls) == before and kept_bytes(state["folder"]) == protected


def test_read_run_request_is_closed_and_has_typed_boundary_refusals(kept_run, monkeypatch):
    state = kept_run
    original = read_request(state["workspace"], state["run"]["identity"]["run_id"], "read-boundary", 61)
    malformed = [
        ({"base_identity": state["base"]["identity"]}, "invalid_request"),
        ({"query_revision": True}, "invalid_request"),
        ({"schema_version": True}, "invalid_request"),
        ({"run_id": "not-a-run-identity"}, "invalid_request"),
        ({"schema_version": 2}, "unsupported_schema"),
    ]
    before = len(state["evaluated"].calls)
    protected = kept_bytes(state["folder"])
    with no_method_execution(monkeypatch):
        for changes, code in malformed:
            refused(state["client"], {**original, **changes}, code)
    assert len(state["evaluated"].calls) == before and kept_bytes(state["folder"]) == protected
