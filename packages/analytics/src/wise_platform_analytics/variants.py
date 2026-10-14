"""Variants: the actual sequences of labelled activities, and the incidents that follow each.

The sequence of an incident is its records in the declared order under the activity projection
``incident.activity.omit_missing_retain_raw_gaps.v1``: a record without an activity label is left
out of the sequence and counted, and repeated activities stay repeated. Incidents with an identical
sequence form one variant. An incident with no labelled record has the empty sequence.

An incident whose order cannot be evaluated has no sequence; it is kept apart with its count and is
in no variant. Shares are over the incidents whose order could be evaluated, and carry that
denominator.

The identity of a variant hashes its exact labels in order, so the same sequence has the same
identity in every population and revision of a preparation.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Iterable, Sequence
from dataclasses import dataclass

from .mapping import ImportRefusal
from .preparation import PreparedData
from .selection import SelectionError, case_ids

__all__ = ["ACTIVITY_PROJECTION_POLICY", "UnevaluableSupport", "Variant", "Variants", "variant_id", "variants"]

ACTIVITY_PROJECTION_POLICY = "incident.activity.omit_missing_retain_raw_gaps.v1"


def variant_id(activities: Sequence[str]) -> str:
    """The identity of a sequence from its exact labels, in order."""
    encoded = json.dumps(list(activities), ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return "variant.v1:sha256:" + hashlib.sha256(encoded).hexdigest()


@dataclass(frozen=True)
class Variant:
    activities: tuple[str, ...]
    case_ids: tuple[str, ...]
    denominator: int
    record_count: int
    omitted_activity_record_count: int

    @property
    def id(self) -> str:
        return variant_id(self.activities)

    @property
    def case_count(self) -> int:
        return len(self.case_ids)

    @property
    def share(self) -> float:
        return self.case_count / self.denominator

    def to_dict(self) -> dict[str, object]:
        return {"id": self.id, "activities": list(self.activities), "case_count": self.case_count,
                "share": self.share, "denominator": self.denominator, "case_ids": list(self.case_ids),
                "record_count": self.record_count, "omitted_activity_record_count": self.omitted_activity_record_count}


@dataclass(frozen=True)
class UnevaluableSupport:
    """Incidents whose order cannot be evaluated; they have no sequence."""

    case_ids: tuple[str, ...]
    record_count: int
    omitted_activity_record_count: int

    def to_dict(self) -> dict[str, object]:
        return {"case_ids": list(self.case_ids), "case_count": len(self.case_ids), "record_count": self.record_count,
                "omitted_activity_record_count": self.omitted_activity_record_count}


@dataclass(frozen=True)
class Variants:
    case_count: int
    record_count: int
    omitted_activity_record_count: int
    sequence_evaluable_case_count: int
    variants: tuple[Variant, ...]
    unevaluable: UnevaluableSupport

    def to_dict(self) -> dict[str, object]:
        return {"activity_projection_policy": ACTIVITY_PROJECTION_POLICY, "case_count": self.case_count,
                "record_count": self.record_count, "omitted_activity_record_count": self.omitted_activity_record_count,
                "sequence_evaluable_case_count": self.sequence_evaluable_case_count,
                "variant_count": len(self.variants), "variants": [variant.to_dict() for variant in self.variants],
                "unevaluable": self.unevaluable.to_dict()}


def variants(prepared: PreparedData, population_ids: Iterable[str]) -> Variants | ImportRefusal:
    """The variants of a population, ranked by their number of incidents, then by their sequence."""
    try:
        population = case_ids(prepared, population_ids)
    except SelectionError as error:
        return ImportRefusal(error.code, str(error), "case_ids")
    grouped: dict[tuple[str, ...], list[str]] = {}
    records: dict[tuple[str, ...], int] = {}
    omitted: dict[tuple[str, ...], int] = {}
    unevaluable: list[str] = []
    unevaluable_records = unevaluable_omitted = all_records = all_omitted = 0
    for case_id in population:
        history = prepared.histories[case_id]
        sequence = tuple(record.activity for record in history if record.activity is not None)
        without_label = len(history) - len(sequence)
        all_records += len(history)
        all_omitted += without_label
        if not prepared.sequence_evaluable(case_id):
            unevaluable.append(case_id)
            unevaluable_records += len(history)
            unevaluable_omitted += without_label
            continue
        grouped.setdefault(sequence, []).append(case_id)
        records[sequence] = records.get(sequence, 0) + len(history)
        omitted[sequence] = omitted.get(sequence, 0) + without_label
    evaluable = len(population) - len(unevaluable)
    ranked = sorted(grouped, key=lambda sequence: (-len(grouped[sequence]), sequence))
    return Variants(
        case_count=len(population), record_count=all_records, omitted_activity_record_count=all_omitted,
        sequence_evaluable_case_count=evaluable,
        variants=tuple(Variant(sequence, tuple(grouped[sequence]), evaluable, records[sequence], omitted[sequence])
                       for sequence in ranked),
        unevaluable=UnevaluableSupport(tuple(unevaluable), unevaluable_records, unevaluable_omitted))
