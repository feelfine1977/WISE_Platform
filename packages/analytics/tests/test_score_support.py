"""Counting supplied verdicts by state, and naming the records an endpoint time rests on."""

from datetime import datetime, timedelta, timezone

from literal_logs import prepared_from

from wise_platform_analytics.score_support import endpoint_candidates, score_support


def verdict(case_id, value, reason, status, in_scope=True):
    return {
        "case_id": case_id,
        "value": value,
        "in_scope": in_scope,
        "reason": reason,
        "measurement": {
            "status": status,
            "activation_known": status != "missing_activation",
            "response_known": status == "observed",
        },
    }


def test_each_state_is_counted_from_the_supplied_values_and_measurements():
    # Six incidents, values as a library would supply them:
    #   A met (0), B partly (0.5), C not met (1), D missing response but valued 1 by its policy,
    #   E without start (no value), F out of scope (no value).
    cases = [
        verdict("A", 0.0, "evaluated", "observed"),
        verdict("B", 0.5, "evaluated", "observed"),
        verdict("C", 1.0, "evaluated", "observed"),
        verdict("D", 1.0, "censored", "missing_response"),
        verdict("E", None, "missing_activation", "missing_activation"),
        verdict("F", None, "out_of_scope", "observed", in_scope=False),
    ]
    support = score_support(cases)
    assert support == {
        "scored_case_count": 6,
        "in_scope_case_count": 5,
        "out_of_scope_case_count": 1,
        "scope_unknown_case_count": 0,
        "numeric_value_case_count": 4,
        "unavailable_value_case_count": 2,
        "affected_case_count": 3,  # B, C, D
        "zero_value_case_count": 1,  # A
        "observed_interval_case_count": 4,  # A, B, C, F
        "activation_known_case_count": 5,  # all but E
        "response_known_case_count": 4,
        "missing_activation_case_count": 1,
        "missing_response_case_count": 1,
        "censored_case_count": 1,
        "method_reason_counts": [
            {"reason": "censored", "case_count": 1},
            {"reason": "evaluated", "case_count": 3},
            {"reason": "missing_activation", "case_count": 1},
            {"reason": "out_of_scope", "case_count": 1},
        ],
    }


def test_an_empty_run_counts_nothing():
    support = score_support([])
    assert support["scored_case_count"] == 0 and support["method_reason_counts"] == []


def test_every_record_of_the_activity_at_the_endpoint_time_is_a_candidate_in_declared_order():
    prepared = prepared_from([
        "case;activity;time;desk;team",
        "T;Resolved;2026-10-01T00:00:00Z;a;x",
        "T;Opened;2026-10-01T00:00:00Z;a;x",
        "T;Resolved;2026-10-01T00:00:00Z;a;x",
        "T;Resolved;2026-10-01T02:00:00+02:00;a;x",
        "T;Resolved;2026-10-02T00:00:00Z;a;x",
    ])
    rows = prepared.histories["T"]
    midnight = datetime(2026, 10, 1, tzinfo=timezone.utc)
    # The fourth record is written with another offset and is the same instant.
    assert endpoint_candidates(rows, "Resolved", midnight) == [rows[0].row_id, rows[2].row_id, rows[3].row_id]
    assert endpoint_candidates(rows, "Opened", midnight) == [rows[1].row_id]
    assert endpoint_candidates(rows, "Resolved", midnight + timedelta(days=1)) == [rows[4].row_id]
    assert endpoint_candidates(rows, "Resolved", None) == []
    assert endpoint_candidates(rows, "Closed", midnight) == []
