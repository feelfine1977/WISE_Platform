"""Saved investigations in a workspace: immutable revisions and the latest revision of each.

Layout inside the workspace folder::

    investigations/revisions/<sha256>.json   one saved revision, never changed once written
    investigations/heads/<name>.json         the latest revision of one investigation
    investigations/.publication.lock         held while a revision is published

A saved revision is one JSON file. It holds the format and its version, the
application and analytics versions that saved it, the revision it replaces,
when it was saved, the stored source (id, file name, size), the full recipe
of the preparation (dialect, mapping, policies), the saved content (name,
notes, identities, the selection steps with their parent, the comparison,
bookmarks) and the identities and counts of the results at the time of
saving. It holds no path of the machine and nothing of the workspace itself.

Its id is ``saved-revision.v1:sha256:`` and the SHA-256 of the canonical JSON
(keys sorted, no whitespace, UTF-8, no NaN) of the kind, the investigation id,
the revision it replaces and the content. Reading a revision checks the file
against its id, so a file changed by hand is refused rather than shown.

Publishing is a comparison with the latest revision followed by writing the
new revision and then the head, all under one lock that other processes on
the same workspace respect too. Each file is written beside its final name
and renamed onto it: an interruption can leave a revision that no head names,
never a head that names a missing or partial revision.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import threading
import time
import uuid
from collections.abc import Iterator, Mapping
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from pydantic import ValidationError

from .generated.saving import SavedInvestigationContent
from .workspace import Problem, Workspace, write_atomically

logger = logging.getLogger(__name__)

FORMAT = "wise-platform-saved-revision"
HEAD_FORMAT = "wise-platform-investigation-head"
FORMAT_VERSION = 1
FOLDER = "investigations"
REVISIONS = "revisions"
HEADS = "heads"
LOCK = ".publication.lock"
REVISION_KIND = "investigation_revision.v1"

_REVISION_ID = re.compile(r"saved-revision\.v1:sha256:([a-f0-9]{64})")
_INVESTIGATION_ID = re.compile(r"investigation\.v1:([A-Za-z0-9-]{8,64})")
_LOCK_WAIT_SECONDS = 10.0
_PUBLISHING = threading.Lock()


@dataclass(frozen=True)
class StoredRevision:
    """A saved revision read back from its file and found to match its id."""

    investigation_id: str
    saved_revision_id: str
    replaces_revision_id: str | None
    saved_utc: str
    application_version: str
    analytics_version: str
    source: Mapping[str, object]
    preparation: Mapping[str, object]
    content: dict
    results: Mapping[str, object]
    presentation_state: object

    def revision(self) -> dict[str, object]:
        """The revision as the contract's ``SavedRevision``."""
        return {
            "investigation_id": self.investigation_id,
            "saved_revision_id": self.saved_revision_id,
            "content": self.content,
        }


@dataclass(frozen=True)
class Head:
    investigation_id: str
    latest_revision_id: str


@dataclass(frozen=True)
class Published:
    revision: StoredRevision
    created_investigation: bool
    semantic_change: bool


@dataclass(frozen=True)
class Conflict:
    """The latest revision is not the one the writer expected; nothing was written."""

    investigation_id: str
    expected_revision_id: str
    current_revision_id: str


def revision_id(investigation_id: str, replaces_revision_id: str | None, content: Mapping[str, object]) -> str:
    """The id of a saved revision: the hash of what it means, never of where or when it was saved."""
    parts = {
        "kind": REVISION_KIND,
        "investigation_id": investigation_id,
        "replaces_revision_id": replaces_revision_id,
        "content": content,
    }
    text = json.dumps(parts, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
    return "saved-revision.v1:sha256:" + hashlib.sha256(text.encode("utf-8")).hexdigest()


class SavedInvestigations:
    """The saved investigations of one opened workspace."""

    def __init__(self, workspace: Workspace) -> None:
        self.workspace = workspace
        self.folder = workspace.path / FOLDER

    # Publishing ------------------------------------------------------------------------------

    def publish(
        self,
        investigation_id: str | None,
        expected_revision_id: str | None,
        content: dict,
        record: Mapping[str, object],
    ) -> Published | Conflict | Problem:
        """Save content as the next revision of an investigation, or as the first of a new one.

        ``record`` holds what the file keeps beside the content: ``source``, ``preparation``,
        ``results`` and ``presentation_state``. Content equal to the latest revision's is not
        saved again; the latest revision is answered with ``semantic_change`` false.
        """
        problem = self.workspace.check()
        if problem is not None:
            return problem
        try:
            with self._exclusive():
                return self._publish(investigation_id, expected_revision_id, content, record)
        except _Busy:
            return Problem(
                "publication_failed",
                "Another save in this workspace is still being written. Try again in a moment.",
                None,
            )
        except OSError as error:
            return _write_problem(error)

    def _publish(
        self,
        investigation_id: str | None,
        expected_revision_id: str | None,
        content: dict,
        record: Mapping[str, object],
    ) -> Published | Conflict | Problem:
        created = investigation_id is None
        replaces: str | None = None
        if investigation_id is None:
            investigation_id = "investigation.v1:" + uuid.uuid4().hex
        else:
            head = self.head(investigation_id)
            if isinstance(head, Problem):
                return head
            if head.latest_revision_id != expected_revision_id:
                assert expected_revision_id is not None
                return Conflict(investigation_id, expected_revision_id, head.latest_revision_id)
            latest = self.revision(head.latest_revision_id)
            if isinstance(latest, StoredRevision) and latest.content == content:
                return Published(latest, created_investigation=False, semantic_change=False)
            replaces = head.latest_revision_id
        saved_id = revision_id(investigation_id, replaces, content)
        artifact = {
            "format": FORMAT,
            "format_version": FORMAT_VERSION,
            "application_version": record["application_version"],
            "analytics_version": record["analytics_version"],
            "investigation_id": investigation_id,
            "saved_revision_id": saved_id,
            "replaces_revision_id": replaces,
            "saved_utc": _now(),
            "source": record["source"],
            "preparation": record["preparation"],
            "content": content,
            "results": record["results"],
            "presentation_state": record["presentation_state"],
        }
        target = self._revision_path(saved_id)
        target.parent.mkdir(parents=True, exist_ok=True)
        existing = self.revision(saved_id)
        if not isinstance(existing, StoredRevision):
            write_atomically(target, _json_bytes(artifact))
            existing = self.revision(saved_id)
            if not isinstance(existing, StoredRevision):
                logger.error("A saved revision did not read back as written: %s", existing.code)
                return Problem(
                    "publication_failed",
                    "The saved revision could not be read back after writing it. Check the drive, then save again.",
                    None,
                )
        head_path = self._head_path(investigation_id)
        head_path.parent.mkdir(parents=True, exist_ok=True)
        write_atomically(
            head_path,
            _json_bytes(
                {
                    "format": HEAD_FORMAT,
                    "format_version": FORMAT_VERSION,
                    "investigation_id": investigation_id,
                    "latest_revision_id": saved_id,
                    "updated_utc": _now(),
                }
            ),
        )
        return Published(existing, created_investigation=created, semantic_change=True)

    # Reading ---------------------------------------------------------------------------------

    def revision(self, saved_revision_id: str) -> StoredRevision | Problem:
        """A saved revision of this workspace, refused when it is missing, damaged or of another format."""
        problem = self.workspace.check()
        if problem is not None:
            return problem
        path = self._revision_path(saved_revision_id)
        where = f"{FOLDER}/{REVISIONS}/{path.name}"
        try:
            raw = path.read_bytes()
        except FileNotFoundError:
            return Problem(
                "revision_unavailable",
                "This saved revision is not in the workspace. Choose a saved investigation from the list again.",
                "saved_revision_id",
            )
        except OSError:
            return Problem(
                "revision_unavailable",
                f"The file {where} of this saved revision cannot be read. Check its permissions, then try again.",
                "saved_revision_id",
            )
        return _stored_revision(raw, saved_revision_id, where)

    def head(self, investigation_id: str) -> Head | Problem:
        path = self._head_path(investigation_id)
        where = f"{FOLDER}/{HEADS}/{path.name}"
        try:
            raw = path.read_bytes()
        except FileNotFoundError:
            return Problem(
                "investigation_unavailable",
                "This investigation is not saved in the workspace. Save it as a new investigation.",
                "investigation_id",
            )
        except OSError:
            return Problem(
                "investigation_unavailable",
                f"The file {where} of this investigation cannot be read. Check its permissions, then try again.",
                "investigation_id",
            )
        head = _head(raw)
        if head is None or head.investigation_id != investigation_id:
            return _damaged(where, "investigation_id")
        return head

    def heads(self) -> list[Head] | Problem:
        """The latest revision of every saved investigation; a damaged head is refused, not left out."""
        problem = self.workspace.check()
        if problem is not None:
            return problem
        folder = self.folder / HEADS
        try:
            names = sorted(path.name for path in folder.iterdir() if path.suffix == ".json" and not path.name.startswith("."))
        except FileNotFoundError:
            return []
        except OSError:
            return Problem(
                "workspace_unavailable",
                f"The folder {FOLDER}/{HEADS} of the workspace cannot be read. Check its permissions.",
                "workspace_id",
            )
        heads = []
        for name in names:
            where = f"{FOLDER}/{HEADS}/{name}"
            try:
                raw = (folder / name).read_bytes()
            except OSError:
                return _damaged(where, None)
            head = _head(raw)
            if head is None or self._head_path(head.investigation_id).name != name:
                return _damaged(where, None)
            heads.append(head)
        return heads

    # Files -----------------------------------------------------------------------------------

    def _revision_path(self, saved_revision_id: str) -> Path:
        match = _REVISION_ID.fullmatch(saved_revision_id)
        if match is None:
            raise ValueError("A saved revision id has the contract's form.")
        return self.folder / REVISIONS / f"{match.group(1)}.json"

    def _head_path(self, investigation_id: str) -> Path:
        match = _INVESTIGATION_ID.fullmatch(investigation_id)
        if match is None:
            raise ValueError("An investigation id has the contract's form.")
        return self.folder / HEADS / f"{match.group(1)}.json"

    @contextmanager
    def _exclusive(self) -> Iterator[None]:
        """Hold the publication lock of this workspace, against threads and other processes."""
        if not _PUBLISHING.acquire(timeout=_LOCK_WAIT_SECONDS):
            raise _Busy
        try:
            self.folder.mkdir(exist_ok=True)
            with (self.folder / LOCK).open("a+b") as handle:
                deadline = time.monotonic() + _LOCK_WAIT_SECONDS
                while True:
                    try:
                        _lock(handle)
                        break
                    except OSError:
                        if time.monotonic() >= deadline:
                            raise _Busy from None
                        time.sleep(0.05)
                try:
                    yield
                finally:
                    _unlock(handle)
        finally:
            _PUBLISHING.release()


class _Busy(Exception):
    """Another writer holds the publication lock for longer than a save waits."""


if os.name == "nt":
    import msvcrt

    def _lock(handle) -> None:
        handle.seek(0)
        msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)

    def _unlock(handle) -> None:
        handle.seek(0)
        msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)

else:
    import fcntl

    def _lock(handle) -> None:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)

    def _unlock(handle) -> None:
        fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def _stored_revision(raw: bytes, saved_revision_id: str, where: str) -> StoredRevision | Problem:
    try:
        stored = json.loads(raw.decode("utf-8"), parse_constant=_no_constant)
    except (UnicodeDecodeError, ValueError, RecursionError):
        return _damaged(where, "saved_revision_id")
    if not isinstance(stored, dict) or stored.get("format") != FORMAT:
        return _damaged(where, "saved_revision_id")
    if stored.get("format_version") != FORMAT_VERSION:
        return Problem(
            "incompatible_saved_revision",
            f"The saved revision {where} was written in format version {stored.get('format_version')!r}; "
            f"this application reads version {FORMAT_VERSION}. Open it with the application version that saved it.",
            "saved_revision_id",
        )
    texts = ("application_version", "analytics_version", "investigation_id", "saved_revision_id", "saved_utc")
    objects = ("source", "preparation", "content", "results")
    replaces = stored.get("replaces_revision_id")
    if (
        any(not isinstance(stored.get(name), str) for name in texts)
        or any(not isinstance(stored.get(name), dict) for name in objects)
        or _INVESTIGATION_ID.fullmatch(stored["investigation_id"]) is None
        or not (replaces is None or (isinstance(replaces, str) and _REVISION_ID.fullmatch(replaces) is not None))
        or "presentation_state" not in stored
    ):
        return _damaged(where, "saved_revision_id")
    try:
        SavedInvestigationContent.model_validate_json(json.dumps(stored["content"], ensure_ascii=False), strict=True)
    except (ValidationError, ValueError):
        return _damaged(where, "saved_revision_id")
    if (
        stored["saved_revision_id"] != saved_revision_id
        or revision_id(stored["investigation_id"], replaces, stored["content"]) != saved_revision_id
    ):
        return _damaged(where, "saved_revision_id")
    return StoredRevision(
        investigation_id=stored["investigation_id"],
        saved_revision_id=saved_revision_id,
        replaces_revision_id=replaces,
        saved_utc=stored["saved_utc"],
        application_version=stored["application_version"],
        analytics_version=stored["analytics_version"],
        source=stored["source"],
        preparation=stored["preparation"],
        content=stored["content"],
        results=stored["results"],
        presentation_state=stored["presentation_state"],
    )


def _head(raw: bytes) -> Head | None:
    try:
        stored = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError, RecursionError):
        return None
    if (
        not isinstance(stored, dict)
        or stored.get("format") != HEAD_FORMAT
        or stored.get("format_version") != FORMAT_VERSION
        or not isinstance(stored.get("investigation_id"), str)
        or _INVESTIGATION_ID.fullmatch(stored["investigation_id"]) is None
        or not isinstance(stored.get("latest_revision_id"), str)
        or _REVISION_ID.fullmatch(stored["latest_revision_id"]) is None
    ):
        return None
    return Head(stored["investigation_id"], stored["latest_revision_id"])


def _damaged(where: str, field: str | None) -> Problem:
    return Problem(
        "malformed_saved_revision",
        f"The file {where} in the workspace was changed or damaged outside the application, so it is not shown "
        "as a saved state. Restore it from a backup, or move it out of the workspace folder.",
        field,
    )


def _write_problem(error: OSError) -> Problem:
    logger.info("A saved revision could not be written: %s", error.__class__.__name__)
    if isinstance(error, PermissionError):
        return Problem(
            "workspace_not_writable",
            "The investigation cannot be saved: this application may not write in the workspace folder. "
            "Change its permissions, then save again.",
            "workspace_id",
        )
    return Problem(
        "publication_failed",
        "The investigation cannot be saved: writing in the workspace folder failed. Check that the drive is "
        "connected and has free space, then save again. The earlier revisions are unchanged.",
        "workspace_id",
    )


def _json_bytes(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8")


def _no_constant(name: str) -> object:
    raise ValueError(f"{name} is not JSON")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z")
