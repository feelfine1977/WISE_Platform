"""#26: an application-aware backup of a workspace and its checked restore into another folder, also in another process.

A workspace with a saved, unscored finding (tests/fixtures/frozen-parent, as in #25) is backed up while its service runs.
A second service process restores it into a new folder: the workspace keeps its identity, the saved revision reopens with
the same identities and incidents, and an incident's complete evidence is the same; the original is unchanged. A backup
changed, cut short or of another format is refused with what to do; an interrupted backup or restore leaves no folder
that looks complete; a save being written makes a backup wait and then refuse; a destination in the workspace, not
empty or not writable is refused.
"""

import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import textwrap

from fastapi.testclient import TestClient
import pytest

from test_import_acceptance import envelope
from test_issue25_saved_finding import EXPECTED, FIXTURES, ok, question, read, reopen, save
from test_saved_investigation_restart import cli_host, loopback_port, open_workspace
from wise_platform_api import saved_store, workspace_backup
from wise_platform_api.app import create_app

ROOT = Path(__file__).resolve().parents[1]


def back_up(client, workspace, destination):  # noqa: F811
    return client.post("/api/workspaces/back-up", json=envelope("back_up_workspace_request", workspace_id=workspace["workspace_id"], destination=str(destination)))


def restore(client, backup, destination):  # noqa: F811
    return client.post("/api/workspaces/restore", json=envelope("restore_workspace_request", backup_path=str(backup), destination=str(destination)))


def hashes(folder):
    return {str(path.relative_to(folder)): hashlib.sha256(path.read_bytes()).hexdigest() for path in sorted(folder.rglob("*")) if path.is_file()
            and not path.name.startswith(".")}


def evidence_of(client, workspace, identity, case_id):  # noqa: F811
    answer = ok(client.post("/api/investigations/case-evidence", json=envelope("imported_case_evidence_request", "evidence", 3, workspace_id=workspace["workspace_id"],
                identity=identity, case_id=case_id)))
    return answer["records"], answer["incident_time"]


def test_a_backup_restored_in_another_process_reopens_the_saved_finding_and_its_evidence(tmp_path):
    original, backup, restored = tmp_path / "workspace", tmp_path / "backup", tmp_path / "restored copy"
    original.mkdir()
    port = loopback_port()
    with cli_host(tmp_path, 1, port) as (client, _):
        workspace = open_workspace(client, original, "workspace-1")
        base = read(client, workspace, (FIXTURES / EXPECTED["file"]).read_bytes(), EXPECTED["file"], "upload-1")
        selected, compared, request = question(client, workspace, base, "first")
        revision = ok(save(client, request))["revision"]
        before = evidence_of(client, workspace, selected["identity"], "F01")
        backed = ok(back_up(client, workspace, backup))
        assert (backed["workspace_id"], backed["counts"]["sources"], backed["counts"]["revisions"], backed["counts"]["investigations"]) == (workspace["workspace_id"], 1, 1, 1)
        assert (backup / workspace_backup.BACKUP_MANIFEST).is_file()
    original_files = hashes(original)
    with cli_host(tmp_path, 2, port) as (client, _):
        answer = ok(restore(client, backup, restored))
        assert (answer["workspace_id"], answer["warnings"]) == (workspace["workspace_id"], [])
        relocated = open_workspace(client, restored, "workspace-2")
        assert relocated["workspace_id"] == workspace["workspace_id"]
        reopened = reopen(client, relocated, revision["saved_revision_id"])
        assert reopened["revision"] == revision
        assert reopened["restored_selection"]["identity"] == selected["identity"]
        assert reopened["restored_comparison_id"] == compared["comparison_id"]
        assert evidence_of(client, relocated, selected["identity"], "F01") == before
    assert hashes(original) == original_files
    # The restored workspace holds exactly the files the application wrote, as they were.
    assert {name: digest for name, digest in hashes(restored).items()} == {name: digest for name, digest in hashes(backup).items() if name != workspace_backup.BACKUP_MANIFEST}


@pytest.fixture
def backed_up(tmp_path):
    original, backup = tmp_path / "workspace", tmp_path / "backup"
    original.mkdir()
    with TestClient(create_app(static_dir=tmp_path / "unbuilt")) as client:
        workspace = ok(client.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(original))))
        base = read(client, workspace, (FIXTURES / EXPECTED["file"]).read_bytes(), EXPECTED["file"], "upload-1")
        _, _, request = question(client, workspace, base, "first")
        ok(save(client, request))
        ok(back_up(client, workspace, backup))
        yield client, workspace, original, backup


def refused(response, code):
    assert response.status_code >= 400 and response.json()["code"] == code, response.text
    return response.json()


@pytest.mark.parametrize("damage", ["changed", "missing", "extra"])
def test_a_changed_or_incomplete_backup_is_refused_and_nothing_is_restored(backed_up, tmp_path, damage):
    client, _, _, backup = backed_up
    source = next((backup / "sources").glob("*.csv"))
    revision = next((backup / "investigations" / "revisions").glob("*.json"))
    if damage == "changed":
        source.write_bytes(source.read_bytes().replace(b"F01", b"F09", 1))
    elif damage == "missing":
        revision.unlink()
    else:
        (backup / "preparations" / ("0" * 64 + ".json")).write_text("{}", encoding="utf-8")
    body = refused(restore(client, backup, tmp_path / "restored"), "backup_damaged")
    assert "Restore another backup" in body["message"]
    assert not (tmp_path / "restored").exists() and not any(path.name.endswith(".partial") for path in tmp_path.iterdir())


def test_another_format_or_an_unfinished_backup_is_refused_with_its_recovery(backed_up, tmp_path):
    client, _, _, backup = backed_up
    manifest = backup / workspace_backup.BACKUP_MANIFEST
    described = json.loads(manifest.read_text(encoding="utf-8"))
    manifest.write_text(json.dumps({**described, "format_version": 2}), encoding="utf-8")
    body = refused(restore(client, backup, tmp_path / "restored"), "workspace_incompatible")
    assert "Restore it with the application version that wrote it" in body["message"]
    manifest.unlink()
    body = refused(restore(client, backup, tmp_path / "restored"), "backup_unavailable")
    assert "A backup that was interrupted is never finished" in body["message"]


def test_an_interrupted_backup_leaves_no_folder_that_looks_complete(backed_up, tmp_path, monkeypatch):
    client, workspace, _, _ = backed_up
    copied = []
    real = workspace_backup._copy

    def failing(source_root, target_root, relative):
        if len(copied) == 3:
            raise OSError("The disk is full.")
        copied.append(relative)
        real(source_root, target_root, relative)

    monkeypatch.setattr(workspace_backup, "_copy", failing)
    body = refused(back_up(client, workspace, tmp_path / "second backup"), "workspace_not_writable")
    assert "none was kept" in body["message"]
    assert not (tmp_path / "second backup").exists()
    assert not any(path.name.startswith(".second backup") for path in tmp_path.iterdir())


def test_a_save_being_written_makes_a_backup_wait_and_then_refuse(backed_up, tmp_path, monkeypatch):
    client, workspace, original, _ = backed_up
    monkeypatch.setattr(saved_store, "_LOCK_WAIT_SECONDS", 0.5)
    environment = {**os.environ, "PYTHONPATH": os.pathsep.join(str(ROOT / part) for part in ("apps/api/src", "packages/analytics/src"))}
    holder = subprocess.Popen([sys.executable, "-c", textwrap.dedent("""
        import sys
        from pathlib import Path
        from wise_platform_api import saved_store
        with (Path(sys.argv[1]) / "investigations" / ".publication.lock").open("a+b") as handle:
            saved_store._lock(handle)
            print("held", flush=True)
            sys.stdin.readline()
    """), str(original)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, env=environment)
    try:
        assert holder.stdout.readline().strip() == "held"
        body = refused(back_up(client, workspace, tmp_path / "while saving"), "workspace_busy")
        assert body["retryable"] is True and not (tmp_path / "while saving").exists()
    finally:
        holder.communicate("done\n", timeout=10)
    ok(back_up(client, workspace, tmp_path / "while saving"))


def test_destinations_inside_the_workspace_not_empty_or_not_writable_are_refused(backed_up, tmp_path):
    client, workspace, original, backup = backed_up
    refused(back_up(client, workspace, original / "inside"), "destination_unavailable")
    occupied = tmp_path / "occupied"
    occupied.mkdir()
    (occupied / "note.txt").write_text("mine", encoding="utf-8")
    refused(back_up(client, workspace, occupied), "destination_unavailable")
    refused(restore(client, backup, occupied), "destination_unavailable")
    refused(back_up(client, workspace, "relative/folder"), "invalid_request")
    if os.name != "nt" and os.geteuid() != 0:
        locked = tmp_path / "locked"
        locked.mkdir()
        locked.chmod(0o500)
        try:
            refused(back_up(client, workspace, locked / "backup"), "workspace_not_writable")
        finally:
            locked.chmod(0o700)
    # An empty folder is a fine destination.
    empty = tmp_path / "empty"
    empty.mkdir()
    assert ok(restore(client, backup, empty))["path"] == str(empty)
