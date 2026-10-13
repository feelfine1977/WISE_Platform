"""Saving an investigation, listing it, revising it and reopening it, through the routes.

The literal log below has three incidents. Every membership and count was
worked out by hand from it:

    A  Opened, Assigned, Resolved on 9 October     3 records, contains Assigned
    B  Opened, Resolved on 9 October                2 records, does not
    C  Opened, Assigned on 10 October               2 records, contains Assigned

The step "contains Assigned" on the parent A, B, C keeps A and C (5 records)
and removes B (2 records); nothing is unevaluable.
"""

import hashlib
import json
import os
import subprocess
import sys
import textwrap
import threading
from copy import deepcopy
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from import_requests import envelope, policies
from jsonschema import Draft202012Validator, FormatChecker

from wise_platform_api import saved_store, saving as saving_module, workspace as workspace_module
from wise_platform_api.app import create_app
from wise_platform_api.saving_boundary import STATUS

ROOT = Path(__file__).resolve().parents[3]
SCHEMA = json.loads((ROOT / "contracts" / "saving.schema.json").read_text(encoding="utf-8"))
VALIDATOR = Draft202012Validator(SCHEMA, format_checker=FormatChecker())
SAVE = "/api/investigations/save"
LIST = "/api/investigations/list-saved"
REOPEN = "/api/investigations/reopen"
CONTEXT_POLICY = "incident.context.first_record_in_declared_order.v1"

LOG = (
    "Ticket,Activity,At,Desk\r\n"
    "A,Opened,2026-10-09T08:00:00Z,East\r\n"
    "A,Assigned,2026-10-09T09:00:00Z,East\r\n"
    "A,Resolved,2026-10-09T11:00:00Z,East\r\n"
    "B,Opened,2026-10-09T08:00:00Z,\r\n"
    "B,Resolved,2026-10-09T08:30:00Z,West\r\n"
    "C,Opened,2026-10-10T08:00:00Z,West\r\n"
    "C,Assigned,2026-10-10T10:00:00Z,West\r\n"
).encode("utf-8")
DIGEST = hashlib.sha256(LOG).hexdigest()
LOG_ID = "source.v1:sha256:" + DIGEST
DIALECT = {"encoding": "utf-8", "delimiter": ",", "quotechar": '"', "header": "first_record"}
MAPPING = {"case_column": 0, "activity_column": 1, "timestamp_column": 2, "sequence_column": None, "context_columns": [3]}
ASSIGNED = {"kind": "contains_activity", "activity": "Assigned", "negate": False}


def new_client(tmp_path) -> TestClient:
    return TestClient(create_app(static_dir=tmp_path / "unbuilt"))


@pytest.fixture
def client(tmp_path):
    with new_client(tmp_path) as active:
        yield active


@pytest.fixture
def folder(tmp_path):
    path = tmp_path / "Ablage Fälle"
    path.mkdir()
    return path


def open_workspace(client, folder) -> str:
    response = client.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(folder)))
    assert response.status_code == 200, response.text
    return response.json()["workspace_id"]


@pytest.fixture
def question(client, folder):
    """The literal log stored, prepared, opened and selected by "contains Assigned"."""
    workspace_id = open_workspace(client, folder)
    metadata = envelope("upload_source_metadata", "upload-1", workspace_id=workspace_id, filename="Störungen.csv")
    response = client.put("/api/sources", params=metadata, content=LOG, headers={"Content-Type": "application/octet-stream"})
    assert response.status_code == 200, response.text
    confirmation = envelope(
        "confirm_mapping_request", "prepare-1", workspace_id=workspace_id, source_id=LOG_ID, dialect=DIALECT,
        mapping=MAPPING, policies=policies("iso8601", None), accept_report_issues=True)
    prepared = client.post("/api/preparations", json=confirmation).json()
    assert prepared["state"] == "ready", prepared
    request = envelope("open_population_request", "population-1", workspace_id=workspace_id,
                       preparation_id=prepared["preparation"]["preparation_id"])
    base = client.post("/api/investigations/open-population", json=request).json()
    selection = client.post("/api/investigations/select-cases", json=envelope(
        "select_cases_request", "select-2", 2, workspace_id=workspace_id, identity=base["identity"],
        parent_case_ids=["A", "B", "C"], predicates=[ASSIGNED])).json()
    assert selection["kept"] == {"case_ids": ["A", "C"], "case_count": 2, "record_count": 5}
    return {"workspace_id": workspace_id, "confirmation": confirmation, "base": base, "selection": selection}


def save_request(question, request_id="save-1", revision=3, **changes) -> dict:
    request = envelope(
        "save_investigation_request", request_id, revision, workspace_id=question["workspace_id"],
        investigation_id=None, expected_revision_id=None, name="Zuweisungen",
        base_identity=deepcopy(question["base"]["identity"]),
        selection_identity=deepcopy(question["selection"]["identity"]),
        selection_recipe={"parent_case_ids": ["A", "B", "C"], "predicates": [deepcopy(ASSIGNED)]},
        context_policy=CONTEXT_POLICY, comparison=None, notes="Assigned incidents.\nKeep every record.",
        bookmarks=[])
    request.update(changes)
    return request


def saved(client, request) -> dict:
    VALIDATOR.validate(request)
    response = client.post(SAVE, json=request)
    assert response.status_code == 200, response.text
    answer = response.json()
    VALIDATOR.validate(answer)
    assert answer["message_type"] == "save_investigation_answer"
    assert (answer["request_id"], answer["query_revision"], answer["workspace_id"]) == (
        request["request_id"], request["query_revision"], request["workspace_id"])
    return answer


def listed(client, workspace_id, revision=9) -> list:
    response = client.post(LIST, json=envelope("list_saved_request", "list-1", revision, workspace_id=workspace_id))
    assert response.status_code == 200, response.text
    answer = response.json()
    VALIDATOR.validate(answer)
    return answer["investigations"]


def reopen_request(workspace_id, revision_id, revision=7) -> dict:
    return envelope("reopen_investigation_request", "reopen-1", revision, workspace_id=workspace_id,
                    saved_revision_id=revision_id)


def reopened(client, workspace_id, revision_id, revision=7) -> dict:
    response = client.post(REOPEN, json=reopen_request(workspace_id, revision_id, revision))
    assert response.status_code == 200, response.text
    answer = response.json()
    VALIDATOR.validate(answer)
    assert answer["message_type"] == "reopen_investigation_answer"
    return answer


def refused(response, operation, code, field=None) -> dict:
    body = response.json()
    VALIDATOR.validate(body)
    assert body["message_type"] == "saving_refusal", body
    assert (body["operation"], body["code"]) == (operation, code), body
    assert response.status_code == STATUS[code]
    assert body["message"].strip()
    if field is not None:
        assert body["field"] == field, body
    return body


def revision_files(folder) -> list[Path]:
    return sorted((folder / "investigations" / "revisions").glob("*.json"))


def expected_revision_id(investigation_id, replaces, content) -> str:
    text = json.dumps({"kind": "investigation_revision.v1", "investigation_id": investigation_id,
                       "replaces_revision_id": replaces, "content": content},
                      sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return "saved-revision.v1:sha256:" + hashlib.sha256(text.encode("utf-8")).hexdigest()


# Saving and listing ------------------------------------------------------------------------------


def test_save_answers_the_content_as_given_and_writes_one_file_without_a_path(client, question, folder, tmp_path):
    request = save_request(question)
    answer = saved(client, request)
    revision = answer["revision"]
    assert revision["content"] == {
        "format_version": 1, "name": "Zuweisungen", "base_identity": question["base"]["identity"],
        "selection_identity": question["selection"]["identity"],
        "selection_recipe": {"parent_case_ids": ["A", "B", "C"], "predicates": [ASSIGNED]},
        "context_policy": CONTEXT_POLICY, "comparison": None, "notes": "Assigned incidents.\nKeep every record.",
        "bookmarks": [], "score_run_ref": None}
    assert answer["created_investigation"] is True and answer["semantic_change"] is True
    assert answer["recovery"] == {"presentation_state": None, "warnings": []}
    assert revision["saved_revision_id"] == expected_revision_id(revision["investigation_id"], None, revision["content"])

    [path] = revision_files(folder)
    assert path.name == revision["saved_revision_id"].rsplit(":", 1)[1] + ".json"
    text = path.read_text(encoding="utf-8")
    assert str(tmp_path) not in text and folder.name not in text
    stored = json.loads(text)
    assert stored["format"] == "wise-platform-saved-revision" and stored["format_version"] == 1
    assert stored["application_version"] == "0.1.0" and stored["analytics_version"] == "0.1.0"
    assert stored["replaces_revision_id"] is None
    assert stored["source"] == {"source_id": LOG_ID, "filename": "Störungen.csv", "byte_count": len(LOG)}
    confirmation = question["confirmation"]
    assert {key: stored["preparation"][key] for key in ("dialect", "mapping", "policies")} == {
        key: confirmation[key] for key in ("dialect", "mapping", "policies")}
    assert stored["content"] == revision["content"]
    results = stored["results"]
    assert (results["base"]["case_count"], results["base"]["record_count"]) == (3, 7)
    assert (results["parent"]["case_count"], results["parent"]["record_count"]) == (3, 7)
    assert results["selection"]["identity"] == question["selection"]["identity"]
    assert results["selection"]["kept"] == {"case_count": 2, "record_count": 5}
    assert results["selection"]["removed"] == {"case_count": 1, "record_count": 2}
    assert results["selection"]["unevaluable"] == {"case_count": 0, "record_count": 0}
    assert results["comparison"] is None


def test_the_list_names_the_latest_revision_with_the_counts_stored_at_saving(client, question):
    assert listed(client, question["workspace_id"]) == []
    revision = saved(client, save_request(question))["revision"]
    assert listed(client, question["workspace_id"]) == [{
        "investigation_id": revision["investigation_id"], "latest_revision_id": revision["saved_revision_id"],
        "name": "Zuweisungen", "source_id": LOG_ID, "preparation_id": question["base"]["identity"]["preparation_id"],
        "selected_case_count": 2, "selected_record_count": 5, "comparison_kind": None, "has_score_run": False,
        "source_validation": "not_checked"}]


def test_a_second_revision_names_the_one_it_replaces_and_keeps_it(client, question, folder):
    first = saved(client, save_request(question))["revision"]
    update = save_request(question, "save-2", 4, investigation_id=first["investigation_id"],
                          expected_revision_id=first["saved_revision_id"], name="Zuweisungen, geprüft",
                          notes="Second look.")
    answer = saved(client, update)
    second = answer["revision"]
    assert answer["created_investigation"] is False and answer["semantic_change"] is True
    assert second["investigation_id"] == first["investigation_id"]
    assert second["saved_revision_id"] == expected_revision_id(
        first["investigation_id"], first["saved_revision_id"], second["content"])
    assert len(revision_files(folder)) == 2
    stored = json.loads((folder / "investigations" / "revisions" / (second["saved_revision_id"][-64:] + ".json"))
                        .read_text(encoding="utf-8"))
    assert stored["replaces_revision_id"] == first["saved_revision_id"]
    [summary] = listed(client, question["workspace_id"])
    assert (summary["latest_revision_id"], summary["name"]) == (second["saved_revision_id"], "Zuweisungen, geprüft")
    assert reopened(client, question["workspace_id"], first["saved_revision_id"])["revision"] == first
    assert reopened(client, question["workspace_id"], second["saved_revision_id"], 8)["revision"] == second


def test_saving_unchanged_content_again_adds_no_revision(client, question, folder):
    first = saved(client, save_request(question))["revision"]
    again = saved(client, save_request(question, "save-2", 4, investigation_id=first["investigation_id"],
                                       expected_revision_id=first["saved_revision_id"]))
    assert again["revision"] == first
    assert again["created_investigation"] is False and again["semantic_change"] is False
    assert len(revision_files(folder)) == 1


def test_a_save_against_an_earlier_head_is_a_conflict_and_changes_nothing(client, question, folder):
    first = saved(client, save_request(question))["revision"]
    second = saved(client, save_request(question, "save-2", 4, investigation_id=first["investigation_id"],
                                        expected_revision_id=first["saved_revision_id"], notes="Newer."))["revision"]
    heads = sorted((folder / "investigations" / "heads").glob("*.json"))
    before = [path.read_bytes() for path in heads]
    stale = save_request(question, "save-3", 5, investigation_id=first["investigation_id"],
                         expected_revision_id=first["saved_revision_id"], notes="Stale.")
    body = refused(client.post(SAVE, json=stale), "save_investigation", "revision_conflict", "expected_revision_id")
    assert body["retryable"] is False
    assert (body["investigation_id"], body["expected_revision_id"], body["current_revision_id"]) == (
        first["investigation_id"], first["saved_revision_id"], second["saved_revision_id"])
    assert (body["request_id"], body["query_revision"], body["workspace_id"]) == ("save-3", 5, question["workspace_id"])
    assert [path.read_bytes() for path in heads] == before
    assert len(revision_files(folder)) == 2
    assert listed(client, question["workspace_id"])[0]["latest_revision_id"] == second["saved_revision_id"]


def test_unchanged_content_against_an_earlier_head_is_still_a_conflict(client, question):
    first = saved(client, save_request(question))["revision"]
    saved(client, save_request(question, "save-2", 4, investigation_id=first["investigation_id"],
                               expected_revision_id=first["saved_revision_id"], notes="Newer."))
    stale = save_request(question, "save-3", 5, investigation_id=first["investigation_id"],
                         expected_revision_id=first["saved_revision_id"])
    refused(client.post(SAVE, json=stale), "save_investigation", "revision_conflict")


def test_an_update_of_an_investigation_never_saved_is_refused(client, question):
    request = save_request(question, investigation_id="investigation.v1:never-saved-here",
                           expected_revision_id="saved-revision.v1:sha256:" + "a" * 64)
    refused(client.post(SAVE, json=request), "save_investigation", "investigation_unavailable", "investigation_id")


def test_concurrent_writers_of_one_head_publish_exactly_one_revision(client, question, folder):
    first = saved(client, save_request(question))["revision"]
    statuses = []

    def write(index):
        request = save_request(question, f"save-{index}", 10 + index, investigation_id=first["investigation_id"],
                               expected_revision_id=first["saved_revision_id"], notes=f"Writer {index}.")
        statuses.append(client.post(SAVE, json=request).status_code)

    writers = [threading.Thread(target=write, args=(index,)) for index in range(6)]
    for writer in writers:
        writer.start()
    for writer in writers:
        writer.join()
    assert sorted(statuses) == [200, 409, 409, 409, 409, 409]
    assert len(revision_files(folder)) == 2


# Writing atomically --------------------------------------------------------------------------------


def test_a_failure_while_writing_a_revision_leaves_every_file_as_it_was(client, question, folder, monkeypatch):
    first = saved(client, save_request(question))["revision"]
    before = {path.relative_to(folder): path.read_bytes() for path in folder.rglob("*") if path.is_file()}

    def failing(source, target):
        raise OSError("the drive went away")

    monkeypatch.setattr(workspace_module.os, "replace", failing)
    update = save_request(question, "save-2", 4, investigation_id=first["investigation_id"],
                          expected_revision_id=first["saved_revision_id"], notes="Never written.")
    body = refused(client.post(SAVE, json=update), "save_investigation", "publication_failed")
    assert body["retryable"] is True
    monkeypatch.undo()
    after = {path.relative_to(folder): path.read_bytes() for path in folder.rglob("*") if path.is_file()}
    assert after == before
    assert listed(client, question["workspace_id"])[0]["latest_revision_id"] == first["saved_revision_id"]


def test_a_failure_while_writing_the_head_keeps_the_earlier_head(client, question, folder, monkeypatch):
    first = saved(client, save_request(question))["revision"]
    real = os.replace

    def failing_for_heads(source, target):
        if Path(target).parent.name == "heads":
            raise OSError("the drive went away")
        real(source, target)

    monkeypatch.setattr(workspace_module.os, "replace", failing_for_heads)
    update = save_request(question, "save-2", 4, investigation_id=first["investigation_id"],
                          expected_revision_id=first["saved_revision_id"], notes="Head never moved.")
    refused(client.post(SAVE, json=update), "save_investigation", "publication_failed")
    monkeypatch.undo()
    # The complete new revision may stay behind, but no head names it and no partial file is left.
    assert [path.name for path in (folder / "investigations").rglob("*.partial")] == []
    assert listed(client, question["workspace_id"])[0]["latest_revision_id"] == first["saved_revision_id"]
    assert reopened(client, question["workspace_id"], first["saved_revision_id"])["revision"] == first


def test_a_writer_of_another_process_holding_the_lock_makes_a_save_wait_and_then_refuse(client, question, folder, monkeypatch):
    monkeypatch.setattr(saved_store, "_LOCK_WAIT_SECONDS", 0.5)
    first = saved(client, save_request(question))["revision"]
    holder = subprocess.Popen(
        [sys.executable, "-c", textwrap.dedent("""
            import sys, time
            from pathlib import Path
            from wise_platform_api import saved_store
            with (Path(sys.argv[1]) / "investigations" / ".publication.lock").open("a+b") as handle:
                saved_store._lock(handle)
                print("held", flush=True)
                sys.stdin.readline()
        """), str(folder)],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, env=_environment())
    try:
        assert holder.stdout.readline().strip() == "held"
        update = save_request(question, "save-2", 4, investigation_id=first["investigation_id"],
                              expected_revision_id=first["saved_revision_id"], notes="Waits.")
        body = refused(client.post(SAVE, json=update), "save_investigation", "publication_failed")
        assert body["retryable"] is True
    finally:
        holder.communicate("done\n", timeout=10)
    assert saved(client, update)["revision"]["content"]["notes"] == "Waits."


# Reopening -------------------------------------------------------------------------------------------


def test_reopening_in_a_new_application_restores_the_selection_and_its_populations(question, folder, tmp_path):
    with new_client(tmp_path) as first_run:
        workspace_id = open_workspace(first_run, folder)
        revision = saved(first_run, save_request(question))["revision"]
    with new_client(tmp_path) as second_run:
        assert open_workspace(second_run, folder) == workspace_id
        answer = reopened(second_run, workspace_id, revision["saved_revision_id"])
        assert answer["revision"] == revision
        assert answer["restored_comparison_id"] is None
        assert answer["recovery"] == {"presentation_state": None, "warnings": []}
        restored = answer["restored_selection"]
        assert restored["identity"] == question["selection"]["identity"]
        assert restored["parent"] == {"case_ids": ["A", "B", "C"], "case_count": 3, "record_count": 7}
        assert restored["kept"] == {"case_ids": ["A", "C"], "case_count": 2, "record_count": 5}
        assert restored["removed"] == {"case_ids": ["B"], "case_count": 1, "record_count": 2}
        assert restored["unevaluable"] == {"case_ids": [], "case_count": 0, "record_count": 0}
        assert [result["predicate"] for result in restored["predicate_results"]] == [ASSIGNED]
        # Without selecting again, the restored populations answer their map and complete histories.
        graph = second_run.post("/api/investigations/process-graph", json=envelope(
            "process_graph_request", "graph-1", 7, workspace_id=workspace_id, identity=restored["identity"]))
        assert graph.status_code == 200, graph.text
        assert graph.json()["graph"]["meta"]["selected_case_ids"] == ["A", "C"]
        evidence = second_run.post("/api/investigations/case-evidence", json=envelope(
            "imported_case_evidence_request", "case-1", 7, workspace_id=workspace_id,
            identity=restored["identity"], case_id="C"))
        assert evidence.status_code == 200, evidence.text
        assert [row["activity"] for row in evidence.json()["records"]] == ["Opened", "Assigned"]


def test_a_second_python_process_reopens_what_this_one_saved(client, question, folder):
    revision = saved(client, save_request(question))["revision"]
    script = textwrap.dedent("""
        import json, sys
        from pathlib import Path
        from fastapi.testclient import TestClient
        from wise_platform_api.app import create_app
        folder, revision_id = sys.argv[1], sys.argv[2]
        def envelope(kind, **fields):
            return {"schema_version": 1, "message_type": kind, "request_id": "second-1", "query_revision": 1, **fields}
        with TestClient(create_app(static_dir=Path(folder) / "unbuilt")) as client:
            opened = client.post("/api/workspaces/open", json=envelope("open_workspace_request", path=folder)).json()
            answer = client.post("/api/investigations/reopen", json=envelope(
                "reopen_investigation_request", workspace_id=opened["workspace_id"], saved_revision_id=revision_id))
            evidence = client.post("/api/investigations/case-evidence", json=envelope(
                "imported_case_evidence_request", workspace_id=opened["workspace_id"],
                identity=answer.json()["restored_selection"]["identity"], case_id="A"))
            print(json.dumps({"pid": __import__("os").getpid(), "status": answer.status_code, "answer": answer.json(),
                              "evidence": evidence.json()}))
    """)
    finished = subprocess.run([sys.executable, "-c", script, str(folder), revision["saved_revision_id"]],
                              capture_output=True, text=True, timeout=120, env=_environment())
    assert finished.returncode == 0, finished.stderr
    second = json.loads(finished.stdout.strip().splitlines()[-1])
    assert second["pid"] != os.getpid()
    assert second["status"] == 200, second["answer"]
    VALIDATOR.validate(second["answer"])
    assert second["answer"]["revision"] == revision
    assert second["answer"]["restored_selection"]["kept"]["case_ids"] == ["A", "C"]
    assert [row["activity"] for row in second["evidence"]["records"]] == ["Opened", "Assigned", "Resolved"]


def test_reopening_with_the_source_file_removed_names_the_file(client, question, folder, tmp_path):
    revision = saved(client, save_request(question))["revision"]
    (folder / "sources" / f"{DIGEST}.csv").unlink()
    with new_client(tmp_path) as later:
        workspace_id = open_workspace(later, folder)
        body = refused(later.post(REOPEN, json=reopen_request(workspace_id, revision["saved_revision_id"])),
                       "reopen_investigation", "source_unavailable", "saved_revision_id")
    assert "Störungen.csv" in body["message"] and LOG_ID in body["message"]
    assert body["request_id"] == "reopen-1"


def test_reopening_with_changed_source_bytes_is_refused_as_changed(client, question, folder):
    revision = saved(client, save_request(question))["revision"]
    (folder / "sources" / f"{DIGEST}.csv").write_bytes(LOG.replace(b"B,Resolved", b"B,Reopened"))
    refused(client.post(REOPEN, json=reopen_request(question["workspace_id"], revision["saved_revision_id"])),
            "reopen_investigation", "source_changed")


def test_reopening_a_revision_of_another_analytics_version_is_refused(client, question, monkeypatch):
    revision = saved(client, save_request(question))["revision"]
    monkeypatch.setattr(saving_module, "IMPLEMENTATION_VERSION", "0.2.0")
    body = refused(client.post(REOPEN, json=reopen_request(question["workspace_id"], revision["saved_revision_id"])),
                   "reopen_investigation", "incompatible_saved_revision", "saved_revision_id")
    assert "0.1.0" in body["message"] and "0.2.0" in body["message"]


@pytest.mark.parametrize("damage", ["notes", "counts", "truncated", "not-json"])
def test_a_hand_damaged_revision_is_refused_and_not_listed_as_saved(client, question, folder, damage):
    revision = saved(client, save_request(question))["revision"]
    [path] = revision_files(folder)
    stored = json.loads(path.read_text(encoding="utf-8"))
    if damage == "notes":
        stored["content"]["notes"] = "Edited by hand."
        path.write_text(json.dumps(stored), encoding="utf-8")
    elif damage == "counts":
        stored["results"]["selection"]["kept"]["case_count"] = 3
        path.write_text(json.dumps(stored), encoding="utf-8")
    elif damage == "truncated":
        path.write_bytes(path.read_bytes()[:200])
    else:
        path.write_bytes(b"\xff\xfe")
    code = "selection_mismatch" if damage == "counts" else "malformed_saved_revision"
    refused(client.post(REOPEN, json=reopen_request(question["workspace_id"], revision["saved_revision_id"])),
            "reopen_investigation", code)
    if damage != "counts":
        response = client.post(LIST, json=envelope("list_saved_request", "list-1", 9, workspace_id=question["workspace_id"]))
        body = refused(response, "list_saved", "malformed_saved_revision")
        assert "investigations/revisions/" in body["message"]


def test_a_damaged_head_is_refused_rather_than_left_out_of_the_list(client, question, folder):
    saved(client, save_request(question))
    [head] = (folder / "investigations" / "heads").glob("*.json")
    head.write_text("{}", encoding="utf-8")
    response = client.post(LIST, json=envelope("list_saved_request", "list-1", 9, workspace_id=question["workspace_id"]))
    refused(response, "list_saved", "malformed_saved_revision")


def test_a_revision_not_in_the_workspace_is_unavailable(client, question):
    refused(client.post(REOPEN, json=reopen_request(question["workspace_id"], "saved-revision.v1:sha256:" + "b" * 64)),
            "reopen_investigation", "revision_unavailable", "saved_revision_id")


def test_a_preparation_no_longer_kept_is_prepared_again_from_the_saved_recipe(client, question, folder, tmp_path):
    revision = saved(client, save_request(question))["revision"]
    preparation_id = question["base"]["identity"]["preparation_id"]
    kept = folder / "preparations" / f"{preparation_id[-64:]}.json"
    kept.unlink()
    with new_client(tmp_path) as later:
        workspace_id = open_workspace(later, folder)
        answer = reopened(later, workspace_id, revision["saved_revision_id"])
    assert answer["restored_selection"]["identity"] == question["selection"]["identity"]
    assert json.loads(kept.read_text(encoding="utf-8"))["preparation"]["preparation_id"] == preparation_id


def test_a_kept_preparation_with_another_recipe_is_refused_as_changed(client, question, folder, tmp_path):
    revision = saved(client, save_request(question))["revision"]
    kept = folder / "preparations" / f"{question['base']['identity']['preparation_id'][-64:]}.json"
    stored = json.loads(kept.read_text(encoding="utf-8"))
    stored["preparation"]["mapping"]["context_columns"] = []
    kept.write_text(json.dumps(stored), encoding="utf-8")
    with new_client(tmp_path) as later:
        workspace_id = open_workspace(later, folder)
        refused(later.post(REOPEN, json=reopen_request(workspace_id, revision["saved_revision_id"])),
                "reopen_investigation", "preparation_changed")


def test_a_saved_presentation_comes_back_and_an_unreadable_one_is_a_warning(client, question, folder):
    presentation = {"active_view": "process_map", "table_sorts": [], "flow_artifact_sha256": None,
                    "graph_positions": None}
    answer = saved(client, save_request(question, presentation_state=presentation))
    assert answer["recovery"] == {"presentation_state": presentation, "warnings": []}
    revision_id = answer["revision"]["saved_revision_id"]
    assert reopened(client, question["workspace_id"], revision_id)["recovery"]["presentation_state"] == presentation
    [path] = revision_files(folder)
    stored = json.loads(path.read_text(encoding="utf-8"))
    stored["presentation_state"] = {"active_view": "somewhere"}
    path.write_text(json.dumps(stored), encoding="utf-8")
    recovery = reopened(client, question["workspace_id"], revision_id, 8)["recovery"]
    assert recovery["presentation_state"] is None
    assert [warning["code"] for warning in recovery["warnings"]] == ["presentation_invalid"]


# Comparisons and bookmarks -----------------------------------------------------------------------------


def group_comparison(client, question) -> tuple[dict, dict]:
    definition = {"mode": "two_named_groups",
                  "target": {"name": "Nur A", "definition": {"kind": "explicit_case_ids", "case_ids": ["A"]}},
                  "reference": {"name": "B und C", "definition": {"kind": "explicit_case_ids", "case_ids": ["C", "B"]}}}
    response = client.post("/api/investigations/compare-groups", json=envelope(
        "compare_groups_request", "compare-1", 3, workspace_id=question["workspace_id"],
        identity=question["base"]["identity"], parent_case_ids=["A", "B", "C"], context_column_index=3,
        context_policy=CONTEXT_POLICY, definition=definition))
    assert response.status_code == 200, response.text
    answer = response.json()
    return answer, {"kind": "group", "comparison_id": answer["comparison_id"], "parent_case_ids": ["A", "B", "C"],
                    "context_column_index": 3, "context_policy": CONTEXT_POLICY, "definition": definition}


def test_a_comparison_and_bookmarks_are_saved_and_restored_with_their_groups(client, question, folder, tmp_path):
    workspace_id = question["workspace_id"]
    comparison, saved_comparison = group_comparison(client, question)
    assert comparison["target"]["included"]["case_ids"] == ["A"]
    assert comparison["reference"]["included"]["case_ids"] == ["B", "C"]
    evidence = client.post("/api/investigations/case-evidence", json=envelope(
        "imported_case_evidence_request", "case-1", 3, workspace_id=workspace_id,
        identity=question["selection"]["identity"], case_id="A")).json()
    bookmarks = [
        {"label": "Ganz A", "identity": question["selection"]["identity"], "case_id": "A", "row_ids": [], "note": ""},
        {"label": "Zuweisung", "identity": question["selection"]["identity"], "case_id": "A",
         "row_ids": [evidence["records"][1]["row_id"]], "note": "The assignment."},
        {"label": "Referenz", "identity": comparison["reference"]["identity"], "case_id": "B", "row_ids": [],
         "note": "A compared group."},
    ]
    revision = saved(client, save_request(question, comparison=saved_comparison, bookmarks=bookmarks))["revision"]
    assert revision["content"]["comparison"] == saved_comparison
    assert revision["content"]["bookmarks"] == bookmarks
    [summary] = listed(client, workspace_id)
    assert summary["comparison_kind"] == "group"
    with new_client(tmp_path) as second_run:
        open_workspace(second_run, folder)
        answer = reopened(second_run, workspace_id, revision["saved_revision_id"])
        assert answer["restored_comparison_id"] == comparison["comparison_id"]
        for role, case_id, activities in (("target", "A", ["Opened", "Assigned", "Resolved"]),
                                          ("reference", "B", ["Opened", "Resolved"])):
            response = second_run.post("/api/investigations/case-evidence", json=envelope(
                "imported_case_evidence_request", "case-2", 7, workspace_id=workspace_id,
                identity=comparison[role]["identity"], case_id=case_id))
            assert response.status_code == 200, response.text
            assert [row["activity"] for row in response.json()["records"]] == activities


def test_a_comparison_whose_id_is_not_its_definition_is_refused(client, question):
    _, saved_comparison = group_comparison(client, question)
    saved_comparison["definition"]["target"]["definition"]["case_ids"] = ["C"]
    refused(client.post(SAVE, json=save_request(question, comparison=saved_comparison)),
            "save_investigation", "comparison_mismatch", "comparison.comparison_id")


def test_a_period_comparison_saved_with_a_whole_number_of_hours_written_either_way(client, question):
    definition = {
        "target": {"name": "9. Oktober", "window": {"timestamp_kind": "utc_instant",
                   "start_inclusive": "2026-10-09T00:00:00Z", "end_exclusive": "2026-10-10T00:00:00Z"}},
        "reference": {"name": "10. Oktober", "window": {"timestamp_kind": "utc_instant",
                      "start_inclusive": "2026-10-10T00:00:00Z", "end_exclusive": "2026-10-11T00:00:00Z"}},
        "minimum_followup_hours": 4, "endpoint_activity": None}
    response = client.post("/api/investigations/compare-periods", json=envelope(
        "compare_periods_request", "compare-1", 3, workspace_id=question["workspace_id"],
        identity=question["base"]["identity"], parent_case_ids=None, context_column_index=3,
        context_policy=CONTEXT_POLICY, definition=definition))
    assert response.status_code == 200, response.text
    comparison = response.json()
    assert comparison["target"]["included"]["case_ids"] == ["A", "B"]
    assert comparison["reference"]["included"]["case_ids"] == ["C"]
    saved_comparison = {"kind": "period", "comparison_id": comparison["comparison_id"],
                        "parent_case_ids": ["A", "B", "C"], "context_column_index": 3,
                        "context_policy": CONTEXT_POLICY, "definition": definition}
    whole = saved(client, save_request(question, comparison=saved_comparison))["revision"]
    written_as_float = deepcopy(saved_comparison)
    written_as_float["definition"]["minimum_followup_hours"] = 4.0
    again = saved(client, save_request(question, "save-2", 4, comparison=written_as_float))["revision"]
    assert again["content"]["comparison"]["definition"]["minimum_followup_hours"] == 4
    assert again["content"] == whole["content"]
    assert listed(client, question["workspace_id"])[0]["comparison_kind"] == "period"
    assert reopened(client, question["workspace_id"], whole["saved_revision_id"])["restored_comparison_id"] == (
        comparison["comparison_id"])


@pytest.mark.parametrize("mistake", ["foreign-case", "foreign-row", "foreign-population"])
def test_a_bookmark_not_bound_to_the_question_is_refused(client, question, mistake):
    workspace_id = question["workspace_id"]
    rows = {
        case_id: [row["row_id"] for row in client.post("/api/investigations/case-evidence", json=envelope(
            "imported_case_evidence_request", "case-1", 2, workspace_id=workspace_id,
            identity=question["selection"]["identity"] if case_id != "B" else question["base"]["identity"],
            case_id=case_id)).json()["records"]]
        for case_id in ("A", "B")
    }
    bookmark = {"label": "Witness", "identity": deepcopy(question["selection"]["identity"]), "case_id": "A",
                "row_ids": [rows["A"][0]], "note": ""}
    field = "bookmarks.0.identity"
    if mistake == "foreign-case":
        bookmark["case_id"], bookmark["row_ids"], field = "B", [], "bookmarks.0.case_id"
    elif mistake == "foreign-row":
        bookmark["row_ids"], field = [rows["B"][0]], "bookmarks.0.row_ids"
    else:
        bookmark["identity"]["population_id"] = "population.v1:sha256:" + "c" * 64
    refused(client.post(SAVE, json=save_request(question, bookmarks=[bookmark])), "save_investigation",
            "invalid_bookmark", field)


# Saving refuses a question that is not what the workspace computes --------------------------------------


def test_a_reference_to_a_score_run_the_workspace_does_not_keep_is_refused(client, question, folder):
    reference = {"score_run_id": "score-run.v1:sha256:" + "d" * 64,
                 "scored_population_id": question["selection"]["identity"]["population_id"],
                 "calibration_id": "calibration.v1:sha256:" + "e" * 64}
    refused(client.post(SAVE, json=save_request(question, score_run_ref=reference)), "save_investigation",
            "score_reference_unavailable", "score_run_ref.score_run_id")
    assert not (folder / "investigations").exists()


def test_a_null_score_reference_is_saved_as_unscored(client, question):
    assert saved(client, save_request(question, score_run_ref=None))["revision"]["content"]["score_run_ref"] is None


def test_a_selection_identity_the_steps_do_not_give_is_refused(client, question):
    named = deepcopy(question["selection"]["identity"])
    named["population_id"] = question["base"]["identity"]["population_id"]
    refused(client.post(SAVE, json=save_request(question, selection_identity=named)), "save_investigation",
            "selection_mismatch", "selection_identity.population_id")
    other_steps = {"parent_case_ids": ["A", "B", "C"], "predicates": [{**ASSIGNED, "negate": True}]}
    refused(client.post(SAVE, json=save_request(question, selection_recipe=other_steps)), "save_investigation",
            "selection_mismatch", "selection_identity.population_id")
    unknown_parent = {"parent_case_ids": ["A", "Z"], "predicates": [ASSIGNED]}
    refused(client.post(SAVE, json=save_request(question, selection_recipe=unknown_parent)), "save_investigation",
            "selection_mismatch", "selection_recipe")


def test_a_base_identity_of_another_dictionary_is_refused(client, question):
    base = deepcopy(question["base"]["identity"])
    base["case_dictionary_id"] = "case-dictionary.v1:sha256:" + "0" * 64
    selection = deepcopy(question["selection"]["identity"])
    selection["case_dictionary_id"] = base["case_dictionary_id"]
    refused(client.post(SAVE, json=save_request(question, base_identity=base, selection_identity=selection)),
            "save_investigation", "identity_mismatch", "base_identity.case_dictionary_id")
    refused(client.post(SAVE, json=save_request(question, selection_identity=selection)),
            "save_investigation", "identity_mismatch", "selection_identity.case_dictionary_id")


def test_saving_with_the_source_removed_is_refused(client, question, folder):
    (folder / "sources" / f"{DIGEST}.csv").unlink()
    refused(client.post(SAVE, json=save_request(question)), "save_investigation", "source_unavailable",
            "base_identity.source_id")


def test_a_workspace_not_open_is_refused(client, question):
    request = save_request(question, workspace_id="workspace.v1:not-opened-here")
    body = refused(client.post(SAVE, json=request), "save_investigation", "workspace_unavailable", "workspace_id")
    assert body["workspace_id"] == "workspace.v1:not-opened-here"


def _environment() -> dict:
    environment = dict(os.environ)
    paths = [str(ROOT / "apps" / "api" / "src"), str(ROOT / "packages" / "analytics" / "src")]
    if environment.get("PYTHONPATH"):
        paths.append(environment["PYTHONPATH"])
    environment["PYTHONPATH"] = os.pathsep.join(paths)
    return environment
