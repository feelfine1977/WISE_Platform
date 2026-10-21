"""Support of a score run and the records an endpoint rests on, over values supplied by the method library.

Nothing here scores. Every value, scope and reason is the method library's,
handed over per incident; ``score_support`` only counts the incidents in each
state the score contract names, and ``endpoint_candidates`` names the records
of an incident that carry an endpoint the library reported as an activity and
a time.

``affected`` means a value above zero, ``zero`` a value of exactly zero. A
measured interval is counted only where both endpoints are known: a missing
response stays a missing response even when the library's policy gives the
incident a value for it.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Iterable, Mapping, Sequence
from datetime import datetime
from typing import Protocol


class TimedRecord(Protocol):
    row_id: str
    activity: str | None
    time_value: datetime | None


def score_support(cases: Sequence[Mapping[str, object]]) -> dict[str, object]:
    """The number of incidents in each state of a run, from their supplied verdicts and measurements."""
    reasons = Counter(str(case["reason"]) for case in cases)
    values = [case["value"] for case in cases]
    measurements = [_measurement(case) for case in cases]
    statuses = Counter(str(measurement["status"]) for measurement in measurements)
    return {
        "scored_case_count": len(cases),
        "in_scope_case_count": sum(case["in_scope"] is True for case in cases),
        "out_of_scope_case_count": reasons["out_of_scope"],
        "scope_unknown_case_count": reasons["scope_unknown"],
        "numeric_value_case_count": sum(value is not None for value in values),
        "unavailable_value_case_count": sum(value is None for value in values),
        "affected_case_count": sum(_number(value) > 0 for value in values if value is not None),
        "zero_value_case_count": sum(_number(value) == 0 for value in values if value is not None),
        "observed_interval_case_count": statuses["observed"],
        "activation_known_case_count": sum(measurement["activation_known"] is True for measurement in measurements),
        "response_known_case_count": sum(measurement["response_known"] is True for measurement in measurements),
        "missing_activation_case_count": statuses["missing_activation"],
        "missing_response_case_count": statuses["missing_response"],
        "censored_case_count": reasons["censored"],
        "method_reason_counts": [{"reason": reason, "case_count": count} for reason, count in sorted(reasons.items())],
    }


def endpoint_candidates(history: Iterable[TimedRecord], activity: str, moment: datetime | None) -> list[str]:
    """Every record of an incident with this activity at this time, in the declared order.

    The library reports an endpoint as a time, not as a record: when several records of the
    activity share that time, each of them is a candidate. Without a time there is no candidate.
    """
    if moment is None:
        return []
    return [row.row_id for row in history if row.activity == activity and row.time_value is not None and row.time_value == moment]


def _measurement(case: Mapping[str, object]) -> Mapping[str, object]:
    measurement = case["measurement"]
    if not isinstance(measurement, Mapping):
        raise TypeError("A scored case carries its measurement as a mapping.")
    return measurement


def _number(value: object) -> float:
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise TypeError("A supplied value is a number or missing.")
    return float(value)
