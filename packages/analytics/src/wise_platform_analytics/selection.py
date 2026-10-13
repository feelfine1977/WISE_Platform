"""Pure complete-case predicates over one frozen prepared population."""
from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime
import hashlib
import json
from types import MappingProxyType
from typing import TYPE_CHECKING, Protocol, TypeAlias

if TYPE_CHECKING:
    from .mapping import ImportRefusal
    from .preparation import PreparedData


OPENING_CONTEXT_POLICY = "incident.context.first_record_in_declared_order.v1"
BOUNDARY_POLICY = "incident.boundary.raw_labeled_start_end.v1"


class ContextRecord(Protocol):
    column_index: int
    value: str | None


class PreparedRecordLike(Protocol):
    row_id: str
    source_position: int
    source_sequence: int | None
    activity: str | None
    timestamp_kind: str
    time_value: datetime | None
    context: tuple[ContextRecord, ...]


class PreparedDataLike(Protocol):
    histories: Mapping[str, tuple[PreparedRecordLike, ...]]
    mapping: Mapping[str, object]
    policies: Mapping[str, object]

    def sequence_evaluable(self, case_id: str) -> bool: ...
    def identity_dict(self) -> dict[str, str]: ...


@dataclass(frozen=True)
class ContainsActivity:
    activity: str
    negate: bool = False


@dataclass(frozen=True)
class DirectlyFollows:
    source_activity: str
    target_activity: str
    negate: bool = False


@dataclass(frozen=True)
class OpeningAttributeEquals:
    column_index: int
    value: str | None
    negate: bool = False


@dataclass(frozen=True)
class StartsWithActivity:
    activity: str
    negate: bool = False


@dataclass(frozen=True)
class EndsWithActivity:
    activity: str
    negate: bool = False


Predicate: TypeAlias = (ContainsActivity | DirectlyFollows | OpeningAttributeEquals
                        | StartsWithActivity | EndsWithActivity)


class SelectionError(ValueError):
    """A malformed predicate or a case outside the prepared dictionary."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class PopulationSupport:
    case_ids: tuple[str, ...]
    record_count: int

    @property
    def case_count(self) -> int:
        return len(self.case_ids)

    def to_dict(self) -> dict[str, object]:
        return {"case_ids": list(self.case_ids), "case_count": self.case_count,
                "record_count": self.record_count}


@dataclass(frozen=True)
class PredicateResult:
    predicate: Predicate
    kept: PopulationSupport
    removed: PopulationSupport
    unevaluable: PopulationSupport

    def to_dict(self) -> dict[str, object]:
        return {"predicate": predicate_descriptor(self.predicate), "kept": self.kept.to_dict(),
                "removed": self.removed.to_dict(), "unevaluable": self.unevaluable.to_dict()}


@dataclass(frozen=True)
class SelectionResult:
    parent: PopulationSupport
    kept: PopulationSupport
    removed: PopulationSupport
    unevaluable: PopulationSupport
    predicate_results: tuple[PredicateResult, ...]
    identity: Mapping[str, str] = field(repr=False)

    def identity_dict(self) -> dict[str, str]:
        return dict(self.identity)

    @property
    def population_id(self) -> str:
        return self.identity["population_id"]

    def to_dict(self) -> dict[str, object]:
        return {"identity": self.identity_dict(), "parent": self.parent.to_dict(),
                "kept": self.kept.to_dict(), "removed": self.removed.to_dict(),
                "unevaluable": self.unevaluable.to_dict(),
                "predicate_results": [result.to_dict() for result in self.predicate_results]}


def predicate_descriptor(predicate: Predicate) -> dict[str, object]:
    """Canonical pure-data meaning; negation never converts unknown into true."""
    if type(getattr(predicate, "negate", None)) is not bool:
        raise SelectionError("invalid_predicate", "Predicate negation must be Boolean.")
    if isinstance(predicate, ContainsActivity):
        _label(predicate.activity)
        return {"kind": "contains_activity", "activity": predicate.activity, "negate": predicate.negate}
    if isinstance(predicate, DirectlyFollows):
        _label(predicate.source_activity)
        _label(predicate.target_activity)
        return {"kind": "directly_follows", "source_activity": predicate.source_activity,
                "target_activity": predicate.target_activity, "negate": predicate.negate}
    if isinstance(predicate, OpeningAttributeEquals):
        if type(predicate.column_index) is not int or predicate.column_index < 0:
            raise SelectionError("invalid_predicate", "Opening context needs a nonnegative column index.")
        if predicate.value is not None and not isinstance(predicate.value, str):
            raise SelectionError("invalid_predicate", "Opening context values are text or missing.")
        return {"kind": "opening_attribute_equals", "column_index": predicate.column_index,
                "value": predicate.value, "negate": predicate.negate, "anchor_policy": OPENING_CONTEXT_POLICY}
    if isinstance(predicate, (StartsWithActivity, EndsWithActivity)):
        _label(predicate.activity)
        kind = "starts_with_activity" if isinstance(predicate, StartsWithActivity) else "ends_with_activity"
        return {"kind": kind, "activity": predicate.activity, "negate": predicate.negate}
    raise SelectionError("invalid_predicate", "Unsupported descriptive predicate.")


def boundary_activities(records: Sequence[PreparedRecordLike]) -> tuple[str | None, str | None]:
    """The activities a history starts and ends at under ``BOUNDARY_POLICY``.

    Only the labels of the first and of the last raw record in the declared
    order count. A boundary record without label is no start and no end: no
    labelled record further inside takes its place. A history without records
    has neither. The map and the boundary predicates both read starts and ends
    here, and both only for incidents whose sequence is evaluable.
    """
    if not records:
        return None, None
    return records[0].activity, records[-1].activity


def case_ids(prepared: PreparedDataLike, requested: Iterable[str] | None = None) -> tuple[str, ...]:
    """Validate dictionary membership and freeze a deterministic whole-case parent."""
    ids = tuple(prepared.histories) if requested is None else tuple(requested)
    if any(not isinstance(case_id, str) for case_id in ids):
        raise SelectionError("invalid_parent", "Population case IDs must be strings.")
    if len(set(ids)) != len(ids):
        raise SelectionError("invalid_parent", "Population case IDs must not repeat.")
    unknown = set(ids).difference(prepared.histories)
    if unknown:
        raise SelectionError("unknown_case", "Population contains a case outside this dictionary.")
    return tuple(sorted(ids))


def select_cases(prepared: PreparedDataLike, predicates: Sequence[Predicate] = (),
                 parent_ids: Iterable[str] | None = None) -> SelectionResult:
    """AND predicates with false dominating unknown; retain complete histories.

    Each chip's removal is measured independently against the frozen parent.
    Those overlapping removals must not be added to form the conjunction count.
    """
    parent = case_ids(prepared, parent_ids)
    definitions = [predicate_descriptor(predicate) for predicate in predicates]
    for predicate in predicates:
        if isinstance(predicate, OpeningAttributeEquals) and predicate.column_index not in prepared.mapping["context_columns"]:
            raise SelectionError("unmapped_context_column", "Opening context must use a mapped context column.")
    evaluations = [dict((case_id, _evaluate(prepared, case_id, predicate)) for case_id in parent)
                   for predicate in predicates]
    combined: dict[str, bool | None] = {}
    for case_id in parent:
        values = [evaluation[case_id] for evaluation in evaluations]
        combined[case_id] = False if False in values else None if None in values else True
    kept, removed, unevaluable = _partition(prepared, combined)
    individual = tuple(PredicateResult(predicate, *_partition(prepared, evaluation))
                       for predicate, evaluation in zip(predicates, evaluations))
    source_identity = prepared.identity_dict()
    meaning = {
        "kind": "complete_case_selection.v1", "source_id": source_identity["source_id"],
        "preparation_id": source_identity["preparation_id"],
        "representation_id": source_identity["representation_id"],
        "case_dictionary_id": source_identity["case_dictionary_id"], "parent_case_ids": parent,
        "predicates": sorted({_canonical(definition) for definition in definitions}),
        "kept_case_ids": kept.case_ids, "removed_case_ids": removed.case_ids,
        "unevaluable_case_ids": unevaluable.case_ids,
    }
    identity = {**source_identity, "population_id": "population.v1:sha256:" + hashlib.sha256(_canonical(meaning).encode("utf-8")).hexdigest()}
    return SelectionResult(_support(prepared, parent), kept, removed, unevaluable,
                           individual, MappingProxyType(identity))


def _evaluate(prepared: PreparedDataLike, case_id: str, predicate: Predicate) -> bool | None:
    records = prepared.histories[case_id]
    if isinstance(predicate, ContainsActivity):
        value: bool | None = any(record.activity == predicate.activity for record in records)
    elif not prepared.sequence_evaluable(case_id):
        value = None
    elif isinstance(predicate, DirectlyFollows):
        mapped = [record.activity for record in records if record.activity is not None]
        value = any(left == predicate.source_activity and right == predicate.target_activity
                    for left, right in zip(mapped, mapped[1:]))
    elif isinstance(predicate, (StartsWithActivity, EndsWithActivity)):
        start, end = boundary_activities(records)
        value = (start if isinstance(predicate, StartsWithActivity) else end) == predicate.activity
    else:
        assert isinstance(predicate, OpeningAttributeEquals)
        if not records:
            value = None
        else:
            opening = next((context.value for context in records[0].context
                            if context.column_index == predicate.column_index), None)
            value = opening == predicate.value
    return None if value is None else not value if predicate.negate else value


def _partition(prepared: PreparedDataLike, values: Mapping[str, bool | None]) -> tuple[PopulationSupport, PopulationSupport, PopulationSupport]:
    return tuple(_support(prepared, (case_id for case_id, value in values.items() if value is state))
                 for state in (True, False, None))


def _support(prepared: PreparedDataLike, ids: Iterable[str]) -> PopulationSupport:
    ordered = tuple(sorted(ids))
    return PopulationSupport(ordered, sum(len(prepared.histories[case_id]) for case_id in ordered))


def _canonical(value: object) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def _label(value: str) -> None:
    if not isinstance(value, str) or not value:
        raise SelectionError("invalid_predicate", "Activity labels must be nonempty strings.")


def open_selected_case(prepared: PreparedData, selection: SelectionResult,
                       identity: Mapping[str, object], case_id: str) -> dict[str, object] | ImportRefusal:
    """Validate a named selection before delegating complete raw-case retrieval.

    The application must resolve the selection from its stored recipe/registry;
    an incoming identity is never repaired or substituted before validation.
    """
    from .mapping import ImportRefusal
    from .prepared_operations import open_prepared_case

    if not isinstance(selection, SelectionResult):
        return ImportRefusal("identity_mismatch", "A named selection is required for this evidence.", "identity")
    expected = selection.identity_dict()
    base = prepared.identity_dict()
    if set(expected) != set(base) or any(expected[key] != value for key, value in base.items() if key != "population_id"):
        return ImportRefusal("identity_mismatch", "The selection belongs to another prepared representation.", "identity")
    if not isinstance(identity, Mapping) or dict(identity) != expected:
        return ImportRefusal("identity_mismatch", "The supplied identity does not match this named selection.", "identity")
    if not isinstance(case_id, str) or case_id not in prepared.histories:
        return ImportRefusal("case_not_found", "This incident is absent from the prepared case dictionary.", "case_id")
    if case_id not in selection.kept.case_ids:
        return ImportRefusal("case_not_found", "This incident is not in the selected kept population.", "case_id")
    result = open_prepared_case(prepared, base, case_id)
    if isinstance(result, ImportRefusal):
        return result
    return {**result, "identity": expected}
