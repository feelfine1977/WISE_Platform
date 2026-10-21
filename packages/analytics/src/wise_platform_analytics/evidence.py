"""Opening the whole evidence of one incident.

The evidence is bound to a population: the population is computed again from
the source and the policies, and the request is refused when one of the given
identities is not the computed one, when the incident is not in the source,
or when it is in the source but outside the parent population.

Every raw record of the incident is returned in the declared order. Each
record carries the original text of all its cells, an empty cell as empty
text, beside the values read from them, where a missing value is ``None``: it
is never empty text and never a word such as ``Unknown``.

Each record has a row identity derived from its source and its position
there, so it is unique in its source and the same in every population of it.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import datetime
from types import MappingProxyType

from .identities import Identities, row_identity
from .ordering import order_records
from .parsing import SourceRecord
from .policies import AppliedPolicies, PolicySelection
from .population import Coverage, coverage_of, resolve_population
from .projection import omitted_from_mapped_sequence
from .refusals import Refusal, RefusalCode


@dataclass(frozen=True)
class EvidenceRecord:
    """One raw record of an incident."""

    row_id: str
    source_position: int
    """Index of the record among the data rows of the source, counting from 0."""
    source_event_id: str
    source_sequence: int
    timestamp_utc: datetime
    activity: str | None
    service: str
    assignment_group: str | None
    original_values: Mapping[str, str] = field(hash=False)
    """The text of every cell of the row as written, keyed by column."""
    omitted_from_mapped_sequence: bool

    def __post_init__(self) -> None:
        object.__setattr__(
            self, "original_values", MappingProxyType(dict(self.original_values))
        )

    def to_dict(self) -> dict[str, object]:
        return {
            "row_id": self.row_id,
            "source_position": self.source_position,
            "source_event_id": self.source_event_id,
            "source_sequence": self.source_sequence,
            "timestamp_utc": utc_text(self.timestamp_utc),
            "activity": self.activity,
            "service": self.service,
            "assignment_group": self.assignment_group,
            "original_values": dict(self.original_values),
            "omitted_from_mapped_sequence": self.omitted_from_mapped_sequence,
        }


@dataclass(frozen=True)
class CaseEvidence:
    """Every raw record of one incident of a population, in the declared order.

    ``mapped_row_ids`` and ``omitted_activity_row_ids`` split the row
    identities of ``records`` by the activity projection, each in the
    declared order.
    """

    identities: Identities
    policies: AppliedPolicies
    case_id: str
    coverage: Coverage
    records: tuple[EvidenceRecord, ...]
    mapped_row_ids: tuple[str, ...]
    omitted_activity_row_ids: tuple[str, ...]

    def to_dict(self) -> dict[str, object]:
        return {
            "kind": "case_evidence",
            "identities": self.identities.to_dict(),
            "policies": self.policies.to_dict(),
            "case_id": self.case_id,
            "coverage": self.coverage.to_dict(),
            "records": [record.to_dict() for record in self.records],
            "mapped_row_ids": list(self.mapped_row_ids),
            "omitted_activity_row_ids": list(self.omitted_activity_row_ids),
        }


def open_case(
    source: bytes,
    policies: PolicySelection,
    identities: Identities,
    case_id: str,
) -> CaseEvidence | Refusal:
    """Return every raw record of one incident of a population, or refuse.

    ``identities`` must be those of the population of ``source`` under
    ``policies``, as given by ``open_population``; ``case_id`` is the incident
    id exactly as written in the source.
    """
    resolved = resolve_population(source, policies)
    if isinstance(resolved, Refusal):
        return resolved

    computed = resolved.identities
    differing = identities.first_difference(computed)
    if differing is not None:
        return Refusal(
            RefusalCode.IDENTITY_MISMATCH,
            f"The given {differing.replace('_', ' ')} does not match the population "
            "computed from this source under these policies.",
            {
                "identity": differing,
                "supplied": getattr(identities, differing),
                "computed": getattr(computed, differing),
            },
        )
    history = resolved.histories.get(case_id)
    if history is None:
        return Refusal(
            RefusalCode.UNKNOWN_CASE,
            f"The source has no case {case_id!r}.",
            {"case_id": case_id, "population_id": computed.population_id},
        )
    if case_id not in resolved.partition:
        return Refusal(
            RefusalCode.CASE_NOT_IN_POPULATION,
            f"The case {case_id!r} is outside the parent population.",
            {"case_id": case_id, "population_id": computed.population_id},
        )

    projection = resolved.policies.activity_projection
    records = tuple(
        _evidence_record(
            record,
            resolved.columns,
            row_identity(computed.source_id, record.source_position),
            omitted_from_mapped_sequence(record, projection),
        )
        for record in order_records(history, resolved.policies.order)
    )
    return CaseEvidence(
        identities=computed,
        policies=resolved.policies,
        case_id=case_id,
        coverage=coverage_of((history,), projection),
        records=records,
        mapped_row_ids=tuple(
            record.row_id
            for record in records
            if not record.omitted_from_mapped_sequence
        ),
        omitted_activity_row_ids=tuple(
            record.row_id for record in records if record.omitted_from_mapped_sequence
        ),
    )


def utc_text(instant: datetime) -> str:
    """Write a UTC instant as ``2026-01-31T09:30:00Z``, with microseconds when it has them."""
    text = (
        f"{instant.year:04d}-{instant.month:02d}-{instant.day:02d}"
        f"T{instant.hour:02d}:{instant.minute:02d}:{instant.second:02d}"
    )
    if instant.microsecond:
        text += f".{instant.microsecond:06d}"
    return text + "Z"


def _evidence_record(
    record: SourceRecord,
    columns: tuple[str, ...],
    row_id: str,
    omitted: bool,
) -> EvidenceRecord:
    return EvidenceRecord(
        row_id=row_id,
        source_position=record.source_position,
        source_event_id=record.source_event_id,
        source_sequence=record.sequence,
        timestamp_utc=record.timestamp_utc,
        activity=record.activity,
        service=record.service,
        assignment_group=record.assignment_group,
        original_values={
            column: "" if cell is None else cell
            for column, cell in zip(columns, record.cells, strict=True)
        },
        omitted_from_mapped_sequence=omitted,
    )
