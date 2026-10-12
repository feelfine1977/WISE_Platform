"""Opening the whole evidence of one incident.

The evidence is bound to a population: the population is computed again from
the source and the policies, and the request is refused when the given
population identity is not the computed one or the incident is not a member.

Every raw record of the incident is returned in the declared order, with all
its original cells as text. A missing cell is ``None``; it is never empty
text and never a word such as ``Unknown``.

Each record has a row id that is unique in its source. It is the
``source_event_id`` when that cell has a value which no other record of the
source shares; otherwise it is ``source_position:<n>``. An event id that
itself has this form is not used, so the two kinds can never collide. The
1-based position of the record among the data rows is always given as well.
"""

from __future__ import annotations

import re
from collections import Counter
from collections.abc import Mapping
from dataclasses import dataclass, field
from types import MappingProxyType

from .identities import Identities
from .ordering import order_records
from .parsing import SourceRecord
from .policies import AppliedPolicies, PolicySelection
from .population import resolve_population
from .projection import omitted_from_mapped_sequence
from .refusals import Refusal, RefusalCode

ROW_ID_IS_SOURCE_EVENT_ID = "source_event_id"
ROW_ID_IS_SOURCE_POSITION = "source_position"

_POSITION_ROW_ID = re.compile(r"source_position:[0-9]+")


@dataclass(frozen=True)
class EvidenceRecord:
    """One raw record of an incident."""

    row_id: str
    row_id_kind: str
    source_position: int
    cells: Mapping[str, str | None] = field(hash=False)
    omitted_from_mapped_sequence: bool

    def __post_init__(self) -> None:
        object.__setattr__(self, "cells", MappingProxyType(dict(self.cells)))

    def to_dict(self) -> dict[str, object]:
        return {
            "row_id": self.row_id,
            "row_id_kind": self.row_id_kind,
            "source_position": self.source_position,
            "cells": dict(self.cells),
            "omitted_from_mapped_sequence": self.omitted_from_mapped_sequence,
        }


@dataclass(frozen=True)
class CaseEvidence:
    """Every raw record of one incident of a population, in the declared order."""

    identities: Identities
    policies: AppliedPolicies
    case_id: str
    raw_record_count: int
    omitted_record_count: int
    records: tuple[EvidenceRecord, ...]

    def to_dict(self) -> dict[str, object]:
        return {
            "kind": "case_evidence",
            "identities": self.identities.to_dict(),
            "policies": self.policies.to_dict(),
            "case_id": self.case_id,
            "raw_record_count": self.raw_record_count,
            "omitted_record_count": self.omitted_record_count,
            "records": [record.to_dict() for record in self.records],
        }


def open_case(
    source: bytes,
    policies: PolicySelection,
    population_id: str,
    case_id: str,
) -> CaseEvidence | Refusal:
    """Return every raw record of one incident of a population, or refuse.

    ``population_id`` must be the identity of the population of ``source``
    under ``policies``, as given by ``open_population``; ``case_id`` is the
    incident id exactly as written in the source.
    """
    resolved = resolve_population(source, policies)
    if isinstance(resolved, Refusal):
        return resolved

    computed = resolved.identities.population_id
    if population_id != computed:
        return Refusal(
            RefusalCode.IDENTITY_MISMATCH,
            "The given population identity is not the identity of the population of this source "
            "under these policies.",
            {
                "identity": "population_id",
                "supplied": population_id,
                "computed": computed,
            },
        )
    history = resolved.histories.get(case_id)
    if history is None:
        return Refusal(
            RefusalCode.UNKNOWN_CASE,
            f"The case {case_id!r} is not in the population.",
            {"case_id": case_id, "population_id": computed},
        )

    usable_event_ids = _usable_event_ids(resolved.records)
    projection = resolved.policies.activity_projection
    records = tuple(
        _evidence_record(
            record,
            resolved.columns,
            usable_event_ids,
            omitted_from_mapped_sequence(record, projection),
        )
        for record in order_records(history, resolved.policies.order)
    )
    return CaseEvidence(
        identities=resolved.identities,
        policies=resolved.policies,
        case_id=case_id,
        raw_record_count=len(records),
        omitted_record_count=sum(
            1 for record in records if record.omitted_from_mapped_sequence
        ),
        records=records,
    )


def _usable_event_ids(records: tuple[SourceRecord, ...]) -> frozenset[str]:
    """Return the event ids that identify exactly one record of the source."""
    occurrences = Counter(
        record.source_event_id
        for record in records
        if record.source_event_id is not None
    )
    return frozenset(
        event_id
        for event_id, count in occurrences.items()
        if count == 1 and _POSITION_ROW_ID.fullmatch(event_id) is None
    )


def _evidence_record(
    record: SourceRecord,
    columns: tuple[str, ...],
    usable_event_ids: frozenset[str],
    omitted: bool,
) -> EvidenceRecord:
    if (
        record.source_event_id is not None
        and record.source_event_id in usable_event_ids
    ):
        row_id, row_id_kind = record.source_event_id, ROW_ID_IS_SOURCE_EVENT_ID
    else:
        row_id, row_id_kind = (
            f"source_position:{record.position}",
            ROW_ID_IS_SOURCE_POSITION,
        )
    return EvidenceRecord(
        row_id=row_id,
        row_id_kind=row_id_kind,
        source_position=record.position,
        cells=dict(zip(columns, record.cells, strict=True)),
        omitted_from_mapped_sequence=omitted,
    )
