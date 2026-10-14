"""The adapter to the method library on a literal log, with every expected value worked out by hand.

Times are UTC on 9 October 2026; the expectation is "after Opened, Resolved
within 4 hours", with a width of 2 hours in which it is partly met. The
library's rule gives 0 up to and including 4 hours, (hours - 4) / 2 between 4
and 6 hours, and 1 from 6 hours on.

    MET      Opened 00:00, Resolved 03:00                           3 h  -> 0
    EDGE     Opened 00:00, Resolved 04:00                           4 h  -> 0 (equal to the target)
    PARTLY   Opened 00:00, Resolved 05:00                           5 h  -> 0.5
    LATE     Opened 00:00, Resolved 07:00                           7 h  -> 1
    OPEN     Opened 00:00, no Resolved                              no response
    NOSTART  Assigned 00:00, Resolved 02:00                         no start
    REPEAT   Resolved 00:00, Opened 01:00, Opened 02:00,
             Resolved 06:00, Resolved 08:00                         first Opened 01:00, first Resolved at or
                                                                    after it 06:00: 5 h -> 0.5
    TIED     Resolved 00:00, Opened 00:00 (same instant)            0 h  -> 0

The snapshot cutoff is 10:00; OPEN has been open for 10 hours at the cutoff.
"""

import sys
from datetime import datetime, timezone

import pytest

from wise_platform_analytics.preparation import PreparationResult, prepare
from wise_platform_api import method

DAY = "2026-10-09T"
LOG = "\r\n".join(
    [
        "Ticket,Activity,At,Desk",
        f"MET,Opened,{DAY}00:00:00Z,East",
        f"MET,Resolved,{DAY}03:00:00Z,East",
        f"EDGE,Opened,{DAY}00:00:00Z,East",
        f"EDGE,Resolved,{DAY}04:00:00Z,East",
        f"PARTLY,Opened,{DAY}00:00:00Z,East",
        f"PARTLY,Resolved,{DAY}05:00:00Z,East",
        f"LATE,Opened,{DAY}00:00:00Z,East",
        f"LATE,Resolved,{DAY}07:00:00Z,East",
        f"OPEN,Opened,{DAY}00:00:00Z,East",
        f"NOSTART,Assigned,{DAY}00:00:00Z,East",
        f"NOSTART,Resolved,{DAY}02:00:00Z,East",
        f"REPEAT,Resolved,{DAY}00:00:00Z,",
        f"REPEAT,Opened,{DAY}01:00:00Z,West",
        f"REPEAT,Opened,{DAY}02:00:00Z,East",
        f"REPEAT,Resolved,{DAY}06:00:00Z,East",
        f"REPEAT,Resolved,{DAY}08:00:00Z,East",
        f"TIED,Resolved,{DAY}00:00:00Z,East",
        f"TIED,Opened,{DAY}00:00:00Z,East",
    ]
).encode("utf-8") + b"\r\n"
START = datetime(2026, 10, 9, tzinfo=timezone.utc)
CUTOFF = datetime(2026, 10, 9, 10, tzinfo=timezone.utc)

POLICIES = {
    "time": {"id": "incident.time.explicit_format_timezone_utc.v1", "parameters": {
        "format": "iso8601", "timezone": {"mode": "from_values"}, "snapshot_cutoff_utc": "2026-10-09T10:00:00Z"}},
    "order": {"id": "incident.order.declared_time_optional_sequence_source_position.v1", "parameters": {
        "primary": "usable_declared_time_ascending", "secondary": "mapped_sequence_or_source_position",
        "tie_breaker": "source_position_ascending", "unavailable_timestamp": "presentation_tail_source_position",
        "unavailable_timestamp_case_sequence": "unevaluable"}},
    "rows": {"id": "incident.rows.missing_id_outside_invalid_time_retained.v1", "parameters": {
        "missing_case_id": "outside_population_preserve_source", "unavailable_timestamp": "retain_case_raw_flag_order_unknown",
        "invalid_mapped_sequence": "block_preparation", "duplicate_candidates": "retain_all"}},
    "missing_values": {"id": "incident.missing.empty_mapped_activity_context.v1", "parameters": {
        "empty_activity_context": "missing", "literal_values": "preserve"}},
    "identifier": {"id": "incident.identifier.trim_outer_whitespace.v1", "parameters": {
        "normalization": "trim_outer_whitespace_preserve_raw"}},
    "activity_projection": {"id": "incident.activity.omit_missing_retain_raw_gaps.v1", "parameters": {
        "missing_activity": "omit_from_mapped_sequence", "raw_records": "retain_all", "gap_evidence": "omitted_row_ids"}},
    "parent": {"id": "incident.parent.all_identified_cases.v1", "parameters": {
        "eligibility": "nonempty_normalized_case_identifier"}},
}
DEFINITION = {
    "kind": "resolution_first_after.v1",
    "name": "Resolved within four hours",
    "definition_revision": 1,
    "review_state": "reviewed",
    "provenance": {"kind": "locally_entered", "owner_label": "Service desk", "source_label": "Literal test",
                   "rationale": "Worked out by hand."},
    "role": "negotiable_target",
    "scope": {"kind": "all_cases"},
    "endpoints": {"activation_activity": "Opened", "response_activity": "Resolved", "activation": "first",
                  "response": "first_after", "response_time_comparison": "at_or_after"},
    "clock_kind": "utc_instant",
    "target": 4.0,
    "width": 2.0,
    "unit": "hours",
    "missing_activation": "skip",
    "missing_response": "skip",
    "calibration": "fixed_threshold",
}


@pytest.fixture(scope="module")
def prepared():
    result = prepare(
        LOG,
        {"encoding": "utf-8", "delimiter": ",", "quotechar": '"', "header": "first_record"},
        {"case_column": 0, "activity_column": 1, "timestamp_column": 2, "sequence_column": None, "context_columns": [3]},
        POLICIES,
        True,
    )
    assert isinstance(result, PreparationResult) and result.preparation is not None
    return result.preparation


def scored(prepared, **changes):
    definition = {**DEFINITION, **changes}
    compiled = method.compile_norm(definition)
    assert isinstance(compiled, method.CompiledNorm)
    case_ids = sorted(prepared.histories)
    log = method.event_log(prepared, case_ids, method.Clock(False, START, CUTOFF))
    assert method.check(compiled, log) == []
    return {case["case_id"]: case for case in method.score(compiled, log, case_ids, "hours")}


def test_values_scopes_and_reasons_are_the_library_rule_worked_out_by_hand(prepared):
    cases = scored(prepared)
    assert {key: case["value"] for key, case in cases.items()} == {
        "MET": 0, "EDGE": 0, "PARTLY": 0.5, "LATE": 1, "OPEN": None, "NOSTART": None, "REPEAT": 0.5, "TIED": 0,
    }
    assert {key: case["reason"] for key, case in cases.items()} == {
        "MET": "evaluated", "EDGE": "evaluated", "PARTLY": "evaluated", "LATE": "evaluated",
        "OPEN": "missing_response", "NOSTART": "missing_activation", "REPEAT": "evaluated", "TIED": "evaluated",
    }
    assert all(case["in_scope"] is True for case in cases.values())


def test_the_measured_time_is_the_interval_from_the_first_start_to_the_first_response_at_or_after_it(prepared):
    cases = scored(prepared)
    assert {key: case["measurement"]["value"] for key, case in cases.items()} == {
        "MET": 3, "EDGE": 4, "PARTLY": 5, "LATE": 7, "OPEN": None, "NOSTART": None, "REPEAT": 5, "TIED": 0,
    }
    assert cases["OPEN"]["measurement"] == {
        "status": "missing_response", "value": None, "unit": "hours",
        "activation_known": True, "response_known": False, "censor_age": None,
    }
    assert cases["NOSTART"]["measurement"] == {
        "status": "missing_activation", "value": None, "unit": "hours",
        "activation_known": False, "response_known": False, "censor_age": None,
    }


def test_a_missing_response_counted_as_not_met_has_the_value_one_and_still_no_measured_time(prepared):
    cases = scored(prepared, missing_response="violate")
    assert cases["OPEN"]["value"] == 1 and cases["OPEN"]["reason"] == "evaluated"
    assert cases["OPEN"]["measurement"]["value"] is None and cases["OPEN"]["measurement"]["status"] == "missing_response"
    # A missing start stays without a value under either meaning of a missing response.
    assert cases["NOSTART"]["value"] is None and cases["NOSTART"]["reason"] == "missing_activation"
    assert cases["PARTLY"]["value"] == 0.5


def test_an_open_incident_judged_by_its_age_reports_the_age_apart_from_the_measured_time(prepared):
    cases = scored(prepared, missing_response="censor")
    # Open for 10 hours at the cutoff: beyond target and width, so 1.
    assert cases["OPEN"]["value"] == 1 and cases["OPEN"]["reason"] == "censored"
    assert cases["OPEN"]["measurement"]["value"] is None and cases["OPEN"]["measurement"]["censor_age"] == 10


def test_without_a_width_the_rule_is_a_step_above_the_target(prepared):
    cases = scored(prepared, width=0.0)
    assert [cases[key]["value"] for key in ("MET", "EDGE", "PARTLY", "LATE")] == [0, 0, 1, 1]


def test_the_trace_of_an_incident_keeps_every_record_and_names_the_endpoint_times(prepared):
    compiled = method.compile_norm(DEFINITION)
    witness = method.case_witness(compiled, prepared, "REPEAT", method.Clock(False, START, CUTOFF))
    assert witness.trace_row_ids == [row.row_id for row in prepared.histories["REPEAT"]]
    assert witness.activation_time == datetime(2026, 10, 9, 1, tzinfo=timezone.utc)
    assert witness.response_time == datetime(2026, 10, 9, 6, tzinfo=timezone.utc)
    tied = method.case_witness(compiled, prepared, "TIED", method.Clock(False, START, CUTOFF))
    assert tied.activation_time == tied.response_time == START
    open_case = method.case_witness(compiled, prepared, "OPEN", method.Clock(False, START, CUTOFF))
    assert open_case.response_time is None and open_case.activation_time == START


def test_the_log_carries_the_opening_context_of_the_first_record_even_when_it_is_missing(prepared):
    log = method.event_log(prepared, ["REPEAT", "MET"], method.Clock(False, START, CUTOFF))
    opening = log.cases["opening_column_3"].to_dict()
    # REPEAT's first record has no desk; its later records say West and East.
    assert opening["REPEAT"] is None and opening["MET"] == "East"
    assert len(log.events) == 7


def test_the_compiled_norm_is_schema_three_with_one_lag_constraint(prepared):
    compiled = method.compile_norm({**DEFINITION, "missing_response": "violate", "unit": "days"})
    assert compiled.document["schema_version"] == 3 and compiled.document["missing_values"] == "three_valued"
    assert compiled.document["constraints"][0]["params"] == {
        "a": "Opened", "b": "Resolved", "activation": "first", "response": "first_after",
        "delta": 4.0, "width": 2.0, "unit": "D", "missing_a": "skip", "missing_b": "violate",
    }
    assert compiled.fingerprint == method.compile_norm({**DEFINITION, "missing_response": "violate", "unit": "days"}).fingerprint


@pytest.mark.parametrize(
    ("target", "width", "field"),
    [(1e308, 0.0, "definition.target"), (4.0, 1e308, "definition.width"), (1e308, 1e308, "definition.target"),
     # A duration is held in whole microseconds of a 64-bit number: at most 2**63 - 1 microseconds,
     # about 2.562 billion hours. 1.5 billion hours each can be held, together they cannot.
     (1.5e9, 1.5e9, "definition.width"), (2.6e9, 0.0, "definition.target")],
)
def test_a_target_and_width_without_a_representable_duration_are_refused_at_their_field(target, width, field):
    problem = method.compile_norm({**DEFINITION, "target": target, "width": width})
    assert isinstance(problem, method.DefinitionProblem) and problem.field == field
    assert "duration" in problem.message


def test_a_duration_just_inside_the_range_is_taken():
    assert isinstance(method.compile_norm({**DEFINITION, "target": 1.5e9, "width": 1e9}), method.CompiledNorm)


def test_without_the_library_every_use_is_refused_with_how_to_install_it(monkeypatch):
    monkeypatch.setitem(sys.modules, "wise", None)
    problem = method.method_problem()
    assert problem is not None and method.INSTALL_COMMAND in problem.message


def test_another_version_of_the_library_is_refused(monkeypatch):
    import wise

    monkeypatch.setattr(wise, "__version__", "0.3.0")
    problem = method.method_problem()
    assert problem is not None and "0.3.0" in problem.message and "0.2.0" in problem.message


def test_the_qualified_library_is_available():
    assert method.method_problem() is None
