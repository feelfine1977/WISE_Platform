"""A workspace: a folder chosen by the analyst that keeps sources and preparations.

A workspace is an ordinary folder outside the program. Opening an empty
folder makes it a workspace by writing a small manifest with a new workspace
id; opening a folder that already holds that manifest finds everything stored
there before, so another run of the application finds it again. A folder that
does not exist, cannot be written, lies inside the program, or already holds
other files is refused with the reason, and nothing is written into it.

Layout inside the folder::

    wise-platform-workspace.json        format, version and workspace id
    sources/<sha256>.csv                the bytes of a source, unchanged
    sources/<sha256>.json               its file name, size and when it was stored
    preparations/<sha256>.json          a confirmed interpretation, its identities and report
    definitions/<sha256>.json           a version of an expectation's definition, as validated
    score-runs/<sha256>.json            a score run with every value it answered
    investigations/                     saved investigations, see ``saved_store``

A source is stored under the SHA-256 of its bytes, so the same bytes are kept
once. Every file is written beside its final name and then renamed onto it,
so a reader sees either the previous file or the complete new one. A
definition version and a score run are immutable: once one is stored under
its id, it is kept as it is.

This module knows nothing of what a CSV means; it keeps bytes and records.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import tempfile
import uuid
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Literal

from wise_platform_analytics.csv_inspection import SourceFile

logger = logging.getLogger(__name__)

MANIFEST = "wise-platform-workspace.json"
FORMAT = "wise-platform-workspace"
FORMAT_VERSION = 1
SOURCES = "sources"
PREPARATIONS = "preparations"
DEFINITIONS = "definitions"
SCORE_RUNS = "score-runs"

_WORKSPACE_ID = re.compile(r"workspace\.v1:[A-Za-z0-9-]{8,64}")
_SOURCE_ID = re.compile(r"source\.v1:sha256:([a-f0-9]{64})")
_PREPARATION_ID = re.compile(r"preparation\.v1:sha256:([a-f0-9]{64})")
_DEFINITION_ID = re.compile(r"definition-version\.v1:sha256:([a-f0-9]{64})")
_RUN_ID = re.compile(r"score-run\.v1:sha256:([a-f0-9]{64})")
# Files an operating system places in an otherwise empty folder.
_SYSTEM_FILES = frozenset({"desktop.ini", "thumbs.db", ".ds_store"})


@dataclass(frozen=True)
class Problem:
    """Why a workspace operation was refused, in the contract's terms."""

    code: str
    message: str
    field: str | None = None


@dataclass(frozen=True)
class ReferenceIntegrity:
    """Read-only reference state; existing import/Resolution refusals stay unchanged."""

    state: Literal["available", "unavailable", "checksum_invalid", "invalid_reference"]
    reference_id: str
    path: str
    record: Mapping[str, object] | None = None


@dataclass(frozen=True)
class StoredSource:
    source_id: str
    filename: str
    byte_count: int
    stored_utc: str

    def to_dict(self) -> dict[str, object]:
        return {"source_id": self.source_id, "filename": self.filename, "byte_count": self.byte_count}


@dataclass(frozen=True)
class StoredPreparation:
    """A ready preparation: what was confirmed, the identities it was given and its report."""

    preparation_id: str
    source_id: str
    descriptor: Mapping[str, object]
    identity: Mapping[str, object]
    report: Mapping[str, object]
    stored_utc: str

    def to_dict(self) -> dict[str, object]:
        return {"preparation_id": self.preparation_id, "source_id": self.source_id}


def program_folders() -> tuple[Path, ...]:
    """The folders of the installed program, where no workspace may be placed."""
    import wise_platform_analytics

    package = Path(__file__).resolve().parent
    folders = [package, Path(wise_platform_analytics.__file__).resolve().parent]
    for ancestor in package.parents:
        # In a source checkout the package lies under apps/api/src of the project folder.
        if (ancestor / "pyproject.toml").is_file() and (ancestor / "apps" / "api").is_dir():
            folders.append(ancestor)
            break
    return tuple(folders)


class Workspace:
    """An opened workspace folder. Every method re-checks that the folder is still this workspace."""

    def __init__(self, workspace_id: str, path: Path) -> None:
        self.workspace_id = workspace_id
        self.path = path
        self._lock = Lock()

    # Opening -----------------------------------------------------------------------------

    @classmethod
    def open(cls, path_text: str, forbidden: Iterable[Path] = ()) -> Workspace | Problem:
        """Open the workspace in a folder, making an empty folder a new workspace."""
        if "\x00" in path_text:
            return Problem("invalid_request", "The folder path contains a character no path can hold.", "path")
        given = Path(path_text.strip())
        if not given.is_absolute():
            return Problem(
                "workspace_unavailable",
                "Give the full path of the folder, beginning with its drive or root, "
                "for example D:\\Investigations\\Incidents.",
                "path",
            )
        try:
            folder = given.resolve(strict=True)
        except (OSError, RuntimeError):
            return Problem(
                "workspace_unavailable",
                "This folder does not exist or cannot be reached. Create it first, or check the path.",
                "path",
            )
        if not folder.is_dir():
            return Problem("workspace_unavailable", "This path is a file, not a folder. Choose a folder.", "path")
        for program in forbidden:
            if folder == program or program in folder.parents:
                return Problem(
                    "workspace_incompatible",
                    "This folder belongs to the program itself. Choose a folder outside the program, "
                    "for example in your documents.",
                    "path",
                )
        manifest = folder / MANIFEST
        if manifest.exists():
            workspace_id = _read_manifest(manifest)
            if isinstance(workspace_id, Problem):
                return workspace_id
            workspace = cls(workspace_id, folder)
            problem = workspace._probe_writable()
            return problem if problem is not None else workspace
        try:
            others = [entry.name for entry in folder.iterdir() if entry.name.lower() not in _SYSTEM_FILES]
        except OSError:
            return Problem(
                "workspace_unavailable", "The contents of this folder cannot be read. Check its permissions.", "path"
            )
        if others:
            return Problem(
                "workspace_incompatible",
                "This folder already holds other files and is not a workspace. "
                "Choose an empty folder for a new workspace, or a folder that is already one.",
                "path",
            )
        return cls._create(folder)

    @classmethod
    def _create(cls, folder: Path) -> Workspace | Problem:
        workspace_id = "workspace.v1:" + uuid.uuid4().hex
        manifest = {
            "format": FORMAT,
            "format_version": FORMAT_VERSION,
            "workspace_id": workspace_id,
            "created_utc": _now(),
        }
        try:
            (folder / SOURCES).mkdir(exist_ok=True)
            (folder / PREPARATIONS).mkdir(exist_ok=True)
            write_atomically(folder / MANIFEST, _json_bytes(manifest))
        except OSError as error:
            return _write_problem(error, "The folder cannot be made a workspace")
        # Another process may have made the same folder a workspace at the same moment;
        # the manifest that is on disk now is the one every process uses.
        stored = _read_manifest(folder / MANIFEST)
        if isinstance(stored, Problem):
            return stored
        return cls(stored, folder)

    def _probe_writable(self) -> Problem | None:
        try:
            write_atomically(self.path / f".write-check-{uuid.uuid4().hex}", b"", keep=False)
        except OSError as error:
            return _write_problem(error, "The workspace cannot be written")
        return None

    def check(self) -> Problem | None:
        """Say why this workspace can no longer be used, or ``None`` when it still can."""
        stored = _read_manifest(self.path / MANIFEST)
        if isinstance(stored, Problem) or stored != self.workspace_id:
            return Problem(
                "workspace_unavailable",
                "The workspace folder is no longer the one that was opened. Open the workspace again.",
                "workspace_id",
            )
        return None

    # Sources -----------------------------------------------------------------------------

    def store_source(self, raw: bytes | Iterable[bytes], filename: str) -> StoredSource | Problem:
        """Keep the bytes unchanged under their SHA-256; the same bytes are stored once.

        The bytes may arrive in chunks. They are written beside the store while they are hashed and then moved
        into place, so no whole source is held in memory.
        """
        problem = self.check()
        if problem is not None:
            return problem
        sources = self.path / SOURCES
        try:
            sources.mkdir(exist_ok=True)
            handle, temporary = tempfile.mkstemp(prefix=".upload.", suffix=".partial", dir=sources)
        except OSError as error:
            return _write_problem(error, "The source cannot be stored in the workspace", "workspace_id")
        try:
            hasher, size = hashlib.sha256(), 0
            with os.fdopen(handle, "wb") as stream:
                for chunk in (raw,) if isinstance(raw, bytes) else raw:
                    stream.write(chunk)
                    hasher.update(chunk)
                    size += len(chunk)
                stream.flush()
                os.fsync(stream.fileno())
            digest = hasher.hexdigest()
            data_path = sources / f"{digest}.csv"
            meta_path = sources / f"{digest}.json"
            with self._lock:
                if not _holds(data_path, digest, size):
                    os.replace(temporary, data_path)
                existing = self._source_record(meta_path, digest)
                if existing is not None:
                    return existing
                record = StoredSource("source.v1:sha256:" + digest, filename, size, _now())
                write_atomically(
                    meta_path,
                    _json_bytes({**record.to_dict(), "stored_utc": record.stored_utc}),
                )
                return record
        except OSError as error:
            return _write_problem(error, "The source cannot be stored in the workspace", "workspace_id")
        finally:
            try:
                os.unlink(temporary)
            except OSError:
                pass

    def source(self, source_id: str) -> StoredSource | Problem:
        match = _SOURCE_ID.fullmatch(source_id)
        record = None if match is None else self._source_record(
            self.path / SOURCES / f"{match.group(1)}.json", match.group(1)
        )
        if record is None:
            return Problem(
                "source_unavailable", "This source is not stored in the workspace. Add the file again.", "source_id"
            )
        return record

    def read_source(self, source_id: str) -> bytes | Problem:
        """The stored bytes of a source, refused if they are missing or no longer the stored ones."""
        problem = self.check()
        if problem is not None:
            return problem
        record = self.source(source_id)
        if isinstance(record, Problem):
            return record
        digest = source_id.rsplit(":", 1)[1]
        try:
            raw = (self.path / SOURCES / f"{digest}.csv").read_bytes()
        except OSError:
            return Problem(
                "source_unavailable",
                "The stored bytes of this source cannot be read. Add the file again.",
                "source_id",
            )
        if hashlib.sha256(raw).hexdigest() != digest:
            return Problem(
                "source_unavailable",
                "The stored bytes of this source were changed outside the application. Add the file again.",
                "source_id",
            )
        return raw

    def source_file(self, source_id: str) -> SourceFile | Problem:
        """A stored source to read as it is parsed. Its bytes are verified as they are read, and a reader that finds
        them changed raises ``SourceChanged``, which ``source_changed`` answers."""
        problem = self.check()
        if problem is not None:
            return problem
        record = self.source(source_id)
        if isinstance(record, Problem):
            return record
        path = self.path / SOURCES / f"{source_id.rsplit(':', 1)[1]}.csv"
        if not path.is_file():
            return Problem(
                "source_unavailable",
                "The stored bytes of this source cannot be read. Add the file again.",
                "source_id",
            )
        return SourceFile(path, source_id)

    def source_unchanged(self, source_id: str) -> Problem | None:
        """Nothing while the stored bytes of a source are the stored ones, else the refusal for them.

        An answer kept in memory is given only after this check, so that a file changed outside the
        application is refused in a running application exactly as in a freshly started one.
        """
        record = self.source(source_id)
        if isinstance(record, Problem):
            return record
        digest = source_id.rsplit(":", 1)[1]
        if not _holds(self.path / SOURCES / f"{digest}.csv", digest, record.byte_count):
            return Problem(
                "source_unavailable",
                "The stored bytes of this source were changed outside the application. Add the file again.",
                "source_id",
            )
        return None

    def source_bytes_state(self, source_id: str) -> str:
        """``stored`` while the bytes of a source are kept unchanged, ``changed`` when the file holds other
        bytes, ``missing`` when the file or its record is gone."""
        match = _SOURCE_ID.fullmatch(source_id)
        if match is None:
            return "missing"
        digest = match.group(1)
        data_path = self.path / SOURCES / f"{digest}.csv"
        if not isinstance(_read_json(self.path / SOURCES / f"{digest}.json"), dict) or not data_path.is_file():
            return "missing"
        try:
            size = data_path.stat().st_size
        except OSError:
            return "missing"
        return "stored" if _holds(data_path, digest, size) else "changed"

    def reference_integrity(self, kind: Literal["source", "definition", "run"], reference_id: str) -> ReferenceIntegrity:
        """Inspect only a declared source or immutable native reference, without repair.

        Callers decide their public refusal vocabulary. Resolution continues to
        use source/run/definition and their established failure codes.
        """
        folder, pattern = {"source": (SOURCES, _SOURCE_ID), "definition": (DEFINITIONS, _DEFINITION_ID),
                           "run": (SCORE_RUNS, _RUN_ID)}[kind]
        match = pattern.fullmatch(reference_id) if isinstance(reference_id, str) else None
        if match is None:
            return ReferenceIntegrity("invalid_reference", reference_id, folder)
        digest = match.group(1)
        path = self.path / folder / (digest + ".json")
        try:
            encoded = path.read_bytes()
        except OSError:
            return ReferenceIntegrity("unavailable", reference_id, str(path))
        try:
            stored = json.loads(encoded)
        except (ValueError, UnicodeError, RecursionError):
            # A source descriptor has no recorded checksum of its own. Its id
            # authenticates CSV bytes, unlike immutable native record wrappers.
            return ReferenceIntegrity("unavailable" if kind == "source" else "checksum_invalid", reference_id, str(path))
        if kind == "source":
            if (not isinstance(stored, dict) or stored.get("source_id") != reference_id
                    or not isinstance(stored.get("filename"), str) or not stored["filename"]
                    or type(stored.get("byte_count")) is not int or stored["byte_count"] < 0
                    or not isinstance(stored.get("stored_utc"), str)):
                return ReferenceIntegrity("unavailable", reference_id, str(path))
            record = StoredSource(reference_id, stored["filename"], stored["byte_count"], stored["stored_utc"])
            path = self.path / folder / (digest + ".csv")
            try:
                hasher, size = hashlib.sha256(), 0
                with path.open("rb") as stream:
                    for block in iter(lambda: stream.read(1 << 20), b""):
                        size += len(block)
                        hasher.update(block)
            except OSError:
                return ReferenceIntegrity("unavailable", reference_id, str(path))
            if hasher.hexdigest() != digest or size != record.byte_count:
                return ReferenceIntegrity("checksum_invalid", reference_id, str(path))
            return ReferenceIntegrity("available", reference_id, str(path), record.to_dict())
        record = stored.get("record") if isinstance(stored, dict) else None
        checksum = _checksum_or_none(record) if isinstance(record, dict) else None
        if not isinstance(stored, dict) or stored.get("id") != reference_id or checksum is None or stored.get("sha256") != checksum:
            return ReferenceIntegrity("checksum_invalid", reference_id, str(path))
        return ReferenceIntegrity("available", reference_id, str(path), record)

    def sources(self) -> list[StoredSource]:
        """Every complete stored source, oldest first."""
        found = []
        for meta_path in _listed(self.path / SOURCES, ".json"):
            record = self._source_record(meta_path, meta_path.stem)
            if record is not None:
                found.append(record)
        return sorted(found, key=lambda record: (record.stored_utc, record.source_id))

    def _source_record(self, meta_path: Path, digest: str) -> StoredSource | None:
        stored = _read_json(meta_path)
        if not isinstance(stored, dict):
            return None
        source_id = stored.get("source_id")
        filename = stored.get("filename")
        byte_count = stored.get("byte_count")
        stored_utc = stored.get("stored_utc")
        if (
            source_id != "source.v1:sha256:" + digest
            or not isinstance(filename, str)
            or not filename
            or type(byte_count) is not int
            or not isinstance(stored_utc, str)
        ):
            return None
        data_path = self.path / SOURCES / f"{digest}.csv"
        try:
            if data_path.stat().st_size != byte_count:
                return None
        except OSError:
            return None
        return StoredSource(source_id, filename, byte_count, stored_utc)

    # Preparations ------------------------------------------------------------------------

    def store_preparation(
        self,
        descriptor: Mapping[str, object],
        identity: Mapping[str, object],
        report: Mapping[str, object],
    ) -> StoredPreparation | Problem:
        """Keep a ready preparation; one that is already stored is kept as it is."""
        problem = self.check()
        if problem is not None:
            return problem
        preparation_id = str(descriptor["preparation_id"])
        match = _PREPARATION_ID.fullmatch(preparation_id)
        if match is None:
            raise ValueError("A preparation id has the contract's form.")
        target = self.path / PREPARATIONS / f"{match.group(1)}.json"
        with self._lock:
            existing = self._preparation_record(target)
            if existing is not None and existing.preparation_id == preparation_id:
                return existing
            record = StoredPreparation(
                preparation_id, str(descriptor["source_id"]), descriptor, identity, report, _now()
            )
            try:
                (self.path / PREPARATIONS).mkdir(exist_ok=True)
                write_atomically(
                    target,
                    _json_bytes(
                        {
                            "preparation": dict(descriptor),
                            "identity": dict(identity),
                            "report": dict(report),
                            "stored_utc": record.stored_utc,
                        }
                    ),
                )
            except OSError as error:
                return _write_problem(error, "The preparation cannot be kept in the workspace", "workspace_id")
            return record

    def preparation(self, preparation_id: str) -> StoredPreparation | Problem:
        problem = self.check()
        if problem is not None:
            return problem
        match = _PREPARATION_ID.fullmatch(preparation_id)
        record = None if match is None else self._preparation_record(
            self.path / PREPARATIONS / f"{match.group(1)}.json"
        )
        if record is None or record.preparation_id != preparation_id:
            return Problem(
                "preparation_unavailable",
                "This preparation is not kept in the workspace. Confirm the interpretation of the source again.",
                "preparation_id",
            )
        return record

    def preparations(self) -> list[StoredPreparation]:
        """Every readable stored preparation whose source is still stored, oldest first."""
        found = []
        for path in _listed(self.path / PREPARATIONS, ".json"):
            record = self._preparation_record(path)
            if record is not None and not isinstance(self.source(record.source_id), Problem):
                found.append(record)
        return sorted(found, key=lambda record: (record.stored_utc, record.preparation_id))

    def _preparation_record(self, path: Path) -> StoredPreparation | None:
        stored = _read_json(path)
        if not isinstance(stored, dict):
            return None
        descriptor, identity, report = stored.get("preparation"), stored.get("identity"), stored.get("report")
        stored_utc = stored.get("stored_utc")
        if not (isinstance(descriptor, dict) and isinstance(identity, dict) and isinstance(report, dict)):
            return None
        preparation_id, source_id = descriptor.get("preparation_id"), descriptor.get("source_id")
        if (
            not isinstance(preparation_id, str)
            or _PREPARATION_ID.fullmatch(preparation_id) is None
            or path.stem != preparation_id.rsplit(":", 1)[1]
            or not isinstance(source_id, str)
            or _SOURCE_ID.fullmatch(source_id) is None
            or not isinstance(stored_utc, str)
        ):
            return None
        return StoredPreparation(preparation_id, source_id, descriptor, identity, report, stored_utc)

    # Definitions and score runs ---------------------------------------------------------

    def store_definition(self, version: Mapping[str, object]) -> Mapping[str, object] | Problem:
        """Keep a definition version under its id; the one already stored under that id is kept and returned."""
        return self._keep_immutable(
            DEFINITIONS, _DEFINITION_ID, str(version["definition_version_id"]), version, "definition_unavailable", "definition version"
        )

    def definition(self, definition_version_id: str) -> Mapping[str, object] | Problem | None:
        """The definition version stored under this id, nothing if there is none, or why its file cannot be used."""
        return self._immutable(DEFINITIONS, _DEFINITION_ID, definition_version_id, "definition_unavailable", "definition version")

    def store_run(self, run: Mapping[str, object]) -> Mapping[str, object] | Problem:
        """Keep a score run under its id; the run already stored under that id is kept and returned."""
        identity = run["identity"]
        assert isinstance(identity, Mapping)
        return self._keep_immutable(SCORE_RUNS, _RUN_ID, str(identity["run_id"]), run, "run_unavailable", "score run")

    def run(self, run_id: str) -> Mapping[str, object] | Problem | None:
        """The score run stored under this id, nothing if there is none, or why its file cannot be used."""
        return self._immutable(SCORE_RUNS, _RUN_ID, run_id, "run_unavailable", "score run")

    def _keep_immutable(
        self, folder: str, pattern: re.Pattern[str], record_id: str, record: Mapping[str, object], code: str, what: str
    ) -> Mapping[str, object] | Problem:
        problem = self.check()
        if problem is not None:
            return problem
        match = pattern.fullmatch(record_id)
        if match is None:
            raise ValueError("A stored record's id has the contract's form.")
        with self._lock:
            # A file that is there and cannot be used is never written over: that would hide the damage.
            existing = self._immutable(folder, pattern, record_id, code, what)
            if existing is not None:
                return existing
            try:
                (self.path / folder).mkdir(exist_ok=True)
                kept = dict(record)
                write_atomically(
                    self.path / folder / f"{match.group(1)}.json",
                    _json_bytes({"id": record_id, "sha256": _record_checksum(kept), "record": kept}),
                )
            except OSError as error:
                return _write_problem(error, "The answer cannot be kept in the workspace", "workspace_id")
        return record

    def _immutable(
        self, folder: str, pattern: re.Pattern[str], record_id: str, code: str, what: str
    ) -> Mapping[str, object] | Problem | None:
        """A kept record that is never changed after it was written.

        The file holds the record with the checksum of its content. A file that is not there is
        nothing; a file that is there and is not exactly what was written (not readable, another id,
        or content that no longer has its checksum) is a problem, so that a value changed outside
        the application is refused and never answered or silently computed again.
        """
        match = pattern.fullmatch(record_id) if isinstance(record_id, str) else None
        if match is None:
            return None
        path = self.path / folder / f"{match.group(1)}.json"
        if not path.exists():
            return None
        stored = _read_json(path)
        record = stored.get("record") if isinstance(stored, dict) else None
        checksum = _checksum_or_none(record) if isinstance(record, dict) else None
        if (
            not isinstance(stored, dict)
            or stored.get("id") != record_id
            or not isinstance(record, dict)
            # Content without a checksum is never accepted, also when the file names none.
            or checksum is None
            or stored.get("sha256") != checksum
        ):
            return Problem(
                code,
                f"The kept {what} in {folder}/{path.name} of the workspace is not what the application wrote: "
                "it was changed or damaged outside the application. Nothing was computed again. Restore the "
                "file from a copy, or move it out of the workspace and repeat the step that made it.",
                None,
            )
        return record


def source_changed() -> Problem:
    """The refusal for a stored source whose bytes no longer match its identity, or cannot be read."""
    return Problem(
        "source_unavailable",
        "The stored bytes of this source were changed outside the application. Add the file again.",
        "source_id",
    )


def write_atomically(target: Path, data: bytes, *, keep: bool = True) -> None:
    """Write beside the target, then rename onto it; a failure leaves the target as it was.

    With ``keep=False`` the written file is removed again: a check that the folder can be written.
    """
    handle, temporary = tempfile.mkstemp(prefix=f".{target.name}.", suffix=".partial", dir=target.parent)
    try:
        with os.fdopen(handle, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        if keep:
            os.replace(temporary, target)
    finally:
        if not keep or os.path.exists(temporary):
            try:
                os.unlink(temporary)
            except OSError:
                pass


def is_workspace_id(value: object) -> bool:
    return isinstance(value, str) and _WORKSPACE_ID.fullmatch(value) is not None


def _read_manifest(manifest: Path) -> str | Problem:
    stored = _read_json(manifest)
    if (
        not isinstance(stored, dict)
        or stored.get("format") != FORMAT
        or not is_workspace_id(stored.get("workspace_id"))
    ):
        return Problem(
            "workspace_incompatible",
            "This folder holds a workspace description this application cannot read. "
            "Choose another folder, or an empty one for a new workspace.",
            "path",
        )
    if stored.get("format_version") != FORMAT_VERSION:
        return Problem(
            "workspace_incompatible",
            f"This workspace was written in format version {stored.get('format_version')!r}; this application "
            f"reads version {FORMAT_VERSION}. Use the application version that wrote it, or an empty folder.",
            "path",
        )
    return str(stored["workspace_id"])


def _holds(path: Path, digest: str, size: int) -> bool:
    """Whether a file already holds exactly the bytes of this digest."""
    try:
        if path.stat().st_size != size:
            return False
        hasher = hashlib.sha256()
        with path.open("rb") as stream:
            for block in iter(lambda: stream.read(1 << 20), b""):
                hasher.update(block)
        return hasher.hexdigest() == digest
    except OSError:
        return False


def _listed(folder: Path, suffix: str) -> list[Path]:
    try:
        return [path for path in folder.iterdir() if path.suffix == suffix and not path.name.startswith(".")]
    except OSError:
        return []


def _read_json(path: Path) -> object:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, ValueError, RecursionError):
        return None


def _record_checksum(record: Mapping[str, object]) -> str:
    """SHA-256 of a record's content, whatever the order of its names and the spacing of its file."""
    canonical = json.dumps(record, ensure_ascii=False, allow_nan=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _checksum_or_none(record: Mapping[str, object]) -> str | None:
    """The checksum of a record read from a file, or nothing when its content cannot have one.

    A file changed by hand can hold what no kept record holds: a number that is not a number, text
    that is half a character, or nesting too deep to walk. Such content has no checksum, so the file
    is treated as damaged like any other file that is not what was written.
    """
    try:
        return _record_checksum(record)
    except (ValueError, TypeError, RecursionError):
        return None


def _json_bytes(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z")


def _write_problem(error: OSError, what: str, field: str | None = "path") -> Problem:
    logger.info("%s: %s", what, error.__class__.__name__)
    if isinstance(error, PermissionError):
        return Problem(
            "workspace_not_writable",
            f"{what}: this application may not write in the folder. "
            "Choose a folder you can write to, or change its permissions.",
            field,
        )
    return Problem(
        "workspace_not_writable",
        f"{what}: writing in the folder failed. Check that the drive is connected and has free space, "
        "then try again.",
        field,
    )
