"""Native full-history clock coordinates and descriptive compatibility."""

from dataclasses import replace
from datetime import datetime, timedelta, timezone

import pytest

from wise_platform_analytics.case_time import CaseTimeError, case_time_summary
from test_incident_time_contracts import POSITIVES, native_preparation, preparation_for, read


@pytest.mark.parametrize("case", POSITIVES, ids=lambda c: c["name"])
def test_full_raw_diagnostics_match_independent_clock_and_gap_literals(case):
    from wise_platform_analytics.incident_time import incident_time_diagnostics

    body = read(case["expected_answer"])
    prepared = preparation_for(body)
    assert incident_time_diagnostics(prepared, body["case_id"]) == body["incident_time"]
    assert case_time_summary(prepared, body["case_id"]) == body["incident_time"]["summary"]


def with_history(prepared, records, known):
    class DeclaredHistory:
        histories = {"A": tuple(records)}
        policies = prepared.policies

        def sequence_evaluable(self, case_id):
            return known

    return DeclaredHistory()


@pytest.mark.parametrize("known", [False, True])
@pytest.mark.parametrize("change", [
    {"timestamp_kind": "unsupported"},
    {"timestamp_status": "unsupported"},
    {"timestamp_status": "usable", "time_value": None, "utc_instant": None},
    {"timestamp_status": "missing"},
    {"timestamp_status": "invalid"},
    {"time_value": datetime(2026, 10, 1)},
    {"time_value": "2026-10-01T00:00:00Z"},
    {"utc_instant": "2026-10-01T00:00:00+00:00"},
    {"local_timestamp": "2026-10-01T00:00:00"},
    {"time_value": datetime(1, 1, 1, tzinfo=timezone(timedelta(minutes=1)))},
    {"time_value": datetime(9999, 12, 31, 23, 59, 59, 999999, tzinfo=timezone(timedelta(minutes=-1)))},
])
def test_native_status_kind_value_and_normalized_range_are_validated_before_u(known, change):
    from wise_platform_analytics.incident_time import incident_time_diagnostics

    prepared = native_preparation("utc_instant")
    records = list(prepared.histories["A"])
    records[0] = replace(records[0], **change)
    broken = with_history(prepared, records, known)
    with pytest.raises(CaseTimeError):
        incident_time_diagnostics(broken, "A")


@pytest.mark.parametrize("known", [False, True])
def test_wall_clock_rejects_native_zones_even_under_unknown_order(known):
    from wise_platform_analytics.incident_time import incident_time_diagnostics

    prepared = native_preparation("wall_clock")
    row = prepared.histories["A"][0]
    broken = with_history(prepared, [replace(row, time_value=row.time_value.replace(tzinfo=timezone.utc))], known)
    with pytest.raises(CaseTimeError):
        incident_time_diagnostics(broken, "A")


@pytest.mark.parametrize("policy", [{"time": {"id": "unsupported"}}, {}, {"time": None}])
def test_diagnostics_check_supported_policy_even_when_legacy_summary_is_u(policy):
    from wise_platform_analytics.incident_time import incident_time_diagnostics

    prepared = native_preparation("utc_instant")
    broken = with_history(prepared, prepared.histories["A"], False)
    broken.policies = policy
    assert case_time_summary(broken, "A")["status"] == "unavailable"
    with pytest.raises(CaseTimeError):
        incident_time_diagnostics(broken, "A")


def test_inconsistent_declared_ascending_order_is_refused_without_reordering():
    from wise_platform_analytics.incident_time import incident_time_diagnostics

    prepared = native_preparation("utc_instant")
    broken = with_history(prepared, reversed(prepared.histories["A"]), True)
    before = broken.histories["A"]
    for compute in (incident_time_diagnostics, case_time_summary):
        with pytest.raises(CaseTimeError):
            compute(broken, "A")
    assert broken.histories["A"] == before


@pytest.mark.parametrize("kind", ["utc_instant", "wall_clock"])
def test_exact_decisions_stay_distinct_when_descriptive_hours_collide(kind):
    from wise_platform_analytics.incident_time import incident_time_diagnostics

    prepared = native_preparation(kind)
    unequal = incident_time_diagnostics(prepared, "HugeUnequal")
    gaps = unequal["records"]
    assert gaps[1]["gap_before"]["hours"] == gaps[2]["gap_before"]["hours"] == 35054496.0
    assert unequal["maximum_adjacent_raw_gap_microseconds"] == "126196185600000001"
    assert unequal["maximum_gap_equal_count"] == 1
    assert unequal["summary"]["maximum_gap_witness"]["from_row_id"] == prepared.histories["HugeUnequal"][1].row_id
    equal = incident_time_diagnostics(prepared, "HugeEqual")
    assert equal["maximum_gap_equal_count"] == 2
    assert equal["summary"]["maximum_gap_witness"]["from_row_id"] == prepared.histories["HugeEqual"][0].row_id
    assert unequal["summary"]["maximum_gap_witness"]["share_of_observed_span"] == .5
    micro = incident_time_diagnostics(prepared, "Micro2500")
    assert [r["clock_microseconds"] for r in micro["records"]] == ["16725225600000000", "16725225600000001"]
    assert micro["observed_span_microseconds"] == "1"
    bounds = incident_time_diagnostics(prepared, "Bounds")
    assert bounds["observed_span_microseconds"] == "315537897599999999"
    assert bounds["summary"]["observed_span_hours"] == 87649416.0


@pytest.mark.parametrize("known", [False, True])
def test_empty_duplicate_and_unknown_native_histories_are_invariant_failures(known):
    from wise_platform_analytics.incident_time import incident_time_diagnostics

    prepared = native_preparation("utc_instant")
    records = prepared.histories["A"]
    for broken_rows in ([], [records[0], records[0]]):
        with pytest.raises(CaseTimeError):
            incident_time_diagnostics(with_history(prepared, broken_rows, known), "A")
    with pytest.raises(CaseTimeError) as caught:
        incident_time_diagnostics(prepared, "absent")
    assert caught.value.code == "unknown_case"


@pytest.mark.parametrize("known", [False, True])
def test_usable_native_utc_offsets_normalize_before_exact_subtraction(known):
    from wise_platform_analytics.incident_time import incident_time_diagnostics

    prepared = native_preparation("utc_instant")
    rows = list(prepared.histories["A"])
    before = with_history(prepared, rows, known)
    expected = incident_time_diagnostics(before, "A")
    rows[0] = replace(rows[0], time_value=datetime(2026, 10, 1, 2, tzinfo=timezone(timedelta(hours=2))))
    normalized = with_history(prepared, rows, known)
    assert incident_time_diagnostics(normalized, "A") == expected
    assert normalized.histories["A"][0].time_value.utcoffset() == timedelta(hours=2)


@pytest.mark.parametrize("known", [0, 1, None, "false"])
def test_declared_sequence_evaluability_requires_an_actual_boolean(known):
    from wise_platform_analytics.incident_time import incident_time_diagnostics

    prepared = native_preparation("utc_instant")
    with pytest.raises(CaseTimeError):
        incident_time_diagnostics(with_history(prepared, prepared.histories["A"], known), "A")
