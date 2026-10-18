"""Independent raw-record oracles for BPIC19 descriptive measurement policies."""

from datetime import datetime

import pytest

from wise_platform_analytics.bpic19_measures import build_historical_features, build_paper_features, derive_case_measures, measure_population
from wise_platform_analytics.preparation import PreparedData, PreparedRecord


def snapshot(events):
    columns = ("case", "activity", "time", "case Item Category", "event org:resource",
               "event Cumulative net worth (EUR)", "case Purchasing Document", "case Company", "case Spend area text")
    rows = []
    histories = {}
    for index, (case, activity, time, category, resource, value) in enumerate(events, 1):
        moment = datetime.fromisoformat(time) if time else None
        cells = (case, activity, time or "", category, resource, str(value), "document", "company", "Packaging")
        row = PreparedRecord(f"row-{index}", index, case, None, activity, "wall_clock", None,
                             time, "usable" if moment else "missing", (), cells, moment)
        rows.append(row)
        histories.setdefault(case, []).append(row)
    return PreparedData("source", "preparation", "representation", "dictionary", "population", "0.1.0",
                        columns, tuple(rows), {key: tuple(value) for key, value in histories.items()}, {}, {}, {}, {})


def test_counts_remain_available_when_time_and_attribution_are_missing():
    prepared = snapshot([
        ("a", "Create Purchase Order Item", None, "3-way match, invoice before GR", "NONE", 20),
        ("a", "Record Invoice Receipt", None, "3-way match, invoice before GR", "user_02", 20),
    ])
    feature = derive_case_measures(prepared, "a")
    assert feature["flow"] == "DF2"
    assert feature["measures"]["invoice_count"]["value"] == 1
    assert feature["measures"]["clearing_count"]["value"] == 0
    assert feature["measures"]["clearing_count"]["available"] is True
    assert feature["measures"]["clearing_count"]["absence_row_ids"] == ["row-1", "row-2"]
    assert feature["measures"]["invoice_to_clearing_days"]["available"] is False
    assert feature["measures"]["user_event_count"]["reason"] == "incomplete_resource_attribution"
    assert feature["representations"]["exact_sequence"] is None


def test_unknown_activity_does_not_become_proved_absence_but_value_and_resource_are_local():
    prepared = snapshot([("a", None, "2018-01-01T00:00:00", "2-way match", "user_1", 7)])
    feature = build_historical_features(prepared, ["a"])[0]
    assert feature["record_count"] == 1 and feature["activity_counts"] == {}
    assert feature["activity_counts_available"] is False
    assert feature["measures"]["invoice_count"]["reason"] == "missing_activity_label"
    assert feature["historical_measures"]["historical_invoice_count"]["value"] is None
    assert feature["measures"]["exposure"]["value"] == 7
    assert feature["measures"]["user_event_count"]["value"] == 1
    assert feature["representations"]["exact_sequence"] is None


def test_invalid_earlier_parsed_minimum_is_not_replaced_by_valid_later_endpoint():
    prepared = snapshot([
        ("a", "Record Invoice Receipt", "1948-01-01T00:00:00", "3-way match, invoice after GR", "user_1", 5),
        ("a", "Record Invoice Receipt", "2018-01-01T00:00:00", "3-way match, invoice after GR", "user_1", 5),
        ("a", "Clear Invoice", "2018-01-31T00:00:00", "3-way match, invoice after GR", "batch_1", 5),
    ])
    feature = derive_case_measures(prepared, "a")
    assert feature["milestones"]["invoice"]["selected_row_id"] == "row-1"
    assert feature["measures"]["invoice_to_clearing_days"]["reason"] == "minimum_outside_admissible_range"
    assert feature["measures"]["invoice_count"]["value"] == 2


def test_independent_minima_are_not_first_after_and_ties_are_valid_zero():
    prepared = snapshot([
        ("a", "Clear Invoice", "2018-01-01T00:00:00", "3-way match, invoice before GR", "batch_1", 5),
        ("a", "Record Invoice Receipt", "2018-01-02T00:00:00", "3-way match, invoice before GR", "batch_1", 5),
        ("a", "Clear Invoice", "2018-02-02T00:00:00", "3-way match, invoice before GR", "batch_1", 5),
        ("b", "Record Invoice Receipt", "2018-02-02T00:00:00", "3-way match, invoice after GR", " BATCH_01 ", 0),
        ("b", "Record Service Entry Sheet", "2018-02-02T00:00:00", "3-way match, invoice after GR", "batch_02", 0),
        ("b", "Clear Invoice", "2018-02-02T00:00:00", "3-way match, invoice after GR", "batch_02", 0),
    ])
    a, b = build_paper_features(prepared, ["a", "b"])
    assert a["measures"]["invoice_to_clearing_days"]["reason"] == "reversed_interval"
    assert a["measures"]["invoice_to_clearing_days"]["recorded_difference_days"] == -1
    assert b["measures"]["invoice_to_clearing_days"]["value"] == 0
    assert b["measures"]["invoice_precedes_receipt"]["value"] == 0
    assert b["measures"]["receipt_count"]["row_ids"] == ["row-5"]
    assert b["measures"]["user_event_count"]["value"] == 0
    assert b["measures"]["distinct_user_count"]["value"] == 0


def test_resource_full_match_and_identity_normalization_do_not_guess_missing_users():
    prepared = snapshot([
        ("a", "Change Price", "2018-01-01T00:00:00", "Consignment", " User_01 ", 0),
        ("a", "Change Quantity", "2018-01-01T00:00:00", "Consignment", "USER_01", 0),
        ("a", "Clear Invoice", "2018-01-02T00:00:00", "Consignment", "batch_9", 0),
        ("b", "Clear Invoice", "2018-01-01T00:00:00", "2-way match", "user_1_suffix", 5),
    ])
    a, b = build_paper_features(prepared, ["a", "b"])
    assert a["measures"]["user_event_count"]["value"] == 2
    assert a["measures"]["distinct_user_count"]["value"] == 1
    assert a["measures"]["edit_count"]["value"] == 2
    assert b["measures"]["user_event_count"]["invalid_row_ids"] == ["row-4"]
    assert b["measures"]["user_event_count"]["value"] is None


def test_value_reducers_and_signatures_retain_different_meanings():
    prepared = snapshot([
        ("a", "Create Purchase Order Item", "2018-01-01T00:00:00", "Consignment", "user_1", -10),
        ("a", "Record Goods Receipt", "2018-01-02T00:00:00", "Consignment", "user_1", 12),
        ("a", "Create Purchase Order Item", "2018-01-03T00:00:00", "Consignment", "user_1", 8),
    ])
    result = derive_case_measures(prepared, "a")
    assert result["measures"]["creation_value"]["reason"] == "conflicting_creation_values"
    assert result["measures"]["exposure"]["value"] == 12
    assert result["representations"]["exact_sequence"] == ["Create Purchase Order Item", "Record Goods Receipt", "Create Purchase Order Item"]
    assert result["representations"]["first_occurrence_signature"] == ["Create Purchase Order Item", "Record Goods Receipt"]


def test_paging_does_not_recalibrate_summary_or_result_identity():
    prepared = snapshot([
        ("a", "Record Invoice Receipt", "2018-01-01T00:00:00", "2-way match", "user_1", 1),
        ("a", "Clear Invoice", "2018-01-11T00:00:00", "2-way match", "user_2", 1),
        ("b", "Record Invoice Receipt", "2018-01-01T00:00:00", "2-way match", "user_1", 2),
        ("b", "Clear Invoice", "2018-01-21T00:00:00", "2-way match", "user_2", 2),
    ])
    first = measure_population(prepared, ["a", "b"], offset=0, limit=1)
    second = measure_population(prepared, ["a", "b"], offset=1, limit=1)
    assert first["result_id"] == second["result_id"]
    assert first["summaries"] == second["summaries"]
    assert first["summaries"]["invoice_to_clearing_days"]["mean"] == 15
    assert [row["case_id"] for row in first["cases"]] == ["a"]
    assert [row["case_id"] for row in second["cases"]] == ["b"]


@pytest.mark.parametrize("value", [True, -1, 99])
def test_invalid_role_indices_are_refused(value):
    prepared = snapshot([("a", "Clear Invoice", "2018-01-01T00:00:00", "2-way match", "user_1", 1)])
    result = measure_population(prepared, ["a"], {"resource": value})
    assert result.code == "invalid_parameter"


def test_historical_union_sentinel_resources_and_calibration_are_not_paper_semantics():
    prepared = snapshot([
        ("a", "Vendor creates invoice", "1948-01-01T00:00:00", "3-way match, invoice after GR", "NONE", 10),
        ("a", "Record Goods Receipt", "2018-01-01T00:00:00", "3-way match, invoice after GR", "legacy_system", 10),
        ("a", "Record Invoice Receipt", "2018-01-02T00:00:00", "3-way match, invoice after GR", "user_1", 10),
        ("a", "Clear Invoice", "2018-01-03T00:00:00", "3-way match, invoice after GR", "batch_1", 10),
        ("a", "Change Price", "2018-01-03T00:00:00", "3-way match, invoice after GR", "user_1", 10),
        ("b", "Vendor creates debit memo", "2018-01-01T00:00:00", "2-way match", "batch_x", 20),
    ])
    a, b = build_historical_features(prepared, ["a", "b"])
    assert a["measures"]["user_event_count"]["available"] is False
    assert a["historical_measures"]["historical_manual_touch_count"]["value"] == 3
    assert a["historical_measures"]["historical_distinct_human_resources"]["value"] == 2
    assert a["historical_measures"]["historical_invoice_count"]["value"] == 2
    assert a["historical_measures"]["historical_invoice_precedes_receipt"]["value"] == 1
    assert a["historical_measures"]["historical_goods_to_invoice_days"]["reason"] == "reversed_interval"
    assert a["historical_policy"]["calibration"]["quantile"] == 19.5
    assert a["historical_measures"]["historical_price_exposure"]["value"] == pytest.approx(10 / 19.5)
    assert b["historical_measures"]["historical_memo_exposure"]["value"] == 1
    assert b["historical_measures"]["historical_manual_touch_count"]["value"] == 0


def test_historical_cv_is_sample_sd_and_missing_value_fill_is_explicit():
    prepared = snapshot([
        ("a", "Record Goods Receipt", "2018-01-01T00:00:00", "Consignment", "user_1", 10),
        ("a", "Record Goods Receipt", "2018-01-01T00:00:00", "Consignment", "user_1", 20),
        ("b", "Record Goods Receipt", "2018-01-01T00:00:00", "Consignment", "NONE", ""),
    ])
    a, b = build_historical_features(prepared, ["a", "b"])
    assert a["historical_measures"]["historical_networth_cv"]["value"] == pytest.approx(7.0710678118654755 / 15)
    assert a["historical_measures"]["event_replication_ratio"]["value"] == 2
    assert b["measures"]["exposure"]["available"] is False
    assert b["historical_measures"]["exposure_abs_max"]["value"] == 0
    assert b["historical_measures"]["historical_networth_cv"]["missing_fill_row_ids"] == ["row-3"]
    assert b["historical_policy"]["calibration"]["missing_case_count"] == 1


def test_historical_page_uses_a_frozen_calibration_population():
    prepared = snapshot([
        ("a", "Change Price", "2018-01-01T00:00:00", "2-way match", "user_1", 10),
        ("b", "Change Price", "2018-01-01T00:00:00", "2-way match", "user_1", 20),
    ])
    selected = measure_population(prepared, ["a"], measure_profile="historical_v1", calibration_case_ids=["a", "b"])
    assert selected["definition"]["calibration"]["case_count"] == 2
    assert selected["cases"][0]["historical_measures"]["exposure_norm"]["value"] == pytest.approx(10 / 19.5)


def literal_activity_parent():
    """T05: independent A/B/C rows, with no Flow/Norm dependency."""
    return snapshot([
        ("A", "Record Invoice Receipt", "2018-01-01T00:00:00", "", "", 100),
        ("A", "Record Invoice Receipt", "2018-01-01T00:00:00", "", "", 100),
        ("A", "Clear Invoice", "2018-01-02T00:00:00", "", "", 100),
        ("A", "Change Price", "2018-01-03T00:00:00", "", "", 100),
        ("A", "Change Quantity", "2018-01-04T00:00:00", "", "", 100),
        ("A", "Cancel Invoice Receipt", "2018-01-05T00:00:00", "", "", 100),
        ("B", "Vendor creates invoice", "2018-01-01T00:00:00", "", "", 100),
        ("C", "Unrelated", None, "", "", ""),
    ])


def test_literal_t05_selectors_operators_complete_histories_and_zero_support():
    prepared = literal_activity_parent()
    answer = measure_population(prepared, ["A", "B", "C"])
    assert [case["activity_measure"]["count"]["value"] for case in answer["cases"]] == [2, 0, 0]
    assert [case["activity_measure"]["presence"]["value"] for case in answer["cases"]] == [1, 0, 0]
    assert [case["activity_measure"]["repeat_quantity"]["value"] for case in answer["cases"]] == [1, 0, 0]
    assert answer["cases"][0]["activity_measure"]["matching_row_ids"] == ["row-1", "row-2"]
    assert answer["cases"][1]["activity_measure"]["absence_row_ids"] == ["row-7"]
    assert answer["cases"][2]["activity_measure"]["absence_row_ids"] == ["row-8"]
    assert answer["cases"][0]["record_row_ids"] == ["row-1", "row-2", "row-3", "row-4", "row-5", "row-6"]
    assert answer["cases"][0]["measures"]["cancellation_count"]["value"] == 1
    assert answer["activity_cohorts"]["presence_positive_case_ids"] == ["A"]
    assert answer["activity_cohorts"]["presence_absent_case_ids"] == ["B", "C"]
    assert answer["activity_cohorts"]["presence_fraction"] == 1 / 3
    assert answer["activity_cohorts"]["repeated_presence_fraction"] == 1 / 3
    assert answer["summaries"]["selected_activity"]["zero_case_count"] == 2
    union = measure_population(prepared, ["A", "B", "C"], definition={"activity_selector": ["Record Invoice Receipt", "Vendor creates invoice"]})
    assert [case["activity_measure"]["count"]["value"] for case in union["cases"]] == [2, 1, 0]
    assert union["definition_id"] != answer["definition_id"]
    edit = measure_population(prepared, ["A"], definition={"activity_selector": ["Change Price", "Change Quantity", "Change Price"]})
    equivalent = measure_population(prepared, ["A"], definition={"activity_selector": ["Change Quantity", "Change Price"]})
    assert edit["definition_id"] == equivalent["definition_id"]
    assert edit["cases"][0]["activity_measure"]["count"]["value"] == 2
    assert edit["cases"][0]["activity_measure"]["matching_row_ids"] == ["row-4", "row-5"]
    empty = measure_population(prepared, [])
    assert empty["population_case_count"] == empty["population_record_count"] == 0
    assert empty["activity_cohorts"]["presence_fraction"] is None
    assert empty["activity_cohorts"]["reason"] == "empty_denominator"


def test_literal_t05_missing_labels_preserve_finite_lower_bound_indicators():
    prepared = snapshot([
        ("D", None, None, "", "", ""), ("D", "Other", None, "", "", ""),
        ("E", "Record Invoice Receipt", None, "", "", ""), ("E", None, None, "", "", ""),
        ("F", "Record Invoice Receipt", None, "", "", ""), ("F", "Record Invoice Receipt", None, "", "", ""), ("F", None, None, "", "", ""),
    ])
    cases = measure_population(prepared, ["D", "E", "F"])["cases"]
    assert [case["activity_measure"]["lower_bound"] for case in cases] == [0, 1, 2]
    assert [case["activity_measure"]["count"]["value"] for case in cases] == [None, None, None]
    assert [case["activity_measure"]["repeat_quantity"]["value"] for case in cases] == [None, None, None]
    assert [case["activity_measure"]["presence"]["value"] for case in cases] == [None, 1, 1]
    assert [case["activity_measure"]["repeated_presence"]["value"] for case in cases] == [None, None, 1]
    assert [case["activity_measure"]["unknown_row_ids"] for case in cases] == [["row-1"], ["row-4"], ["row-7"]]
    assert all(case["activity_measure"]["absence_row_ids"] == [] for case in cases)


def test_literal_t07_cominima_parse_support_signed_diagnostic_and_union():
    prepared = snapshot([
        ("A", "Record Invoice Receipt", "2018-01-01T00:00:00", "", "", 1),
        ("A", "Record Invoice Receipt", "2018-01-01T00:00:00", "", "", 1),
        ("A", "Record Invoice Receipt", None, "", "", 1),
        ("A", "Record Invoice Receipt", "2018-01-03T00:00:00", "", "", 1),
        ("A", "Clear Invoice", "2018-01-02T00:00:00", "", "", 1),
        ("A", "Clear Invoice", "2018-01-10T00:00:00", "", "", 1),
        ("A", "Record Goods Receipt", "2018-01-03T00:00:00", "", "", 1),
        ("A", "Record Service Entry Sheet", "2018-01-02T00:00:00", "", "", 1),
    ])
    case = derive_case_measures(prepared, "A")
    assert case["measures"]["selected_interval"]["value"] == 1
    assert case["milestones"]["source"]["row_ids"] == ["row-1", "row-2"]
    assert case["milestones"]["source"]["selected_row_id"] == "row-1"
    assert case["milestones"]["source"]["unparseable_row_ids"] == ["row-3"]
    assert case["milestones"]["source"]["later_row_ids"] == ["row-4"]
    assert case["milestones"]["target"]["later_row_ids"] == ["row-6"]
    assert case["milestones"]["receipt"]["row_ids"] == ["row-8"]
    receipt = derive_case_measures(prepared, "A", definition={"interval_source": ["Record Goods Receipt", "Record Service Entry Sheet"]})
    assert receipt["measures"]["selected_interval"]["value"] == 0
    assert receipt["milestones"]["source"]["row_ids"] == ["row-8"]


@pytest.mark.parametrize("source,target,expected,state", [
    ("2017-01-01T00:00:00", "2017-01-01T21:36:00", .9, "available"),
    ("2020-01-01T00:00:00", "2020-01-02T00:00:00", None, "endpoint_unavailable"),
    ("2018-01-01T01:00:00+01:00", "2018-01-01T00:00:00+00:00", 0, "available"),
    ("2018-01-10T00:00:00", "2018-01-09T00:00:00", None, "reversed"),
])
def test_literal_t07_clock_boundaries_fractional_and_reversed(source, target, expected, state):
    case = derive_case_measures(snapshot([
        ("A", "Record Invoice Receipt", source, "", "", 1),
        ("A", "Clear Invoice", target, "", "", 1),
    ]), "A")
    assert case["measures"]["selected_interval"]["value"] == expected
    assert case["measures"]["selected_interval"]["interval_state"] == state
    if state == "reversed": assert case["measures"]["selected_interval"]["recorded_difference_days"] == -1
    if source.startswith("2020"): assert case["milestones"]["source"]["endpoint_state"] == "out_of_range"


def test_literal_t08_actor_classifications_unknown_lower_bounds_and_denominators():
    prepared = snapshot([
        ("A", "Record Invoice Receipt", None, "", " USER_1 ", 1),
        ("A", "Other", None, "", "user_1", 1),
        ("A", "Other", None, "", "batch_2", 1),
        ("A", "Other", None, "", "user_2", 1),
        ("B", "Other", None, "", "batch_1", 1), ("B", "Other", None, "", "batch_2", 1),
        ("D", "Record Invoice Receipt", None, "", "user_1", 1), ("D", "Other", None, "", "NONE", 1),
    ])
    a, b, d = build_paper_features(prepared, ["A", "B", "D"])
    assert a["actor_records"][0] == {"row_id": "row-1", "raw": " USER_1 ", "normalized": "user_1", "classification": "user"}
    assert a["actor_summary"]["known_user_event_count"] == 3
    assert a["actor_summary"]["distinct_normalized_user_count"] == 2
    assert a["actor_summary"]["batch_all_share"] == 1 / 4
    assert a["actor_summary"]["batch_human_ratio"] == 1 / 3
    assert b["measures"]["user_event_count"]["value"] == b["measures"]["distinct_user_count"]["value"] == 0
    assert b["actor_summary"]["batch_event_count"] == 2
    assert d["measures"]["user_event_count"]["value"] is None
    assert d["measures"]["user_event_count"]["lower_bound"] == 1
    assert d["actor_summary"]["unknown_event_count"] == 1
    assert d["measures"]["invoice_count"]["value"] == 1
    assert d["actor_records"][1]["raw"] == "NONE"


@pytest.mark.parametrize("raw,classification", [("NONE", "unknown"), ("", "unknown"), ("user_1_extra", "unknown"), ("robot", "unknown"), ("batch_x", "unknown"), ("user_12", "user"), ("batch_003", "batch")])
def test_literal_t08_full_match_is_not_substring_or_prefix(raw, classification):
    case = derive_case_measures(snapshot([("A", "Other", None, "", raw, 0)]), "A")
    assert case["actor_records"][0]["classification"] == classification


def test_literal_t09_unique_creation_value_is_distinct_from_event_recipe_and_maxabs():
    prepared = snapshot([
        ("A", "Create Purchase Order Item", None, "", "", 100), ("A", "Record Goods Receipt", None, "", "", 200), ("A", "Clear Invoice", None, "", "", 100),
        ("B", "Create Purchase Order Item", None, "", "", 100), ("B", "Create Purchase Order Item", None, "", "", 100),
        ("C", "Create Purchase Order Item", None, "", "", 100), ("C", "Create Purchase Order Item", None, "", "", 120),
    ])
    answer = measure_population(prepared, ["A", "B", "C"], definition={"value_unit": "EUR"})
    a, b, c = answer["cases"]
    assert a["measures"]["creation_value"]["value"] == 100
    assert a["measures"]["exposure"]["value"] == 200
    assert a["measures"]["exposure"]["winner_row_ids"] == ["row-2"]
    assert b["measures"]["creation_value"]["value"] == 100
    assert b["measures"]["creation_value"]["candidate_count"] == 2
    assert b["measures"]["creation_value"]["row_ids"] == ["row-4", "row-5"]
    assert c["measures"]["creation_value"]["state"] == "conflicting"
    assert c["measures"]["creation_value"]["value"] is None
    event = measure_population(prepared, ["B", "C"], definition={"value_reducer": "unique_creation_event"})
    assert [case["measures"]["selected_value"]["reason"] for case in event["cases"]] == ["creation_event_not_unique", "creation_event_not_unique"]
    assert event["definition_id"] != answer["definition_id"]


@pytest.mark.parametrize("raw,creation,exposure,state", [("1.2E+3", 1200, 1200, "finite"), ("-5", -5, 5, "finite"), ("0", 0, 0, "finite"), ("", None, None, "missing"), ("NaN", None, None, "invalid_nonfinite"), ("Infinity", None, None, "invalid_nonfinite"), ("-Infinity", None, None, "invalid_nonfinite"), ("1,5", None, None, "invalid_numeric")])
def test_literal_t09_numeric_state_preserves_original_text(raw, creation, exposure, state):
    case = derive_case_measures(snapshot([("A", "Create Purchase Order Item", None, "", "", raw)]), "A")
    assert case["amount_records"][0]["raw"] == raw
    assert case["amount_records"][0]["state"] == state
    assert case["measures"]["creation_value"]["value"] == creation
    assert case["measures"]["exposure"]["value"] == exposure


def test_literal_t09_frozen_linear_p95_subset_zero_fallback_empty_refusal_and_bands():
    prepared = snapshot([(case, "Create Purchase Order Item", None, "", "", value) for case, value in [("M", ""), ("A", 10), ("B", 20), ("C", 30), ("D", 40)]])
    full = measure_population(prepared, ["M", "A", "B", "C", "D"], measure_profile="historical_v1")
    assert full["definition"]["calibration"]["quantile"] == 38
    assert full["definition"]["calibration"]["denominator"] == 38
    assert full["definition"]["calibration"]["position"] == 3.8
    assert {case["case_id"]: case["historical_measures"]["exposure_norm"]["value"] for case in full["cases"]} == {"M": 0, "A": 10 / 38, "B": 20 / 38, "C": 30 / 38, "D": 1}
    selected = measure_population(prepared, ["A", "B"], measure_profile="historical_v1", calibration_case_ids=["M", "A", "B", "C", "D"])
    assert selected["definition"]["calibration"] == full["definition"]["calibration"]
    assert [case["historical_measures"]["exposure_norm"]["value"] for case in selected["cases"]] == [10 / 38, 20 / 38]
    zero = measure_population(snapshot([("A", "Other", None, "", "", 0), ("B", "Other", None, "", "", 0)]), ["A", "B"], measure_profile="historical_v1")
    assert zero["definition"]["calibration"]["quantile"] == 0
    assert zero["definition"]["calibration"]["denominator"] == 1
    empty = measure_population(prepared, [], measure_profile="historical_v1", calibration_case_ids=[])
    assert empty.code == "empty_calibration"
    tied = snapshot([(case, "Create Purchase Order Item", None, "", "", 10) for case in ["Z", "A", "B"]])
    bands = measure_population(tied, ["Z", "A", "B"], definition={"value_band_edges": [10, 20]})
    assert [case["selected_value_band"] for case in bands["cases"]] == [1, 1, 1]
    assert bands["value_bands"][1]["case_ids"] == ["A", "B", "Z"]


def test_literal_t17_original_repetition_suppression_and_distinct_support():
    prepared = snapshot([
        ("A", "A", "2018-01-01T00:00:00", "", "", 0), ("A", "B", "2018-01-01T01:00:00", "", "", 0),
        ("A", "B", "2018-01-01T01:00:00", "", "", 0), ("A", "B", "2018-01-01T02:00:00", "", "", 0),
        ("A", "A", "2018-01-01T03:00:00", "", "", 0),
        ("B", "A", "2018-01-01T00:00:00", "", "", 0), ("B", "B", "2018-01-01T01:00:00", "", "", 0),
    ])
    answer = measure_population(prepared, ["A", "B"])
    reps = answer["cases"][0]["representations"]
    assert reps["exact_sequence"] == ["A", "B", "B", "B", "A"]
    assert reps["first_occurrence_signature"] == ["A", "B"]
    assert reps["signature_suppressed_row_ids"] == ["row-3", "row-4", "row-5"]
    assert reps["signature_retained_row_ids"] == ["row-1", "row-2"]
    assert reps["exact_representation_id"] != reps["signature_representation_id"]
    assert [group["case_count"] for group in answer["representation_groups"]["exact"]] == [1, 1]
    group = answer["representation_groups"]["first_occurrence"][0]
    assert group["case_ids"] == ["A", "B"] and group["case_count"] == 2 and group["record_count"] == 7
    exact = measure_population(prepared, ["A", "B"], definition={"representation_policy": "exact"})
    assert exact["definition_id"] != answer["definition_id"]
    unsupported = measure_population(prepared, ["A"], definition={"representation_policy": "adjacent_same_label_same_time"})
    assert unsupported.code == "unsupported_definition"
