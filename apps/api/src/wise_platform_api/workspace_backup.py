"""Application-aware backup and restore of a local investigation workspace.

A backup copies what the application wrote and knows: the workspace manifest, the stored sources and preparations, the
immutable definitions, score runs and their artifacts, and the saved revisions with their heads, under the publication
lock so that no head points to a revision that is not copied. It is written into a hidden ``.partial`` folder beside the
destination, ends with a backup manifest of every file's SHA-256 and size, and only then takes the destination's name: an
interrupted backup leaves no folder that looks complete. Machine settings (the folder of record documents, an absolute
path of this computer) are not copied, and the answer says so.

A restore reads the backup manifest, refuses another backup or workspace format with the recovery of using the version
that wrote it, checks every listed file against its checksum and every unlisted one as damage, copies into a hidden
folder, opens it as a workspace and checks its sources, immutable records and saved revisions as the application reads
them, and only then gives it the destination's name. The workspace keeps its identity: the copy is the same workspace,
relocated, and saved revisions name no path of the machine.
"""

from __future__ import annotations

from collections.abc import Iterable
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import uuid

from wise_platform_analytics.version import IMPLEMENTATION_VERSION

from . import __version__
from .saved_store import FOLDER, HEADS, REVISIONS, SavedInvestigations, _Busy
from .workspace import DEFINITIONS, FORMAT_VERSION, MANIFEST, PREPARATIONS, SCORE_RUNS, SOURCES, Problem, Workspace, write_atomically

BACKUP_MANIFEST = "wise-platform-backup.json"
BACKUP_FORMAT = "wise-platform-workspace-backup"
BACKUP_FORMAT_VERSION = 1
ARTIFACTS = "score-run-artifacts"
SETTINGS = "settings"
# The folders a backup holds, the saved revisions and heads first: they are copied under the publication lock.
LOCKED = (f"{FOLDER}/{HEADS}", f"{FOLDER}/{REVISIONS}")
APPEND_ONLY = (SOURCES, PREPARATIONS, DEFINITIONS, SCORE_RUNS, ARTIFACTS)


def _listed(root: Path, folders: Iterable[str]) -> list[str]:
    """The files the application wrote in these folders, as paths relative to the root; temporary and hidden files are not."""
    names = []
    for folder in folders:
        directory = root / folder
        if not directory.is_dir():
            continue
        for child in sorted(directory.iterdir()):
            if child.name.startswith(".") or child.name.endswith(".partial") or not child.is_file():
                continue
            names.append(f"{folder}/{child.name}")
    return names


def _digest(path: Path) -> tuple[str, int]:
    hasher, size = hashlib.sha256(), 0
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1 << 20), b""):
            size += len(block)
            hasher.update(block)
    return hasher.hexdigest(), size


def _copy(source_root: Path, target_root: Path, relative: str) -> None:
    target = target_root / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source_root / relative, target)


def _destination(text: str, field: str, forbidden: Iterable[Path] = ()) -> Path | Problem:
    """A destination that does not exist yet, or is an empty folder, beside which a hidden folder can be written."""
    if "\x00" in text:
        return Problem("invalid_request", "The folder name holds a character no folder can have.", field)
    path = Path(text)
    if not path.is_absolute():
        return Problem("invalid_request", "Name the folder by its whole path, from the drive or the root.", field)
    parent = path.parent
    if not parent.is_dir():
        return Problem("destination_unavailable", "The folder that should hold it does not exist. Create it first, or choose another place.", field)
    if path.exists() and (not path.is_dir() or any(path.iterdir())):
        return Problem("destination_unavailable", "That folder already exists and is not empty. Choose a new or an empty folder.", field)
    resolved = parent.resolve() / path.name
    for other in forbidden:
        other = other.resolve()
        if resolved == other or resolved.is_relative_to(other) or other.is_relative_to(resolved):
            return Problem("destination_unavailable", "A backup cannot be kept inside the workspace it copies, nor the workspace inside it. Choose a folder outside it.", field)
    return path


def _hidden_beside(destination: Path, field: str) -> Path | Problem:
    partial = destination.parent / f".{destination.name}.{uuid.uuid4().hex}.partial"
    try:
        partial.mkdir()
    except OSError:
        return Problem("workspace_not_writable", "Nothing can be written in the folder that should hold it. Choose a folder you can write to.", field)
    return partial


def _take_name(partial: Path, destination: Path) -> None:
    """The finished folder takes the destination's name in one step; an empty destination folder gives way to it."""
    if destination.is_dir():
        destination.rmdir()
    os.replace(partial, destination)


def preview(workspace: Workspace, destination_text: str) -> dict[str, object] | Problem:
    """What a backup into the destination would hold, the destination checked as for a backup, and nothing written."""
    destination = _destination(destination_text, "destination", [workspace.path])
    if isinstance(destination, Problem):
        return destination
    files = sorted({MANIFEST, *_listed(workspace.path, APPEND_ONLY), *_listed(workspace.path, LOCKED)})
    listing = [{"path": relative, "bytes": (workspace.path / relative).stat().st_size} for relative in files]
    return {"workspace_id": workspace.workspace_id, "path": str(destination), "file_count": len(listing), "byte_count": sum(item["bytes"] for item in listing),
            "counts": _counts(listing), "omitted": [name for name in _listed(workspace.path, [SETTINGS])], "written": False}


def back_up(workspace: Workspace, destination_text: str) -> dict[str, object] | Problem:
    destination = _destination(destination_text, "destination", [workspace.path])
    if isinstance(destination, Problem):
        return destination
    partial = _hidden_beside(destination, "destination")
    if isinstance(partial, Problem):
        return partial
    try:
        try:
            with SavedInvestigations(workspace)._exclusive():
                locked = _listed(workspace.path, LOCKED)
                for relative in locked:
                    _copy(workspace.path, partial, relative)
        except _Busy:
            raise _Refused(Problem("workspace_busy", "A save in this workspace is still being written. Back up again in a moment.", None))
        files = [MANIFEST, *_listed(workspace.path, APPEND_ONLY)]
        for relative in files:
            _copy(workspace.path, partial, relative)
        files = [*files, *locked]
        # Every head names a revision of the copy.
        copied = SavedInvestigations(Workspace(workspace.workspace_id, partial))
        heads = copied.heads()
        if isinstance(heads, Problem):
            raise _Refused(heads)
        for head in heads:
            revision = copied.revision(head.latest_revision_id)
            if isinstance(revision, Problem):
                raise _Refused(Problem(revision.code, f"The latest revision of a saved investigation cannot be read, so no backup was made: {revision.message}", None))
        listing = []
        for relative in sorted(files):
            digest, size = _digest(partial / relative)
            listing.append({"path": relative, "sha256": digest, "bytes": size})
        manifest = {"format": BACKUP_FORMAT, "format_version": BACKUP_FORMAT_VERSION, "workspace_id": workspace.workspace_id,
                    "workspace_format_version": FORMAT_VERSION, "application_version": __version__, "analytics_version": IMPLEMENTATION_VERSION,
                    "created_utc": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"), "files": listing}
        write_atomically(partial / BACKUP_MANIFEST, json.dumps(manifest, indent=1, ensure_ascii=False).encode("utf-8"))
        _take_name(partial, destination)
    except _Refused as refused:
        shutil.rmtree(partial, ignore_errors=True)
        return refused.problem
    except OSError:
        shutil.rmtree(partial, ignore_errors=True)
        return Problem("workspace_not_writable", "The backup could not be written completely, so none was kept. Free some space or choose another folder, then back up again.", "destination")
    omitted = [name for name in _listed(workspace.path, [SETTINGS])]
    return {"workspace_id": workspace.workspace_id, "path": str(destination), "file_count": len(listing), "byte_count": sum(item["bytes"] for item in listing),
            "counts": _counts(listing), "omitted": omitted, "written": True}


def restore(backup_text: str, destination_text: str, forbidden: Iterable[Path] = ()) -> dict[str, object] | Problem:
    if "\x00" in backup_text or not Path(backup_text).is_absolute():
        return Problem("invalid_request", "Name the backup folder by its whole path, from the drive or the root.", "backup_path")
    backup = Path(backup_text)
    manifest_path = backup / BACKUP_MANIFEST
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return Problem("backup_unavailable", "That folder is not a finished backup: it holds no backup description. A backup that was interrupted is never finished; make it again.", "backup_path")
    except (OSError, ValueError, UnicodeError):
        return Problem("backup_damaged", "The backup description cannot be read. Restore another backup.", "backup_path")
    if not isinstance(manifest, dict) or manifest.get("format") != BACKUP_FORMAT:
        return Problem("backup_damaged", "The backup description is not one this application writes. Restore another backup.", "backup_path")
    if manifest.get("format_version") != BACKUP_FORMAT_VERSION or manifest.get("workspace_format_version") != FORMAT_VERSION:
        return Problem("workspace_incompatible",
                       f"This backup was written in backup format {manifest.get('format_version')!r} of workspace format {manifest.get('workspace_format_version')!r}; this "
                       f"application reads backup format {BACKUP_FORMAT_VERSION} of workspace format {FORMAT_VERSION}. Restore it with the application version that "
                       "wrote it; nothing was changed.", "backup_path")
    listing = manifest.get("files")
    if not isinstance(listing, list) or not all(isinstance(item, dict) and isinstance(item.get("path"), str) for item in listing):
        return Problem("backup_damaged", "The backup description lists no files it can be checked by. Restore another backup.", "backup_path")
    destination = _destination(destination_text, "destination", [backup, *forbidden])
    if isinstance(destination, Problem):
        return destination
    # Every listed file is there as written; nothing else was put among them.
    listed = {item["path"]: item for item in listing}
    present = set(_listed(backup, (*LOCKED, *APPEND_ONLY))) | ({MANIFEST} if (backup / MANIFEST).is_file() else set())
    for relative in sorted(set(listed) | present):
        item = listed.get(relative)
        if item is None:
            return Problem("backup_damaged", f"The backup holds {relative}, which its description does not list: it was changed after it was made. Restore another backup.", "backup_path")
        if relative not in present:
            return Problem("backup_damaged", f"The backup lacks {relative}, which its description lists. Restore another backup.", "backup_path")
        if ".." in Path(relative).parts:
            return Problem("backup_damaged", "The backup description names a file outside the backup.", "backup_path")
        try:
            digest, size = _digest(backup / relative)
        except OSError:
            return Problem("backup_damaged", f"{relative} of the backup cannot be read. Restore another backup.", "backup_path")
        if digest != item.get("sha256") or size != item.get("bytes"):
            return Problem("backup_damaged", f"{relative} of the backup is not the file that was backed up: its checksum differs. Restore another backup.", "backup_path")
    partial = _hidden_beside(destination, "destination")
    if isinstance(partial, Problem):
        return partial
    try:
        for relative in sorted(listed):
            _copy(backup, partial, relative)
        workspace = Workspace.open(str(partial))
        if isinstance(workspace, Problem):
            raise _Refused(Problem("backup_damaged", f"The restored folder is not a workspace this application reads: {workspace.message}", "backup_path"))
        if workspace.workspace_id != manifest.get("workspace_id"):
            raise _Refused(Problem("backup_damaged", "The workspace in the backup is not the one its description names.", "backup_path"))
        problem = _verified(workspace, sorted(listed))
        if problem is not None:
            raise _Refused(problem)
        _take_name(partial, destination)
    except _Refused as refused:
        shutil.rmtree(partial, ignore_errors=True)
        return refused.problem
    except OSError:
        shutil.rmtree(partial, ignore_errors=True)
        return Problem("workspace_not_writable", "The workspace could not be restored completely, so nothing was kept. Free some space or choose another folder.", "destination")
    warnings = []
    if manifest.get("analytics_version") != IMPLEMENTATION_VERSION:
        warnings.append(f"The backup was made with analytics version {manifest.get('analytics_version')}; its saved investigations reopen only with that version, "
                        "and say so when reopened.")
    return {"workspace_id": workspace.workspace_id, "path": str(destination), "file_count": len(listing), "counts": _counts(listing), "warnings": warnings}


def _verified(workspace: Workspace, files: list[str]) -> Problem | None:
    """The restored files as the application reads them: sources by their bytes, records by their checksums, revisions by their ids."""
    for relative in files:
        folder, _, name = relative.rpartition("/")
        stem = name.split(".")[0]
        kind = {SOURCES: "source", DEFINITIONS: "definition", SCORE_RUNS: "run"}.get(folder)
        if kind is not None and name.endswith(".json"):
            prefix = {"source": "source.v1:sha256:", "definition": "definition-version.v1:sha256:", "run": "score-run.v1:sha256:"}[kind]
            if kind != "source":
                stored = json.loads((workspace.path / relative).read_text(encoding="utf-8"))
                reference = stored.get("id") if isinstance(stored, dict) else None
            else:
                reference = prefix + stem
            if not isinstance(reference, str) or workspace.reference_integrity(kind, reference).state != "available":
                return Problem("backup_damaged", f"{relative} of the backup does not read back as the application wrote it. Restore another backup.", "backup_path")
    store = SavedInvestigations(workspace)
    for relative in files:
        if relative.startswith(f"{FOLDER}/{REVISIONS}/"):
            revision = store.revision("saved-revision.v1:sha256:" + Path(relative).stem)
            if isinstance(revision, Problem):
                return Problem("backup_damaged", f"{relative} of the backup is not a saved revision this application reads: {revision.message}", "backup_path")
    heads = store.heads()
    if isinstance(heads, Problem):
        return Problem("backup_damaged", f"The saved investigations of the backup cannot be listed: {heads.message}", "backup_path")
    return None


def _counts(listing: list[dict[str, object]]) -> dict[str, int]:
    def count(prefix: str, suffix: str = "") -> int:
        return sum(1 for item in listing if str(item["path"]).startswith(prefix + "/") and str(item["path"]).endswith(suffix))
    return {"sources": count(SOURCES, ".csv"), "preparations": count(PREPARATIONS), "definitions": count(DEFINITIONS), "score_runs": count(SCORE_RUNS),
            "artifacts": count(ARTIFACTS), "revisions": count(f"{FOLDER}/{REVISIONS}"), "investigations": count(f"{FOLDER}/{HEADS}")}


class _Refused(Exception):
    def __init__(self, problem: Problem) -> None:
        super().__init__(problem.message)
        self.problem = problem
