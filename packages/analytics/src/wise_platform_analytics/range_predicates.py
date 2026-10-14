"""Inclusive whole-incident ranges, evaluated on exact native microseconds.

Hours on the wire are decimal numbers. Decisions compare their exact decimal
rational values to integer microseconds; displayed float-hour summaries never
choose membership. Path ranges use the same adjacent mapped records (including
bridges over unlabelled raw rows) as the supplied graph.
"""
from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from fractions import Fraction
import math

from .case_time import CaseTimeError, _clock_kind, _microseconds, _native_durations, _native_times


@dataclass(frozen=True)
class RawRecordCountBetween:
    minimum_records: int
    maximum_records: int | None
    negate: bool = False


@dataclass(frozen=True)
class ObservedSpanBetween:
    minimum_hours: float
    maximum_hours: float | None
    negate: bool = False


@dataclass(frozen=True)
class MaxRawGapBetween:
    minimum_hours: float
    maximum_hours: float | None
    negate: bool = False


@dataclass(frozen=True)
class DirectlyFollowsLagBetween:
    source_activity: str
    target_activity: str
    minimum_hours: float
    maximum_hours: float | None
    quantifier: str = "any"
    negate: bool = False


RANGE_TYPES = (RawRecordCountBetween, ObservedSpanBetween, MaxRawGapBetween, DirectlyFollowsLagBetween)
TIME_RANGE_TYPES = (ObservedSpanBetween, MaxRawGapBetween, DirectlyFollowsLagBetween)


def range_descriptor(predicate) -> dict:
    """Validate the closed range's values before any population is evaluated."""
    records = isinstance(predicate, RawRecordCountBetween)
    lower = predicate.minimum_records if records else predicate.minimum_hours
    upper = predicate.maximum_records if records else predicate.maximum_hours
    for is_upper, value in ((False, lower), (True, upper)):
        if is_upper and value is None:
            continue
        try:
            valid = (type(value) is int and 0 <= value <= 9007199254740991) if records else (type(value) in (int, float) and math.isfinite(value) and value >= 0)
        except OverflowError:
            valid = False
        if not valid:
            raise ValueError("Range bounds must be nonnegative finite hours or supported whole raw-record counts; only the upper bound may be null.")
    if lower is None or (upper is not None and lower > upper):
        raise ValueError("The inclusive lower bound must not exceed the upper bound.")
    if records:
        return {"kind": "raw_record_count_between", "minimum_records": lower, "maximum_records": upper, "negate": predicate.negate}
    kind = "observed_span_between" if isinstance(predicate, ObservedSpanBetween) else "max_raw_gap_between" if isinstance(predicate, MaxRawGapBetween) else "directly_follows_lag_between"
    result = {"kind": kind, "minimum_hours": lower, "maximum_hours": upper, "negate": predicate.negate}
    if isinstance(predicate, DirectlyFollowsLagBetween):
        for label in (predicate.source_activity, predicate.target_activity):
            if not isinstance(label, str) or not label:
                raise ValueError("A path range needs two nonempty activity labels.")
            try:
                label.encode("utf-8")
            except UnicodeEncodeError:
                raise ValueError("Activity labels must contain valid Unicode scalar values.") from None
        if predicate.quantifier not in ("any", "every"):
            raise ValueError("A path range must choose any or every passage.")
        result.update(source_activity=predicate.source_activity, target_activity=predicate.target_activity, quantifier=predicate.quantifier)
    return result


@dataclass(frozen=True)
class ExactCaseRanges:
    span: int
    maximum_gap: int | None
    passages: Mapping[tuple[str, str], tuple[int, ...]]


def exact_range_measurements(prepared, parent) -> dict[str, ExactCaseRanges | None]:
    """Read each whole parent history once, normalizing UTC before subtraction."""
    kind = _clock_kind(prepared)
    result = {}
    for case_id in parent:
        records = prepared.histories[case_id]
        if not records:
            raise CaseTimeError("inconsistent_sequence", "An incident must retain its raw records.")
        times = _native_times(records, kind)
        if not prepared.sequence_evaluable(case_id):
            result[case_id] = None
            continue
        if any(value is None for value in times):
            raise CaseTimeError("inconsistent_sequence", "An evaluable history contains an unavailable timestamp.")
        durations = _native_durations(times)
        mapped = [(record.activity, time) for record, time in zip(records, times) if record.activity is not None]
        passages = {}
        for (source, first), (target, last) in zip(mapped, mapped[1:]):
            passages.setdefault((source, target), []).append(_microseconds(last - first))
        result[case_id] = ExactCaseRanges(durations.span, durations.maximum, {pair: tuple(values) for pair, values in passages.items()})
    return result


def _inside(value: int, lower, upper, *, hours: bool) -> bool:
    scale = 3_600_000_000 if hours else 1
    minimum = Fraction(str(lower)) * scale
    maximum = None if upper is None else Fraction(str(upper)) * scale
    return minimum <= value and (maximum is None or value <= maximum)


def evaluate_range(predicate, raw_count: int, exact: ExactCaseRanges | None) -> bool | None:
    if isinstance(predicate, RawRecordCountBetween):
        value = _inside(raw_count, predicate.minimum_records, predicate.maximum_records, hours=False)
    elif exact is None:
        return None
    elif isinstance(predicate, DirectlyFollowsLagBetween):
        passages = exact.passages.get((predicate.source_activity, predicate.target_activity), ())
        # Both quantifiers require an actual passage; every is never vacuously true.
        if not passages:
            value = False
        else:
            matches = (_inside(lag, predicate.minimum_hours, predicate.maximum_hours, hours=True) for lag in passages)
            value = any(matches) if predicate.quantifier == "any" else all(matches)
    else:
        duration = exact.span if isinstance(predicate, ObservedSpanBetween) else exact.maximum_gap
        if duration is None:
            return None
        value = _inside(duration, predicate.minimum_hours, predicate.maximum_hours, hours=True)
    return not value if predicate.negate else value
