"""The email, note or object card behind a record, read from the workspace's local document folder.

The work side writes one ``<reference>.json`` file per document through its masking step; the platform only
reads it. Nothing of a document - text, field, attachment name or path - is stored in the workspace, a saved
investigation, an export, a log line or an error message: refusals and unavailable states name the rule, never
the content. The only thing kept is the document folder itself, with the workspace on this computer.
"""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
import zipfile

from .boundary import read_object
from .generated import record_documents as generated
from .imports import Imports
from .population_views import resolve_population
from .strict_reading import alternatives_of, read_strictly
from .workspace import Problem, Workspace, write_atomically

SCHEMA_VERSION = 1
FORMAT = "wise.record_document.v1"
FOLDER_FORMAT = "wise.document_folder.v1"
SETTING = Path("settings") / "document-folder.json"
MAX_DOCUMENT_BYTES = 1_048_576
"""The stated size limit of one document file (the contract's MaxDocumentBytes)."""
_REFERENCE = re.compile(r"[A-Za-z0-9_.-]{1,200}")
_RESERVED = {"CON", "PRN", "AUX", "NUL", *(f"COM{n}" for n in range(1, 10)), *(f"LPT{n}" for n in range(1, 10))}
_ALTERNATIVES = alternatives_of(generated)


def _signature_pdf(head: bytes, _: Path) -> bool: return head.startswith(b"%PDF-")
def _signature_png(head: bytes, _: Path) -> bool: return head.startswith(b"\x89PNG\r\n\x1a\n")
def _signature_jpeg(head: bytes, _: Path) -> bool: return head.startswith(b"\xff\xd8\xff")
def _signature_gif(head: bytes, _: Path) -> bool: return head.startswith((b"GIF87a", b"GIF89a"))
def _signature_ole(head: bytes, _: Path) -> bool: return head.startswith(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1")


def _signature_text(head: bytes, _: Path) -> bool:
    if b"\x00" in head:
        return False
    try:
        head.decode("utf-8")
    except UnicodeDecodeError as error:
        return error.start >= len(head) - 3  # a character cut at the end of the sample
    return True


def _office(part: str):
    def check(head: bytes, path: Path) -> bool:
        if not head.startswith(b"PK\x03\x04"):
            return False
        try:
            with zipfile.ZipFile(path) as archive:
                names = set(archive.namelist())
        except (OSError, zipfile.BadZipFile):
            return False
        return "[Content_Types].xml" in names and part in names
    return check


def _open_document(media_type: str):
    def check(head: bytes, path: Path) -> bool:
        if not head.startswith(b"PK\x03\x04"):
            return False
        try:
            with zipfile.ZipFile(path) as archive:
                return archive.read("mimetype").decode("ascii").strip() == media_type
        except (OSError, KeyError, UnicodeDecodeError, zipfile.BadZipFile):
            return False
    return check


# The stated list of attachment types (the contract's OpenableAttachmentType): extension, media type and the
# content signature that must agree with both. Programs, scripts, shortcuts and archives are never on it.
OPENABLE = {
    "pdf": ("application/pdf", _signature_pdf),
    "png": ("image/png", _signature_png),
    "jpg": ("image/jpeg", _signature_jpeg),
    "jpeg": ("image/jpeg", _signature_jpeg),
    "gif": ("image/gif", _signature_gif),
    "txt": ("text/plain", _signature_text),
    "docx": ("application/vnd.openxmlformats-officedocument.wordprocessingml.document", _office("word/document.xml")),
    "xlsx": ("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", _office("xl/workbook.xml")),
    "pptx": ("application/vnd.openxmlformats-officedocument.presentationml.presentation", _office("ppt/presentation.xml")),
    "doc": ("application/msword", _signature_ole),
    "xls": ("application/vnd.ms-excel", _signature_ole),
    "ppt": ("application/vnd.ms-powerpoint", _signature_ole),
    "odt": ("application/vnd.oasis.opendocument.text", _open_document("application/vnd.oasis.opendocument.text")),
    "ods": ("application/vnd.oasis.opendocument.spreadsheet", _open_document("application/vnd.oasis.opendocument.spreadsheet")),
    "odp": ("application/vnd.oasis.opendocument.presentation", _open_document("application/vnd.oasis.opendocument.presentation")),
}
STATUS = {"invalid_request": 400, "unsupported_schema": 400, "forbidden_origin": 403, "workspace_unavailable": 404,
          "workspace_not_writable": 403, "population_unavailable": 404, "identity_mismatch": 409, "unknown_case": 404,
          "unknown_record": 404, "invalid_folder": 400}


@dataclass(frozen=True)
class DocumentReply:
    status: int
    body: dict


def _refused(given: dict, code: str, message: str, field: str | None = None) -> DocumentReply:
    request_id = given.get("request_id") if isinstance(given.get("request_id"), str) else None
    revision = given.get("query_revision") if type(given.get("query_revision")) is int and given["query_revision"] >= 1 else None
    workspace_id = given.get("workspace_id") if isinstance(given.get("workspace_id"), str) else None
    return DocumentReply(STATUS[code], {"schema_version": SCHEMA_VERSION, "message_type": "record_document_refusal",
        "request_id": request_id, "query_revision": revision, "workspace_id": workspace_id, "code": code, "message": message, "field": field,
        "retryable": code in {"workspace_unavailable", "population_unavailable"}})


def valid_reference(reference: str) -> bool:
    """A plain document name: never a path, a drive, a parent step or a reserved Windows device name."""
    if _REFERENCE.fullmatch(reference) is None or ".." in reference or reference in {".", ".."}:
        return False
    return reference.split(".")[0].upper() not in _RESERVED


def _inside(path: Path, folder: Path) -> bool:
    try:
        path.relative_to(folder)
    except ValueError:
        return False
    return True


def default_opener(path: Path) -> bool:
    """Ask the operating system to open one checked file with its default program; nothing else is started.

    ``WISE_ATTACHMENT_OPEN_RECORD`` names a file that receives one digest line per request instead, so that
    tests and qualification never start a program. It records no path or name."""
    record = os.environ.get("WISE_ATTACHMENT_OPEN_RECORD")
    if record:
        with open(record, "a", encoding="utf-8") as stream:
            stream.write(hashlib.sha256(str(path).encode("utf-8")).hexdigest() + "\n")
        return True
    if sys.platform == "darwin":
        return subprocess.run(["/usr/bin/open", str(path)], check=False, timeout=30,
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
    if sys.platform == "win32":
        os.startfile(str(path))  # type: ignore[attr-defined]  # the registered default program for this type
        return True
    raise NotImplementedError


class RecordDocuments:
    """Reads documents for records of a held population; owns the workspace's document-folder setting."""

    opener = staticmethod(default_opener)

    def __init__(self, imports: Imports) -> None:
        self.imports = imports

    # Boundary ------------------------------------------------------------------------------

    def _read(self, body: bytes, model) -> dict | DocumentReply:
        given = read_object(body)
        if isinstance(given, str):
            return _refused({}, "invalid_request", given)
        if type(given.get("schema_version")) is int and given["schema_version"] != SCHEMA_VERSION:
            return _refused(given, "unsupported_schema", "Only document schema version 1 is supported.", "schema_version")
        checked = read_strictly(given, model, _ALTERNATIVES)
        if isinstance(checked, list):
            return _refused(given, "invalid_request", "The request does not match its contract: " + checked[0].reason, checked[0].field)
        return given

    def _workspace(self, given: dict) -> Workspace | DocumentReply:
        workspace = self.imports.opened_workspace(given["workspace_id"])
        if isinstance(workspace, Problem):
            return _refused(given, "workspace_unavailable", "Open this workspace again.", "workspace_id")
        return workspace

    # The workspace's document folder ----------------------------------------------------------

    def _folder(self, workspace: Workspace) -> str | None:
        try:
            stored = json.loads((workspace.path / SETTING).read_text(encoding="utf-8"))
        except (OSError, ValueError, UnicodeError):
            return None
        folder = stored.get("folder") if isinstance(stored, dict) and stored.get("format") == FOLDER_FORMAT else None
        return folder if isinstance(folder, str) and folder else None

    @staticmethod
    def _state(folder: str | None) -> str:
        if folder is None:
            return "not_set"
        path = Path(folder)
        if not path.exists():
            return "missing"
        return "available" if path.is_dir() else "not_a_folder"

    def folder(self, body: bytes) -> DocumentReply:
        given = self._read(body, generated.DocumentFolderRequest)
        if isinstance(given, DocumentReply):
            return given
        workspace = self._workspace(given)
        if isinstance(workspace, DocumentReply):
            return workspace
        change = given["change"]
        if change is not None:
            folder = change["folder"]
            if folder is not None and (not Path(folder).is_absolute() or "\x00" in folder):
                return _refused(given, "invalid_folder", "The document folder must be an absolute folder on this computer.", "change.folder")
            target = workspace.path / SETTING
            try:
                target.parent.mkdir(exist_ok=True)
                if folder is None:
                    target.unlink(missing_ok=True)
                else:
                    write_atomically(target, json.dumps({"format": FOLDER_FORMAT, "folder": str(Path(folder))}, ensure_ascii=False).encode("utf-8"))
            except OSError:
                return _refused(given, "workspace_not_writable", "The workspace folder cannot be written; the document folder was not changed.", "workspace_id")
        folder = self._folder(workspace)
        return DocumentReply(200, {"schema_version": SCHEMA_VERSION, "message_type": "document_folder_answer", "request_id": given["request_id"],
                                   "query_revision": given["query_revision"], "workspace_id": given["workspace_id"], "folder": folder, "state": self._state(folder)})

    # Reading ---------------------------------------------------------------------------------

    def _record(self, given: dict):
        resolved = resolve_population(self.imports, {"workspace_id": given["workspace_id"], "identity": given["identity"]})
        if isinstance(resolved, Problem):
            code = resolved.code if resolved.code in STATUS else "population_unavailable"
            return _refused(given, code, resolved.message, resolved.field)
        prepared, population = resolved
        if given["case_id"] not in set(population.case_ids):
            return _refused(given, "unknown_case", "This incident is not in the population.", "case_id")
        record = next((row for row in prepared.histories[given["case_id"]] if row.row_id == given["row_id"]), None)
        if record is None:
            return _refused(given, "unknown_record", "This record is not in the incident.", "row_id")
        return prepared, record

    def _document(self, workspace: Workspace, prepared, record) -> dict:
        """The document behind one record, or the reason it is not available, with nothing of its content in it."""
        unavailable = lambda reason, size=None: {"state": "unavailable", "reason": reason, "size_bytes": size, "document": None, "path": None}
        column = prepared.mapping.get("document_reference_column")
        reference = record.original_cells[column].strip() if column is not None and column < len(record.original_cells) else ""
        if not reference:
            return unavailable("no_reference")
        if not valid_reference(reference):
            return unavailable("not_a_valid_reference")
        folder = self._folder(workspace)
        if folder is None:
            return unavailable("folder_not_set")
        try:
            root = Path(folder).resolve(strict=True)
        except OSError:
            return unavailable("folder_missing")
        if not root.is_dir():
            return unavailable("folder_missing")
        candidate = root / f"{reference}.json"
        if not os.path.lexists(candidate):
            return unavailable("file_missing")
        try:
            path = candidate.resolve(strict=True)
        except OSError:
            return unavailable("file_missing")
        if not _inside(path, root) or path.parent != root:
            return unavailable("outside_folder")
        try:
            size = path.stat().st_size
            if not path.is_file():
                return unavailable("unreadable")
            if size > MAX_DOCUMENT_BYTES:
                return unavailable("too_large", size)
            with path.open("rb") as stream:
                data = stream.read(MAX_DOCUMENT_BYTES + 1)
        except OSError:
            return unavailable("unreadable")
        if len(data) > MAX_DOCUMENT_BYTES:
            return unavailable("too_large", len(data))
        try:
            document = json.loads(data.decode("utf-8"))
        except (UnicodeDecodeError, ValueError):
            return unavailable("invalid_json", len(data))
        if not isinstance(document, dict) or not isinstance(document.get("format"), str):
            return unavailable("invalid_document", len(data))
        if document["format"] != FORMAT:
            return unavailable("unknown_format_version", len(data))
        if isinstance(read_strictly(document, generated.RecordDocument, _ALTERNATIVES), list):
            return unavailable("invalid_document", len(data))
        return {"state": "available", "reason": None, "size_bytes": len(data), "document": document, "path": path, "root": root}

    @staticmethod
    def openable(attachment: dict) -> bool:
        extension = PurePosixPath(attachment["path"]).suffix.lower().lstrip(".")
        allowed = OPENABLE.get(extension)
        return allowed is not None and allowed[0] == attachment["type"].strip().lower()

    def read(self, body: bytes) -> DocumentReply:
        given = self._read(body, generated.RecordDocumentRequest)
        if isinstance(given, DocumentReply):
            return given
        workspace = self._workspace(given)
        if isinstance(workspace, DocumentReply):
            return workspace
        found = self._record(given)
        if isinstance(found, DocumentReply):
            return found
        result = self._document(workspace, *found)
        document = result["document"]
        return DocumentReply(200, {"schema_version": SCHEMA_VERSION, "message_type": "record_document_answer",
            "request_id": given["request_id"], "query_revision": given["query_revision"], "workspace_id": given["workspace_id"], "case_id": given["case_id"], "row_id": given["row_id"],
            "state": result["state"], "reason": result["reason"], "size_bytes": result["size_bytes"], "max_document_bytes": MAX_DOCUMENT_BYTES,
            "document": document, "openable_attachments": [self.openable(item) for item in document["attachments"]] if document else []})

    # Attachments -----------------------------------------------------------------------------

    def open_attachment(self, body: bytes) -> DocumentReply:
        given = self._read(body, generated.AttachmentOpenRequest)
        if isinstance(given, DocumentReply):
            return given
        workspace = self._workspace(given)
        if isinstance(workspace, DocumentReply):
            return workspace
        found = self._record(given)
        if isinstance(found, DocumentReply):
            return found
        answer = lambda opened, reason: DocumentReply(200, {"schema_version": SCHEMA_VERSION, "message_type": "attachment_open_answer",
            "request_id": given["request_id"], "query_revision": given["query_revision"], "workspace_id": given["workspace_id"], "opened": opened, "reason": reason})
        result = self._document(workspace, *found)
        if result["state"] != "available":
            return answer(False, "document_unavailable")
        attachments = result["document"]["attachments"]
        if given["attachment_index"] >= len(attachments):
            return answer(False, "no_such_attachment")
        attachment, root = attachments[given["attachment_index"]], result["root"]
        relative = attachment["path"]
        parts = PurePosixPath(relative).parts
        if ("\\" in relative or "\x00" in relative or relative.startswith("/") or re.match(r"^[A-Za-z]:", relative)
                or not parts or any(part in {"", ".", ".."} for part in parts)):
            return answer(False, "invalid_path")
        candidate = root.joinpath(*parts)
        if not os.path.lexists(candidate):
            return answer(False, "file_missing")
        try:
            path = candidate.resolve(strict=True)
        except OSError:
            return answer(False, "file_missing")
        if not _inside(path, root):
            return answer(False, "outside_folder")
        if not path.is_file():
            return answer(False, "file_missing")
        extension = path.suffix.lower().lstrip(".")
        allowed = OPENABLE.get(extension)
        if allowed is None or PurePosixPath(relative).suffix.lower().lstrip(".") != extension:
            return answer(False, "not_an_allowed_type")
        media_type, signature = allowed
        try:
            with path.open("rb") as stream:
                head = stream.read(4096)
        except OSError:
            return answer(False, "file_missing")
        if attachment["type"].strip().lower() != media_type or not signature(head, path):
            return answer(False, "type_mismatch")
        try:
            opened = type(self).opener(path)
        except NotImplementedError:
            return answer(False, "unsupported_system")
        except (OSError, subprocess.SubprocessError):
            return answer(False, "open_failed")
        return answer(True, None) if opened else answer(False, "open_failed")


GUARDED = ("/api/documents/", "/api/workspaces/document-folder")
TRUSTED_ORIGINS_ENVIRONMENT = "WISE_TRUSTED_WEB_ORIGINS"
"""Extra loopback web origins, such as the development server, named explicitly; nothing is trusted by default."""
_LOOPBACK = {"127.0.0.1", "localhost"}


def _host_port(value: str) -> tuple[str, int | None] | None:
    match = re.fullmatch(r"(127\.0\.0\.1|localhost)(?::(\d{1,5}))?", value.strip().lower())
    return None if match is None else (match.group(1), int(match.group(2)) if match.group(2) else None)


def _trusted_extra() -> set[tuple[str, int | None]]:
    trusted = set()
    for origin in os.environ.get(TRUSTED_ORIGINS_ENVIRONMENT, "").split(","):
        found = re.fullmatch(r"http://(127\.0\.0\.1|localhost)(?::(\d{1,5}))?", origin.strip().lower())
        if found:
            trusted.add((found.group(1), int(found.group(2)) if found.group(2) else None))
    return trusted


def allowed_request(headers: dict[str, str], server_port: int | None) -> bool:
    """Only the platform's own loopback host and origin may read a document or ask to open an attachment."""
    def own(host: tuple[str, int | None] | None) -> bool:
        if host is None:
            return False
        name, port = host
        return name in _LOOPBACK and (port or 80) == (server_port or 80) or host in _trusted_extra()
    if not own(_host_port(headers.get("host", ""))):
        return False
    if headers.get("sec-fetch-site", "same-origin") not in {"same-origin", "none"}:
        return False
    origin = headers.get("origin")
    if origin is None:
        return True
    found = re.fullmatch(r"http://(.+)", origin.strip().lower())
    return found is not None and own(_host_port(found.group(1)))


class DocumentOriginGuard:
    """ASGI middleware refusing document and folder requests from another host, origin or web page."""

    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] != "http" or not scope["path"].startswith(GUARDED):
            await self.app(scope, receive, send)
            return
        headers = {key.decode("latin-1").lower(): value.decode("latin-1") for key, value in scope.get("headers", [])}
        server = scope.get("server") or (None, None)
        if allowed_request(headers, server[1]):
            await self.app(scope, receive, send)
            return
        body = json.dumps({"schema_version": SCHEMA_VERSION, "message_type": "record_document_refusal", "request_id": None,
                           "query_revision": None, "workspace_id": None, "code": "forbidden_origin",
                           "message": "Documents answer only the platform's own page on this computer.", "field": None,
                           "retryable": False}).encode("utf-8")
        await send({"type": "http.response.start", "status": 403,
                    "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())]})
        await send({"type": "http.response.body", "body": body})
