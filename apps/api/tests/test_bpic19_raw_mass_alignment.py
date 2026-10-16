"""Independent native raw-mass/coverage disclosure regressions.

These synthetic prepared-measure inputs exercise the native Method bridge, not
raw-event adapter or full-source qualification. Expected mass comes from literal
source weights and flow scopes, never from the product's raw-weight mapping.
The paper control uses the independently reported original exemplar vector.
"""

from copy import deepcopy

import pytest

from wise_platform_api.bpic19_method import evaluate_features


HISTORICAL_VIEWS = {
    "Finance": (.24, .08, .24, .06, .08, .24, .06),
    "Logistics": (.08, .24, .22, .22, .08, .04, .12),
    "Compliance": (.12, .30, .10, .06, .26, .06, .10),
    "Automation": (.06, .08, .10, .28, .06, .08, .34),
}
# Literal ratios of in-scope source within-layer weight to full layer weight.
# Consignment: no completion/timing; sole order rule; 3 of 4 fragmentation
# rules; 4 of 5 reversal rules; 4 of 5 commercial rules; all effort rules.
CONSIGNMENT_SCOPE = (0, .8 / 4.9, 0, 3.4 / 4.4, 4.5 / 5.7, 4.8 / 5.8, 1)
DF1_SCOPE = (1, 1.4 / 4.9, 2.8 / 5.2, 1, 1, 1, 1)


def measured(value, name):
    return {"value": value, "available": value is not None,
            "reason": None if value is not None else "literal_unavailable",
            "row_ids": ["synthetic-" + name]}


def historical_feature(flow="Consignment", missing=None):
    values = {"historical_invoice_precedes_receipt": 0, "historical_release_precedes_receipt": 0,
        "historical_goods_to_invoice_days": 0, "historical_invoice_to_clear_days": 0,
        "historical_goods_to_release_days": 0, "historical_release_to_clear_days": 0,
        "historical_manual_touch_count": 0, "historical_distinct_human_resources": 0,
        "historical_manual_share": 0, "historical_networth_cv": 0,
        "historical_memo_exposure": 0, "historical_price_exposure": 0}
    if missing:
        values[missing] = None
    # Consignment has a clearing, cancellation and deletion, as in F29-D.
    # The DF1 control adds an invoice so every admitted count is known.
    activities = {"Create Purchase Order Item": 1, "Record Goods Receipt": 1,
                  "Cancel Goods Receipt": 1, "Delete Purchase Order Item": 1, "Clear Invoice": 1}
    if flow == "DF1":
        activities["Record Invoice Receipt"] = 1
    return {"case_id": "synthetic-" + flow, "flow": flow, "document": "Synthetic", "company": "0000", "spend_area": "Mass",
        "record_count": 5 if flow == "Consignment" else 6,
        "activity_counts": activities,
        "measures": {key: measured(value, key) for key, value in {
            "invoice_count": 0 if flow == "Consignment" else 1, "clearing_count": 1, "receipt_count": 1,
            "cancellation_count": 0, "edit_count": 0, "user_event_count": 0,
            "distinct_user_count": 0, "invoice_to_clearing_days": 0,
            "invoice_precedes_receipt": 0, "exposure": 40}.items()},
        "historical_measures": {key: measured(value, key) for key, value in values.items()}}


def literal_mass(view, scope=CONSIGNMENT_SCOPE):
    return sum(weight * fraction for weight, fraction in zip(HISTORICAL_VIEWS[view], scope))


def assert_mass(case, denominator, numerator):
    assert case["in_scope_raw_weight"] == pytest.approx(denominator, abs=1e-12, rel=0)
    assert case["evaluated_raw_weight"] == pytest.approx(numerator, abs=1e-12, rel=0)
    assert case["coverage"] == pytest.approx(numerator / denominator, abs=1e-12, rel=0)


@pytest.mark.parametrize("view", HISTORICAL_VIEWS)
def test_complete_consignment_literal_mass_and_native_score(view):
    feature = historical_feature()
    assessment = evaluate_features([feature], profile="historical", view=view, mode="layer_balanced")
    case = assessment.case(feature["case_id"])
    assert_mass(case, literal_mass(view), literal_mass(view))
    assert sum(cell["in_scope"] for cell in case["criteria"]) == 16
    weights = HISTORICAL_VIEWS[view]
    # Native L2 penalty=1, L5=(1+1.1)/(1+1.1+1.3+1.1)=7/15;
    # the other three eligible layers have zero penalty.
    score = 1 - (weights[1] + weights[4] * 7 / 15) / (weights[1] + weights[3] + weights[4] + weights[5] + weights[6])
    assert case["score"] == pytest.approx(score, abs=1e-12, rel=0)
    if view == "Finance":
        assert_mass(case, .3812034452454468, .3812034452454468)


@pytest.mark.parametrize("view", HISTORICAL_VIEWS)
@pytest.mark.parametrize("missing,source_weight", [
    ("historical_manual_touch_count", 1.4),
    ("historical_distinct_human_resources", 1.1),
    ("historical_manual_share", .9),
])
def test_consignment_missing_effort_subtracts_only_its_named_raw_mass(view, missing, source_weight):
    feature = historical_feature(missing=missing)
    assessment = evaluate_features([feature], profile="historical", view=view, mode="layer_balanced")
    case = assessment.case(feature["case_id"])
    denominator = literal_mass(view)
    numerator = denominator - HISTORICAL_VIEWS[view][6] * source_weight / 4.4
    assert_mass(case, denominator, numerator)
    assert sum(cell["reason"] == "missing_attribute" for cell in case["criteria"]) == 1
    assert sum(cell["in_scope"] for cell in case["criteria"]) == 16
    # CV is outside Consignment scope; it cannot enter mass when the final
    # effort measurement is unavailable.
    cv = next(cell for cell in case["criteria"] if cell["criterion_id"] == "c_l6_bal_networth_volatility")
    assert cv["reason"] == "out_of_scope"


@pytest.mark.parametrize("view", HISTORICAL_VIEWS)
def test_missing_df1_cv_subtracts_commercial_mass_not_final_effort_mass(view):
    feature = historical_feature("DF1", "historical_networth_cv")
    assessment = evaluate_features([feature], profile="historical", view=view, mode="layer_balanced")
    case = assessment.case(feature["case_id"])
    denominator = literal_mass(view, DF1_SCOPE)
    numerator = denominator - HISTORICAL_VIEWS[view][5] / 5.8
    assert_mass(case, denominator, numerator)
    assert sum(cell["in_scope"] for cell in case["criteria"]) == 24
    assert sum(cell["reason"] == "missing_attribute" for cell in case["criteria"]) == 1


@pytest.mark.parametrize("view", HISTORICAL_VIEWS)
def test_raw_weight_mapping_order_cannot_change_case_disclosure_or_native_results(view):
    feature = historical_feature(missing="historical_manual_share")
    assessment = evaluate_features([feature], profile="historical", view=view, mode="layer_balanced")
    # Establish the proven native column order rather than reordering its masks.
    assert list(assessment.result.in_scope.columns) == [constraint.id for constraint in assessment.result.norm.constraints]
    native_before = deepcopy({"scores": assessment.result.scores.to_dict(),
                              "effective_weights": assessment.effective_weights.to_dict(),
                              "penalties": assessment.penalties.to_dict(), "norm": assessment.norm_document})
    # This changes only an ID→weight lookup's insertion order, not any key/value
    # or native definition. Positional lookup against that map is the defect.
    assessment.__dict__["raw_weights"] = dict(reversed(list(assessment.raw_weights.items())))
    case = assessment.case(feature["case_id"])
    denominator = literal_mass(view)
    assert_mass(case, denominator, denominator - HISTORICAL_VIEWS[view][6] * .9 / 4.4)
    native_after = {"scores": assessment.result.scores.to_dict(), "effective_weights": assessment.effective_weights.to_dict(),
                    "penalties": assessment.penalties.to_dict(), "norm": assessment.norm_document}
    assert native_after == native_before


def paper_original_exemplar_vector():
    # Independently qualified original source exemplar 4507005472_00040:
    # six zero deviations plus C04; C05 OOS and C09/C10 unavailable.
    # This is its literal prepared-vector control, not a claimed source import.
    values = {"invoice_count": 1, "clearing_count": 1, "receipt_count": 1,
        "invoice_to_clearing_days": 69.04097222222222, "invoice_precedes_receipt": 0,
        "cancellation_count": 0, "edit_count": 0, "user_event_count": None,
        "distinct_user_count": None, "exposure": 10}
    return {"case_id": "paper-original-exemplar-vector", "flow": "DF2", "document": "Paper control",
        "company": "0000", "spend_area": "Packaging", "record_count": 4,
        "activity_counts": {"Record Invoice Receipt": 1, "Clear Invoice": 1, "Record Goods Receipt": 1},
        "measures": {key: measured(value, key) for key, value in values.items()}}


@pytest.mark.parametrize("view,denominator,numerator,timing_weight", [
    ("Balanced", 9, 7, 1), ("Completion", 16, 14, 2), ("Operations", 16, 10, 1),
])
@pytest.mark.parametrize("reorder_lookup", [False, True])
def test_original_paper_exemplar_mass_coverage_and_native_grade_remain_exact(view, denominator, numerator, timing_weight, reorder_lookup):
    feature = paper_original_exemplar_vector()
    assessment = evaluate_features([feature], profile="paper", view=view, mode="flat")
    if reorder_lookup:
        assessment.__dict__["raw_weights"] = dict(reversed(list(assessment.raw_weights.items())))
    case = assessment.case(feature["case_id"])
    assert_mass(case, denominator, numerator)
    severity = (69.04097222222222 - 30) / 60
    assert case["score"] == pytest.approx(1 - severity * timing_weight / numerator, abs=1e-12, rel=0)
    verdicts = {cell["criterion_id"]: cell for cell in case["criteria"]}
    assert verdicts["C05"]["reason"] == "out_of_scope"
    assert verdicts["C09"]["reason"] == verdicts["C10"]["reason"] == "missing_attribute"
    assert verdicts["C04"]["deviation"] == pytest.approx(severity, abs=1e-12, rel=0)
