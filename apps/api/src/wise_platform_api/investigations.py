"""Opening a synthetic example and the evidence of one of its incidents.

This module maps between the generated contract models and the analytics
package. The package computes every population, count, order, identity and
refusal; the answers here carry its values onto the contract and add nothing
to their meaning. A source the contract cannot carry, such as one with a
column it does not name or an incident id longer than it allows, is refused
here as malformed rather than failing while the answer is written.

An evidence request names a population only by its identities, so the
application remembers, for every population it has opened, which example and
which policies it was opened from. The package then computes the population
again from the example's bytes and checks every identity of the request
against it. A population this application has not opened, for instance one
opened before a restart, is refused as an identity mismatch: the example must
be opened again.
"""

from __future__ import annotations

import logging
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from pathlib import Path
from threading import Lock

from pydantic import BaseModel, ValidationError
from wise_platform_analytics import (
    CaseEvidence,
    Identities,
    PolicyChoice,
    PolicySelection,
    PopulationAnswer as AnalyticsPopulation,
    PopulationSupport as AnalyticsSupport,
    Refusal as AnalyticsRefusal,
    RefusalCode,
    open_case,
    open_population,
)

from .boundary import SCHEMA_VERSION, STATUS, parse_request, refusal
from .examples import CATALOG, read_example
from .generated.investigation import (
    AnswerIdentity,
    CaseEvidenceAnswer,
    CaseEvidenceRequest,
    CaseId,
    CaseSummary,
    Coverage,
    InputPolicies,
    OpenExampleRequest,
    OriginalValues,
    PopulationAnswer,
    PopulationPartition,
    PopulationSupport,
    Refusal,
    SourceRecord,
    SyntheticSource,
)

logger = logging.getLogger(__name__)

OPEN_EXAMPLE = "open_example"
CASE_EVIDENCE = "case_evidence"

_CODES: Mapping[RefusalCode, str] = {
    RefusalCode.MALFORMED_SOURCE: "malformed_source",
    RefusalCode.UNKNOWN_POLICY: "unsupported_policy",
    RefusalCode.UNSUPPORTED_PARAMETER: "invalid_parameter",
    RefusalCode.MISSING_POLICY: "invalid_request",
    RefusalCode.IDENTITY_MISMATCH: "identity_mismatch",
    RefusalCode.UNKNOWN_CASE: "case_not_found",
    RefusalCode.CASE_NOT_IN_POPULATION: "case_not_in_population",
}
_COLUMNS = tuple(OriginalValues.model_fields)
_SHOWN_LENGTH = 60


@dataclass(frozen=True)
class Reply:
    """A contract message and the HTTP status it is sent with."""

    status: int
    body: BaseModel


@dataclass(frozen=True)
class _Opened:
    example_id: str
    policies: PolicySelection


class Investigations:
    """The two operations on the examples of one directory."""

    def __init__(self, examples_dir: Path) -> None:
        self.examples_dir = examples_dir
        self._opened: dict[str, _Opened] = {}
        self._lock = Lock()

    def open_example(self, body: bytes) -> Reply:
        return _answering(OPEN_EXAMPLE, body, OpenExampleRequest, self._open_example)

    def case_evidence(self, body: bytes) -> Reply:
        return _answering(CASE_EVIDENCE, body, CaseEvidenceRequest, self._case_evidence)

    def _open_example(self, request: OpenExampleRequest) -> Reply:
        example = CATALOG[request.example_id.root]
        policies = selection_of(request.policies.model_dump(mode="json"))
        source = read_example(self.examples_dir, example.example_id)
        if source is None:
            return _unavailable(OPEN_EXAMPLE, request, example.example_id)
        answer = open_population(source, policies)
        if isinstance(answer, AnalyticsRefusal):
            return _refused(OPEN_EXAMPLE, answer, request, example.example_id)
        uncarried = _not_carried(answer)
        if uncarried is not None:
            return _reply(
                _echoing(
                    OPEN_EXAMPLE,
                    request,
                    "malformed_source",
                    f"The synthetic example {example.example_id} {uncarried}",
                )
            )
        with self._lock:
            self._opened[answer.identities.population_id] = _Opened(
                example.example_id, policies
            )
        return _reply(
            PopulationAnswer(
                schema_version=SCHEMA_VERSION,
                message_type="population_answer",
                request_id=request.request_id,
                query_revision=request.query_revision,
                identity=_identity(answer.identities),
                source=SyntheticSource(
                    example_id=example.example_id,
                    synthetic=True,
                    label=example.label,
                    snapshot_cutoff_utc=example.snapshot_cutoff_utc,
                ),
                policies=InputPolicies.model_validate(
                    {
                        role: {"id": choice.policy_id, "parameters": dict(choice.parameters)}
                        for role, choice in answer.policies.by_role().items()
                    }
                ),
                populations=_populations(answer),
                coverage=Coverage(**answer.coverage.to_dict()),
                cases=[CaseSummary(**summary.to_dict()) for summary in answer.cases],
            )
        )

    def _case_evidence(self, request: CaseEvidenceRequest) -> Reply:
        given = Identities(**request.identity.model_dump(mode="json"))
        with self._lock:
            opened = self._opened.get(given.population_id)
        if opened is None:
            return _reply(
                _echoing(
                    CASE_EVIDENCE,
                    request,
                    "identity_mismatch",
                    "This population is not open in the application. Open the example again.",
                    field="identity.population_id",
                )
            )
        source = read_example(self.examples_dir, opened.example_id)
        if source is None:
            return _unavailable(CASE_EVIDENCE, request, opened.example_id)
        evidence = open_case(source, opened.policies, given, request.case_id.root)
        if isinstance(evidence, AnalyticsRefusal):
            return _refused(CASE_EVIDENCE, evidence, request, opened.example_id)
        return _reply(_evidence_answer(request, evidence))


def selection_of(policies: Mapping[str, Mapping[str, object]]) -> PolicySelection:
    """The package's selection of the policies a request names, role by role."""
    return PolicySelection(
        {
            role: PolicyChoice(entry["id"], entry["parameters"])  # type: ignore[arg-type]
            for role, entry in policies.items()
        }
    )


def refusal_from_package(
    operation: str,
    refused: AnalyticsRefusal,
    request_id: str | None,
    query_revision: int | None,
    example_id: str | None = None,
) -> Refusal:
    """The contract refusal for a refusal of the package, naming the offending field."""
    detail = refused.detail
    role = detail.get("role")
    if refused.code is RefusalCode.UNKNOWN_POLICY:
        field = f"policies.{role}" + ("" if detail.get("reason") == "unknown_role" else ".id")
    elif refused.code is RefusalCode.UNSUPPORTED_PARAMETER:
        field = f"policies.{role}.parameters.{detail.get('parameter')}"
    elif refused.code is RefusalCode.MISSING_POLICY:
        field = f"policies.{role}"
    elif refused.code is RefusalCode.IDENTITY_MISMATCH:
        field = f"identity.{detail.get('identity')}"
    elif refused.code in (RefusalCode.UNKNOWN_CASE, RefusalCode.CASE_NOT_IN_POPULATION):
        field = "case_id"
    else:
        field = None
    message = refused.message
    if refused.code is RefusalCode.MALFORMED_SOURCE and example_id is not None:
        message = f"The synthetic example {example_id} cannot be read. {message}"
    return refusal(
        operation,
        _CODES[refused.code],
        message,
        request_id=request_id,
        query_revision=query_revision,
        field=field,
    )


def _answering(
    operation: str,
    body: bytes,
    model: type[OpenExampleRequest] | type[CaseEvidenceRequest],
    answer: Callable[..., Reply],
) -> Reply:
    request = parse_request(body, model, operation)
    if isinstance(request, Refusal):
        return _reply(request)
    try:
        return answer(request)
    except Exception:
        logger.exception("The %s operation failed unexpectedly", operation)
        return _reply(
            _echoing(
                operation,
                request,
                "computation_failed",
                "The answer could not be computed. Try again; if it fails again, "
                "the application needs to be repaired.",
            )
        )


def _echoing(
    operation: str,
    request: OpenExampleRequest | CaseEvidenceRequest,
    code: str,
    message: str,
    *,
    field: str | None = None,
) -> Refusal:
    return refusal(
        operation,
        code,
        message,
        request_id=request.request_id.root,
        query_revision=request.query_revision.root,
        field=field,
    )


def _unavailable(
    operation: str, request: OpenExampleRequest | CaseEvidenceRequest, example_id: str
) -> Reply:
    return _reply(
        _echoing(
            operation,
            request,
            "source_unavailable",
            f"The synthetic example {example_id} is not available on this computer. "
            "Reinstalling the application restores it.",
        )
    )


def _refused(
    operation: str,
    refused: AnalyticsRefusal,
    request: OpenExampleRequest | CaseEvidenceRequest,
    example_id: str,
) -> Reply:
    return _reply(
        refusal_from_package(
            operation,
            refused,
            request.request_id.root,
            request.query_revision.root,
            example_id,
        )
    )


def _not_carried(answer: AnalyticsPopulation) -> str | None:
    """Say what of a source the contract cannot carry, or ``None`` when it carries all."""
    foreign = [column for column in answer.columns if column not in _COLUMNS]
    if foreign:
        return f"has columns the example format does not carry: {', '.join(foreign)}."
    for case_id in answer.base.case_ids:
        try:
            CaseId.model_validate(case_id)
        except ValidationError as error:
            reason = error.errors(include_url=False)[0]["msg"]
            shown = case_id if len(case_id) <= _SHOWN_LENGTH else case_id[:_SHOWN_LENGTH] + "..."
            return (
                f"has a case id the contract cannot carry "
                f"({reason[0].lower()}{reason[1:]}): {shown!r}."
            )
    return None


def _reply(body: BaseModel) -> Reply:
    if isinstance(body, Refusal):
        return Reply(STATUS[body.code], body)
    return Reply(200, body)


def _identity(identities: Identities) -> AnswerIdentity:
    return AnswerIdentity.model_validate(identities.to_dict())


def _support(support: AnalyticsSupport) -> PopulationSupport:
    return PopulationSupport.model_validate(support.to_dict())


def _populations(answer: AnalyticsPopulation) -> PopulationPartition:
    return PopulationPartition(
        base=_support(answer.base),
        parent=_support(answer.parent),
        kept=_support(answer.kept),
        removed=_support(answer.removed),
        unevaluable=_support(answer.unevaluable),
        outside=_support(answer.outside),
    )


def _evidence_answer(
    request: CaseEvidenceRequest, evidence: CaseEvidence
) -> CaseEvidenceAnswer:
    return CaseEvidenceAnswer(
        schema_version=SCHEMA_VERSION,
        message_type="case_evidence_answer",
        request_id=request.request_id,
        query_revision=request.query_revision,
        identity=_identity(evidence.identities),
        case_id=evidence.case_id,
        coverage=Coverage(**evidence.coverage.to_dict()),
        records=[
            SourceRecord(
                row_id=record.row_id,
                source_position=record.source_position,
                source_event_id=record.source_event_id,
                source_sequence=record.source_sequence,
                activity=record.activity,
                timestamp_utc=record.timestamp_utc,
                service=record.service,
                assignment_group=record.assignment_group,
                original_values=OriginalValues.model_validate(dict(record.original_values)),
            )
            for record in evidence.records
        ],
        mapped_row_ids=list(evidence.mapped_row_ids),
        omitted_activity_row_ids=list(evidence.omitted_activity_row_ids),
    )
