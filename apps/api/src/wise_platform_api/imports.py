"""Working with an analyst's own CSV in a workspace: the operations of the import contract.

Each operation reads its request, finds the workspace it names, and hands the
stored bytes and the analyst's confirmed choices to the analytics package.
Every detection, interpretation, count, order, identity and refusal of the
answers comes from the package; this module adds the envelope, the workspace
and the stored source, and keeps what the package prepared.

A ready preparation is kept in the workspace with its identities and report.
To answer for it later, also in another run of the application, the package
prepares the stored bytes again under the stored confirmation and must arrive
at the same preparation id; the last prepared snapshots are held in memory so
that the population and the evidence of their incidents answer at once.

Every answer is checked against the generated models before it is sent, but
sent with the package's own values, so that a confirmed interpretation comes
back exactly as it was confirmed.
"""

from __future__ import annotations

import logging
from collections import OrderedDict
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass
from pathlib import Path
from threading import Lock

from pydantic import BaseModel, ValidationError
from wise_platform_analytics.csv_inspection import inspect_csv
from wise_platform_analytics.mapping import ImportRefusal as PackageRefusal
from wise_platform_analytics.preparation import PreparationResult, PreparedData, prepare
from wise_platform_analytics.prepared_operations import open_prepared_case, open_prepared_population

from .boundary import SCHEMA_VERSION
from .generated.imports import (
    ConfirmMappingRequest,
    CsvInspectionAnswer,
    ImportedCaseEvidenceAnswer,
    ImportedCaseEvidenceRequest,
    ImportedPopulationAnswer,
    ImportRefusal,
    InspectCsvRequest,
    InterpretationAnswer,
    OpenPopulationRequest,
    OpenWorkspaceRequest,
    SourceAnswer,
    UploadSourceMetadata,
    WorkspaceAnswer,
)
from .import_boundary import (
    STATUS,
    import_echo,
    import_refusal,
    parse_import,
    parse_import_body,
    upload_message,
)
from .workspace import Problem, StoredPreparation, Workspace

logger = logging.getLogger(__name__)

OPEN_WORKSPACE = "open_workspace"
UPLOAD_SOURCE = "upload_source"
INSPECT_CSV = "inspect_csv"
CONFIRM_MAPPING = "confirm_mapping"
OPEN_POPULATION = "open_population"
CASE_EVIDENCE = "case_evidence"

_PREPARED_KEPT = 2
_INSPECTIONS_KEPT = 16


@dataclass(frozen=True)
class ImportReply:
    """A contract message, as the JSON it is sent as, and its HTTP status."""

    status: int
    body: dict


class Imports:
    """The import operations over the workspaces opened in this run of the application."""

    def __init__(self, forbidden: Iterable[Path] = ()) -> None:
        self._forbidden = tuple(forbidden)
        self._workspaces: dict[str, Workspace] = {}
        self._prepared: OrderedDict[str, PreparedData] = OrderedDict()
        self._inspections: OrderedDict[tuple[str, str | None, str | None], dict] = OrderedDict()
        self._lock = Lock()
        self._preparing = Lock()

    # Operations ---------------------------------------------------------------------------

    def open_workspace(self, body: bytes) -> ImportReply:
        return _answering(OPEN_WORKSPACE, parse_import_body(body, OpenWorkspaceRequest, OPEN_WORKSPACE), self._open_workspace)

    def upload_source(self, query: Iterable[tuple[str, str]], content_type: str | None, raw: bytes) -> ImportReply:
        message = upload_message(query)
        if isinstance(message, str):
            return _refused(import_refusal(UPLOAD_SOURCE, "invalid_request", message))
        parsed = parse_import(message, UploadSourceMetadata, UPLOAD_SOURCE)
        if not isinstance(parsed, ImportRefusal):
            media_type = (content_type or "").split(";", 1)[0].strip().lower()
            if media_type != "application/octet-stream":
                return _refused(
                    import_refusal(
                        UPLOAD_SOURCE,
                        "invalid_request",
                        "The source must be sent as its unchanged bytes with the content type "
                        "application/octet-stream.",
                        echo=import_echo(message),
                        field="Content-Type",
                    )
                )
        return _answering(UPLOAD_SOURCE, parsed, lambda request, given: self._upload_source(request, given, raw))

    def inspect(self, body: bytes) -> ImportReply:
        return _answering(INSPECT_CSV, parse_import_body(body, InspectCsvRequest, INSPECT_CSV), self._inspect)

    def confirm_mapping(self, body: bytes) -> ImportReply:
        return _answering(
            CONFIRM_MAPPING, parse_import_body(body, ConfirmMappingRequest, CONFIRM_MAPPING), self._confirm_mapping
        )

    def open_population(self, body: bytes) -> ImportReply:
        return _answering(
            OPEN_POPULATION, parse_import_body(body, OpenPopulationRequest, OPEN_POPULATION), self._open_population
        )

    def case_evidence(self, body: bytes) -> ImportReply:
        return _answering(
            CASE_EVIDENCE, parse_import_body(body, ImportedCaseEvidenceRequest, CASE_EVIDENCE), self._case_evidence
        )

    # Use cases ----------------------------------------------------------------------------

    def _open_workspace(self, request: OpenWorkspaceRequest, given: dict) -> ImportReply:
        workspace = Workspace.open(request.path, self._forbidden)
        if isinstance(workspace, Problem):
            return _problem(OPEN_WORKSPACE, workspace, given)
        with self._lock:
            known = self._workspaces.get(workspace.workspace_id)
            if known is None or known.path != workspace.path:
                self._workspaces[workspace.workspace_id] = workspace
            else:
                workspace = known
        return _answer(
            WorkspaceAnswer,
            _envelope("workspace_answer", given)
            | {
                "workspace_id": workspace.workspace_id,
                "path": str(workspace.path),
                "writable": True,
                "sources": [source.to_dict() for source in workspace.sources()],
                "preparations": [preparation.to_dict() for preparation in workspace.preparations()],
            },
        )

    def _upload_source(self, request: UploadSourceMetadata, given: dict, raw: bytes) -> ImportReply:
        workspace = self._workspace(UPLOAD_SOURCE, given)
        if isinstance(workspace, ImportReply):
            return workspace
        stored = workspace.store_source(raw, request.filename)
        if isinstance(stored, Problem):
            return _problem(UPLOAD_SOURCE, stored, given)
        return _answer(SourceAnswer, _envelope("source_answer", given) | {"source": stored.to_dict()})

    def _inspect(self, request: InspectCsvRequest, given: dict) -> ImportReply:
        workspace = self._workspace(INSPECT_CSV, given)
        if isinstance(workspace, ImportReply):
            return workspace
        source_id = given["source_id"]
        stored = workspace.source(source_id)
        if isinstance(stored, Problem):
            return _problem(INSPECT_CSV, stored, given)
        hints = given.get("hints")
        key = (
            source_id,
            None if hints is None else hints.get("encoding"),
            None if hints is None else hints.get("delimiter"),
        )
        with self._lock:
            inspection = self._inspections.get(key)
        if inspection is None:
            raw = workspace.read_source(source_id)
            if isinstance(raw, Problem):
                return _problem(INSPECT_CSV, raw, given)
            found = inspect_csv(raw, hints)
            if isinstance(found, PackageRefusal):
                return _from_package(INSPECT_CSV, found, given)
            inspection = found
            with self._lock:
                _keep(self._inspections, key, inspection, _INSPECTIONS_KEPT)
        return _answer(CsvInspectionAnswer, _envelope("csv_inspection_answer", given) | inspection)

    def _confirm_mapping(self, request: ConfirmMappingRequest, given: dict) -> ImportReply:
        workspace = self._workspace(CONFIRM_MAPPING, given)
        if isinstance(workspace, ImportReply):
            return workspace
        raw = workspace.read_source(given["source_id"])
        if isinstance(raw, Problem):
            return _problem(CONFIRM_MAPPING, raw, given)
        result = prepare(raw, given["dialect"], given["mapping"], given["policies"], given["accept_report_issues"])
        if isinstance(result, PackageRefusal):
            return _from_package(CONFIRM_MAPPING, result, given)
        interpretation = result.to_dict()
        if result.preparation is not None:
            prepared = result.preparation
            stored = workspace.store_preparation(
                interpretation["preparation"], prepared.identity_dict(), interpretation["report"]
            )
            if isinstance(stored, Problem):
                return _problem(CONFIRM_MAPPING, stored, given)
            with self._lock:
                _keep(self._prepared, prepared.preparation_id, prepared, _PREPARED_KEPT)
        return _answer(InterpretationAnswer, _envelope("interpretation_answer", given) | interpretation)

    def _open_population(self, request: OpenPopulationRequest, given: dict) -> ImportReply:
        workspace = self._workspace(OPEN_POPULATION, given)
        if isinstance(workspace, ImportReply):
            return workspace
        found = self._prepared_snapshot(workspace, given["preparation_id"], "preparation_id")
        if isinstance(found, Problem):
            return _problem(OPEN_POPULATION, found, given)
        if isinstance(found, PackageRefusal):
            return _from_package(OPEN_POPULATION, found, given)
        prepared, source = found
        return _answer(
            ImportedPopulationAnswer,
            _envelope("imported_population_answer", given)
            | {"source": source}
            | open_prepared_population(prepared),
        )

    def _case_evidence(self, request: ImportedCaseEvidenceRequest, given: dict) -> ImportReply:
        workspace = self._workspace(CASE_EVIDENCE, given)
        if isinstance(workspace, ImportReply):
            return workspace
        identity = given["identity"]
        found = self._prepared_snapshot(workspace, identity["preparation_id"], "identity.preparation_id")
        if isinstance(found, Problem):
            return _problem(CASE_EVIDENCE, found, given)
        if isinstance(found, PackageRefusal):
            return _from_package(CASE_EVIDENCE, found, given)
        evidence = open_prepared_case(found[0], identity, given["case_id"])
        if isinstance(evidence, PackageRefusal):
            return _from_package(CASE_EVIDENCE, evidence, given)
        return _answer(ImportedCaseEvidenceAnswer, _envelope("imported_case_evidence_answer", given) | evidence)

    # Workspaces and prepared snapshots -----------------------------------------------------

    def prepared(self, workspace_id: str, preparation_id: str) -> tuple[PreparedData, dict] | Problem | PackageRefusal:
        """The prepared snapshot of a preparation kept in an open workspace, and its stored source.

        A problem with the source or the preparation names its field inside ``identity``, as the
        investigation operations that use it carry both inside their identity.
        """
        workspace = self._open(workspace_id)
        if isinstance(workspace, Problem):
            return workspace
        found = self._prepared_snapshot(workspace, preparation_id, "identity.preparation_id")
        if isinstance(found, Problem) and found.field in ("source_id", "preparation_id"):
            return Problem(found.code, found.message, f"identity.{found.field}")
        return found

    def _workspace(self, operation: str, given: dict) -> Workspace | ImportReply:
        workspace = self._open(given["workspace_id"])
        if isinstance(workspace, Problem):
            return _problem(operation, workspace, given)
        return workspace

    def _open(self, workspace_id: str) -> Workspace | Problem:
        with self._lock:
            workspace = self._workspaces.get(workspace_id)
        if workspace is None:
            return Problem(
                "workspace_unavailable",
                "This workspace is not open in the application. Open the workspace folder again.",
                "workspace_id",
            )
        problem = workspace.check()
        if problem is not None:
            with self._lock:
                self._workspaces.pop(workspace.workspace_id, None)
            return problem
        return workspace

    def _prepared_snapshot(
        self, workspace: Workspace, preparation_id: str, field: str
    ) -> tuple[PreparedData, dict] | Problem | PackageRefusal:
        """The prepared snapshot of a kept preparation and its stored source."""
        record = workspace.preparation(preparation_id)
        if isinstance(record, Problem):
            return Problem(record.code, record.message, field if record.field == "preparation_id" else record.field)
        source = workspace.source(record.source_id)
        if isinstance(source, Problem):
            return source
        with self._lock:
            prepared = self._prepared.get(preparation_id)
            if prepared is not None:
                self._prepared.move_to_end(preparation_id)
        if prepared is None:
            # One preparation at a time: a second request for the same snapshot then finds it held.
            with self._preparing:
                with self._lock:
                    prepared = self._prepared.get(preparation_id)
                if prepared is None:
                    again = self._prepare_again(workspace, record)
                    if not isinstance(again, PreparedData):
                        return again
                    prepared = again
                    with self._lock:
                        _keep(self._prepared, preparation_id, prepared, _PREPARED_KEPT)
        return prepared, source.to_dict()

    def _prepare_again(self, workspace: Workspace, record: StoredPreparation) -> PreparedData | Problem | PackageRefusal:
        raw = workspace.read_source(record.source_id)
        if isinstance(raw, Problem):
            return raw
        descriptor = record.descriptor
        result = prepare(raw, descriptor["dialect"], descriptor["mapping"], descriptor["policies"], True)
        if isinstance(result, PackageRefusal):
            return result
        if not isinstance(result, PreparationResult) or result.preparation is None:
            return _not_reproduced()
        if result.preparation.preparation_id != record.preparation_id:
            return _not_reproduced()
        return result.preparation


def _not_reproduced() -> Problem:
    return Problem(
        "preparation_unavailable",
        "This preparation was made by another version of the application and cannot be reproduced "
        "from the stored source. Confirm the interpretation of the source again.",
        "preparation_id",
    )


def _keep(held: OrderedDict, key: object, value: object, limit: int) -> None:
    held[key] = value
    held.move_to_end(key)
    while len(held) > limit:
        held.popitem(last=False)


def _envelope(message_type: str, given: Mapping[str, object]) -> dict[str, object]:
    envelope: dict[str, object] = {
        "schema_version": SCHEMA_VERSION,
        "message_type": message_type,
        "request_id": given["request_id"],
        "query_revision": given["query_revision"],
    }
    if "workspace_id" in given:
        envelope["workspace_id"] = given["workspace_id"]
    return envelope


def _answering(
    operation: str,
    parsed: tuple[BaseModel, dict] | ImportRefusal,
    answer: Callable[[BaseModel, dict], ImportReply],
) -> ImportReply:
    if isinstance(parsed, ImportRefusal):
        return _refused(parsed)
    request, given = parsed
    try:
        return answer(request, given)
    except Exception:
        logger.exception("The %s operation failed unexpectedly", operation)
        return _refused(
            import_refusal(
                operation,
                "computation_failed",
                "The answer could not be computed. Try again; if it fails again, "
                "the application needs to be repaired.",
                echo=import_echo(given),
            )
        )


def _answer(model: type[BaseModel], body: dict) -> ImportReply:
    """Check an answer against its generated model and send it with its own values."""
    try:
        model.model_validate(body)
    except ValidationError as error:
        first = error.errors(include_url=False)[0]
        raise ValueError(
            f"A {body.get('message_type')} answer is outside the contract at "
            f"{'.'.join(str(part) for part in first['loc'])}: {first['msg']}"
        ) from None
    return ImportReply(200, body)


def _refused(refusal: ImportRefusal) -> ImportReply:
    return ImportReply(STATUS[refusal.code], refusal.model_dump(mode="json"))


def _problem(operation: str, problem: Problem, given: Mapping[str, object]) -> ImportReply:
    return _refused(import_refusal(operation, problem.code, problem.message, echo=import_echo(given), field=problem.field))


def _from_package(operation: str, refused: PackageRefusal, given: Mapping[str, object]) -> ImportReply:
    code = refused.code if refused.code in STATUS else "computation_failed"
    if code != refused.code:
        logger.error("The analytics package refused with a code the contract does not name: %s", refused.code)
    return _refused(import_refusal(operation, code, refused.message, echo=import_echo(given), field=refused.field))
