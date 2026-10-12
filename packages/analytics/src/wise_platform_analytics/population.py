"""Opening the population of a source.

Every incident of the source is in the base population. The parent policy
takes whole incidents from it into the parent population; the others are
outside. The predicate splits the parent population into kept and removed
incidents, and keeps apart those it cannot evaluate. An incident belongs to a
population as a whole: all its records belong to it wherever they stand in
the source.

Every list of incidents is in the order in which they first appear in the
source, and every count of records counts raw records.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass

from .identities import Identities, identify
from .parsing import SourceRecord, parse_source
from .policies import AppliedPolicies, PolicyChoice, PolicySelection, resolve_policies
from .projection import omitted_from_mapped_sequence
from .refusals import Refusal
from .selection import in_parent, predicate_holds

MEMBERSHIP_ORDER = "first_appearance_in_source"

KEPT = "kept"
REMOVED = "removed"
UNEVALUABLE = "unevaluable"


@dataclass(frozen=True)
class PopulationSupport:
    """The incidents of one population and the number of their raw records."""

    case_ids: tuple[str, ...]
    case_count: int
    record_count: int

    def to_dict(self) -> dict[str, object]:
        return {
            "case_ids": list(self.case_ids),
            "case_count": self.case_count,
            "record_count": self.record_count,
        }


@dataclass(frozen=True)
class Coverage:
    """How many raw records there are and how many the mapped sequence leaves out.

    ``mapped_record_count`` and ``omitted_activity_record_count`` add up to
    ``raw_record_count``.
    """

    raw_record_count: int
    mapped_record_count: int
    omitted_activity_record_count: int

    def to_dict(self) -> dict[str, object]:
        return {
            "raw_record_count": self.raw_record_count,
            "mapped_record_count": self.mapped_record_count,
            "omitted_activity_record_count": self.omitted_activity_record_count,
        }


@dataclass(frozen=True)
class CaseSummary:
    """One incident of the parent population: its records and its side of the predicate."""

    case_id: str
    record_count: int
    mapped_record_count: int
    omitted_activity_record_count: int
    partition: str
    """``kept``, ``removed`` or ``unevaluable``."""

    def to_dict(self) -> dict[str, object]:
        return {
            "case_id": self.case_id,
            "record_count": self.record_count,
            "mapped_record_count": self.mapped_record_count,
            "omitted_activity_record_count": self.omitted_activity_record_count,
            "partition": self.partition,
        }


@dataclass(frozen=True)
class PopulationAnswer:
    """The populations of a source, with exact counts and the identities they are bound to.

    ``coverage`` and ``cases`` describe the parent population.
    """

    identities: Identities
    policies: AppliedPolicies
    columns: tuple[str, ...]
    """The columns of the source, in the order of its header."""
    base: PopulationSupport
    parent: PopulationSupport
    kept: PopulationSupport
    removed: PopulationSupport
    unevaluable: PopulationSupport
    outside: PopulationSupport
    coverage: Coverage
    cases: tuple[CaseSummary, ...]

    def to_dict(self) -> dict[str, object]:
        return {
            "kind": "population_answer",
            "identities": self.identities.to_dict(),
            "policies": self.policies.to_dict(),
            "columns": list(self.columns),
            "membership_order": MEMBERSHIP_ORDER,
            "populations": {
                "base": self.base.to_dict(),
                "parent": self.parent.to_dict(),
                "kept": self.kept.to_dict(),
                "removed": self.removed.to_dict(),
                "unevaluable": self.unevaluable.to_dict(),
                "outside": self.outside.to_dict(),
            },
            "coverage": self.coverage.to_dict(),
            "cases": [summary.to_dict() for summary in self.cases],
        }


@dataclass(frozen=True, eq=False)
class ResolvedPopulation:
    """A source read under applied policies, with its records grouped by incident.

    ``histories`` lists every incident in order of first appearance, with its
    records in source order. ``partition`` names the side of the predicate of
    every incident of the parent population, in the same order.
    """

    identities: Identities
    policies: AppliedPolicies
    columns: tuple[str, ...]
    records: tuple[SourceRecord, ...]
    histories: Mapping[str, tuple[SourceRecord, ...]]
    partition: Mapping[str, str]


def resolve_population(
    source: bytes, policies: PolicySelection
) -> ResolvedPopulation | Refusal:
    """Check the selection, read the source and identify its populations.

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
    histories = {incident_id: tuple(history) for incident_id, history in grouped.items()}
    partition = {
        incident_id: _side(predicate_holds(history, applied.predicate))
        for incident_id, history in histories.items()
        if in_parent(history, applied.parent)
    }
    return ResolvedPopulation(
        identities=identify(
            source, applied, incident_ids=tuple(histories), members=partition
        ),
        policies=applied,
        columns=parsed.columns,
        records=parsed.records,
        histories=histories,
        partition=partition,
    )


def coverage_of(
    histories: Iterable[Sequence[SourceRecord]], projection: PolicyChoice
) -> Coverage:
    """Count the raw records of some histories and those the projection omits."""
    raw = omitted = 0
    for history in histories:
        raw += len(history)
        omitted += sum(
            1 for record in history if omitted_from_mapped_sequence(record, projection)
        )
    return Coverage(
        raw_record_count=raw,
        mapped_record_count=raw - omitted,
        omitted_activity_record_count=omitted,
    )


def open_population(
    source: bytes, policies: PolicySelection
) -> PopulationAnswer | Refusal:
    """Answer which incidents of an event-history source form which population, or refuse.

    ``source`` is the bytes of the event-history CSV and ``policies`` selects
    one policy for every role. A malformed source or an unusable selection is
    returned as a ``Refusal``; it is never an empty population.
    """
    resolved = resolve_population(source, policies)
    if isinstance(resolved, Refusal):
        return resolved

    histories = resolved.histories
    partition = resolved.partition
    projection = resolved.policies.activity_projection

    def support(case_ids: Iterable[str]) -> PopulationSupport:
        listed = tuple(case_ids)
        return PopulationSupport(
            case_ids=listed,
            case_count=len(listed),
            record_count=sum(len(histories[case_id]) for case_id in listed),
        )

    def summary(case_id: str) -> CaseSummary:
        coverage = coverage_of((histories[case_id],), projection)
        return CaseSummary(
            case_id=case_id,
            record_count=coverage.raw_record_count,
            mapped_record_count=coverage.mapped_record_count,
            omitted_activity_record_count=coverage.omitted_activity_record_count,
            partition=partition[case_id],
        )

    return PopulationAnswer(
        identities=resolved.identities,
        policies=resolved.policies,
        columns=resolved.columns,
        base=support(histories),
        parent=support(partition),
        kept=support(case for case, side in partition.items() if side == KEPT),
        removed=support(case for case, side in partition.items() if side == REMOVED),
        unevaluable=support(
            case for case, side in partition.items() if side == UNEVALUABLE
        ),
        outside=support(case for case in histories if case not in partition),
        coverage=coverage_of((histories[case] for case in partition), projection),
        cases=tuple(summary(case_id) for case_id in partition),
    )


def _side(holds: bool | None) -> str:
    if holds is None:
        return UNEVALUABLE
    return KEPT if holds else REMOVED
