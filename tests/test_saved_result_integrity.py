"""Corrupt kept results are refused without evaluation or replacing their history."""

from copy import deepcopy
import json
from pathlib import Path

from fastapi.testclient import TestClient
import pytest

from wise_platform_api.app import create_app
from test_import_acceptance import envelope
from test_saved_investigation_restart import (
    CONTEXT_POLICY,
    SAVING,
    open_workspace,
    refused_saving,
    save,
    save_synthetic_question,
)
from test_saved_score_restart import VALUES
from test_scoring_acceptance import (
    ROOT,
    SCORE,
    VALIDATOR as SCORING,
    WITNESS,
    definition,
    observe_real_lag_evaluations,
    ready,
    score,
    score_request,
    source_population,
    witness,
)
from test_selection_acceptance import select


def kept_files(folder):
    """The source, investigation and its current head must stay as kept."""
    return {
        path.relative_to(folder): path.read_bytes()
        for part in ("sources", "investigations/revisions", "investigations/heads")
        for path in (folder / part).glob("*.json" if part != "sources" else "*")
        if path.is_file()
    }


def save_scored_question(client, workspace, base, run):
    selected = select(
        client, workspace, base, [], parent=sorted(VALUES), revision=2
    )
    assert selected["kept"] == base["population"]
    reference = {
        "score_run_id": run["identity"]["run_id"],
        "scored_population_id": run["identity"]["scored_population_identity"][
            "population_id"
        ],
        "calibration_id": run["identity"]["calibration_id"],
    }
    request = envelope(
        "save_investigation_request",
        "save-before-damage",
        3,
        workspace_id=workspace["workspace_id"],
        investigation_id=None,
        expected_revision_id=None,
        name="Synthetic first-resolution result integrity",
        base_identity=base["identity"],
        selection_identity=selected["identity"],
        selection_recipe={"parent_case_ids": sorted(VALUES), "predicates": []},
        context_policy=CONTEXT_POLICY,
        comparison=None,
        notes="Retain the original Method run and every source record.",
        bookmarks=[],
        score_run_ref=reference,
    )
    saved = save(client, request)["revision"]
    assert saved["content"]["score_run_ref"] == reference
    return saved


def corrupt_d5(folder, run):
    """Fault the established workspace run file, without depending on checksums."""
    digest = run["identity"]["run_id"].rsplit(":", 1)[1]
    path = folder / "score-runs" / f"{digest}.json"
    stored = json.loads(path.read_text(encoding="utf-8"))
    assert stored["record"] == run
    changed = deepcopy(stored)
    verdict = next(
        case for case in changed["record"]["cases"] if case["case_id"] == "D5"
    )
    assert verdict["value"] == 0.5
    verdict["value"] = 0.9
    assert changed["record"]["identity"] == run["identity"]
    path.write_text(json.dumps(changed, ensure_ascii=False), encoding="utf-8")
    return path, path.read_bytes()


def refusal_to_read_damaged_run(client, operation, workspace, base, version, run, saved):
    if operation == "score":
        request = score_request(
            workspace, base, base, version, "reuse-damaged-run", 10
        )
        route, verb = SCORE, "score_expectation"
    elif operation == "witness":
        request = envelope(
            "score_case_witness_request",
            "witness-damaged-run",
            11,
            workspace_id=workspace["workspace_id"],
            run_id=run["identity"]["run_id"],
            case_id="D5",
        )
        route, verb = WITNESS, "score_case_witness"
    else:
        request = envelope(
            "reopen_investigation_request",
            "reopen-damaged-run",
            12,
            workspace_id=workspace["workspace_id"],
            saved_revision_id=saved["saved_revision_id"],
        )
        SAVING.validate(request)
        return refused_saving(
            client.post("/api/investigations/reopen", json=request),
            request,
            "score_reference_unavailable",
        )
    SCORING.validate(request)
    response = client.post(route, json=request)
    assert 400 <= response.status_code < 500, response.text
    answer = response.json()
    SCORING.validate(answer)
    assert answer["message_type"] == "scoring_refusal"
    assert answer["operation"] == verb
    assert answer["code"] == "run_unavailable"
    assert answer["message"].strip()
    for key in ("request_id", "query_revision", "workspace_id"):
        assert answer[key] == request[key]
    return answer


@pytest.mark.parametrize("cold", [False, True], ids=["warm-host", "fresh-host"])
@pytest.mark.parametrize("operation", ["score", "witness", "reopen"])
def test_changed_run_value_is_refused_without_reevaluation(tmp_path, cold, operation):
    assert not tmp_path.resolve().is_relative_to(ROOT)
    folder = tmp_path / "Synthetic result workspace"
    folder.mkdir()
    with observe_real_lag_evaluations() as method:
        with TestClient(create_app(static_dir=tmp_path / "unbuilt-first")) as first:
            workspace = open_workspace(first, folder, "integrity-first-host")
            base = source_population(first, workspace)
            assert base["population"] == {
                "case_ids": sorted(VALUES), "case_count": 9, "record_count": 19
            }
            version = ready(first, workspace, base, base, definition(target=4, width=2))
            before = len(method.calls)
            run = score(first, workspace, base, base, version)
            method.assert_single_evaluation_since(before, sorted(VALUES), 19)
            assert {case["case_id"]: case["value"] for case in run["cases"]} == VALUES
            assert witness(first, workspace, run, "D5")["case"]["value"] == 0.5
            saved = save_scored_question(first, workspace, base, run)
            protected = kept_files(folder)
            run_path, damaged_bytes = corrupt_d5(folder, run)
            evaluated = len(method.calls)
            if not cold:
                try:
                    refusal_to_read_damaged_run(
                        first, operation, workspace, base, version, run, saved
                    )
                finally:
                    assert len(method.calls) == evaluated
                    assert kept_files(folder) == protected
                    assert run_path.read_bytes() == damaged_bytes
        if cold:
            with TestClient(create_app(static_dir=tmp_path / "unbuilt-second")) as second:
                reopened_workspace = open_workspace(second, folder, "integrity-fresh-host")
                assert reopened_workspace["workspace_id"] == workspace["workspace_id"]
                try:
                    refusal_to_read_damaged_run(
                        second, operation, reopened_workspace, base, version, run, saved
                    )
                finally:
                    assert len(method.calls) == evaluated
                    assert kept_files(folder) == protected
                    assert run_path.read_bytes() == damaged_bytes


def test_update_refuses_a_damaged_current_revision_without_advancing_head(tmp_path):
    assert not tmp_path.resolve().is_relative_to(ROOT)
    folder = tmp_path / "Synthetic saved head workspace"
    folder.mkdir()
    with TestClient(create_app(static_dir=tmp_path / "unbuilt")) as client:
        workspace = open_workspace(client, folder, "saved-head-integrity")
        before = save_synthetic_question(client, workspace)
        revision = before["revision"]
        digest = revision["saved_revision_id"].rsplit(":", 1)[1]
        path = folder / "investigations" / "revisions" / f"{digest}.json"
        stored = json.loads(path.read_text(encoding="utf-8"))
        stored["content"]["notes"] = "Changed under the original revision hash."
        path.write_text(json.dumps(stored, ensure_ascii=False), encoding="utf-8")
        protected = kept_files(folder)
        request = deepcopy(before["request"])
        request.update(
            request_id="save-after-current-revision-damage",
            query_revision=20,
            investigation_id=revision["investigation_id"],
            expected_revision_id=revision["saved_revision_id"],
            notes="An intentionally new note cannot repair the earlier revision.",
        )
        SAVING.validate(request)
        try:
            refused_saving(
                client.post("/api/investigations/save", json=request),
                request,
                "malformed_saved_revision",
            )
        finally:
            assert kept_files(folder) == protected
