"""Independent integer/calendar controls for range decisions, never float summaries."""
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import pytest
from wise_platform_analytics.case_time import CaseTimeError
from wise_platform_analytics.selection import (
    RawRecordCountBetween, ObservedSpanBetween, MaxRawGapBetween, DirectlyFollowsLagBetween,
    SelectionError, select_cases,
)


@dataclass
class Prepared:
    histories: dict
    kind: str = "utc_instant"
    unknown: tuple = ()
    mapping = {"context_columns": []}

    @property
    def policies(self):
        return {"time": {"id": "incident.time.wall_clock_as_recorded.v1" if self.kind == "wall_clock" else "incident.time.explicit_format_timezone_utc.v1"}}

    def sequence_evaluable(self, case):
        return case not in self.unknown

    def identity_dict(self):
        return {key: key for key in ("source_id", "preparation_id", "representation_id", "case_dictionary_id", "population_id")}


def history(times, kind="utc_instant", activities=None):
    return tuple(SimpleNamespace(row_id=f"row-{i}", activity=(activities[i] if activities else "Open" if i % 2 == 0 else "Close"), timestamp_status="missing" if t is None else "usable", time_value=t, timestamp_kind=kind) for i, t in enumerate(times))


def ids(prepared, predicate):
    answer = select_cases(prepared, [predicate])
    return answer.kept.case_ids, answer.removed.case_ids, answer.unevaluable.case_ids


@pytest.mark.parametrize("kind", ["utc_instant", "wall_clock"])
@pytest.mark.parametrize("constructor", [ObservedSpanBetween, MaxRawGapBetween])
def test_huge_unequal_native_durations_with_identical_display_hours_do_not_tie(kind, constructor):
    zone = timezone.utc if kind == "utc_instant" else None
    first = datetime(1, 1, 1, tzinfo=zone)
    last = datetime(4000, 1, 1, tzinfo=zone)
    assert (last - first).total_seconds() / 3600 == (last + timedelta(microseconds=1) - first).total_seconds() / 3600
    p = Prepared({"A_exact": history([first, last], kind), "B_plus_us": history([first, last + timedelta(microseconds=1)], kind)}, kind)
    assert ids(p, constructor(35054496, 35054496)) == (("A_exact",), ("B_plus_us",), ())
    assert ids(p, constructor(35054496, None)) == (("A_exact", "B_plus_us"), (), ())
    assert ids(p, constructor(35054496, 35054496, True)) == (("B_plus_us",), ("A_exact",), ())


@pytest.mark.parametrize("kind", ["utc_instant", "wall_clock"])
def test_zero_singleton_unknown_and_one_microsecond_after_year2500(kind):
    t = datetime(2500, 1, 1, tzinfo=timezone.utc if kind == "utc_instant" else None)
    p = Prepared({"micro": history([t, t + timedelta(microseconds=1)], kind), "single": history([t], kind), "tied": history([t, t], kind), "U": history([t, None], kind)}, kind, ("U",))
    assert ids(p, ObservedSpanBetween(0, 0)) == (("single", "tied"), ("micro",), ("U",))
    assert ids(p, MaxRawGapBetween(0, 0)) == (("tied",), ("micro",), ("U", "single"))
    # Decimal 1e-9hours is 3.6microseconds, preserving a one-microsecond gap as positive.
    assert ids(p, MaxRawGapBetween(0, 1e-9)) == (("micro", "tied"), (), ("U", "single"))
    assert ids(p, RawRecordCountBetween(2, 2)) == (("U", "micro", "tied"), ("single",), ())


def test_known_utc_passage_normalizes_same_zoneinfo_before_subtraction():
    berlin = ZoneInfo("Europe/Berlin")
    first = datetime(2026, 3, 29, 1, 30, tzinfo=berlin)
    last = datetime(2026, 3, 29, 3, 30, tzinfo=berlin)
    assert last - first == timedelta(hours=2)  # Python's same-ZoneInfo subtraction is wall time.
    utc = Prepared({"DST": history([first, last])})
    assert ids(utc, DirectlyFollowsLagBetween("Open", "Close", 1, 1)) == (("DST",), (), ())
    assert ids(utc, ObservedSpanBetween(1, 1)) == (("DST",), (), ())
    wall = Prepared({"DST": history([first.replace(tzinfo=None), last.replace(tzinfo=None)], "wall_clock")}, "wall_clock")
    assert ids(wall, DirectlyFollowsLagBetween("Open", "Close", 2, 2, "every")) == (("DST",), (), ())


@pytest.mark.parametrize("predicate", [
    RawRecordCountBetween(True, 4), RawRecordCountBetween(1.5, None), RawRecordCountBetween(0, 9007199254740992),
    ObservedSpanBetween(2, 1), MaxRawGapBetween(float("nan"), None), ObservedSpanBetween(0, float("inf")),
    DirectlyFollowsLagBetween("Open", "Close", 0, 1, "all"), DirectlyFollowsLagBetween("", "Close", 0, 1),
])
def test_pure_predicates_reject_invalid_parameters_even_on_an_empty_parent(predicate):
    with pytest.raises(SelectionError) as failure:
        select_cases(Prepared({}), [predicate])
    assert failure.value.code == "invalid_predicate"


@pytest.mark.parametrize("unknown", [False, True])
def test_new_time_ranges_do_not_trust_malformed_native_values_even_under_unknown_order(unknown):
    t = datetime(2026, 1, 1, tzinfo=timezone.utc)
    records = list(history([t, t]))
    records[1].timestamp_kind = "wall_clock"
    p = Prepared({"bad": tuple(records)}, unknown=("bad",) if unknown else ())
    with pytest.raises(CaseTimeError, match="clock"):
        select_cases(p, [DirectlyFollowsLagBetween("Open", "Close", 0, None)])
