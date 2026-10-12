"""The workspace folder: creation, refusals, atomic writes and what another run finds there."""

import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

from wise_platform_api import workspace as workspace_module
from wise_platform_api.workspace import (
    MANIFEST,
    Problem,
    Workspace,
    program_folders,
    write_atomically,
)

SOURCE = "Ticket;Activity;At\r\nA-1;Opened;2026-10-09T08:00:00Z\r\n".encode("utf-8")
SOURCE_ID = "source.v1:sha256:" + hashlib.sha256(SOURCE).hexdigest()
PREPARATION_ID = "preparation.v1:sha256:" + "1" * 64


def opened(path: Path, forbidden=()) -> Workspace:
    result = Workspace.open(str(path), forbidden)
    assert isinstance(result, Workspace), result
    return result


def refused(path_text: str, code: str, forbidden=()) -> Problem:
    result = Workspace.open(path_text, forbidden)
    assert isinstance(result, Problem), result
    assert result.code == code, result
    assert result.message.strip()
    return result


def descriptor(source_id: str = SOURCE_ID, preparation_id: str = PREPARATION_ID) -> dict:
    return {"preparation_id": preparation_id, "source_id": source_id, "dialect": {}, "mapping": {}, "policies": {}}


def files_in(folder: Path) -> list[str]:
    return sorted(str(path.relative_to(folder)) for path in folder.rglob("*"))


def test_an_empty_folder_becomes_a_workspace_with_a_manifest(tmp_path):
    folder = tmp_path / "Überprüfung Ablage"
    folder.mkdir()

    workspace = opened(folder)

    manifest = json.loads((folder / MANIFEST).read_text(encoding="utf-8"))
    assert manifest["format"] == "wise-platform-workspace"
    assert manifest["format_version"] == 1
    assert manifest["workspace_id"] == workspace.workspace_id
    assert workspace.workspace_id.startswith("workspace.v1:")
    assert workspace.path == folder.resolve()
    assert files_in(folder) == ["preparations", "sources", MANIFEST]
    assert workspace.sources() == [] and workspace.preparations() == []


def test_opening_the_same_folder_again_finds_the_same_workspace(tmp_path):
    first = opened(tmp_path)
    again = opened(tmp_path)

    assert again.workspace_id == first.workspace_id
    assert files_in(tmp_path) == ["preparations", "sources", MANIFEST]


def test_files_an_operating_system_leaves_in_an_empty_folder_do_not_make_it_foreign(tmp_path):
    (tmp_path / "desktop.ini").write_text("[.ShellClassInfo]", encoding="utf-8")

    opened(tmp_path)


def test_a_missing_folder_is_refused_and_not_created(tmp_path):
    missing = tmp_path / "not there"

    problem = refused(str(missing), "workspace_unavailable")

    assert problem.field == "path"
    assert not missing.exists()


def test_a_relative_path_is_refused(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    (tmp_path / "relative").mkdir()

    refused("relative", "workspace_unavailable")
    assert files_in(tmp_path) == ["relative"]


def test_a_file_is_not_a_workspace(tmp_path):
    file = tmp_path / "events.csv"
    file.write_bytes(SOURCE)

    refused(str(file), "workspace_unavailable")
    assert file.read_bytes() == SOURCE


def test_a_folder_holding_other_files_is_foreign_and_left_untouched(tmp_path):
    (tmp_path / "events.csv").write_bytes(SOURCE)

    refused(str(tmp_path), "workspace_incompatible")
    assert files_in(tmp_path) == ["events.csv"]


@pytest.mark.parametrize(
    "manifest",
    [
        {"format": "another-program", "format_version": 1, "workspace_id": "workspace.v1:abcdefgh"},
        {"format": "wise-platform-workspace", "format_version": 2, "workspace_id": "workspace.v1:abcdefgh"},
        {"format": "wise-platform-workspace", "format_version": 1, "workspace_id": "elsewhere"},
        "not an object",
    ],
)
def test_a_workspace_description_this_version_cannot_read_is_incompatible(tmp_path, manifest):
    (tmp_path / MANIFEST).write_text(json.dumps(manifest), encoding="utf-8")

    refused(str(tmp_path), "workspace_incompatible")
    assert files_in(tmp_path) == [MANIFEST]


def test_a_folder_inside_the_program_is_refused(tmp_path):
    program = tmp_path / "program"
    inside = program / "data"
    inside.mkdir(parents=True)

    refused(str(inside), "workspace_incompatible", forbidden=[program])
    refused(str(program), "workspace_incompatible", forbidden=[program])
    assert files_in(program) == ["data"]


def test_the_program_folders_include_both_packages():
    folders = program_folders()

    assert Path(workspace_module.__file__).resolve().parent in folders
    import wise_platform_analytics

    assert Path(wise_platform_analytics.__file__).resolve().parent in folders


def test_a_folder_that_cannot_be_written_is_refused(tmp_path, monkeypatch):
    def no_writing(*args, **kwargs):
        raise PermissionError("denied")

    monkeypatch.setattr(workspace_module.tempfile, "mkstemp", no_writing)

    problem = refused(str(tmp_path), "workspace_not_writable")
    assert problem.field == "path"
    assert not (tmp_path / MANIFEST).exists()


def test_an_existing_workspace_that_can_no_longer_be_written_is_refused(tmp_path, monkeypatch):
    opened(tmp_path)

    def no_writing(*args, **kwargs):
        raise PermissionError("denied")

    monkeypatch.setattr(workspace_module.tempfile, "mkstemp", no_writing)

    refused(str(tmp_path), "workspace_not_writable")


def test_an_atomic_write_leaves_the_previous_file_when_it_fails(tmp_path, monkeypatch):
    target = tmp_path / "record.json"
    target.write_bytes(b"previous")

    def interrupted(source, destination):
        raise OSError("interrupted")

    monkeypatch.setattr(workspace_module.os, "replace", interrupted)
    with pytest.raises(OSError):
        write_atomically(target, b"new and complete")

    assert target.read_bytes() == b"previous"
    assert files_in(tmp_path) == ["record.json"]


def test_an_atomic_write_writes_beside_the_target_and_renames(tmp_path, monkeypatch):
    target = tmp_path / "record.json"
    target.write_bytes(b"previous")
    renamed = []
    original_replace = os.replace

    def watched(source, destination):
        assert Path(source).parent == tmp_path
        assert Path(source).read_bytes() == b"new and complete"
        assert target.read_bytes() == b"previous"
        renamed.append(Path(destination))
        original_replace(source, destination)

    monkeypatch.setattr(workspace_module.os, "replace", watched)
    write_atomically(target, b"new and complete")

    assert renamed == [target]
    assert target.read_bytes() == b"new and complete"
    assert files_in(tmp_path) == ["record.json"]


def test_a_source_is_kept_unchanged_under_its_sha256(tmp_path):
    workspace = opened(tmp_path)

    stored = workspace.store_source(SOURCE, "Ereignisse März.csv")

    assert stored.to_dict() == {"source_id": SOURCE_ID, "filename": "Ereignisse März.csv", "byte_count": len(SOURCE)}
    digest = hashlib.sha256(SOURCE).hexdigest()
    assert (tmp_path / "sources" / f"{digest}.csv").read_bytes() == SOURCE
    assert workspace.read_source(SOURCE_ID) == SOURCE
    assert workspace.sources() == [stored]


def test_the_same_bytes_are_stored_once(tmp_path, monkeypatch):
    workspace = opened(tmp_path)
    first = workspace.store_source(SOURCE, "first.csv")
    writes = []
    original = workspace_module.write_atomically
    monkeypatch.setattr(
        workspace_module, "write_atomically", lambda target, data, **kw: (writes.append(target), original(target, data, **kw))
    )

    again = workspace.store_source(SOURCE, "renamed copy.csv")

    assert again == first
    assert writes == []
    assert [path for path in files_in(tmp_path) if path.startswith("sources" + os.sep)] == sorted(
        [os.path.join("sources", f"{hashlib.sha256(SOURCE).hexdigest()}.csv"),
         os.path.join("sources", f"{hashlib.sha256(SOURCE).hexdigest()}.json")]
    )


def test_stored_bytes_changed_outside_the_application_are_not_read(tmp_path):
    workspace = opened(tmp_path)
    workspace.store_source(SOURCE, "events.csv")
    data = tmp_path / "sources" / f"{hashlib.sha256(SOURCE).hexdigest()}.csv"
    data.write_bytes(SOURCE.replace(b"A-1", b"B-1"))

    problem = workspace.read_source(SOURCE_ID)

    assert isinstance(problem, Problem) and problem.code == "source_unavailable"


def test_a_source_that_is_not_stored_is_unavailable(tmp_path):
    workspace = opened(tmp_path)

    for source_id in [SOURCE_ID, "source.v1:sha256:../../x"]:
        problem = workspace.read_source(source_id)
        assert isinstance(problem, Problem) and problem.code == "source_unavailable"


def test_a_preparation_is_kept_with_its_identities_and_report(tmp_path):
    workspace = opened(tmp_path)
    workspace.store_source(SOURCE, "events.csv")
    identity = {"source_id": SOURCE_ID, "preparation_id": PREPARATION_ID}
    report = {"raw_record_count": 1, "issues": []}

    stored = workspace.store_preparation(descriptor(), identity, report)

    found = workspace.preparation(PREPARATION_ID)
    assert found == stored
    assert (found.descriptor, found.identity, found.report) == (descriptor(), identity, report)
    assert [item.to_dict() for item in workspace.preparations()] == [
        {"preparation_id": PREPARATION_ID, "source_id": SOURCE_ID}
    ]


def test_a_preparation_that_is_not_kept_is_unavailable(tmp_path):
    workspace = opened(tmp_path)

    problem = workspace.preparation(PREPARATION_ID)

    assert isinstance(problem, Problem) and problem.code == "preparation_unavailable"


def test_unfinished_and_unreadable_entries_are_not_listed(tmp_path):
    workspace = opened(tmp_path)
    workspace.store_source(SOURCE, "events.csv")
    (tmp_path / "sources" / ".abc.json.1234.partial").write_text("{", encoding="utf-8")
    (tmp_path / "sources" / ("f" * 64 + ".json")).write_text("{broken", encoding="utf-8")
    (tmp_path / "preparations" / ("2" * 64 + ".json")).write_text("[]", encoding="utf-8")
    # A preparation whose source is no longer stored is not offered.
    workspace.store_preparation(descriptor("source.v1:sha256:" + "3" * 64, "preparation.v1:sha256:" + "4" * 64), {}, {})

    assert [source.source_id for source in workspace.sources()] == [SOURCE_ID]
    assert workspace.preparations() == []


def test_a_workspace_whose_folder_changed_is_no_longer_used(tmp_path):
    workspace = opened(tmp_path)
    (tmp_path / MANIFEST).unlink()

    problem = workspace.store_source(SOURCE, "events.csv")

    assert isinstance(problem, Problem) and problem.code == "workspace_unavailable"
    assert not any((tmp_path / "sources").iterdir())


def test_another_process_finds_the_stored_sources_and_preparations(tmp_path):
    workspace = opened(tmp_path)
    workspace.store_source(SOURCE, "events.csv")
    workspace.store_preparation(descriptor(), {"source_id": SOURCE_ID}, {"raw_record_count": 1})
    script = (
        "import json, sys\n"
        "from wise_platform_api.workspace import Workspace\n"
        "found = Workspace.open(sys.argv[1])\n"
        "print(json.dumps({'workspace_id': found.workspace_id,"
        " 'sources': [item.to_dict() for item in found.sources()],"
        " 'preparations': [item.to_dict() for item in found.preparations()]}))\n"
    )

    completed = subprocess.run(
        [sys.executable, "-c", script, str(tmp_path)], capture_output=True, text=True, encoding="utf-8", check=True
    )

    assert json.loads(completed.stdout) == {
        "workspace_id": workspace.workspace_id,
        "sources": [{"source_id": SOURCE_ID, "filename": "events.csv", "byte_count": len(SOURCE)}],
        "preparations": [{"preparation_id": PREPARATION_ID, "source_id": SOURCE_ID}],
    }
