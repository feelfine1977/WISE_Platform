"""Exact clock coordinates and adjacent gaps over complete declared RAW histories."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from datetime import datetime, timezone
from typing import Protocol

from .case_time import (
    CaseTimeError, TimedRecord, TimedPreparation, _available_summary, _clock_kind,
    _duration_hours, _microseconds, _native_durations, _native_times, _unavailable_summary,
)
from .time_formats import iso_local, iso_utc

DIAGNOSTICS_POLICY = "incident.time_diagnostics.full_raw_declared_order.v1"
WALL_LIMITATION = "recorded_wall_duration_may_differ_from_physical_elapsed"


class _DiagnosticRecord(TimedRecord, Protocol):
    utc_instant: str | None
    local_timestamp: str | None


class _DiagnosticPreparation(TimedPreparation, Protocol):
    histories: Mapping[str, Sequence[_DiagnosticRecord]]


def incident_time_diagnostics(prepared: _DiagnosticPreparation, case_id: str) -> dict[str, object]:
    """Preserve individually usable timestamps even when whole-case order is U.

    Clock/status/native-value validation precedes the U branch. A broken native
    value cannot become a successful unknown-order answer.
    """
    if case_id not in prepared.histories:
        raise CaseTimeError("unknown_case", "The case is outside this preparation's case dictionary.")
    records = prepared.histories[case_id]
    if not records or len({record.row_id for record in records}) != len(records):
        raise CaseTimeError("inconsistent_sequence", "A case must retain distinct complete raw records.")
    kind = _clock_kind(prepared)
    times = _native_times(records, kind)
    formatter = iso_local if kind == "wall_clock" else iso_utc
    epoch = datetime(1970, 1, 1, tzinfo=None if kind == "wall_clock" else timezone.utc)
    rows = []
    for record, moment in zip(records, times):
        key = None if moment is None else formatter(moment)
        # Stored timestamp spelling/status must agree with the native clock.
        expected_utc = key if kind == "utc_instant" else None
        expected_local = key if kind == "wall_clock" else None
        if record.utc_instant != expected_utc or record.local_timestamp != expected_local:
            raise CaseTimeError("inconsistent_time_kind", "The stored timestamp does not bind its native recorded value.")
        rows.append({"row_id": record.row_id, "timestamp_key": key,
                     "clock_microseconds": None if moment is None else str(_microseconds(moment - epoch)),
                     "offset_from_first_record_microseconds": None,
                     "gap_before": {"status": "unavailable", "reason": "order_unknown",
                                    "from_row_id": None, "microseconds": None, "hours": None}})
    known = prepared.sequence_evaluable(case_id)
    if type(known) is not bool:
        raise CaseTimeError("inconsistent_sequence", "Declared sequence evaluability must be a truth value.")
    unavailable = sum(moment is None for moment in times)
    span = maximum = equal_count = None
    if known:
        if unavailable:
            raise CaseTimeError("inconsistent_sequence", "An evaluable history contains an unavailable timestamp.")
        durations = _native_durations(times)
        summary = _available_summary(records, kind, times, durations)
        span = str(durations.span)
        maximum = None if durations.maximum is None else str(durations.maximum)
        equal_count = durations.maximum_equal_count
        for index, row in enumerate(rows):
            row["offset_from_first_record_microseconds"] = str(durations.offsets[index])
            if index == 0:
                row["gap_before"]["reason"] = "first_record"
            else:
                gap = durations.gaps[index - 1]
                row["gap_before"] = {"status": "available", "from_row_id": records[index - 1].row_id,
                                     "microseconds": str(gap), "hours": _duration_hours(gap)}
    else:
        summary = _unavailable_summary(unavailable)
    return {"policy_id": DIAGNOSTICS_POLICY, "timestamp_kind": kind,
            "duration_basis": "recorded_wall_clock" if kind == "wall_clock" else "elapsed_utc",
            "clock_limitation": WALL_LIMITATION if kind == "wall_clock" else None,
            "summary": summary, "observed_span_microseconds": span,
            "maximum_adjacent_raw_gap_microseconds": maximum,
            "maximum_gap_equal_count": equal_count, "records": rows}
