"""Recorded full-case time summaries shared by predicates and list projections.

The input is the immutable declared raw order. A record without an activity is
still part of every time measurement and every maximum-gap witness.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import math
from typing import Protocol
from collections.abc import Mapping, Sequence

from .time_formats import iso_local, iso_utc

SUMMARY_POLICY = "incident.case_summary.full_raw_declared_order.v1"


class CaseTimeError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


class TimedRecord(Protocol):
    row_id: str
    activity: str | None
    timestamp_kind: str
    timestamp_status: str
    time_value: datetime | None


class TimedPreparation(Protocol):
    histories: Mapping[str, Sequence[TimedRecord]]
    policies: Mapping[str, object]

    def sequence_evaluable(self, case_id: str) -> bool: ...


def _duration(later: datetime, earlier: datetime) -> timedelta:
    value = later - earlier
    if value < timedelta(0):
        raise CaseTimeError("inconsistent_sequence", "The recorded history is not in its declared ascending time order.")
    return value


def _hours(later: datetime, earlier: datetime) -> float:
    value = _duration(later, earlier).total_seconds() / 3600
    if not math.isfinite(value):
        raise CaseTimeError("inconsistent_sequence", "The recorded history is not in its declared ascending time order.")
    return value


def _microseconds(value: timedelta) -> int:
    """Keep native duration decisions exact across the full datetime range."""
    return (value.days * 86400 + value.seconds) * 1_000_000 + value.microseconds


def _duration_hours(microseconds: int) -> float:
    # Preserve the established descriptive conversion, including its rounding.
    return timedelta(microseconds=microseconds).total_seconds() / 3600


@dataclass(frozen=True)
class NativeDurations:
    span: int
    offsets: tuple[int, ...]
    gaps: tuple[int, ...]
    maximum: int | None
    maximum_index: int | None
    maximum_equal_count: int | None
    tied_groups: int


def _native_durations(times: Sequence[datetime]) -> NativeDurations:
    offsets = tuple(_microseconds(_duration(moment, times[0])) for moment in times)
    gaps = tuple(_microseconds(_duration(right, left)) for left, right in zip(times, times[1:]))
    maximum = max(gaps) if gaps else None
    tied_groups = 0
    in_tie = False
    for gap in gaps:
        if gap == 0 and not in_tie:
            tied_groups += 1
        in_tie = gap == 0
    return NativeDurations(offsets[-1], offsets, gaps, maximum,
                           gaps.index(maximum) if maximum is not None else None,
                           gaps.count(maximum) if maximum is not None else None, tied_groups)


def _clock_kind(prepared: TimedPreparation) -> str:
    time = prepared.policies.get("time")
    time_policy = time.get("id") if isinstance(time, Mapping) else None
    if time_policy == "incident.time.wall_clock_as_recorded.v1":
        return "wall_clock"
    if time_policy == "incident.time.explicit_format_timezone_utc.v1":
        return "utc_instant"
    raise CaseTimeError("unsupported_policy", "The prepared clock policy is not supported by this time summary.")


def _native_times(records: Sequence[TimedRecord], kind: str) -> tuple[datetime | None, ...]:
    """Validate every declared status and normalize representable UTC values."""
    times = []
    for record in records:
        if record.timestamp_kind != kind:
            raise CaseTimeError("inconsistent_time_kind", "The recorded times disagree with the preparation clock.")
        value = record.time_value
        if record.timestamp_status in ("missing", "invalid"):
            if value is not None:
                raise CaseTimeError("inconsistent_sequence", "An unavailable timestamp has a native value.")
            times.append(None)
            continue
        if record.timestamp_status != "usable" or not isinstance(value, datetime):
            raise CaseTimeError("inconsistent_sequence", "The recorded timestamp status and native value disagree.")
        if (value.tzinfo is None) != (kind == "wall_clock"):
            raise CaseTimeError("inconsistent_time_kind", "The recorded timestamps do not have the declared clock kind.")
        try:
            if kind == "utc_instant":
                if value.utcoffset() is None:
                    raise ValueError("A UTC timestamp needs an offset.")
                value = value.astimezone(timezone.utc)
        except (ValueError, OverflowError):
            raise CaseTimeError("inconsistent_time_kind", "The native timestamp is outside the supported clock range.") from None
        times.append(value)
    return tuple(times)


def _unavailable_summary(unavailable: int) -> dict[str, object]:
    return {"status": "unavailable", "reason": "order_unknown", "unavailable_timestamp_record_count": unavailable,
            "first_recorded_timestamp": None, "last_recorded_timestamp": None,
            "first_recorded_activity": None, "last_recorded_activity": None,
            "observed_span_hours": None, "observed_span_unavailable_reason": "order_unknown",
            "maximum_adjacent_raw_gap_hours": None, "maximum_adjacent_raw_gap_unavailable_reason": "order_unknown",
            "maximum_gap_witness": None, "usable_gap_count": 0, "tied_timestamp_group_count": None}


def _available_summary(records: Sequence[TimedRecord], kind: str, times: Sequence[datetime],
                       durations: NativeDurations) -> dict[str, object]:
    formatter = iso_local if kind == "wall_clock" else iso_utc
    span = _duration_hours(durations.span)
    maximum_hours = None if durations.maximum is None else _duration_hours(durations.maximum)
    witness = None
    if durations.maximum_index is not None:
        index = durations.maximum_index
        left, right = records[index:index + 2]
        witness = {"from_row_id": left.row_id, "to_row_id": right.row_id,
                   "from_activity": left.activity, "to_activity": right.activity,
                   "from_offset_hours": _duration_hours(durations.offsets[index]),
                   "share_of_observed_span": maximum_hours / span if span > 0 else None,
                   "share_unavailable_reason": None if span > 0 else "zero_observed_span"}
    return {"status": "available", "timestamp_kind": kind,
            "first_recorded_timestamp": formatter(times[0]), "last_recorded_timestamp": formatter(times[-1]),
            "first_recorded_activity": records[0].activity, "last_recorded_activity": records[-1].activity,
            "observed_span_hours": span, "observed_span_unavailable_reason": None,
            "maximum_adjacent_raw_gap_hours": maximum_hours,
            "maximum_adjacent_raw_gap_unavailable_reason": "fewer_than_two_records" if durations.maximum is None else None,
            "maximum_gap_witness": witness, "usable_gap_count": len(records) - 1,
            "tied_timestamp_group_count": durations.tied_groups}


def case_time_summary(prepared: TimedPreparation, case_id: str) -> dict[str, object]:
    """Summarize raw records without reordering, clipping or inferring completion.

    Unknown declared order is unavailable even when every recorded time is
    individually usable. Its timestamp-unavailability count is therefore zero
    when all timestamps are available, rather than an invented positive count.
    """
    if case_id not in prepared.histories:
        raise CaseTimeError("unknown_case", "The incident is outside this preparation's case dictionary.")
    records = prepared.histories[case_id]
    if not records:
        raise CaseTimeError("inconsistent_sequence", "An identified incident must retain its raw records.")
    unavailable = sum(record.time_value is None or record.timestamp_status != "usable" for record in records)
    if not prepared.sequence_evaluable(case_id):
        return _unavailable_summary(unavailable)
    if unavailable:
        raise CaseTimeError("inconsistent_sequence", "An evaluable history contains an unavailable timestamp.")
    kind = _clock_kind(prepared)
    times = _native_times(records, kind)
    assert all(moment is not None for moment in times)
    return _available_summary(records, kind, times, _native_durations(times))
