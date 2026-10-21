"""The value of each context column at the first record of an incident, beside its parent."""

import json

import pytest

from literal_logs import prepared_from
from wise_platform_analytics.mapping import ImportRefusal
from wise_platform_analytics.opening_context import OPENING_CONTEXT_POLICY, opening_context

# A: the desk is empty at the first record and filled later.
# B: the desk is the text "Unknown" at the first record.
# C: the source lists 10:00 before 09:00; the 09:00 record comes first in the declared order.
# D: one record has no readable time, so the order of D cannot be evaluated.
# E: an ordinary incident with East.
# F: the desk is a single blank, which is a recorded value and not an empty cell.
LOG = [
    "Ticket;Event;At;Desk;Priority",
    "A;Open;2026-10-01T08:00:00Z;;P1",
    "A;Close;2026-10-01T09:00:00Z;East;P1",
    "B;Open;2026-10-01T08:00:00Z;Unknown;P2",
    "C;Close;2026-10-01T10:00:00Z;West;P3",
    "C;Open;2026-10-01T09:00:00Z;East;P1",
    "D;Open;2026-10-01T08:00:00Z;East;P1",
    "D;Close;not a time;East;P1",
    "E;Open;2026-10-01T08:00:00Z;East;P1",
    "F;Open;2026-10-01T08:00:00Z; ;P2",
]
PARENT = ["A", "B", "C", "D", "E", "F"]


def column(answer, index):
    return next(item for item in answer.to_dict()["columns"] if item["column_index"] == index)


def by_value(entry):
    return {(category["kind"], category["value"]): category for category in entry["categories"]}


def test_missing_unknown_and_a_blank_are_three_categories_and_a_later_value_never_fills_the_first():
    answer = opening_context(prepared_from(LOG), ["A", "B", "C"], PARENT)
    desk = by_value(column(answer, 3))
    assert set(desk) == {("missing", None), ("value", "Unknown"), ("value", "East"), ("value", " ")}
    # A is missing at its first record although its second record says East.
    assert desk[("missing", None)]["population"] == {"count": 1, "share": 1 / 3, "denominator": 3}
    assert desk[("value", "Unknown")]["population"] == {"count": 1, "share": 1 / 3, "denominator": 3}
    # Of the selection only C opened at East; A's later East does not count.
    assert desk[("value", "East")]["population"] == {"count": 1, "share": 1 / 3, "denominator": 3}
    assert desk[("value", " ")]["population"] == {"count": 0, "share": 0.0, "denominator": 3}


def test_the_first_record_in_the_declared_order_decides():
    answer = opening_context(prepared_from(LOG), ["C"], PARENT)
    desk = by_value(column(answer, 3))
    priority = by_value(column(answer, 4))
    assert desk[("value", "East")]["population"]["count"] == 1
    assert priority[("value", "P1")]["population"]["count"] == 1
    # West and P3 stand only at C's later record, so no incident opened with them.
    assert ("value", "West") not in desk
    assert ("value", "P3") not in priority


def test_shares_carry_their_denominators_and_the_difference_in_percentage_points():
    answer = opening_context(prepared_from(LOG), ["A", "B", "C"], PARENT)
    whole = answer.to_dict()
    assert whole["anchor_policy"] == OPENING_CONTEXT_POLICY
    # D's order cannot be evaluated: it stays in the parent's count but has no opening value.
    assert whole["population"] == {"case_count": 3, "evaluable_case_count": 3, "unevaluable_case_count": 0,
                                   "unevaluable_case_ids": [], "tied_first_record_case_count": 0}
    assert whole["parent"] == {"case_count": 6, "evaluable_case_count": 5, "unevaluable_case_count": 1,
                               "unevaluable_case_ids": ["D"], "tied_first_record_case_count": 0}
    entry = column(answer, 3)
    assert entry["column_name"] == "Desk"
    east = by_value(entry)[("value", "East")]
    # Parent openings: A missing, B Unknown, C East, E East, F blank.
    assert east["parent"] == {"count": 2, "share": 2 / 5, "denominator": 5}
    assert east["difference_percentage_points"] == pytest.approx(100 / 3 - 40)
    missing = by_value(entry)[("missing", None)]
    assert missing["parent"] == {"count": 1, "share": 1 / 5, "denominator": 5}
    assert missing["difference_percentage_points"] == pytest.approx(100 / 3 - 20)
    assert entry["remainder"] is None
    assert entry["distinct_value_count"] == 3
    json.dumps(whole, allow_nan=False)


def test_categories_are_ranked_by_the_population_then_the_parent():
    answer = opening_context(prepared_from(LOG), ["A", "B", "C"], PARENT)
    ranked = [(item["kind"], item["value"]) for item in column(answer, 3)["categories"]]
    # Each has 1 in the selection; East has 2 in the parent; then Unknown, missing at 1; the blank has 0.
    assert ranked == [("value", "East"), ("value", "Unknown"), ("missing", None), ("value", " ")]


def test_many_distinct_values_end_in_one_remainder_and_missing_is_always_listed():
    lines = ["Ticket;Event;At;Desk;Priority"]
    desks = {"K1": "X", "K2": "X", "K3": "X", "K4": "Y", "K5": "Y", "K6": "Z", "K7": "W", "K8": "", "K9": "V"}
    for case, desk in desks.items():
        lines.append(f"{case};Open;2026-10-01T08:00:00Z;{desk};P1")
    parent = sorted(desks)
    answer = opening_context(prepared_from(lines), parent, parent, category_limit=2)
    entry = column(answer, 3)
    assert [(item["kind"], item["value"], item["population"]["count"]) for item in entry["categories"]] == [
        ("value", "X", 3), ("value", "Y", 2), ("missing", None, 1)]
    assert entry["remainder"] == {
        "distinct_value_count": 3,
        "population": {"count": 3, "share": 3 / 9, "denominator": 9},
        "parent": {"count": 3, "share": 3 / 9, "denominator": 9},
        "difference_percentage_points": 0.0,
    }
    assert entry["distinct_value_count"] == 5
    assert answer.to_dict()["category_limit"] == 2


def test_an_empty_population_has_no_shares_rather_than_zero_shares():
    lines = ["Ticket;Event;At;Desk;Priority", "A;Open;2026-10-01T08:00:00Z;East;P1"]
    answer = opening_context(prepared_from(lines), [], ["A"])
    east = by_value(column(answer, 3))[("value", "East")]
    assert east["population"] == {"count": 0, "share": None, "denominator": 0}
    assert east["parent"] == {"count": 1, "share": 1.0, "denominator": 1}
    assert east["difference_percentage_points"] is None


@pytest.mark.parametrize(("population", "parent", "code"), [
    (["A"], ["B"], "invalid_parent"),
    (["Z"], PARENT, "unknown_case"),
    (["A", "A"], PARENT, "invalid_parent"),
    (["A"], ["A", "Z"], "unknown_case"),
])
def test_a_population_outside_its_parent_or_the_dictionary_is_refused(population, parent, code):
    refused = opening_context(prepared_from(LOG), population, parent)
    assert isinstance(refused, ImportRefusal)
    assert refused.code == code


def test_without_a_context_column_there_is_nothing_to_answer():
    refused = opening_context(prepared_from(LOG, context=()), ["A"], PARENT)
    assert isinstance(refused, ImportRefusal)
    assert refused.code == "no_context_columns"


@pytest.mark.parametrize("limit", [0, -1, True, 2.0])
def test_the_category_limit_is_a_positive_whole_number(limit):
    refused = opening_context(prepared_from(LOG), ["A"], PARENT, category_limit=limit)
    assert isinstance(refused, ImportRefusal)
    assert refused.code == "invalid_parameter"


def test_a_first_record_tied_in_time_is_chosen_by_the_declared_order_and_counted():
    # G's two first records share their time: the declared order (here the place in the file) chooses North.
    tied = [*LOG, "G;Open;2026-10-01T08:00:00Z;North;P1", "G;Note;2026-10-01T08:00:00Z;South;P1"]
    answer = opening_context(prepared_from(tied), ["G"], [*PARENT, "G"]).to_dict()
    assert answer["population"]["tied_first_record_case_count"] == 1
    assert answer["parent"]["tied_first_record_case_count"] == 1
    assert by_value(column_of(answer, 3))[("value", "North")]["population"]["count"] == 1
    assert ("value", "South") not in by_value(column_of(answer, 3))


def column_of(whole, index):
    return next(item for item in whole["columns"] if item["column_index"] == index)
