"""Real CLI continuity of an unscored investigation and complete source evidence."""

from contextlib import contextmanager
from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time

import httpx
from jsonschema import Draft202012Validator, FormatChecker

from test_import_acceptance import (
    VALIDATOR as IMPORT,
    checked as checked_import,
    envelope,
    evidence,
    mapping_request,
    population,
    prepare,
    read_input,
    upload,
)
from test_selection_acceptance import contains, follows, graph, select
from test_comparison_acceptance import (
    VALIDATOR as COMPARISON,
    checked as checked_comparison,
    comparison_request,
    explicit_groups,
)

ROOT = Path(__file__).resolve().parents[1]
SAVING_SCHEMA = json.loads(
    (ROOT / "contracts/saving.schema.json").read_text(encoding="utf-8")
)
SAVING = Draft202012Validator(SAVING_SCHEMA, format_checker=FormatChecker())
HEALTH_SCHEMA = json.loads(
    (ROOT / "contracts/health.schema.json").read_text(encoding="utf-8")
)
HEALTH = Draft202012Validator(HEALTH_SCHEMA)
CONTEXT_POLICY = "incident.context.first_record_in_declared_order.v1"


def stop_owned(process):
    if process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)


def loopback_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as reservation:
        reservation.bind(("127.0.0.1", 0))
        return reservation.getsockname()[1]


@contextmanager
def cli_host(tmp_path, attempt, port):
    log = tmp_path / f"save-host-{attempt}.log"
    environment = dict(os.environ)
    source_paths = [str(ROOT / "apps/api/src"), str(ROOT / "packages/analytics/src")]
    if environment.get("PYTHONPATH"):
        source_paths.append(environment["PYTHONPATH"])
    environment["PYTHONPATH"] = os.pathsep.join(source_paths)
    with log.open("wb") as stream:
        process = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "wise_platform_api",
                "--host",
                "127.0.0.1",
                "--port",
                str(port),
            ],
            cwd=ROOT,
            env=environment,
            stdout=stream,
            stderr=subprocess.STDOUT,
        )
        try:
            with httpx.Client(
                base_url=f"http://127.0.0.1:{port}", trust_env=False, timeout=5
            ) as client:
                deadline = time.monotonic() + 20
                while time.monotonic() < deadline:
                    assert process.poll() is None, log.read_text(
                        encoding="utf-8", errors="replace"
                    )
                    try:
                        response = client.get("/api/health", timeout=1)
                        if response.status_code == 200:
                            HEALTH.validate(response.json())
                            assert process.poll() is None
                            break
                    except httpx.TransportError:
                        pass
                    time.sleep(0.1)
                else:
                    raise AssertionError(
                        "CLI host not ready within 20 seconds: "
                        + log.read_text(encoding="utf-8", errors="replace")
                    )
                yield client, process
        finally:
            stop_owned(process)
    assert process.poll() is not None


def open_workspace(client, path, request_id):
    request = envelope("open_workspace_request", request_id, path=str(path))
    IMPORT.validate(request)
    answer = checked_import(
        client.post("/api/workspaces/open", json=request), "workspace_answer", request
    )
    assert Path(answer["path"]).resolve() == path.resolve()
    assert answer["writable"] is True
    return answer


def checked_saving(response, request, kind):
    assert 200 <= response.status_code < 300, response.text
    answer = response.json()
    SAVING.validate(answer)
    assert answer["message_type"] == kind
    for field in ("request_id", "query_revision", "workspace_id"):
        assert answer[field] == request[field]
    return answer


def refused_saving(response, request, code):
    assert 400 <= response.status_code < 500, response.text
    answer = response.json()
    SAVING.validate(answer)
    assert answer["message_type"] == "saving_refusal"
    assert answer["code"] == code and answer["message"].strip()
    for field in ("request_id", "query_revision", "workspace_id"):
        assert answer[field] == request[field]
    return answer


def save(client, request):
    SAVING.validate(request)
    return checked_saving(
        client.post("/api/investigations/save", json=request),
        request,
        "save_investigation_answer",
    )


def reopen(client, workspace, revision_id, revision=20):
    request = envelope(
        "reopen_investigation_request",
        f"reopen-{revision}",
        revision,
        workspace_id=workspace["workspace_id"],
        saved_revision_id=revision_id,
    )
    SAVING.validate(request)
    return checked_saving(
        client.post("/api/investigations/reopen", json=request),
        request,
        "reopen_investigation_answer",
    )


def list_saved(client, workspace, revision=21):
    request = envelope(
        "list_saved_request",
        f"list-{revision}",
        revision,
        workspace_id=workspace["workspace_id"],
    )
    SAVING.validate(request)
    return checked_saving(
        client.post("/api/investigations/list-saved", json=request),
        request,
        "list_saved_answer",
    )


def save_synthetic_question(client, workspace):
    literal, raw, original = read_input("B4")
    source = upload(client, workspace, raw, literal["file"])
    interpretation = prepare(client, mapping_request(workspace, source, "B4"))
    base = population(client, workspace, interpretation)
    assert base["population"] == {
        "case_ids": ["T-01", "T-02"],
        "case_count": 2,
        "record_count": 5,
    }
    predicates = [contains("Recorded"), follows("Recorded", "Routed")]
    selected = select(
        client, workspace, base, predicates, parent=["T-01", "T-02"], revision=2
    )
    assert selected["kept"] == {
        "case_ids": ["T-01"],
        "case_count": 1,
        "record_count": 4,
    }
    assert selected["removed"] == {
        "case_ids": ["T-02"],
        "case_count": 1,
        "record_count": 1,
    }
    assert selected["unevaluable"]["case_count"] == 0
    trace = evidence(client, workspace, selected, "T-01")
    assert [row["source_position"] for row in trace["records"]] == [1, 2, 3, 0]
    assert [row["original_cells"] for row in trace["records"]] == [
        original[i] for i in [1, 2, 3, 0]
    ]
    assert [row["activity"] for row in trace["records"]] == [
        "Recorded",
        "Routed",
        None,
        "Reviewed",
    ]
    assert trace["records"][1]["context"] == [{"column_index": 4, "value": None}]
    assert trace["records"][2]["context"] == [{"column_index": 4, "value": "Unknown"}]
    supplied_graph = graph(client, workspace, selected)
    assert {node["label"] for node in supplied_graph["nodes"]} == {
        "Recorded",
        "Routed",
        "Reviewed",
    }
    assert len(supplied_graph["edges"]) == 2
    assert supplied_graph["meta"]["selected_case_count"] == 1
    assert supplied_graph["meta"]["raw_record_count"] == 4

    definition = explicit_groups(target=("T-01",), reference=("T-02",))
    comparison_intent = comparison_request(workspace, base, definition, context=4)
    comparison_intent["parent_case_ids"] = ["T-01", "T-02"]
    comparison_intent.update(request_id="compare-before-save", query_revision=3)
    COMPARISON.validate(comparison_intent)
    comparison = checked_comparison(
        client.post("/api/investigations/compare-groups", json=comparison_intent),
        comparison_intent,
        "group_comparison_answer",
    )
    assert comparison["target"]["included"] == selected["kept"]
    assert comparison["reference"]["included"] == selected["removed"]
    reference_population = {
        "identity": comparison["reference"]["identity"],
        "query_revision": comparison["query_revision"],
    }
    reference_trace = evidence(client, workspace, reference_population, "T-02")
    assert [row["source_position"] for row in reference_trace["records"]] == [4]
    assert [row["original_cells"] for row in reference_trace["records"]] == [
        original[4]
    ]
    assert reference_trace["coverage"] == {
        "raw_record_count": 1,
        "mapped_record_count": 1,
        "omitted_activity_record_count": 0,
    }
    bookmarks = [
        {
            "label": "Every original record",
            "identity": selected["identity"],
            "case_id": "T-01",
            "row_ids": [],
            "note": "Complete incident; preserve the missing activity.",
        },
        {
            "label": "Missing activity evidence",
            "identity": selected["identity"],
            "case_id": "T-01",
            "row_ids": [trace["records"][2]["row_id"]],
            "note": "Literal Unknown context is not an empty value.",
        },
    ]
    request = envelope(
        "save_investigation_request",
        "save-unscored",
        4,
        workspace_id=workspace["workspace_id"],
        investigation_id=None,
        expected_revision_id=None,
        name="Übergabe: recorded handoff",
        base_identity=base["identity"],
        selection_identity=selected["identity"],
        selection_recipe={
            "parent_case_ids": ["T-01", "T-02"],
            "predicates": predicates,
        },
        context_policy=CONTEXT_POLICY,
        comparison={
            "kind": "group",
            "comparison_id": comparison["comparison_id"],
            "parent_case_ids": ["T-01", "T-02"],
            "context_column_index": 4,
            "context_policy": CONTEXT_POLICY,
            "definition": definition,
        },
        notes="Fictional incident only.\nCheck the tied timestamps and complete history.",
        bookmarks=bookmarks,
    )
    # Omission is intentional: saving an investigation does not require a score run.
    assert "score_run_ref" not in request
    saved = save(client, request)
    assert saved["created_investigation"] is True and saved["semantic_change"] is True
    expected_content = {
        "format_version": 1,
        **{
            k: deepcopy(request[k])
            for k in (
                "name",
                "base_identity",
                "selection_identity",
                "selection_recipe",
                "context_policy",
                "comparison",
                "notes",
                "bookmarks",
            )
        },
        "score_run_ref": None,
    }
    assert saved["revision"]["content"] == expected_content
    revision = saved["revision"]
    listed = list_saved(client, workspace)["investigations"]
    assert len(listed) == 1
    assert listed[0]["latest_revision_id"] == revision["saved_revision_id"]
    assert (
        listed[0]["selected_case_count"] == 1
        and listed[0]["selected_record_count"] == 4
    )
    assert (
        listed[0]["has_score_run"] is False and listed[0]["comparison_kind"] == "group"
    )
    return {
        "raw": raw,
        "source": source,
        "interpretation": interpretation,
        "base": base,
        "selected": selected,
        "trace": trace,
        "reference_trace": reference_trace,
        "graph": supplied_graph,
        "comparison": comparison,
        "request": request,
        "revision": revision,
    }


def test_actual_two_process_reopen_restores_evidence_graph_and_unscored_question(
    tmp_path,
):
    assert not tmp_path.resolve().is_relative_to(
        ROOT
    ), "Runtime acceptance workspace must be external to source."
    path = tmp_path / "Überprüfung saved workspace"
    path.mkdir()
    port = loopback_port()
    with cli_host(tmp_path, 1, port) as (client, first):
        workspace = open_workspace(client, path, "workspace-first-process")
        before = save_synthetic_question(client, workspace)
    assert first.poll() is not None
    with cli_host(tmp_path, 2, port) as (client, second):
        assert second is not first
        reopened_workspace = open_workspace(client, path, "workspace-second-process")
        assert reopened_workspace["workspace_id"] == workspace["workspace_id"]
        assert before["source"] in reopened_workspace["sources"]
        assert (
            {
                key: before["interpretation"]["preparation"][key]
                for key in ("preparation_id", "source_id")
            }
            in reopened_workspace["preparations"]
        )
        assert (
            before["source"]["source_id"]
            == "source.v1:sha256:" + hashlib.sha256(before["raw"]).hexdigest()
        )
        after = reopen(
            client, reopened_workspace, before["revision"]["saved_revision_id"]
        )
        assert after["revision"] == before["revision"]
        assert after["restored_comparison_id"] == before["comparison"]["comparison_id"]
        for field in (
            "identity",
            "parent_identity",
            "parent",
            "kept",
            "removed",
            "unevaluable",
            "predicate_results",
        ):
            assert after["restored_selection"][field] == before["selected"][field]
        restored = {
            "identity": after["restored_selection"]["identity"],
            "query_revision": after["query_revision"],
        }
        # These calls precede open-population/select/compare in this second process.
        # They therefore require real registry restoration, not an echo of saved IDs.
        after_trace = evidence(client, reopened_workspace, restored, "T-01")
        for field in (
            "identity",
            "case_id",
            "columns",
            "records",
            "coverage",
            "mapped_row_ids",
            "omitted_activity_row_ids",
            "sequence_evaluable",
        ):
            assert after_trace[field] == before["trace"][field]
        assert graph(client, reopened_workspace, restored) == before["graph"]
        assert after["revision"]["content"]["notes"] == before["request"]["notes"]
        assert (
            after["revision"]["content"]["bookmarks"] == before["request"]["bookmarks"]
        )
        assert after["revision"]["content"]["score_run_ref"] is None
        # Comparison cohort identities also have to reopen before a new comparison query.
        target = {
            "identity": before["comparison"]["target"]["identity"],
            "query_revision": after["query_revision"],
        }
        assert len(evidence(client, reopened_workspace, target, "T-01")["records"]) == 4
        reference = {
            "identity": before["comparison"]["reference"]["identity"],
            "query_revision": after["query_revision"],
        }
        after_reference = evidence(client, reopened_workspace, reference, "T-02")
        for field in (
            "identity",
            "case_id",
            "columns",
            "records",
            "coverage",
            "mapped_row_ids",
            "omitted_activity_row_ids",
            "sequence_evaluable",
        ):
            assert after_reference[field] == before["reference_trace"][field]

        update = deepcopy(before["request"])
        update.update(
            request_id="current-update",
            query_revision=30,
            investigation_id=before["revision"]["investigation_id"],
            expected_revision_id=before["revision"]["saved_revision_id"],
            notes="A later preserved note.",
        )
        newer = save(client, update)["revision"]
        assert newer["saved_revision_id"] != before["revision"]["saved_revision_id"]
        stale = deepcopy(update)
        stale.update(
            request_id="stale-writer",
            query_revision=31,
            notes="This must never replace the head.",
        )
        conflict_response = client.post("/api/investigations/save", json=stale)
        assert conflict_response.status_code == 409, conflict_response.text
        conflict = refused_saving(conflict_response, stale, "revision_conflict")
        assert conflict["investigation_id"] == newer["investigation_id"]
        assert (
            conflict["expected_revision_id"] == before["revision"]["saved_revision_id"]
        )
        assert conflict["current_revision_id"] == newer["saved_revision_id"]
        listed = list_saved(client, reopened_workspace, revision=32)["investigations"]
        assert listed[0]["latest_revision_id"] == newer["saved_revision_id"]
        assert (
            reopen(client, reopened_workspace, newer["saved_revision_id"], revision=33)[
                "revision"
            ]
            == newer
        )
        assert (
            reopen(
                client,
                reopened_workspace,
                before["revision"]["saved_revision_id"],
                revision=34,
            )["revision"]
            == before["revision"]
        )
    assert second.poll() is not None


# Deferred external draft: do not adopt until the accepted storage adapter supplies
# an authoritative source-id fault-injection seam; raw-file discovery is not generic.
