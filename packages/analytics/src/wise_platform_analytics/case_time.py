"""Recorded full-case time summaries shared by predicates and list projections.

The input is the immutable declared raw order. A record without an activity is
still part of every time measurement and every maximum-gap witness.
"""
from __future__ import annotations

from datetime import datetime, timedelta
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
        return {"status": "unavailable", "reason": "order_unknown", "unavailable_timestamp_record_count": unavailable,
                "first_recorded_timestamp": None, "last_recorded_timestamp": None,
                "first_recorded_activity": None, "last_recorded_activity": None,
                "observed_span_hours": None, "observed_span_unavailable_reason": "order_unknown",
                "maximum_adjacent_raw_gap_hours": None, "maximum_adjacent_raw_gap_unavailable_reason": "order_unknown",
                "maximum_gap_witness": None, "usable_gap_count": 0, "tied_timestamp_group_count": None}
    if unavailable:
        raise CaseTimeError("inconsistent_sequence", "An evaluable history contains an unavailable timestamp.")
    time_policy = prepared.policies["time"]["id"]
    if time_policy == "incident.time.wall_clock_as_recorded.v1":
        kind = "wall_clock"
        formatter = iso_local
    elif time_policy == "incident.time.explicit_format_timezone_utc.v1":
        kind = "utc_instant"
        formatter = iso_utc
    else:
        raise CaseTimeError("unsupported_policy", "The prepared clock policy is not supported by this time summary.")
    for record in records:
        if record.timestamp_kind != kind:
            raise CaseTimeError("inconsistent_time_kind", "The recorded times disagree with the preparation clock.")
        assert record.time_value is not None
        if (record.time_value.tzinfo is None) != (kind == "wall_clock"):
            raise CaseTimeError("inconsistent_time_kind", "The recorded timestamps do not have the declared clock kind.")
    first, last = records[0], records[-1]
    assert first.time_value is not None and last.time_value is not None
    span = _hours(last.time_value, first.time_value)
    maximum = None
    maximum_hours = None
    witness = None
    tied_groups = 0
    run_length = 1
    for left, right in zip(records, records[1:]):
        assert left.time_value is not None and right.time_value is not None
        gap = _duration(right.time_value, left.time_value)
        if gap == timedelta(0):
            run_length += 1
        else:
            tied_groups += run_length > 1
            run_length = 1
        if maximum is None or gap > maximum:
            # Select the first exact maximum before rounding descriptive hours.
            maximum = gap
            maximum_hours = _hours(right.time_value, left.time_value)
            witness = {"from_row_id": left.row_id, "to_row_id": right.row_id,
                       "from_activity": left.activity, "to_activity": right.activity,
                       "from_offset_hours": _hours(left.time_value, first.time_value),
                       "share_of_observed_span": maximum_hours / span if span > 0 else None,
                       "share_unavailable_reason": None if span > 0 else "zero_observed_span"}
    tied_groups += run_length > 1
    return {"status": "available", "timestamp_kind": kind,
            "first_recorded_timestamp": formatter(first.time_value), "last_recorded_timestamp": formatter(last.time_value),
            "first_recorded_activity": first.activity, "last_recorded_activity": last.activity,
            "observed_span_hours": span, "observed_span_unavailable_reason": None,
            "maximum_adjacent_raw_gap_hours": maximum_hours,
            "maximum_adjacent_raw_gap_unavailable_reason": "fewer_than_two_records" if maximum is None else None,
            "maximum_gap_witness": witness, "usable_gap_count": len(records) - 1,
            "tied_timestamp_group_count": int(tied_groups)}
