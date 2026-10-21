"""Pure complete-case predicates over one frozen prepared population."""
from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime
import math
import re
import hashlib
import json
from types import MappingProxyType
from typing import TYPE_CHECKING, Protocol, TypeAlias

if TYPE_CHECKING:
    from .mapping import ImportRefusal
    from .preparation import PreparedData


OPENING_CONTEXT_POLICY = "incident.context.first_record_in_declared_order.v1"
BOUNDARY_POLICY = "incident.boundary.raw_labeled_start_end.v1"
SAME_RECORD_POLICY = "incident.raw.same_record_all.v1"


class PreparedRecordLike(Protocol):
    row_id: str
    source_position: int
    source_sequence: int | None
    activity: str | None
    timestamp_kind: str
    timestamp_status: str
    utc_instant: str | None
    local_timestamp: str | None
    time_value: datetime | None
    context_columns: tuple[int, ...]
    original_cells: tuple[str, ...]

    def context_value(self, column_index: int) -> str | None: ...


class PreparedDataLike(Protocol):
    histories: Mapping[str, tuple[PreparedRecordLike, ...]]
    mapping: Mapping[str, object]
    policies: Mapping[str, object]
    columns: tuple[str, ...]

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


@dataclass(frozen=True)
class CaseIdIn:
    case_ids: tuple[str, ...]
    negate: bool = False

    def __post_init__(self) -> None:
        if isinstance(self.case_ids, (list, tuple)):
            object.__setattr__(self, "case_ids", tuple(self.case_ids))


@dataclass(frozen=True)
class CaseStartInWindow:
    timestamp_kind: str
    start_inclusive: str
    end_exclusive: str
    negate: bool = False


@dataclass(frozen=True)
class OpeningAttributeIn:
    column_index: int
    values: tuple[str | None, ...]
    negate: bool = False

    def __post_init__(self) -> None:
        if isinstance(self.values, (list, tuple)):
            object.__setattr__(self, "values", tuple(self.values))


@dataclass(frozen=True)
class RecordAttributeIn:
    column_index: int
    values: tuple[str | None, ...]
    negate: bool = False

    def __post_init__(self) -> None:
        if isinstance(self.values, (list, tuple)):
            object.__setattr__(self, "values", tuple(self.values))


@dataclass(frozen=True)
class RecordAttributeCondition:
    column_index: int
    values: tuple[str | None, ...]

    def __post_init__(self) -> None:
        if isinstance(self.values, (list, tuple)):
            object.__setattr__(self, "values", tuple(self.values))


@dataclass(frozen=True)
class RecordAttributesAll:
    conditions: tuple[RecordAttributeCondition, ...]
    negate: bool = False
    policy_id: str = SAME_RECORD_POLICY

    def __post_init__(self) -> None:
        if isinstance(self.conditions, (list, tuple)):
            object.__setattr__(self, "conditions", tuple(self.conditions))


@dataclass(frozen=True)
class ObservedSpanAtLeast:
    hours: float
    negate: bool = False


@dataclass(frozen=True)
class MaxRawGapAtLeast:
    hours: float
    negate: bool = False


Predicate: TypeAlias = (ContainsActivity | DirectlyFollows | OpeningAttributeEquals
                        | StartsWithActivity | EndsWithActivity | CaseIdIn | CaseStartInWindow
                        | OpeningAttributeIn | RecordAttributeIn | RecordAttributesAll | ObservedSpanAtLeast | MaxRawGapAtLeast)


class SelectionError(ValueError):
    """A malformed predicate or a case outside the prepared dictionary."""

    def __init__(self, code: str, message: str, field: str | None = None):
        super().__init__(message)
        self.code = code
        self.field = field


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
class RecordAttributeCaseEvidence:
    case_id: str
    matching_row_ids: tuple[str, ...]
    unevaluable_row_ids: tuple[str, ...]

    def to_dict(self) -> dict[str, object]:
        return {"case_id": self.case_id, "matching_row_ids": list(self.matching_row_ids),
                "unevaluable_row_ids": list(self.unevaluable_row_ids)}


@dataclass(frozen=True)
class RecordAttributeEvidence:
    cases: tuple[RecordAttributeCaseEvidence, ...]

    def to_dict(self) -> dict[str, object]:
        return {"policy_id": SAME_RECORD_POLICY, "cases": [case.to_dict() for case in self.cases]}


@dataclass(frozen=True)
class PredicateResult:
    predicate: Predicate
    kept: PopulationSupport
    removed: PopulationSupport
    unevaluable: PopulationSupport
    record_evidence: RecordAttributeEvidence | None = None

    def to_dict(self) -> dict[str, object]:
        result = {"predicate": predicate_descriptor(self.predicate), "kept": self.kept.to_dict(),
                  "removed": self.removed.to_dict(), "unevaluable": self.unevaluable.to_dict()}
        if self.record_evidence is not None:
            result["record_evidence"] = self.record_evidence.to_dict()
        return result


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
    if isinstance(predicate, CaseIdIn):
        _set_values(predicate.case_ids, identifiers=True)
        return {"kind": "case_id_in", "case_ids": list(predicate.case_ids), "negate": predicate.negate}
    if isinstance(predicate, CaseStartInWindow):
        _window_bounds(predicate)
        return {"kind": "case_start_in_window", "window": {
            "timestamp_kind": predicate.timestamp_kind, "start_inclusive": predicate.start_inclusive,
            "end_exclusive": predicate.end_exclusive}, "negate": predicate.negate}
    if isinstance(predicate, RecordAttributesAll):
        if predicate.policy_id != SAME_RECORD_POLICY:
            raise SelectionError("invalid_predicate", "The same-record policy is not supported.")
        if not isinstance(predicate.conditions, tuple) or not 1 <= len(predicate.conditions) <= 32:
            raise SelectionError("invalid_predicate", "Use between one and 32 same-record conditions.")
        conditions = []
        for condition in predicate.conditions:
            if not isinstance(condition, RecordAttributeCondition) or type(condition.column_index) is not int or condition.column_index < 0:
                raise SelectionError("invalid_predicate", "A raw attribute needs a nonnegative original column index.")
            _set_values(condition.values)
            conditions.append({"column_index": condition.column_index, "values": list(condition.values)})
        if len({condition.column_index for condition in predicate.conditions}) != len(predicate.conditions):
            raise SelectionError("invalid_predicate", "Declare each original column once; combine alternatives in its values.")
        return {"kind": "record_attributes_all", "policy_id": predicate.policy_id,
                "conditions": conditions, "negate": predicate.negate}
    if isinstance(predicate, (OpeningAttributeIn, RecordAttributeIn)):
        if type(predicate.column_index) is not int or predicate.column_index < 0:
            raise SelectionError("invalid_predicate", "Context needs a nonnegative column index.")
        _set_values(predicate.values)
        descriptor = {"kind": "opening_attribute_in" if isinstance(predicate, OpeningAttributeIn) else "record_attribute_in",
                      "column_index": predicate.column_index, "values": list(predicate.values), "negate": predicate.negate}
        if isinstance(predicate, OpeningAttributeIn):
            descriptor["anchor_policy"] = OPENING_CONTEXT_POLICY
        return descriptor
    if isinstance(predicate, (ObservedSpanAtLeast, MaxRawGapAtLeast)):
        _hours(predicate.hours)
        return {"kind": "observed_span_at_least" if isinstance(predicate, ObservedSpanAtLeast) else "max_raw_gap_at_least",
                "hours": predicate.hours, "negate": predicate.negate}
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


_UTC_WINDOW = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,6})?Z")
_WALL_WINDOW = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,6})?")


def _set_values(values: object, *, identifiers: bool = False) -> None:
    if not isinstance(values, (list, tuple)) or not values:
        raise SelectionError("invalid_predicate", "At least one exact value is required.")
    for value in values:
        if value is None and not identifiers:
            continue
        if not isinstance(value, str) or not value or (identifiers and len(value) > 256):
            raise SelectionError("invalid_predicate", "Values must be supported nonempty text, or explicit missing context.")
        try:
            value.encode("utf-8")
        except UnicodeEncodeError:
            raise SelectionError("invalid_predicate", "Values must contain valid Unicode scalar values.") from None
    if len(set(values)) != len(values):
        raise SelectionError("invalid_predicate", "Values must not repeat.")


def _hours(value: object) -> None:
    try:
        valid = type(value) in (int, float) and math.isfinite(value) and value >= 0
    except OverflowError:
        valid = False
    if not valid:
        raise SelectionError("invalid_predicate", "Hours must be a finite nonnegative number.")


def _window_bounds(predicate: CaseStartInWindow) -> tuple[datetime, datetime]:
    pattern = _UTC_WINDOW if predicate.timestamp_kind == "utc_instant" else _WALL_WINDOW
    if predicate.timestamp_kind not in ("utc_instant", "wall_clock"):
        raise SelectionError("invalid_predicate", "Use the declared UTC or recorded wall clock.")
    moments = []
    for value in (predicate.start_inclusive, predicate.end_exclusive):
        if not isinstance(value, str) or pattern.fullmatch(value) is None:
            raise SelectionError("invalid_predicate", "Window bounds must use canonical timestamps in their clock domain.")
        try:
            moments.append(datetime.fromisoformat(value.replace("Z", "+00:00")))
        except ValueError:
            raise SelectionError("invalid_predicate", "Window bounds must be valid calendar timestamps.") from None
    if moments[0] >= moments[1]:
        raise SelectionError("invalid_predicate", "A half-open window needs its start strictly before its end.")
    return moments[0], moments[1]


def semantic_predicate(descriptor: Mapping[str, object]) -> dict[str, object]:
    """Canonical meaning for hashing; the public descriptor retains the requested wire values."""
    result = dict(descriptor)
    kind = result["kind"]
    if kind == "case_id_in":
        result["case_ids"] = sorted(result["case_ids"])
    elif kind in ("opening_attribute_in", "record_attribute_in"):
        result["values"] = sorted(result["values"], key=lambda value: (value is not None, value or ""))
    elif kind == "record_attributes_all":
        result["conditions"] = sorted(({"column_index": condition["column_index"],
            "values": sorted(condition["values"], key=lambda value: (value is not None, value or ""))}
            for condition in result["conditions"]), key=lambda condition: condition["column_index"])
    elif kind in ("observed_span_at_least", "max_raw_gap_at_least"):
        hours = result["hours"]
        if isinstance(hours, float) and hours.is_integer():
            result["hours"] = int(hours)
    elif kind == "case_start_in_window":
        from .time_formats import iso_local, iso_utc
        window = result["window"]
        predicate = CaseStartInWindow(window["timestamp_kind"], window["start_inclusive"], window["end_exclusive"])
        start, end = _window_bounds(predicate)
        render = iso_utc if predicate.timestamp_kind == "utc_instant" else iso_local
        result["window"] = {"timestamp_kind": predicate.timestamp_kind,
                            "start_inclusive": render(start), "end_exclusive": render(end)}
    return result


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
    definitions = []
    for index, predicate in enumerate(predicates):
        try:
            definitions.append(predicate_descriptor(predicate))
        except SelectionError as error:
            error.field = error.field or f"predicates.{index}"
            raise
        if isinstance(predicate, (OpeningAttributeEquals, OpeningAttributeIn, RecordAttributeIn)):
            if predicate.column_index not in prepared.mapping["context_columns"]:
                raise SelectionError("unmapped_context_column", "Context must use a mapped context column.",
                                     None if isinstance(predicate, OpeningAttributeEquals) else f"predicates.{index}.column_index")
        if isinstance(predicate, RecordAttributesAll):
            for condition_index, condition in enumerate(predicate.conditions):
                if condition.column_index >= len(prepared.columns):
                    raise SelectionError("invalid_predicate", "The original column is outside the prepared source.",
                                         f"predicates.{index}.conditions.{condition_index}.column_index")
        if isinstance(predicate, CaseIdIn):
            requested = set(predicate.case_ids)
            if requested.difference(prepared.histories):
                raise SelectionError("unknown_case", "An exact ID is absent from the prepared dictionary.", f"predicates.{index}.case_ids")
            if requested.difference(parent):
                raise SelectionError("case_outside_parent", "An exact ID lies outside the frozen parent.", f"predicates.{index}.case_ids")
        if isinstance(predicate, CaseStartInWindow):
            clock = "wall_clock" if prepared.policies["time"]["id"] == "incident.time.wall_clock_as_recorded.v1" else "utc_instant"
            if predicate.timestamp_kind != clock:
                raise SelectionError("invalid_predicate", "The window must use the preparation's clock.", f"predicates.{index}.window.timestamp_kind")
    summaries = {}
    if any(isinstance(predicate, (ObservedSpanAtLeast, MaxRawGapAtLeast)) for predicate in predicates):
        from .case_time import case_time_summary
        summaries = {case: case_time_summary(prepared, case) for case in parent}
    evaluations = []
    evidence = []
    for predicate in predicates:
        if isinstance(predicate, RecordAttributesAll):
            measured = {case_id: _same_record(prepared.histories[case_id], predicate) for case_id in parent}
            evaluations.append({case_id: result[0] for case_id, result in measured.items()})
            evidence.append(RecordAttributeEvidence(tuple(RecordAttributeCaseEvidence(case_id, result[1], result[2])
                for case_id, result in measured.items() if result[1] or result[2])))
        elif isinstance(predicate, CaseIdIn):
            # The declared tuple stays unchanged in the receipt and identity.
            # Build one index for the frozen parent instead of scanning a large
            # ID tuple for every item (the before-GR flow contains 221,010).
            members = frozenset(predicate.case_ids)
            evaluations.append({case_id: (case_id not in members if predicate.negate else case_id in members)
                                for case_id in parent})
            evidence.append(None)
        else:
            evaluations.append({case_id: _evaluate(prepared, case_id, predicate, summaries) for case_id in parent})
            evidence.append(None)
    combined: dict[str, bool | None] = {}
    for case_id in parent:
        values = [evaluation[case_id] for evaluation in evaluations]
        combined[case_id] = False if False in values else None if None in values else True
    kept, removed, unevaluable = _partition(prepared, combined)
    individual = tuple(PredicateResult(predicate, *_partition(prepared, evaluation), record_evidence=rows)
                       for predicate, evaluation, rows in zip(predicates, evaluations, evidence))
    source_identity = prepared.identity_dict()
    meaning = {
        "kind": "complete_case_selection.v1", "source_id": source_identity["source_id"],
        "preparation_id": source_identity["preparation_id"],
        "representation_id": source_identity["representation_id"],
        "case_dictionary_id": source_identity["case_dictionary_id"], "parent_case_ids": parent,
        "predicates": sorted({_canonical(semantic_predicate(definition)) for definition in definitions}),
        "kept_case_ids": kept.case_ids, "removed_case_ids": removed.case_ids,
        "unevaluable_case_ids": unevaluable.case_ids,
    }
    identity = {**source_identity, "population_id": "population.v1:sha256:" + hashlib.sha256(_canonical(meaning).encode("utf-8")).hexdigest()}
    return SelectionResult(_support(prepared, parent), kept, removed, unevaluable,
                           individual, MappingProxyType(identity))


def _same_record(records: Sequence[PreparedRecordLike], predicate: RecordAttributesAll) -> tuple[bool | None, tuple[str, ...], tuple[str, ...]]:
    """OR values, AND cells, existential raw rows; F dominates row U, T dominates case U.

    Empty original cells are the explicitly selectable missing value; whitespace and
    literal Unknown are untouched text. A structurally absent cell is unknown, never
    fabricated as a blank. Chronology is irrelevant. Witness IDs follow source order.
    """
    matching, unknown = [], []
    for record in sorted(records, key=lambda record: record.source_position):
        values = []
        for condition in predicate.conditions:
            if condition.column_index >= len(record.original_cells):
                values.append(None)
            else:
                cell = record.original_cells[condition.column_index]
                values.append((None if cell == "" else cell) in condition.values)
        state = False if False in values else None if None in values else True
        if state is True:
            matching.append(record.row_id)
        elif state is None:
            unknown.append(record.row_id)
    value = True if matching else None if unknown else False
    return (None if value is None else not value if predicate.negate else value,
            tuple(matching), tuple(unknown))


def _evaluate(prepared: PreparedDataLike, case_id: str, predicate: Predicate, summaries: Mapping[str, Mapping] | None = None) -> bool | None:
    records = prepared.histories[case_id]
    if isinstance(predicate, CaseIdIn):
        value: bool | None = case_id in predicate.case_ids
    elif isinstance(predicate, RecordAttributeIn):
        value = any(record.context_value(predicate.column_index) in predicate.values for record in records)
    elif isinstance(predicate, ContainsActivity):
        value = any(record.activity == predicate.activity for record in records)
    elif not prepared.sequence_evaluable(case_id):
        value = None
    elif isinstance(predicate, CaseStartInWindow):
        start, end = _window_bounds(predicate)
        moment = records[0].time_value if records else None
        value = None if moment is None else start <= moment < end
    elif isinstance(predicate, (ObservedSpanAtLeast, MaxRawGapAtLeast)):
        assert summaries is not None
        key = "observed_span_hours" if isinstance(predicate, ObservedSpanAtLeast) else "maximum_adjacent_raw_gap_hours"
        hours = summaries[case_id][key]
        value = None if hours is None else hours >= predicate.hours
    elif isinstance(predicate, OpeningAttributeIn):
        opening = records[0].context_value(predicate.column_index) if records else None
        value = None if not records else opening in predicate.values
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
            opening = records[0].context_value(predicate.column_index)
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
