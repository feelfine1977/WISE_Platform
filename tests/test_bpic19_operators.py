"""Literal independent oracles for the admitted finite operators, never source-script execution."""

from datetime import datetime, timedelta
import json
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator
from wise_platform_analytics.bpic19_operators import operator_population
from wise_platform_analytics.preparation import PreparedData, PreparedRecord

GR = "Record Goods Receipt"
IR = "Record Invoice Receipt"
CI = "Clear Invoice"
CANCEL = "Cancel Invoice Receipt"
ROLES = {"event_id": 3, "item_category": 4, "net_worth": 5}
BASE = datetime(2018, 1, 1)


def snapshot(events, cutoff="2018-01-21T00:00:00"):
    records = []
    histories = {}
    for index, event in enumerate(events, 1):
        case, activity, day, *extra = event
        event_id = extra[0] if extra else str(index)
        category = extra[1] if len(extra) > 1 else "3-way match, invoice after GR"
        amount = extra[2] if len(extra) > 2 else "100"
        moment = None if day is None else BASE + timedelta(days=day)
        text = moment.isoformat() if moment else ""
        row = PreparedRecord(
            "r" + str(index),
            index,
            case,
            None,
            activity,
            "wall_clock",
            None,
            text or None,
            "usable" if moment else "missing",
            (),
            (case, activity or "", text, str(event_id), category, str(amount)),
            moment,
        )
        records.append(row)
        histories.setdefault(case, []).append(row)
    return PreparedData(
        b"unchanged",
        "source",
        "prepared",
        "representation",
        "dictionary",
        "population",
        "0.1.0",
        ("case", "activity", "time", "eventID", "category", "value"),
        tuple(records),
        histories,
        {},
        {},
        {"time": {"parameters": {"snapshot_cutoff_local": cutoff}}},
        {},
    )


def ordinal(**changes):
    return {
        "kind": "ordinal",
        "order": "numeric_event_id",
        "stages": "gr_ir_ci",
        "receipt": "goods",
        "cancellation": "retain",
        "ties": "source_position",
        **changes,
    }


def fifo(**changes):
    return {
        "kind": "fifo",
        "order": "source_position",
        "stages": "gr_ir_ci",
        "receipt": "goods",
        "cancellation": "retain",
        "ties": "allow_equal",
        **changes,
    }


def cancellation(**changes):
    return {
        "kind": "cancellation",
        "target_activities": [IR],
        "cancellation_activities": [CANCEL],
        "reuse": "consume",
        "ties": "strict_before",
        "ambiguity": "refuse",
        "amount_filter": "ignore",
        "tolerance": 0,
        "max_window_days": None,
        **changes,
    }


def rule(**changes):
    return {
        "kind": "rule",
        "left_activities": ["A"],
        "right_activities": ["B"],
        "relation": "response",
        "position": "eventual",
        "quantifier": "every",
        "reuse": "allow",
        "ties": "allow_equal",
        "vacuity": "not_activated",
        "flow_scope": "all",
        **changes,
    }


def waiting(**changes):
    return {
        "kind": "waiting",
        "activation_activities": ["A"],
        "response_activities": ["B"],
        "endpoints": "first_first",
        "completion": "completed_only",
        "horizon_start": "2018-01-01T00:00:00",
        "horizon_end": "2018-01-07T00:00:00",
        "horizon_provenance": None,
        "horizon_policy": "refuse_outside",
        "calendar": "elapsed_segments",
        **changes,
    }


def evaluate(prepared, recipe, **kwargs):
    answer = operator_population(
        prepared, list(prepared.histories), ROLES, recipe, **kwargs
    )
    assert isinstance(answer, dict), answer
    json.dumps(answer, allow_nan=False)
    return answer


def test_ordinal_repeats_unmatched_and_two_distinct_aggregation_grains():
    p = snapshot(
        [
            ("a", GR, 0),
            ("a", GR, 1),
            ("a", IR, 2),
            ("a", IR, 3),
            ("a", CI, 4),
            ("a", CI, 9),
            ("a", GR, 10),
            ("b", GR, 0),
            ("b", IR, 0),
            ("b", CI, 10),
        ]
    )
    out = evaluate(p, ordinal())
    a, b = out["cases"]
    assert [obs["stage_row_ids"] for obs in a["observations"]] == [
        ["r1", "r3", "r5"],
        ["r2", "r4", "r6"],
        ["r7", None, None],
    ]
    assert a["unmatched_row_ids"] == ["r7"]
    assert [obs["intervals"]["stage_2_to_3"]["value"] for obs in a["observations"]] == [
        2,
        6,
        None,
    ]
    assert (
        out["summary"]["interval_distributions"]["stage_2_to_3"]["per_episode"]["mean"]
        == 6
    )
    assert (
        out["summary"]["interval_distributions"]["stage_2_to_3"]["per_item_mean"][
            "mean"
        ]
        == 7
    )
    assert a["record_row_ids"] == ["r1", "r2", "r3", "r4", "r5", "r6", "r7"]
    assert all(obs["native_invoice_id"] is None for obs in a["observations"])


def test_numeric_eventid_and_timestamp_ordinals_are_distinct_not_fallback():
    p = snapshot(
        [("a", IR, 4, "1"), ("a", IR, 1, "2"), ("a", CI, 2, "3"), ("a", CI, 5, "4")]
    )
    numeric = evaluate(p, ordinal(stages="ir_ci"))
    timestamp = evaluate(p, ordinal(stages="ir_ci", order="timestamp_source_position"))
    assert [
        obs["intervals"]["stage_1_to_2"]["recorded_difference_days"]
        for obs in numeric["cases"][0]["observations"]
    ] == [-2, 4]
    assert [
        obs["intervals"]["stage_1_to_2"]["value"]
        for obs in timestamp["cases"][0]["observations"]
    ] == [1, 1]
    assert numeric["definition_id"] != timestamp["definition_id"]
    for bad in ["no-id", "1"]:
        out = evaluate(
            snapshot([("a", IR, 0, "1"), ("a", CI, 1, bad)]), ordinal(stages="ir_ci")
        )
        assert out["cases"][0]["state"] == "unknown"
        assert out["cases"][0]["observations"] == []


def test_numeric_known_order_has_local_missing_time_and_valid_zero():
    p = snapshot([("a", IR, None), ("a", CI, 1), ("b", IR, 0), ("b", CI, 0)])
    out = evaluate(p, ordinal(stages="ir_ci"))
    assert out["cases"][0]["observations"][0]["state"] == "unknown"
    assert out["cases"][1]["observations"][0]["state"] == "zero"
    assert (
        out["summary"]["interval_distributions"]["stage_1_to_2"]["per_episode"][
            "zero_count"
        ]
        == 1
    )


def test_fifo_source_vector_consumes_complete_tuples_only():
    gr = {1, 2, 7, 8, 9, 10, 16, 17, 18}
    ir = {3, 4, 6, 11, 12, 13, 14, 19}
    ci = {5, 15, 20}
    out = evaluate(
        snapshot(
            [("a", GR if n in gr else IR if n in ir else CI, n) for n in range(1, 21)]
        ),
        fifo(),
    )
    a = out["cases"][0]
    matched = [o["stage_row_ids"] for o in a["observations"] if all(o["stage_row_ids"])]
    assert matched == [["r1", "r3", "r5"], ["r2", "r4", "r15"], ["r7", "r11", "r20"]]
    assert len(a["included_row_ids"]) == 9 and len(a["unmatched_row_ids"]) == 11
    assert len(set(sum(matched, []))) == 9


def test_fifo_equal_sourcepositions_and_auto_flow_are_declared():
    p = snapshot([("a", GR, 0), ("a", IR, 0), ("a", CI, 0)])
    assert evaluate(p, fifo())["cases"][0]["observations"][0]["state"] == "zero"
    assert (
        evaluate(p, fifo(ties="strict_time"))["cases"][0]["totals"][
            "paired_episode_count"
        ]["value"]
        == 0
    )
    p = snapshot(
        [
            ("a", IR, 1, "1", "3-way match, invoice before GR"),
            ("a", GR, 2, "2", "3-way match, invoice before GR"),
            ("a", CI, 3, "3", "3-way match, invoice before GR"),
        ]
    )
    assert evaluate(p, fifo(stages="auto_flow"))["cases"][0]["observations"][0][
        "stage_row_ids"
    ] == ["r1", "r2", "r3"]
    assert (
        evaluate(p, fifo())["cases"][0]["totals"]["paired_episode_count"]["value"] == 0
    )
    assert evaluate(p, ordinal(stages="auto_flow"))["cases"][0]["observations"][0][
        "stage_row_ids"
    ] == ["r1", "r2", "r3"]


def test_fifo_timestamp_numeric_ids_reverse_equal_time_source_order_explicitly():
    p = snapshot([("a", IR, 0, "10"), ("a", GR, 0, "2"), ("a", CI, 0, "11")])
    source = evaluate(p, fifo())
    timestamp_source = evaluate(p, fifo(order="timestamp_source_position"))
    numeric_ties = evaluate(p, fifo(order="timestamp_numeric_event_id"))
    assert source["cases"][0]["totals"]["paired_episode_count"]["value"] == 0
    assert timestamp_source["cases"][0]["totals"]["paired_episode_count"]["value"] == 0
    case = numeric_ties["cases"][0]
    assert case["record_row_ids"] == ["r1", "r2", "r3"]
    assert case["observations"][0]["stage_row_ids"] == ["r2", "r1", "r3"]
    assert case["observations"][0]["state"] == "zero"
    assert case["totals"]["paired_episode_count"]["value"] == 1
    assert case["totals"]["paired_endpoint_event_count"]["value"] == 3
    assert case["unmatched_row_ids"] == []
    assert (
        len({v["definition_id"] for v in [source, timestamp_source, numeric_ties]}) == 3
    )
    assert numeric_ties["definition"]["representative_policy"] == (
        "parsed_time_then_numeric_event_id_then_original_source_position"
    )
    assert (
        "Panel-declared modern FIFO order"
        in numeric_ties["definition"]["source_evidence"][-1]
    )
    strict = evaluate(p, fifo(order="timestamp_numeric_event_id", ties="strict_time"))
    assert strict["cases"][0]["totals"]["paired_episode_count"]["value"] == 0
    assert strict["cases"][0]["unmatched_row_ids"] == ["r1", "r2", "r3"]


def test_fifo_timestamp_is_primary_and_duplicate_numeric_ids_tie_by_source_position():
    p = snapshot([("a", IR, 1, "1"), ("a", GR, 0, "9"), ("a", CI, 2, "0")])
    case = evaluate(p, fifo(order="timestamp_numeric_event_id"))["cases"][0]
    assert case["observations"][0]["stage_row_ids"] == ["r2", "r1", "r3"]
    assert [v["value"] for v in case["observations"][0]["intervals"].values()] == [1, 1]
    p = snapshot([("a", GR, 0, " 01 "), ("a", IR, 0, "1"), ("a", CI, 0, "001")])
    case = evaluate(p, fifo(order="timestamp_numeric_event_id"))["cases"][0]
    assert case["observations"][0]["stage_row_ids"] == ["r1", "r2", "r3"]
    assert case["observations"][0]["state"] == "zero"
    assert evaluate(p, ordinal())["cases"][0]["reason"] == "ambiguous_event_id"


@pytest.mark.parametrize("bad_id", ["", "no-id", "-1", "1.0", "١", "1" * 65])
def test_fifo_numeric_tie_ids_do_not_fallback_even_for_unrelated_original_rows(bad_id):
    p = snapshot(
        [("a", GR, 0, "1"), ("a", IR, 1, "2"), ("a", CI, 2, "3"), ("a", "X", 0, bad_id)]
    )
    case = evaluate(p, fifo(order="timestamp_numeric_event_id"))["cases"][0]
    assert case["state"] == "unknown" and case["reason"] == "invalid_event_id"
    assert case["unknown_row_ids"] == ["r4"] and case["observations"] == []
    assert case["record_row_ids"] == ["r1", "r2", "r3", "r4"]
    assert case["activation_count"] == case["known_activation_count"] == 1
    assert case["unmatched_row_ids"] == ["r1", "r2", "r3"]
    # Other finite definitions do not acquire an eventID dependency.
    for order in ["source_position", "timestamp_source_position"]:
        assert (
            evaluate(p, fifo(order=order))["cases"][0]["totals"][
                "paired_episode_count"
            ]["value"]
            == 1
        )


def test_fifo_timestamp_numeric_auto_flow_uses_same_order_and_exact_unknown_witnesses():
    category = "3-way match, invoice before GR"
    p = snapshot(
        [
            ("a", IR, 0, "2", category),
            ("a", GR, 0, "1", category),
            ("a", CI, 0, "3", category),
        ]
    )
    case = evaluate(p, fifo(order="timestamp_numeric_event_id", stages="auto_flow"))[
        "cases"
    ][0]
    assert case["observations"][0]["stage_row_ids"] == ["r2", "r1", "r3"]
    assert evaluate(p, fifo(stages="auto_flow"))["cases"][0]["observations"][0][
        "stage_row_ids"
    ] == ["r1", "r2", "r3"]
    p = snapshot(
        [
            ("a", IR, None, "2", category),
            ("a", GR, 0, "1", category),
            ("a", CI, 1, "3", category),
        ]
    )
    case = evaluate(p, fifo(order="timestamp_numeric_event_id", stages="auto_flow"))[
        "cases"
    ][0]
    assert case["state"] == "unknown" and case["reason"] == "unknown_flow_stage_order"
    assert case["unknown_row_ids"] == ["r1"] and case["observations"] == []
    assert case["activation_count"] is None
    p = snapshot(
        [
            ("a", IR, 0, "bad", category),
            ("a", GR, 0, "1", category),
            ("a", CI, 1, "3", category),
        ]
    )
    case = evaluate(p, fifo(order="timestamp_numeric_event_id", stages="auto_flow"))[
        "cases"
    ][0]
    assert case["reason"] == "invalid_event_id" and case["unknown_row_ids"] == ["r1"]


def test_fifo_timestamp_numeric_requires_mapped_original_ids_and_keeps_unknown_times():
    p = snapshot([("a", GR, 0), ("a", IR, None), ("a", CI, 2)])
    result = operator_population(
        p, ["a"], {**ROLES, "event_id": None}, fifo(order="timestamp_numeric_event_id")
    )
    assert result.code == "invalid_parameter" and "reviewed event_id" in result.message
    case = evaluate(p, fifo(order="timestamp_numeric_event_id"))["cases"][0]
    assert case["state"] == "unknown" and case["reason"] == "unknown_chronology"
    assert case["unknown_row_ids"] == ["r2"] and case["observations"] == []
    assert case["activation_count"] == case["known_activation_count"] == 1


def test_episode_cancellation_exclusion_keeps_full_history():
    out = evaluate(
        snapshot([("a", IR, 0), ("a", CI, 1), ("a", CANCEL, 2)]),
        ordinal(stages="ir_ci", cancellation="exclude_item"),
    )
    assert out["cases"][0]["state"] == "excluded" and out["cases"][0][
        "excluded_row_ids"
    ] == ["r3"]
    assert out["population_record_count"] == 3


def test_cancellation_latest_consuming_vs_reuse_and_tied_ambiguity():
    p = snapshot(
        [
            ("a", IR, 1),
            ("a", IR, 2),
            ("a", CANCEL, 3),
            ("a", CANCEL, 4),
            ("a", CANCEL, 5),
        ]
    )
    a = evaluate(p, cancellation())["cases"][0]
    assert [o["response_row_ids"] for o in a["observations"]] == [["r2"], ["r1"], []]
    assert a["excluded_row_ids"] == ["r1", "r2"] and a["record_count"] == 5
    assert [
        o["response_row_ids"]
        for o in evaluate(p, cancellation(reuse="allow"))["cases"][0]["observations"]
    ] == [["r2"], ["r2"], ["r2"]]
    ambiguous = evaluate(
        snapshot([("a", IR, 2), ("a", IR, 2), ("a", CANCEL, 3)]), cancellation()
    )["cases"][0]
    assert ambiguous["observations"][0]["state"] == "ambiguous"
    assert (
        ambiguous["observations"][0]["candidate_row_ids"] == ["r1", "r2"]
        and ambiguous["excluded_row_ids"] == []
    )


def test_cancellation_amount_direction_tolerance_and_missing_are_local():
    p = snapshot(
        [
            ("a", IR, 1, "1", "2-way match", 100),
            ("a", CANCEL, 2, "2", "2-way match", -100),
        ]
    )
    assert (
        evaluate(p, cancellation(amount_filter="equal"))["cases"][0]["observations"][0][
            "state"
        ]
        == "unmatched"
    )
    assert evaluate(p, cancellation(amount_filter="opposite"))["cases"][0][
        "observations"
    ][0]["response_row_ids"] == ["r1"]
    p = snapshot(
        [
            ("a", IR, 1, "1", "2-way match", 100.004),
            ("a", CANCEL, 2, "2", "2-way match", 100),
        ]
    )
    assert (
        evaluate(p, cancellation(amount_filter="equal", tolerance=0.01))["cases"][0][
            "observations"
        ][0]["state"]
        == "matched"
    )
    assert (
        evaluate(p, cancellation(amount_filter="equal", tolerance=0.001))["cases"][0][
            "observations"
        ][0]["state"]
        == "unmatched"
    )
    p = snapshot(
        [
            ("a", IR, 1, "1", "2-way match", ""),
            ("a", CANCEL, 2, "2", "2-way match", 100),
        ]
    )
    a = evaluate(p, cancellation())["cases"][0]
    assert (
        a["observations"][0]["state"] == "matched"
        and not a["totals"]["raw_receipt_sum"]["available"]
    )
    assert (
        evaluate(p, cancellation(amount_filter="equal"))["cases"][0]["observations"][0][
            "state"
        ]
        == "unknown"
    )


def test_cancellation_zero_negative_missing_time_and_equal_time_alternatives():
    p = snapshot(
        [
            ("a", IR, 0, "1", "2-way match", 100),
            ("a", IR, 1, "2", "2-way match", -20),
            ("a", IR, 2, "3", "2-way match", 0),
            ("a", CANCEL, 1.5),
        ]
    )
    a = evaluate(p, cancellation())["cases"][0]
    assert (
        a["totals"]["raw_receipt_sum"]["value"] == 80
        and a["totals"]["raw_receipt_mean"]["value"] == 80 / 3
    )
    assert (
        a["totals"]["retained_receipt_sum"]["value"] == 100
        and a["totals"]["retained_receipt_mean"]["value"] == 50
    )
    p = snapshot([("a", IR, 0), ("a", CANCEL, 0)])
    assert (
        evaluate(p, cancellation())["cases"][0]["observations"][0]["state"]
        == "unmatched"
    )
    assert (
        evaluate(p, cancellation(ties="allow_equal_source_before"))["cases"][0][
            "observations"
        ][0]["state"]
        == "matched"
    )
    assert (
        evaluate(snapshot([("a", IR, None), ("a", CANCEL, 1)]), cancellation())[
            "cases"
        ][0]["observations"][0]["state"]
        == "unknown"
    )


def test_default_hypothetical_cancellation_view_preserves_immediate_clearing_and_changes():
    p = snapshot(
        [
            ("a", IR, 1),
            ("a", IR, 2),
            ("a", CANCEL, 3),
            ("a", CI, 3),
            ("a", CANCEL, 4),
            ("a", "Change Price", 4.5),
        ]
    )
    case = evaluate(p, cancellation())["cases"][0]
    assert [obs["response_row_ids"] for obs in case["observations"]] == [["r2"], ["r1"]]
    assert case["excluded_row_ids"] == ["r1", "r2"]
    assert case["record_row_ids"] == ["r1", "r2", "r3", "r4", "r5", "r6"]
    assert case["record_count"] == 6 and case["truth"] is None
    assert "financial_breach" not in case
    assert p.histories["a"][3].activity == CI
    assert p.histories["a"][5].activity == "Change Price"
    assert case["totals"]["raw_receipt_sum"]["value"] == 200
    assert case["totals"]["retained_receipt_sum"]["value"] == 0


def test_rule_some_every_direct_and_eventual_have_exact_raw_witnesses():
    p = snapshot([("a", "A", 0), ("a", "X", 0.5), ("a", "B", 1), ("a", "A", 2)])
    eventual = evaluate(p, rule())
    direct = evaluate(p, rule(position="raw_direct"))
    assert eventual["cases"][0]["truth"] == "false"
    assert [o["response_row_ids"] for o in eventual["cases"][0]["observations"]] == [
        ["r3"],
        [],
    ]
    assert direct["summary"]["observation_state_counts"] == {"unmatched": 2}
    assert evaluate(p, rule(quantifier="some"))["cases"][0]["truth"] == "true"
    assert (
        eventual["cases"][0]["activation_count"] == 2
        and eventual["population_case_count"] == 1
    )


def test_rule_precedence_is_not_reversed_response_and_consume_is_distinct():
    p = snapshot([("a", "B", 0), ("a", "A", 1), ("a", "B", 2)])
    a = evaluate(p, rule(relation="precedence"))["cases"][0]
    assert a["truth"] == "false" and [
        o["response_row_ids"] for o in a["observations"]
    ] == [[], ["r2"]]
    assert evaluate(p, rule())["cases"][0]["truth"] == "true"
    p = snapshot([("a", "A", 0), ("a", "A", 1), ("a", "B", 2)])
    assert evaluate(p, rule())["cases"][0]["truth"] == "true"
    assert [
        o["response_row_ids"]
        for o in evaluate(p, rule(reuse="consume"))["cases"][0]["observations"]
    ] == [["r3"], []]


def test_rule_ties_return_all_candidates_and_independent_direct_order():
    p = snapshot([("a", "B", 0), ("a", "A", 0), ("a", "B", 0)])
    obs = evaluate(p, rule())["cases"][0]["observations"][0]
    assert obs["candidate_row_ids"] == ["r1", "r3"] and obs["response_row_ids"] == [
        "r1"
    ]
    assert obs["intervals"]["relation_lag"]["value"] == 0
    assert evaluate(p, rule(position="raw_direct"))["cases"][0]["observations"][0][
        "response_row_ids"
    ] == ["r3"]
    assert evaluate(p, rule(ties="strict"))["cases"][0]["truth"] == "false"


@pytest.mark.parametrize(
    "events,states,some,every",
    [
        (
            [("a", "A", 0), ("a", "B", 1), ("a", "A", 2), ("a", "A", None)],
            ["true", "false", "unknown"],
            "true",
            "false",
        ),
        (
            [("a", "A", 0), ("a", "B", 1), ("a", "A", None)],
            ["true", "unknown"],
            "true",
            "unknown",
        ),
        ([("a", "A", 0), ("a", "B", 1), ("a", None, 2)], ["true"], "true", "unknown"),
        ([("a", "A", 0), ("a", "B", 1), ("a", "X", None)], ["true"], "true", "true"),
    ],
)
def test_three_valued_quantifiers_preserve_confirmed_witnesses(
    events, states, some, every
):
    p = snapshot(events)
    for quantifier, expected in [("some", some), ("every", every)]:
        a = evaluate(p, rule(quantifier=quantifier))["cases"][0]
        assert (
            a["truth"] == expected and [o["truth"] for o in a["observations"]] == states
        )


def test_rule_vacuity_and_flow_unknown_are_explicit():
    p = snapshot([("a", "B", 1)])
    assert (
        evaluate(p, rule())["cases"][0]["truth"] is None
        and evaluate(p, rule())["cases"][0]["state"] == "not_activated"
    )
    assert evaluate(p, rule(vacuity="logical"))["cases"][0]["truth"] == "true"
    assert (
        evaluate(p, rule(flow_scope="two_way"))["cases"][0]["state"] == "outside_scope"
    )
    p = snapshot([("a", "A", 0, "1", ""), ("a", "B", 1, "2", "")])
    assert evaluate(p, rule(flow_scope="two_way"))["cases"][0]["truth"] == "unknown"


def test_half_open_occupancy_zero_boundaries_censor_and_duration_denominators():
    p = snapshot(
        [
            ("a", "A", 0),
            ("a", "B", 2),
            ("b", "A", 2),
            ("b", "B", 4),
            ("c", "A", 1),
            ("c", "B", 3),
            ("d", "A", 2),
            ("d", "B", 2),
            ("e", "A", 1),
            ("f", "A", 1),
            ("f", "B", None),
            ("g", "A", 4),
            ("g", "B", 2),
        ]
    )
    out = evaluate(p, waiting())
    o = out["summary"]["occupancy"]
    assert [s["occupancy"] for s in o["segments"]] == [1, 2, 2, 1, 0]
    assert (
        o["available_interval_count"] == 4
        and o["zero_duration_count"] == 1
        and o["positive_duration_count"] == 3
    )
    assert (
        o["peak"] == 2
        and o["peak_case_ids"] == ["a", "c"]
        and o["peak_start"] == "2018-01-02T00:00:00"
    )
    assert (
        o["item_days"] == 6
        and o["duration_weighted_mean"] == 1
        and o["duration_weighted_lower_median"] == 1
    )
    censored = evaluate(
        p,
        waiting(
            completion="right_censored",
            horizon_provenance="Independent fixture observation authority day6",
        ),
    )["summary"]["occupancy"]
    assert (
        censored["available_interval_count"] == 5
        and censored["peak"] == 3
        and censored["peak_case_ids"] == ["a", "c", "e"]
    )
    assert censored["item_days"] == 11 and censored["duration_weighted_mean"] == 11 / 6
    assert out["cases"][5]["observations"][0]["state"] == "unknown"
    assert (
        out["cases"][6]["observations"][0]["intervals"]["waiting_duration"][
            "recorded_difference_days"
        ]
        == -2
    )


def test_waiting_trusted_horizon_and_clipping_are_distinct_recipes():
    p = snapshot([("a", "A", -1), ("a", "B", 2)])
    assert (
        evaluate(p, waiting())["summary"]["occupancy"]["available_interval_count"] == 0
    )
    assert (
        evaluate(p, waiting(horizon_policy="clip"))["summary"]["occupancy"]["item_days"]
        == 2
    )
    p = snapshot([("a", "A", 0), ("a", "B", 2)], cutoff="2018-01-02T00:00:00")
    assert (
        operator_population(
            p,
            ["a"],
            ROLES,
            waiting(
                completion="right_censored",
                horizon_provenance="Independent fixture cutoff",
            ),
        ).code
        == "incompatible_horizon"
    )
    assert (
        operator_population(p, ["a"], ROLES, waiting(completion="right_censored")).code
        == "invalid_parameter"
    )
    assert (
        evaluate(p, waiting())["summary"]["occupancy"]["available_interval_count"] == 1
    )
    assert (
        operator_population(p, ["a"], {**ROLES, "event_id": True}, ordinal()).code
        == "invalid_parameter"
    )


def test_waiting_named_clock_refusal_is_operator_only_and_does_not_convert_source():
    p = snapshot([("a", "A", 0), ("a", "B", 2)])
    original = p.records
    for field in ["horizon_start", "horizon_end"]:
        recipe = waiting(**{field: "2018-01-04T00:00:00Z"})
        refused = operator_population(p, ["a"], ROLES, recipe)
        assert refused.code == "incompatible_clock"
        assert refused.field == "query.recipe." + field
        assert "no naive/offset conversion" in refused.message
    assert p.records == original and p.records[0].timestamp_kind == "wall_clock"
    assert evaluate(p, waiting())["summary"]["occupancy"]["item_days"] == 2


def test_waiting_required_endpoint_after_horizon_refuses_whole_query_or_explicit_clip():
    p = snapshot([("a", "A", 0), ("a", "B", 8), ("b", "A", 0), ("b", "B", 1)])
    original = p.records
    refused = operator_population(p, ["a", "b"], ROLES, waiting())
    assert refused.code == "incompatible_horizon"
    assert refused.field == "query.recipe.horizon_end" and "r2" in refused.message
    assert "Item a" in refused.message and "clip projection" in refused.message
    assert p.records == original
    clipped = evaluate(p, waiting(horizon_policy="clip"))
    a = clipped["cases"][0]
    assert a["observations"][0]["end"] == "2018-01-07T00:00:00"
    assert a["observations"][0]["intervals"]["waiting_duration"]["value"] == 6
    assert (
        a["observations"][0]["intervals"]["waiting_duration"][
            "recorded_difference_days"
        ]
        == 8
    )
    assert a["observations"][0]["response_row_ids"] == ["r2"]
    assert clipped["summary"]["occupancy"]["item_days"] == 7
    assert a["record_row_ids"] == ["r1", "r2"]
    # An included, known first activation also cannot be placed after H merely
    # because its eventual response is absent.
    for completion in ["completed_only", "right_censored"]:
        r = waiting(
            completion=completion,
            horizon_provenance=(
                "Literal observation authority"
                if completion == "right_censored"
                else None
            ),
        )
        refused = operator_population(snapshot([("a", "A", 8)]), ["a"], ROLES, r)
        assert refused.code == "incompatible_horizon" and "r1" in refused.message


def test_waiting_unselected_late_response_and_nonstage_record_do_not_trigger_horizon_refusal():
    p = snapshot(
        [("a", "A", 0), ("a", "B", 2), ("a", "B", 8), ("a", "Change Price", 9)]
    )
    case = evaluate(p, waiting())["cases"][0]
    assert case["observations"][0]["response_row_ids"] == ["r2"]
    assert case["observations"][0]["intervals"]["waiting_duration"]["value"] == 2
    assert case["record_row_ids"] == ["r1", "r2", "r3", "r4"]
    refused = operator_population(p, ["a"], ROLES, waiting(endpoints="first_last"))
    assert refused.code == "incompatible_horizon" and "r3" in refused.message
    p = snapshot([("a", "A", 0), ("a", "B", None), ("a", "Change Price", 9)])
    case = evaluate(
        p,
        waiting(
            completion="right_censored",
            horizon_provenance="Literal observation authority",
        ),
    )["cases"][0]
    assert case["reason"] == "unknown_response_time"
    assert case["observations"][0]["state"] == "unknown"
    assert case["unknown_row_ids"] == ["r2"]
    p = snapshot([("a", "A", None), ("a", "A", 8), ("a", "B", 9)])
    case = evaluate(p, waiting())["cases"][0]
    assert case["reason"] == "unknown_activation_time" and case["unknown_row_ids"] == [
        "r1"
    ]


def test_paging_catalogue_semantic_identity_and_authoritative_schema():
    p = snapshot([("a", IR, 0), ("a", CI, 1), ("b", IR, 0), ("b", CI, 2)])
    first = evaluate(p, ordinal(stages="ir_ci"), limit=1)
    second = evaluate(p, ordinal(stages="ir_ci"), offset=1, limit=1)
    assert (
        first["definition_id"] == second["definition_id"]
        and first["result_id"] == second["result_id"]
        and first["summary"] == second["summary"]
    )
    assert second["cases"][0]["case_id"] == "b"
    catalogue = evaluate(p, None)
    assert catalogue["cases"] == [] and catalogue["catalogue"]["activities"] == [CI, IR]
    schema = json.loads(
        (
            Path(__file__).resolve().parents[1]
            / "contracts/bpic19-operators.schema.json"
        ).read_text()
    )
    validator = Draft202012Validator(schema)
    # Synthetic envelope values use literal independently constructed valid identity strings.
    identity = {
        key: prefix + ".v1:sha256:" + "a" * 64
        for key, prefix in [
            ("source_id", "source"),
            ("preparation_id", "preparation"),
            ("representation_id", "representation"),
            ("case_dictionary_id", "case-dictionary"),
            ("population_id", "population"),
        ]
    }
    identity["implementation_version"] = "0.1.0"
    for recipe in [
        ordinal(stages="ir_ci"),
        fifo(stages="ir_ci"),
        cancellation(),
        rule(),
        waiting(),
        None,
    ]:
        result = evaluate(p, recipe)
        validator.validate(
            {
                "schema_version": 1,
                "message_type": "bpic19_operator_answer",
                "request_id": "test",
                "query_revision": 1,
                "workspace_id": "workspace.v1:abcdefgh",
                "identity": identity,
                "parent_identity": identity,
                "query": {
                    "policy_id": "bpic19.declared_operators.v1",
                    "roles": ROLES,
                    "recipe": recipe,
                    "offset": 0,
                    "limit": 20,
                },
                **result,
            }
        )


def test_retained_comparison_counts_cover_population_not_only_case_page():
    events = [
        (case, label, day)
        for case in ["a", "b"]
        for label, day in [
            (CI, 0),
            (GR, 1),
            (IR, 2),
            (CI, 3),
            (GR, 4),
            (IR, 5),
            (CI, 6),
        ]
    ]
    p = snapshot(events)
    left = evaluate(p, ordinal(), limit=1)
    right = evaluate(p, fifo(), limit=1)
    assert len(left["cases"]) == len(right["cases"]) == 1
    assert left["population_case_count"] == right["population_case_count"] == 2
    for result in [left, right]:
        sums = result["summary"]["total_distributions"]
        assert sums["paired_episode_count"]["known_sum"] == 4
        assert sums["paired_endpoint_event_count"]["known_sum"] == 12
        assert sums["unmatched_event_count"]["known_sum"] == 2
        assert sums["stage_3_unmatched_event_count"]["known_sum"] == 2
        assert sums["paired_episode_count"]["available_count"] == 2
    assert left["summary"]["observation_state_counts"] == {
        "reversed": 4,
        "unmatched": 2,
    }
    assert right["summary"]["observation_state_counts"] == {"matched": 4}
    assert (
        left["summary"]["interval_distributions"]["stage_2_to_3"]["per_episode"]["mean"]
        is None
    )
    assert (
        right["summary"]["interval_distributions"]["stage_2_to_3"]["per_episode"][
            "mean"
        ]
        == 1
    )
    assert (
        left["cases"][0]["observations"][0]["intervals"]["stage_2_to_3"][
            "recorded_difference_days"
        ]
        == -2
    )


def test_raw_known_activation_counts_survive_interval_and_scope_unavailability():
    p = snapshot([("a", GR, 0), ("a", IR, None), ("a", CI, 2)])
    result = evaluate(p, ordinal())
    assert (
        result["cases"][0]["known_activation_count"]
        == result["cases"][0]["activation_count"]
        == 1
    )
    assert result["summary"]["known_activation_count"] == 1
    p = snapshot([("a", "A", 0, "1", ""), ("a", "B", 1, "2", "")])
    a = evaluate(p, rule(flow_scope="after_gr"))["cases"][0]
    assert a["state"] == "unknown" and a["truth"] == "unknown"
    assert a["known_activation_count"] == a["activation_count"] == 1
