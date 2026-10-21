"""The interval from a start activity to the first response at or after it, and its distribution over a fixed parent.

One registered policy, ``incident.interval.first_start_first_response_at_or_after.v1``:

- the start is the first record, in the declared order, whose activity is the start activity;
- the response is the first record, in the declared order, other than the start, whose activity is the response activity
  and whose usable time is at or after the start's time;
- the interval is the response's time minus the start's time, on the preparation's clock: elapsed time for UTC instants,
  a difference of recorded times for wall-clock times.

An incident whose order is not known (a record without a usable time) has no interval; neither has one without the start
or without a response at or after it. These are unavailable states with their reason, never zero and never passing.
Other pairings (the last start, the final response, cycles) are not offered.
"""

from __future__ import annotations

from bisect import bisect_right
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import timedelta

INTERVAL_POLICY = "incident.interval.first_start_first_response_at_or_after.v1"
REASONS = ("order_unknown", "missing_start", "missing_response")
OPERATORS = ("gt", "ge")
HOUR = timedelta(hours=1)


@dataclass(frozen=True)
class Interval:
    start_activity: str
    response_activity: str
    policy: str = INTERVAL_POLICY


@dataclass(frozen=True)
class Measured:
    """One incident's interval, or the reason it has none, with the rows of its endpoints."""

    duration: timedelta | None
    reason: str | None
    start_row_id: str | None
    response_row_id: str | None
    start_source_position: int | None = None
    response_source_position: int | None = None

    @property
    def hours(self) -> float | None:
        return None if self.duration is None else self.duration / HOUR


def measure(records: Sequence, sequence_evaluable: bool, interval: Interval) -> Measured:
    """The interval of one incident's records, already in declared order."""
    if not sequence_evaluable:
        return Measured(None, "order_unknown", None, None)
    start = next((record for record in records if record.activity == interval.start_activity), None)
    if start is None:
        return Measured(None, "missing_start", None, None)
    response = next((record for record in records if record is not start and record.activity == interval.response_activity
                     and record.time_value is not None and record.time_value >= start.time_value), None)
    if response is None:
        return Measured(None, "missing_response", start.row_id, None, start.source_position, None)
    return Measured(response.time_value - start.time_value, None, start.row_id, response.row_id, start.source_position, response.source_position)


def threshold_of(hours: float) -> timedelta:
    """A threshold in hours as an exact duration, to the microsecond the times are kept in."""
    return timedelta(microseconds=round(hours * 3_600_000_000))


def satisfies(measured: Measured, operator: str, hours: float) -> bool | None:
    """Whether the interval exceeds (gt) or reaches (ge) the threshold; None when there is no interval."""
    if measured.duration is None:
        return None
    limit = threshold_of(hours)
    return measured.duration > limit if operator == "gt" else measured.duration >= limit


def distribution(prepared, case_ids: Iterable[str], parent_ids: Iterable[str], interval: Interval, edges_hours: Sequence[float],
                 case_limit: int) -> dict[str, object]:
    """Bins fixed by the parent, the kept incidents in them, the unavailable by reason, and the kept incidents' intervals."""
    kept = tuple(case_ids)
    parent = tuple(parent_ids)
    measured: Mapping[str, Measured] = {case_id: measure(prepared.histories[case_id], prepared.sequence_evaluable(case_id), interval)
                                        for case_id in parent}

    def place(hours: float) -> int:
        return bisect_right(edges_hours, hours) - 1

    bins = [{"start_inclusive_hours": edges_hours[index], "end_exclusive_hours": edges_hours[index + 1] if index + 1 < len(edges_hours) else None,
             "parent_case_count": 0, "kept_case_count": 0} for index in range(len(edges_hours))]
    unavailable = {reason: {"reason": reason, "parent_case_count": 0, "kept_case_count": 0} for reason in REASONS}
    kept_set = set(kept)
    for case_id in parent:
        entry = measured[case_id]
        target = unavailable[entry.reason] if entry.reason is not None else bins[place(entry.hours)]
        target["parent_case_count"] += 1
        if case_id in kept_set:
            target["kept_case_count"] += 1
    listed = sorted(kept, key=lambda case_id: (measured[case_id].hours is None, -(measured[case_id].hours or 0), case_id))[:case_limit]
    return {
        "interval": {"policy": interval.policy, "start_activity": interval.start_activity, "response_activity": interval.response_activity},
        "unit": "hours",
        "edges_hours": list(edges_hours),
        "bins": bins,
        "measured": {"parent_case_count": sum(item["parent_case_count"] for item in bins), "kept_case_count": sum(item["kept_case_count"] for item in bins)},
        "unavailable": [unavailable[reason] for reason in REASONS],
        "cases": [{"case_id": case_id, "hours": measured[case_id].hours, "reason": measured[case_id].reason,
                   "start_row_id": measured[case_id].start_row_id, "response_row_id": measured[case_id].response_row_id,
                   "start_source_position": measured[case_id].start_source_position,
                   "response_source_position": measured[case_id].response_source_position} for case_id in listed],
        "cases_truncated": len(kept) > case_limit,
    }
