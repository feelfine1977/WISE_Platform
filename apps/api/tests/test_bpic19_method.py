"""Independent literal scientific checks across the packed Method seam."""

import copy
import json
from datetime import datetime

import pytest

from wise_platform_api.bpic19_method import evaluate_features, historical_catalogue, paper_norm_document
from wise_platform_analytics.bpic19_measures import build_historical_features, build_paper_features
from wise_platform_analytics.preparation import PreparedData, PreparedRecord


def feature(case_id="A", flow="DF1", **values):
    measurements = {
        "invoice_count": 1,
        "clearing_count": 1,
        "receipt_count": 1,
        "invoice_to_clearing_days": 0,
        "invoice_precedes_receipt": 0,
        "cancellation_count": 0,
        "edit_count": 0,
        "user_event_count": 2,
        "distinct_user_count": 1,
        "creation_value": 10,
        "exposure": 10,
    }
    measurements.update(values)
    return {
        "case_id": case_id,
        "flow": flow,
        "company": case_id,
        "spend_area": "Parts",
        "document": case_id,
        "record_count": 4,
        "activity_counts": {
            "Record Invoice Receipt": 1,
            "Clear Invoice": 1,
            "Record Goods Receipt": 1,
            "Create Purchase Order Item": 1,
        },
        "measures": {
            key: {
                "value": value,
                "available": value is not None,
                "reason": None if value is not None else "literal_missing_measurement",
                "row_ids": [case_id + ":" + key],
            }
            for key, value in measurements.items()
        },
    }


def verdict(case, key):
    return next(c for c in case["criteria"] if c["criterion_id"] == key)


def test_exact_paper_scope_and_missing_state_preserve_completion_and_evidence():
    inputs = [
        feature("DF1", invoice_to_clearing_days=60),
        feature(
            "DF2",
            "DF2",
            clearing_count=0,
            invoice_to_clearing_days=None,
            user_event_count=None,
            distinct_user_count=None,
        ),
        feature("CONS", "Consignment", receipt_count=0, cancellation_count=1),
        feature("UNKNOWN", None, cancellation_count=1),
    ]
    assessment = evaluate_features(inputs)
    one, two, cons, unknown = [assessment.case(f["case_id"]) for f in inputs]
    assert one["score"] == pytest.approx(0.95)  # 0.5 / ten equal criteria
    assert verdict(two, "C02")["deviation"] == 1  # known absence is a evaluated violation
    assert verdict(two, "C04")["reason"] == "missing_attribute"
    assert verdict(two, "C04")["deviation"] is None
    assert two["score"] == pytest.approx(5 / 6)
    assert two["coverage"] == pytest.approx(6 / 9)
    assert verdict(cons, "C03")["reason"] == "out_of_scope"
    assert cons["score"] == pytest.approx(0.75)  # only four all-flow criteria
    assert verdict(unknown, "C01")["reason"] == "scope_unknown"
    assert unknown["scope_unknown_count"] == 6
    assert unknown["score"] == pytest.approx(0.75)
    assert unknown["coverage"] is None  # the full in-scope denominator cannot be known


def test_paper_exemplar_and_stakeholder_weights_are_literal_reference_values():
    assessment = evaluate_features(
        [
            feature(
                "4507005472_00040",
                "DF2",
                invoice_to_clearing_days=69.040972,
                user_event_count=None,
                distinct_user_count=None,
            )
        ]
    )
    case = assessment.case("4507005472_00040")
    severity = (69.040972 - 30) / 60
    assert verdict(case, "C04")["deviation"] == pytest.approx(severity)
    assert case["score"] == pytest.approx(1 - severity / 7)
    assert case["coverage"] == pytest.approx(7 / 9)
    assert case["scores"]["Completion"] == pytest.approx(1 - severity * 2 / 14)
    assert case["scores"]["Operations"] == pytest.approx(1 - severity / 10)
    json.dumps(assessment.report(), allow_nan=False)


def test_native_modes_do_not_silently_harmonize_partial_eligibility():
    inputs = [
        feature(
            "A", "DF2", clearing_count=0, invoice_to_clearing_days=60, user_event_count=None, distinct_user_count=None
        )
    ]
    flat = evaluate_features(inputs).case("A")
    layered = evaluate_features(inputs, mode="layer_balanced").case("A")
    assert flat["score"] == pytest.approx(1 - 1.5 / 7)
    # Keep the same per-criterion raw weights. Native layer masses are 3,2,3
    # (Completion,Timing,Rework), including the out-of-scope C05 raw weight.
    assert layered["score"] == pytest.approx(1 - ((1 / 3) * 3 + 0.5 * 2 + 0 * 3) / 8)
    assert flat["score"] != layered["score"]
    assert sum(flat["layers"].values()) == pytest.approx(1 - flat["score"])
    assert sum(layered["layers"].values()) == pytest.approx(1 - layered["score"])


def test_native_priorities_reference_scored_items_and_retain_negative_driver_offsets():
    inputs = [feature("A", cancellation_count=1), feature("B", invoice_to_clearing_days=60)]
    report = evaluate_features(inputs, gamma=1).report()
    bad = report["groups"][0]
    assert report["mean_score"] == pytest.approx(0.925)
    assert bad["mean_score"] == pytest.approx(0.9)
    assert bad["PI"] == pytest.approx(0.025)
    assert bad["stable_PI"] == pytest.approx(0.0125)
    driver = report["layer_drivers"][0]
    assert driver["Rework__signed_PI"] == pytest.approx(0.05)
    assert driver["Timing__signed_PI"] == pytest.approx(-0.025)
    assert sum(
        driver[layer + "__signed_PI"] for layer in ["Completion", "Timing", "Rework", "Effort"]
    ) == pytest.approx(0.025)
    assert sum(
        driver[layer + "__signed_stable_PI"] for layer in ["Completion", "Timing", "Rework", "Effort"]
    ) == pytest.approx(0.0125)


def test_document_grain_counts_sibling_items_not_documents_for_global_reference():
    inputs = [feature("A", cancellation_count=1), feature("B", invoice_to_clearing_days=60), feature("C")]
    inputs[0]["document"] = inputs[1]["document"] = "D"
    report = evaluate_features(inputs).report()
    doc = next(d for d in report["documents"] if d["document"] == "D")
    assert report["mean_score"] == pytest.approx(0.95)
    assert doc["n_cases"] == 2
    assert doc["mean_score"] == pytest.approx(0.925)
    assert doc["PI"] == pytest.approx(0.05)


def test_exposure_changes_native_multiplier_only_and_reuses_frozen_calibration():
    inputs = [
        feature("A", cancellation_count=1, creation_value=10, exposure=10),
        feature("B", creation_value=90, exposure=90),
    ]
    count = evaluate_features(inputs).report()
    amount = evaluate_features(inputs, volume="exposure", exposure_policy="creation_value").report()
    assert amount["mean_score"] == count["mean_score"]
    assert amount["groups"][0]["volume"] == 10
    assert amount["groups"][0]["PI"] == pytest.approx(0.5)
    normalized = evaluate_features(inputs, volume="exposure").report()
    assert normalized["exposure_calibration"]["cutoff"] == pytest.approx(86)
    frozen = normalized["exposure_calibration"]
    subset = evaluate_features(inputs[:1], volume="exposure", exposure_calibration=frozen).report()
    assert subset["exposure_calibration"]["cutoff"] == 86
    assert subset["groups"][0]["volume"] == pytest.approx(10 / 86)
    missing = copy.deepcopy(inputs)
    missing[0]["measures"]["exposure"]["available"] = False
    with pytest.raises(ValueError, match="cannot become zero"):
        evaluate_features(missing, volume="exposure")


def test_associations_use_joint_eligibility_and_declare_descriptive_meaning():
    inputs = [
        feature("A", cancellation_count=1, edit_count=1),
        feature("B", cancellation_count=1, edit_count=None),
        feature("C"),
    ]
    pairs = evaluate_features(inputs).associations()
    pair = next(p for p in pairs if p["left"] == "C06" and p["right"] == "C07")
    assert pair["eligible_case_count"] == 2
    assert pair["support"] == 1
    assert pair["jaccard"] == 1
    assert pair["lift"] == 2
    assert "not causal" in pair["interpretation"]


def test_historical_reference_is_frozen_separate_and_preserves_all_29_bindings():
    catalogue = historical_catalogue()
    assert len(catalogue["source"]["constraints"]) == 29
    assessment = evaluate_features([feature()], profile="historical", view="Finance", mode="layer_balanced")
    report = assessment.report()
    assert report["requested_criterion_count"] == 29
    assert report["admitted_criterion_count"] == 29
    assert len(report["omissions"]) == 0
    assert report["profile_complete"]
    assert any(c["reason"] == "missing_attribute" for c in report["case_page"]["cases"][0]["criteria"])
    assert len(report["view_summaries"]) == 4
    assert report["norm"]["scoring_mode"] == "layer_balanced"
    assert paper_norm_document()["scoring_mode"] == "flat"


def test_full_historical_29_criterion_profile_has_independent_all_view_oracle():
    item = feature("H", "DF1")
    item["activity_counts"].update({"Change Price": 1, "Change Quantity": 1, "Vendor creates debit memo": 1})
    item["record_count"] = 25
    raw = {
        "historical_invoice_precedes_receipt": 1,
        "historical_release_precedes_receipt": 0,
        "historical_goods_to_invoice_days": 20,
        "historical_invoice_to_clear_days": 60,
        "historical_goods_to_release_days": 0,
        "historical_release_to_clear_days": 0,
        "historical_manual_touch_count": 7,
        "historical_distinct_human_resources": 4,
        "historical_manual_share": 0.75,
        "historical_networth_cv": 1,
        "historical_memo_exposure": 0.25,
        "historical_price_exposure": 0.25,
    }
    item["historical_measures"] = {
        key: {"value": value, "available": True, "reason": None, "row_ids": ["raw-" + key]}
        for key, value in raw.items()
    }
    assessment = evaluate_features([item], profile="historical", view="Finance", mode="layer_balanced")
    case = assessment.case("H")
    layers = [0, 1, 0.5, 0, 1.3 / 5.7, 2.35 / 5.8, 2.7 / 4.4]
    expected_weights = {
        "Finance": [0.24, 0.08, 0.24, 0.06, 0.08, 0.24, 0.06],
        "Logistics": [0.08, 0.24, 0.22, 0.22, 0.08, 0.04, 0.12],
        "Compliance": [0.12, 0.30, 0.10, 0.06, 0.26, 0.06, 0.10],
        "Automation": [0.06, 0.08, 0.10, 0.28, 0.06, 0.08, 0.34],
    }
    for view, weights in expected_weights.items():
        assert case["scores"][view] == pytest.approx(1 - sum(a * b for a, b in zip(layers, weights)))
    assert verdict(case, "c_l3_invoice_to_clear_days")["deviation"] == 0.5
    assert verdict(case, "c_l6_high_exposure_memo")["deviation"] == 0.25
    assert verdict(case, "c_l7_manual_touches")["deviation"] == 0.5
    assert verdict(case, "c_l3_invoice_to_clear_days")["row_ids"] == ["raw-historical_invoice_to_clear_days"]
    assert case["coverage"] == 1
    json.dumps(assessment.report(), allow_nan=False)


def test_retained_original_records_cross_native_seam_without_harmonizing_invoice_or_resource_policy():
    # Goods Jan1, vendor invoice Jan11, recorded invoice Jan21, clearing Mar22.
    # Paper uses only recorded invoice: 60d; historical union: 70d.
    original = [
        ("Record Goods Receipt", "2018-01-01T00:00:00", "user_1"),
        ("Vendor creates invoice", "2018-01-11T00:00:00", "user_2"),
        ("Record Invoice Receipt", "2018-01-21T00:00:00", "UNKNOWN"),
        ("Clear Invoice", "2018-03-22T00:00:00", "batch_1"),
    ]
    columns = (
        "case",
        "activity",
        "time",
        "case Item Category",
        "event org:resource",
        "event Cumulative net worth (EUR)",
        "case Purchasing Document",
        "case Company",
        "case Spend area text",
    )
    rows = tuple(
        PreparedRecord(
            f"raw-{i}",
            i,
            "H",
            None,
            activity,
            "wall_clock",
            None,
            time,
            "usable",
            (),
            ("H", activity, time, "3-way match, invoice after GR", resource, "10", "D", "0000", "Packaging"),
            datetime.fromisoformat(time),
        )
        for i, (activity, time, resource) in enumerate(original, 1)
    )
    prepared = PreparedData(
        b"literal records",
        "source",
        "preparation",
        "representation",
        "dictionary",
        "population",
        "0.1.0",
        columns,
        rows,
        {"H": rows},
        {},
        {},
        {},
        {},
    )
    paper = evaluate_features(build_paper_features(prepared, ["H"])).case("H")
    historical = evaluate_features(
        build_historical_features(prepared, ["H"]), profile="historical", view="Finance", mode="layer_balanced"
    ).case("H")
    assert verdict(paper, "C04")["measurement"] == 60
    assert verdict(paper, "C04")["row_ids"] == ["raw-3", "raw-4"]
    assert verdict(paper, "C09")["reason"] == "missing_attribute"
    assert paper["score"] == pytest.approx(1 - 0.5 / 8)
    assert paper["coverage"] == pytest.approx(0.8)
    assert verdict(historical, "c_l3_invoice_to_clear_days")["measurement"] == 70
    assert verdict(historical, "c_l3_invoice_to_clear_days")["row_ids"] == ["raw-2", "raw-4"]
    assert verdict(historical, "c_l7_distinct_human_resources")["deviation"] == 0.25
    assert verdict(historical, "c_l7_manual_share")["deviation"] == 0.5
    assert historical["scores"]["Finance"] == pytest.approx(1 - 0.24 * (1 / 2.8) - 0.06 * (0.725 / 4.4))
    assert historical["coverage"] == 1


def test_partial_paper_families_compile_their_own_native_norm_and_never_claim_full_parity():
    raw = [
        feature(
            "A",
            clearing_count=0,
            invoice_to_clearing_days=None,
            cancellation_count=1,
            user_event_count=15,
            distinct_user_count=7,
        )
    ]
    expected = {
        "completion": (3, 2 / 3, 1),
        "completion_timing": (5, 0.75, 0.8),
        "completion_rework_effort": (8, 0.5, 1),
        "full": (10, 5 / 9, 0.9),
    }
    fingerprints = set()
    for family, (count, score, coverage) in expected.items():
        assessment = evaluate_features(raw, criteria_family=family)
        report = assessment.report()
        fingerprints.add(report["norm_fingerprint"])
        assert len(report["norm"]["constraints"]) == count
        assert report["admitted_criterion_count"] == count
        assert report["requested_criterion_count"] == 10
        assert report["profile_complete"] is (family == "full")
        assert len(report["omissions"]) == 10 - count
        assert report["settings"]["criteria_family"] == family
        assert report["case_page"]["cases"][0]["score"] == pytest.approx(score)
        assert report["case_page"]["cases"][0]["coverage"] == pytest.approx(coverage)
        chunks = list(assessment.case_chunks(1))
        assert chunks[0]["cases"] == report["case_page"]["cases"]
    assert len(fingerprints) == 4
    consignment = evaluate_features([feature("C", "Consignment")], criteria_family="completion").report()
    assert consignment["scored_case_count"] == 0
    assert consignment["case_page"]["cases"][0]["score"] is None


def test_integer_counts_and_context_conflicts_refuse_without_changing_the_native_norm():
    item = feature("bad", distinct_user_count=4.5)
    with pytest.raises(ValueError, match="invalid_count"):
        evaluate_features([item])
    item = feature("conflict")
    item["context"] = {"purchasing_document": {"reason": "conflicting_case_attribute", "value": None}}
    with pytest.raises(ValueError, match="context_conflict"):
        evaluate_features([item])


def test_positive_timing_exemplar_uses_all_evaluable_median_before_candidate_filter():
    items = [feature("A", invoice_to_clearing_days=10), feature("B", invoice_to_clearing_days=20),
             feature("C", invoice_to_clearing_days=40), feature("D", invoice_to_clearing_days=100)]
    for item in items: item["company"] = "0000"
    exemplar = evaluate_features(items).report()["exemplars"][0]
    assert exemplar["reference_median_days"] == 30
    assert exemplar["evaluated_support"] == 4 and exemplar["positive_support"] == 2
    assert exemplar["case_id"] == "C"  # positive-only median 70 would tie C/D instead
    assert exemplar["measurement_days"] == 40


def test_historical_source_slug_matching_preserves_plural_mismatch_and_case_normalization():
    item = feature("term")
    item["activity_counts"].update({"Change payment term": 1, "change price": 1})
    item["activity_row_ids"] = {"Change payment term": ["term-singular"], "change price": ["price-lower"]}
    case = evaluate_features([item], profile="historical", view="Finance", mode="layer_balanced").case("term")
    assert verdict(case,"c_l4_change_payment_terms_repeats")["measurement"] == 0
    assert verdict(case,"c_l4_change_payment_terms_repeats")["deviation"] == 0
    assert verdict(case,"c_l6_change_price")["measurement"] == 1
    assert verdict(case,"c_l6_change_price")["deviation"] == .5
    assert verdict(case,"c_l6_change_price")["row_ids"] == ["price-lower"]


def test_native_ranking_comparison_keeps_each_view_reference_and_empty_union_unavailable():
    result = evaluate_features([feature("A",cancellation_count=1),feature("B",invoice_to_clearing_days=60)])
    comparison = result.report()["ranking_comparisons"]
    assert comparison["views"]["Balanced"]["document_reference"]["global_mean"] == pytest.approx(.925)
    assert comparison["views"]["Completion"]["document_reference"]["global_mean"] != comparison["views"]["Balanced"]["document_reference"]["global_mean"]
    assert comparison["group_policies"]["PI_gamma_0"][0]["PI"] == pytest.approx(.025)
    assert comparison["group_policies"]["PI_gamma_20"][0]["stable_PI"] == pytest.approx(.025/21)
    perfect = evaluate_features([feature("A"),feature("B")]).report()["ranking_comparisons"]
    assert all(pair["jaccard"] is None and pair["reason"] == "zero_union" for pair in perfect["document_overlaps"])


def test_association_minimum_support_suppresses_without_erasing_support_or_zero_statistics():
    result=evaluate_features([feature("A",cancellation_count=1,edit_count=1),feature("B"),feature("C")],association_min_support=2)
    report=result.report()
    assert not any(pair["left"] == "C06" and pair["right"] == "C07" for pair in report["associations"])
    pair=next(pair for pair in report["suppressed_associations"] if pair["left"] == "C06" and pair["right"] == "C07")
    assert pair["support"] == 1 and pair["eligible_case_count"] == 3
    assert pair["suppression_reason"] == "support_below_minimum" and pair["jaccard"] == 1 and pair["lift"] == 3
    zero=next(pair for pair in report["suppressed_associations"] if pair["left"] == "C01" and pair["right"] == "C02")
    assert zero["lift"] is None and zero["lift_reason"] == "zero_support"
    assert zero["jaccard"] is None and zero["jaccard_reason"] == "zero_union"
