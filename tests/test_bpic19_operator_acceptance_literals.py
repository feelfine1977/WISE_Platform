"""Independent literal acceptance inputs and hand-written outputs for G08.

The imported snapshot helper constructs immutable rows only; it supplies no
matching, statistics, expected outputs or source-script execution. Symbolic
g1/i1/c1 in the tickets correspond to the explicit r1/r2/... witnesses below.
"""

import pytest

from test_bpic19_operators import (
    CI,
    GR,
    IR,
    CANCEL,
    evaluate,
    fifo,
    ordinal,
    rule,
    snapshot,
    waiting,
    cancellation,
)


def test_18_ac01_exact_six_original_records_two_numeric_ordinal_episodes():
    prepared = snapshot(
        [
            ("A", GR, 0, "1"),
            ("A", GR, 1, "2"),
            ("A", IR, 2, "3"),
            ("A", IR, 3, "4"),
            ("A", CI, 4, "5"),
            ("A", CI, 9, "6"),
        ]
    )
    answer = evaluate(prepared, ordinal())
    case = answer["cases"][0]
    assert [o["stage_row_ids"] for o in case["observations"]] == [
        ["r1", "r3", "r5"],
        ["r2", "r4", "r6"],
    ]
    assert [o["intervals"]["stage_1_to_2"]["value"] for o in case["observations"]] == [
        2,
        2,
    ]
    assert [o["intervals"]["stage_2_to_3"]["value"] for o in case["observations"]] == [
        2,
        6,
    ]
    assert (
        answer["summary"]["interval_distributions"]["stage_2_to_3"]["per_item_mean"][
            "mean"
        ]
        == 4
    )
    assert [o["native_invoice_id"] for o in case["observations"]] == [None, None]
    assert case["record_row_ids"] == ["r1", "r2", "r3", "r4", "r5", "r6"]
    assert case["record_count"] == answer["population_record_count"] == 6
    assert case["unmatched_row_ids"] == []


def test_18_ac04_zero_missing_middle_endpoint_and_unrelated_valid_tuple():
    prepared = snapshot(
        [
            ("Z", GR, 0),
            ("Z", IR, 0),
            ("Z", CI, 0),
            ("M", GR, 0),
            ("M", IR, None),
            ("M", CI, 2),
            ("V", GR, 3),
            ("V", IR, 4),
            ("V", CI, 5),
        ]
    )
    answer = evaluate(prepared, ordinal())
    cases = {case["case_id"]: case for case in answer["cases"]}
    zero, missing, valid = cases["Z"], cases["M"], cases["V"]
    assert zero["observations"][0]["state"] == "zero"
    assert zero["observations"][0]["stage_row_ids"] == ["r1", "r2", "r3"]
    for key in ["stage_1_to_2", "stage_2_to_3"]:
        assert zero["observations"][0]["intervals"][key]["available"]
        assert zero["observations"][0]["intervals"][key]["value"] == 0
        unavailable = missing["observations"][0]["intervals"][key]
        assert unavailable["value"] is None and not unavailable["available"]
        assert unavailable["reason"] == "unknown_endpoint_time"
        assert "r5" in unavailable["row_ids"]
        assert valid["observations"][0]["intervals"][key]["value"] == 1
        distribution = answer["summary"]["interval_distributions"][key]["per_episode"]
        assert (
            distribution["available_count"] == 2
            and distribution["unavailable_count"] == 1
        )
    assert missing["record_row_ids"] == ["r4", "r5", "r6"]
    assert valid["record_row_ids"] == ["r7", "r8", "r9"]


def test_19_ac03_complete_only_consumption_with_unmatched_supply_and_explicit_units():
    prepared = snapshot(
        [
            ("A", GR, 0),
            ("A", IR, 1),
            ("A", GR, 2),
            ("A", IR, 3),
            ("A", CI, 4),
        ]
    )
    answer = evaluate(prepared, fifo())
    case = answer["cases"][0]
    assert [o["stage_row_ids"] for o in case["observations"]] == [
        ["r1", "r2", "r5"],
        ["r3", "r4", None],
    ]
    assert [o["state"] for o in case["observations"]] == ["matched", "unmatched"]
    assert case["included_row_ids"] == ["r1", "r2", "r5"]
    assert case["unmatched_row_ids"] == ["r3", "r4"]
    assert case["totals"]["paired_episode_count"]["value"] == 1
    assert case["totals"]["paired_episode_count"]["unit"] == "inferred_episodes"
    assert case["totals"]["stage_1_unmatched_event_count"]["value"] == 1
    assert case["totals"]["stage_2_unmatched_event_count"]["value"] == 1
    assert case["totals"]["stage_3_unmatched_event_count"]["value"] == 0
    assert case["totals"]["unmatched_event_count"]["unit"] == "original_events"
    assert (
        answer["population_case_count"] == 1 and answer["population_record_count"] == 5
    )


def test_19_ac04_first_relevant_stage_ignores_creation_and_category_unknown_does_not_guess():
    before = "3-way match, invoice before GR"
    prepared = snapshot(
        [
            ("A", "Create Purchase Order Item", 0, "1", before),
            ("A", IR, 1, "2", before),
            ("A", GR, 2, "3", before),
            ("A", CI, 3, "4", before),
        ]
    )
    automatic = evaluate(prepared, fifo(stages="auto_flow"))
    explicit = evaluate(prepared, fifo(stages="gr_ir_ci"))
    observation = automatic["cases"][0]["observations"][0]
    assert observation["stage_row_ids"] == ["r2", "r3", "r4"]
    assert observation["intervals"]["stage_1_to_2"]["value"] == 1
    assert observation["intervals"]["stage_2_to_3"]["value"] == 1
    assert automatic["cases"][0]["record_row_ids"] == ["r1", "r2", "r3", "r4"]
    assert explicit["cases"][0]["totals"]["paired_episode_count"]["value"] == 0
    assert automatic["definition_id"] != explicit["definition_id"]
    for category, reason in [
        ("", "missing_category"),
        ("Unknown", "unrecognized_category"),
    ]:
        unknown = snapshot(
            [
                ("U", GR, 0, "1", category),
                ("U", IR, 1, "2", category),
                ("U", CI, 2, "3", category),
            ]
        )
        case = evaluate(unknown, fifo(stages="auto_flow"))["cases"][0]
        assert case["state"] == "unknown" and case["reason"] == reason
        assert case["observations"] == [] and case["activation_count"] is None
        assert case["record_row_ids"] == ["r1", "r2", "r3"]
        reviewed = evaluate(unknown, fifo(stages="gr_ir_ci"))
        assert reviewed["cases"][0]["totals"]["paired_episode_count"]["value"] == 1


def test_20_ac04_signed_amount_tolerance_and_zero_are_three_independent_cases():
    prepared = snapshot(
        [
            ("O", IR, 1, "1", "2-way match", 100),
            ("O", CANCEL, 2, "2", "2-way match", -100),
            ("T", IR, 1, "3", "2-way match", 100.004),
            ("T", CANCEL, 2, "4", "2-way match", 100),
            ("Z", IR, 1, "5", "2-way match", 0),
            ("Z", CANCEL, 2, "6", "2-way match", 0),
        ]
    )
    exact = evaluate(prepared, cancellation(amount_filter="equal", tolerance=0))
    opposite = evaluate(prepared, cancellation(amount_filter="opposite", tolerance=0))
    loose = evaluate(prepared, cancellation(amount_filter="equal", tolerance=0.01))
    tight = evaluate(prepared, cancellation(amount_filter="equal", tolerance=0.001))
    assert [c["observations"][0]["state"] for c in exact["cases"]] == [
        "unmatched",
        "unmatched",
        "matched",
    ]
    assert [c["observations"][0]["response_row_ids"] for c in opposite["cases"]] == [
        ["r1"],
        [],
        ["r5"],
    ]
    assert loose["cases"][1]["observations"][0]["response_row_ids"] == ["r3"]
    assert tight["cases"][1]["observations"][0]["state"] == "unmatched"
    zero = exact["cases"][2]["observations"][0]
    assert zero["target_value"] == zero["cancellation_value"] == 0
    assert zero["intervals"]["receipt_to_cancellation"]["available"]
    assert len({a["definition_id"] for a in [exact, opposite, loose, tight]}) == 4


@pytest.mark.parametrize("invalid_amount", ["", "NaN", "Infinity"])
def test_20_ac05_distinct_raw_retained_creation_reducers_and_invalid_witnesses(
    invalid_amount,
):
    prepared = snapshot(
        [
            ("A", "Create Purchase Order Item", -1, "1", "2-way match", 100),
            ("A", IR, 0, "2", "2-way match", 100),
            ("A", IR, 1, "3", "2-way match", -20),
            ("A", IR, 2, "4", "2-way match", 0),
            ("A", CANCEL, 1.5, "5", "2-way match", -20),
            ("M", "Create Purchase Order Item", -1, "6", "2-way match", 100),
            ("M", IR, 0, "7", "2-way match", 100),
            ("M", IR, 1, "8", "2-way match", invalid_amount),
            ("M", IR, 2, "9", "2-way match", 0),
        ]
    )
    answer = evaluate(prepared, cancellation())
    known, missing = answer["cases"]
    expected = {
        "raw_receipt_sum": 80,
        "raw_receipt_mean": 80 / 3,
        "raw_receipt_maximum_absolute": 100,
        "unique_creation_value": 100,
        "raw_receipt_zero_count": 1,
        "raw_receipt_negative_count": 1,
        "retained_receipt_sum": 100,
        "retained_receipt_mean": 50,
    }
    for key, value in expected.items():
        assert (
            known["totals"][key]["available"] and known["totals"][key]["value"] == value
        )
    assert known["totals"]["raw_receipt_sum"]["unit"] == "EUR"
    assert known["totals"]["raw_receipt_zero_count"]["unit"] == "original_events"
    assert known["observations"][0]["response_row_ids"] == ["r3"]
    assert known["excluded_row_ids"] == ["r3"]
    assert known["record_row_ids"] == ["r1", "r2", "r3", "r4", "r5"]
    assert known["totals"]["unique_creation_value"]["row_ids"] == ["r1"]
    for key in ["raw_receipt_sum", "raw_receipt_mean", "raw_receipt_maximum_absolute"]:
        unavailable = missing["totals"][key]
        assert unavailable["value"] is None and not unavailable["available"]
        assert unavailable["reason"] == "invalid_or_missing_value"
        assert unavailable["row_ids"] == ["r7", "r8", "r9"]
    assert missing["totals"]["unique_creation_value"]["value"] == 100
    assert missing["totals"]["retained_target_count"]["value"] == 3
    assert missing["record_count"] == 4


def test_22_ac02_ac04_complete_missing_censored_unknown_and_reversed_are_separate():
    prepared = snapshot(
        [
            ("A", "A", 0),
            ("A", "B", 2),
            ("B", "A", 2),
            ("B", "B", 4),
            ("C", "A", 1),
            ("C", "B", 3),
            ("D", "A", 2),
            ("D", "B", 2),
            ("E", "A", 1),
            ("F", "A", 1),
            ("F", "B", None),
            ("G", "A", 4),
            ("G", "B", 2),
        ]
    )
    completed = evaluate(prepared, waiting())
    censored = evaluate(
        prepared,
        waiting(
            completion="right_censored",
            horizon_provenance="Independent synthetic day6 observation authority",
        ),
    )
    complete_e = completed["cases"][4]
    assert (
        complete_e["state"] == "excluded"
        and complete_e["reason"] == "no_recorded_response"
    )
    assert complete_e["observations"][0]["response_row_ids"] == []
    e = censored["cases"][4]["observations"][0]
    assert e["state"] == "censored" and e["reason"] == "trusted_horizon_right_censor"
    assert e["start"] == "2018-01-02T00:00:00" and e["end"] == "2018-01-07T00:00:00"
    assert e["activation_row_ids"] == ["r9"] and e["response_row_ids"] == []
    assert (
        e["selected_row_ids"] == ["r9"]
        and e["intervals"]["waiting_duration"]["value"] == 5
    )
    assert (
        censored["definition"]["recipe"]["horizon_provenance"]
        == "Independent synthetic day6 observation authority"
    )
    inventory = censored["summary"]["occupancy"]
    assert inventory["available_interval_count"] == 5 and inventory["peak"] == 3
    assert (
        inventory["peak_start"] == "2018-01-02T00:00:00"
        and inventory["peak_end"] == "2018-01-03T00:00:00"
    )
    assert inventory["peak_case_ids"] == ["A", "C", "E"]
    f, g = censored["cases"][5:]
    assert f["state"] == "unknown" and f["reason"] == "unknown_response_time"
    assert f["observations"][0]["state"] == "unknown" and f["unknown_row_ids"] == [
        "r11"
    ]
    assert f["observations"][0]["response_row_ids"] == []
    assert g["observations"][0]["state"] == "reversed"
    interval = g["observations"][0]["intervals"]["waiting_duration"]
    assert interval["value"] is None and not interval["available"]
    assert (
        interval["reason"] == "reversed_interval"
        and interval["recorded_difference_days"] == -2
    )
    assert g["observations"][0]["start"] is None and g["observations"][0]["end"] is None
    assert completed["summary"]["occupancy"]["available_interval_count"] == 4
    assert completed["summary"]["occupancy"]["item_days"] == 6
    assert censored["summary"]["occupancy"]["item_days"] == 11
    assert completed["definition_id"] != censored["definition_id"]


def test_26_ac01_exact_activation_support_partners_counts_and_whole_history():
    prepared = snapshot([("K", "A", 0), ("K", "B", 1), ("K", "A", 2)])
    every = evaluate(prepared, rule())
    some = evaluate(prepared, rule(quantifier="some"))
    case = every["cases"][0]
    assert [o["activation_row_ids"] for o in case["observations"]] == [["r1"], ["r3"]]
    assert [o["response_row_ids"] for o in case["observations"]] == [["r2"], []]
    assert case["totals"]["matched_activation_count"]["value"] == 1
    assert case["totals"]["nonmatching_activation_count"]["value"] == 1
    assert case["activation_count"] == 2 and every["population_case_count"] == 1
    assert case["truth"] == "false" and some["cases"][0]["truth"] == "true"
    assert case["record_row_ids"] == ["r1", "r2", "r3"] and case["record_count"] == 3


def test_26_ac02_raw_direct_uses_unprojected_original_records_and_eventual_is_distinct():
    prepared = snapshot([("K", "A", 0), ("K", "X", 0.5), ("K", "B", 1), ("K", "A", 2)])
    direct = evaluate(prepared, rule(position="raw_direct"))
    eventual = evaluate(prepared, rule(position="eventual"))
    assert [o["response_row_ids"] for o in direct["cases"][0]["observations"]] == [
        [],
        [],
    ]
    assert [o["response_row_ids"] for o in eventual["cases"][0]["observations"]] == [
        ["r3"],
        [],
    ]
    assert direct["cases"][0]["totals"]["matched_activation_count"]["value"] == 0
    assert eventual["cases"][0]["totals"]["matched_activation_count"]["value"] == 1
    assert direct["cases"][0]["record_row_ids"] == ["r1", "r2", "r3", "r4"]
    assert direct["definition_id"] != eventual["definition_id"]
    assert (
        direct["definition"]["original_history_policy"]
        == "immutable_complete_item_histories"
    )


def test_26_ac03_partner_reuse_count_and_consuming_count_have_distinct_identity():
    prepared = snapshot([("K", "A", 0), ("K", "A", 1), ("K", "B", 2)])
    reuse = evaluate(prepared, rule(reuse="allow"))
    consume = evaluate(prepared, rule(reuse="consume"))
    a, b = reuse["cases"][0], consume["cases"][0]
    assert [o["response_row_ids"] for o in a["observations"]] == [["r3"], ["r3"]]
    assert [o["response_row_ids"] for o in b["observations"]] == [["r3"], []]
    assert a["truth"] == "true" and b["truth"] == "false"
    assert (
        a["totals"]["partner_use_count"]["value"] == 2
        and b["totals"]["partner_use_count"]["value"] == 1
    )
    assert (
        reuse["definition_id"] != consume["definition_id"]
        and reuse["result_id"] != consume["result_id"]
    )
    assert [o["native_invoice_id"] for o in a["observations"]] == [None, None]


def test_26_ac05_known_empty_default_logical_vacuity_and_unknown_absence():
    prepared = snapshot([("K", "B", 1)])
    observed = evaluate(prepared, rule())
    logical = evaluate(prepared, rule(vacuity="logical"))
    case = observed["cases"][0]
    assert case["activation_count"] == case["known_activation_count"] == 0
    assert case["state"] == "not_activated" and case["truth"] is None
    assert case["observations"] == [] and case["reason"] == "no_known_activation"
    # The typed receipt serializes vacuously true as true + the explicit empty
    # quantification reason; no observed matching activation is fabricated.
    empty = logical["cases"][0]
    assert (
        empty["truth"] == "true" and empty["reason"] == "logical_empty_quantification"
    )
    assert empty["activation_count"] == 0 and empty["observations"] == []
    assert logical["definition_id"] != observed["definition_id"]
    unknown = evaluate(snapshot([("K", "B", 1), ("K", None, 2)]), rule())["cases"][0]
    assert (
        unknown["activation_count"] is None and unknown["known_activation_count"] == 0
    )
    assert unknown["truth"] == "unknown" and unknown["unknown_row_ids"] == ["r2"]


def test_26_ac10_unrelated_unknown_time_missing_label_and_unknown_partner_are_separate():
    prepared = snapshot([("K", "A", 0), ("K", "B", 1), ("K", "X", None)])
    for quantifier in ["some", "every"]:
        case = evaluate(prepared, rule(quantifier=quantifier))["cases"][0]
        assert case["truth"] == "true" and case["activation_count"] == 1
        assert case["observations"][0]["response_row_ids"] == ["r2"]
        assert case["unknown_row_ids"] == [] and case["record_row_ids"] == [
            "r1",
            "r2",
            "r3",
        ]
    prepared = snapshot([("K", "A", 0), ("K", "B", 1), ("K", None, 2)])
    some, every = evaluate(prepared, rule(quantifier="some")), evaluate(
        prepared, rule()
    )
    assert (
        some["cases"][0]["truth"] == "true" and every["cases"][0]["truth"] == "unknown"
    )
    assert every["cases"][0]["activation_count"] is None and every["cases"][0][
        "unknown_row_ids"
    ] == ["r3"]
    assert every["cases"][0]["observations"][0]["response_row_ids"] == ["r2"]
    unknown = evaluate(snapshot([("K", "A", 0), ("K", "B", None)]), rule())["cases"][0]
    assert (
        unknown["truth"] == "unknown"
        and unknown["observations"][0]["truth"] == "unknown"
    )
    assert unknown["observations"][0]["unknown_row_ids"] == ["r2"]
    assert unknown["observations"][0]["response_row_ids"] == []


@pytest.mark.parametrize(
    "events,expected_states,some,every",
    [
        (
            [("K", "A", 0), ("K", "B", 1), ("K", "A", None)],
            ["true", "unknown"],
            "true",
            "unknown",
        ),
        (
            [("K", "A", 2), ("K", "A", None), ("K", "B", 1)],
            ["false", "unknown"],
            "unknown",
            "false",
        ),
        (
            [("K", "A", 2), ("K", "A", 3), ("K", "B", 1)],
            ["false", "false"],
            "false",
            "false",
        ),
        (
            [("K", "A", 0), ("K", "A", 1), ("K", "B", 2)],
            ["true", "true"],
            "true",
            "true",
        ),
    ],
)
def test_26_ac11_literal_three_valued_quantifier_table(
    events, expected_states, some, every
):
    prepared = snapshot(events)
    for quantifier, expected in [("some", some), ("every", every)]:
        case = evaluate(prepared, rule(quantifier=quantifier))["cases"][0]
        assert [o["truth"] for o in case["observations"]] == expected_states
        assert case["truth"] == expected
        assert case["activation_count"] == case["known_activation_count"] == 2


def test_26_ac11_unknown_additional_support_cannot_erase_existential_true_or_universal_false():
    true_with_unknown = snapshot([("K", "A", 0), ("K", "B", 1), ("K", None, 2)])
    false_with_unknown = snapshot([("K", None, 0), ("K", "B", 1), ("K", "A", 2)])
    assert (
        evaluate(true_with_unknown, rule(quantifier="some"))["cases"][0]["truth"]
        == "true"
    )
    assert evaluate(true_with_unknown, rule())["cases"][0]["truth"] == "unknown"
    # The unknown-label record is known earlier than the final activation, so
    # it cannot supply a later response and erase that confirmed nonmatch.
    every = evaluate(false_with_unknown, rule())["cases"][0]
    assert every["activation_count"] is None and every["known_activation_count"] == 1
    assert every["observations"][0]["truth"] == every["truth"] == "false"
    assert every["unknown_row_ids"] == ["r1"]
