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

A source is stored under the SHA-256 of its bytes, so the same bytes are kept
once. Every file is written beside its final name and then renamed onto it,
so a reader sees either the previous file or the complete new one.

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

logger = logging.getLogger(__name__)

MANIFEST = "wise-platform-workspace.json"
FORMAT = "wise-platform-workspace"
FORMAT_VERSION = 1
SOURCES = "sources"
PREPARATIONS = "preparations"

_WORKSPACE_ID = re.compile(r"workspace\.v1:[A-Za-z0-9-]{8,64}")
_SOURCE_ID = re.compile(r"source\.v1:sha256:([a-f0-9]{64})")
_PREPARATION_ID = re.compile(r"preparation\.v1:sha256:([a-f0-9]{64})")
# Files an operating system places in an otherwise empty folder.
_SYSTEM_FILES = frozenset({"desktop.ini", "thumbs.db", ".ds_store"})


@dataclass(frozen=True)
class Problem:
    """Why a workspace operation was refused, in the contract's terms."""

    code: str
    message: str
    field: str | None = None


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
    checkout = package.parents[2]
    if (checkout / "pyproject.toml").is_file() and (checkout / "apps" / "api").is_dir():
        folders.append(checkout)
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
                "for example C:\\Users\\name\\Documents\\Investigations.",
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

    def store_source(self, raw: bytes, filename: str) -> StoredSource | Problem:
        """Keep the bytes unchanged under their SHA-256; the same bytes are stored once."""
        problem = self.check()
        if problem is not None:
            return problem
        digest = hashlib.sha256(raw).hexdigest()
        source_id = "source.v1:sha256:" + digest
        data_path = self.path / SOURCES / f"{digest}.csv"
        meta_path = self.path / SOURCES / f"{digest}.json"
        with self._lock:
            try:
                (self.path / SOURCES).mkdir(exist_ok=True)
                if not _holds(data_path, digest, len(raw)):
                    write_atomically(data_path, raw)
                existing = self._source_record(meta_path, digest)
                if existing is not None:
                    return existing
                record = StoredSource(source_id, filename, len(raw), _now())
                write_atomically(
                    meta_path,
                    _json_bytes({**record.to_dict(), "stored_utc": record.stored_utc}),
                )
                return record
            except OSError as error:
                return _write_problem(error, "The source cannot be stored in the workspace", "workspace_id")

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
