"""Opening the population of a source.

The population of this version is every incident of the source. An incident
is a member as a whole: all its records belong to it wherever they stand in
the source. Membership is listed in the order in which the incidents first
appear in the source.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass

from .identities import Identities, identify
from .parsing import SourceRecord, parse_source
from .policies import AppliedPolicies, PolicySelection, resolve_policies
from .projection import omitted_from_mapped_sequence
from .refusals import Refusal

MEMBERSHIP_ORDER = "first_appearance_in_source"


@dataclass(frozen=True)
class IncidentRecordCount:
    """The number of raw records of one incident."""

    incident_id: str
    raw_record_count: int

    def to_dict(self) -> dict[str, object]:
        return {
            "incident_id": self.incident_id,
            "raw_record_count": self.raw_record_count,
        }


@dataclass(frozen=True)
class OmittedLabelCoverage:
    """How much of the raw evidence the activity projection leaves out.

    ``omitted_record_count`` of ``raw_record_count`` records have no activity
    label; they belong to ``affected_incident_count`` of ``incident_count``
    incidents.
    """

    omitted_record_count: int
    raw_record_count: int
    affected_incident_count: int
    incident_count: int

    def to_dict(self) -> dict[str, object]:
        return {
            "omitted_record_count": self.omitted_record_count,
            "raw_record_count": self.raw_record_count,
            "affected_incident_count": self.affected_incident_count,
            "incident_count": self.incident_count,
        }


@dataclass(frozen=True)
class PopulationAnswer:
    """The incidents of a population, with exact counts and the identities they are bound to."""

    identities: Identities
    policies: AppliedPolicies
    incident_count: int
    raw_record_count: int
    membership_order: str
    membership: tuple[str, ...]
    raw_record_counts: tuple[IncidentRecordCount, ...]
    omitted_label_coverage: OmittedLabelCoverage

    def to_dict(self) -> dict[str, object]:
        return {
            "kind": "population_answer",
            "identities": self.identities.to_dict(),
            "policies": self.policies.to_dict(),
            "incident_count": self.incident_count,
            "raw_record_count": self.raw_record_count,
            "membership_order": self.membership_order,
            "membership": list(self.membership),
            "raw_record_counts": [count.to_dict() for count in self.raw_record_counts],
            "omitted_label_coverage": self.omitted_label_coverage.to_dict(),
        }


@dataclass(frozen=True, eq=False)
class ResolvedPopulation:
    """A source read under applied policies, with its records grouped by incident.

    ``histories`` lists the incidents in order of first appearance; the records
    of each incident are in source order.
    """

    identities: Identities
    policies: AppliedPolicies
    columns: tuple[str, ...]
    records: tuple[SourceRecord, ...]
    histories: Mapping[str, tuple[SourceRecord, ...]]


def resolve_population(
    source: bytes, policies: PolicySelection
) -> ResolvedPopulation | Refusal:
    """Check the selection, read the source and identify its population.

    The selection is checked before the source is read. Passing something
    other than bytes as the source is a programming error and raises.
    """
    if not isinstance(source, bytes):
        raise TypeError(f"source must be bytes, not {type(source).__name__}")
    applied = resolve_policies(policies)
    if isinstance(applied, Refusal):
        return applied
    parsed = parse_source(source)
    if isinstance(parsed, Refusal):
        return parsed

    grouped: dict[str, list[SourceRecord]] = {}
    for record in parsed.records:
        grouped.setdefault(record.incident_id, []).append(record)
    membership = tuple(grouped)
    return ResolvedPopulation(
        identities=identify(
            source, applied, incident_ids=membership, membership=membership
        ),
        policies=applied,
        columns=parsed.columns,
        records=parsed.records,
        histories={
            incident_id: tuple(history) for incident_id, history in grouped.items()
        },
    )


def open_population(
    source: bytes, policies: PolicySelection
) -> PopulationAnswer | Refusal:
    """Answer which incidents an event-history source holds, or refuse.

    ``source`` is the bytes of the event-history CSV and ``policies`` selects
    the order and the activity projection. A malformed source or an unusable
    selection is returned as a ``Refusal``; it is never an empty population.
    """
    resolved = resolve_population(source, policies)
    if isinstance(resolved, Refusal):
        return resolved

    projection = resolved.policies.activity_projection
    omitted_record_count = 0
    affected_incident_count = 0
    for history in resolved.histories.values():
        omitted = sum(
            1 for record in history if omitted_from_mapped_sequence(record, projection)
        )
        omitted_record_count += omitted
        affected_incident_count += 1 if omitted else 0

    membership = tuple(resolved.histories)
    return PopulationAnswer(
        identities=resolved.identities,
        policies=resolved.policies,
        incident_count=len(membership),
        raw_record_count=len(resolved.records),
        membership_order=MEMBERSHIP_ORDER,
        membership=membership,
        raw_record_counts=tuple(
            IncidentRecordCount(incident_id, len(history))
            for incident_id, history in resolved.histories.items()
        ),
        omitted_label_coverage=OmittedLabelCoverage(
            omitted_record_count=omitted_record_count,
            raw_record_count=len(resolved.records),
            affected_incident_count=affected_incident_count,
            incident_count=len(membership),
        ),
    )
