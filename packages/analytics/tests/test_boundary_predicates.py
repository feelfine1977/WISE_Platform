"""Incidents that begin or end with an activity, and their agreement with the map.

An incident begins with an activity when its first record in the declared
order carries that label, and ends with it when its last record does. Every
expected membership below was worked out by hand from the two literal logs.
"""

from itertools import combinations

import pytest

from literal_logs import prepared_from
from wise_platform_analytics.comparison import compare_groups
from wise_platform_analytics.process_graph import build_process_graph
from wise_platform_analytics.selection import (
    OPENING_CONTEXT_POLICY,
    ContainsActivity,
    EndsWithActivity,
    SelectionError,
    StartsWithActivity,
    boundary_activities,
    select_cases,
)

# B1  Open, Assign, Close                       begins with Open, ends with Close
# B2  Open                                      one record: begins and ends with Open
# B3  (no label), Open, Close                   its first record has no label: begins with nothing, ends with Close
# B4  Open, Close, (no label)                   its last record has no label: begins with Open, ends with nothing
# B5  Open at an unreadable time, Close         its order cannot be evaluated
# B6  Assign 08:00, Close 10:00                 written the other way round in the source: the declared order decides
# B7  (no label)                                one record without label: begins and ends with nothing
BOUNDARIES = [
    "Incident;Event;At;Desk;Priority",
    "B1;Open;2026-10-01T08:00:00Z;East;P1",
    "B1;Assign;2026-10-01T09:00:00Z;East;P1",
    "B1;Close;2026-10-01T10:00:00Z;East;P1",
    "B2;Open;2026-10-02T08:00:00Z;East;P1",
    "B3;;2026-10-03T08:00:00Z;East;P1",
    "B3;Open;2026-10-03T09:00:00Z;East;P1",
    "B3;Close;2026-10-03T10:00:00Z;East;P1",
    "B4;Open;2026-10-04T08:00:00Z;West;P1",
    "B4;Close;2026-10-04T09:00:00Z;West;P1",
    "B4;;2026-10-04T10:00:00Z;West;P1",
    "B5;Open;later;West;P1",
    "B5;Close;2026-10-05T10:00:00Z;West;P1",
    "B6;Close;2026-10-06T10:00:00Z;West;P1",
    "B6;Assign;2026-10-06T08:00:00Z;West;P1",
    "B7;;2026-10-07T08:00:00Z;West;P1",
]

# R1  Check, Fix, Check                         begins and ends with Check
# R2  Fix, Check                                begins with Fix, ends with Check
# R3  Check, (no label), Fix                    the record without label lies inside: begins with Check, ends with Fix
# R4  Fix and Check at the same time            the place in the source decides: begins with Fix, ends with Check
# R5  Check at an unreadable time               its order cannot be evaluated
REPEATS = [
    "Incident;Event;At;Desk;Priority",
    "R1;Check;2026-11-01T08:00:00Z;West;P2",
    "R1;Fix;2026-11-01T09:00:00Z;West;P2",
    "R1;Check;2026-11-01T10:00:00Z;West;P2",
    "R2;Fix;2026-11-02T08:00:00Z;West;P2",
    "R2;Check;2026-11-02T09:00:00Z;West;P2",
    "R3;Check;2026-11-03T08:00:00Z;West;P2",
    "R3;;2026-11-03T09:00:00Z;West;P2",
    "R3;Fix;2026-11-03T10:00:00Z;West;P2",
    "R4;Fix;2026-11-04T08:00:00Z;West;P2",
    "R4;Check;2026-11-04T08:00:00Z;West;P2",
    "R5;Check;not-a-time;West;P2",
]


def partition(result):
    return result.kept.case_ids, result.removed.case_ids, result.unevaluable.case_ids


def test_an_incident_begins_with_the_activity_of_its_first_record_in_the_declared_order():
    prepared = prepared_from(BOUNDARIES)

    assert partition(select_cases(prepared, [StartsWithActivity("Open")])) == (
        ("B1", "B2", "B4"), ("B3", "B6", "B7"), ("B5",))
    # B6 lists Close first in the source, but Assign is earlier in time.
    assert partition(select_cases(prepared, [StartsWithActivity("Assign")])) == (
        ("B6",), ("B1", "B2", "B3", "B4", "B7"), ("B5",))
    assert partition(select_cases(prepared, [StartsWithActivity("Close")])) == (
        (), ("B1", "B2", "B3", "B4", "B6", "B7"), ("B5",))


def test_an_incident_ends_with_the_activity_of_its_last_record_in_the_declared_order():
    prepared = prepared_from(BOUNDARIES)

    assert partition(select_cases(prepared, [EndsWithActivity("Close")])) == (
        ("B1", "B3", "B6"), ("B2", "B4", "B7"), ("B5",))
    assert partition(select_cases(prepared, [EndsWithActivity("Assign")])) == (
        (), ("B1", "B2", "B3", "B4", "B6", "B7"), ("B5",))


def test_an_incident_of_one_record_begins_and_ends_with_its_activity():
    prepared = prepared_from(BOUNDARIES)

    for predicate in (StartsWithActivity("Open"), EndsWithActivity("Open")):
        result = select_cases(prepared, [predicate], ["B2"])
        assert partition(result) == (("B2",), (), ())
        assert result.kept.record_count == 1
    assert select_cases(prepared, [EndsWithActivity("Open")]).kept.case_ids == ("B2",)


def test_a_boundary_record_without_label_is_no_start_and_no_end_of_any_activity():
    prepared = prepared_from(BOUNDARIES)

    # B3 goes on with Open and B4 came from Close, but only the boundary record itself counts.
    for activity in ("Open", "Assign", "Close"):
        assert "B3" in select_cases(prepared, [StartsWithActivity(activity)]).removed.case_ids
        assert "B4" in select_cases(prepared, [EndsWithActivity(activity)]).removed.case_ids
        for predicate in (StartsWithActivity(activity), EndsWithActivity(activity)):
            assert "B7" in select_cases(prepared, [predicate]).removed.case_ids
    assert partition(select_cases(prepared, [StartsWithActivity("Open", negate=True)], ["B3", "B7"])) == (
        ("B3", "B7"), (), ())
    assert partition(select_cases(prepared, [EndsWithActivity("Close", negate=True)], ["B4", "B7"])) == (
        ("B4", "B7"), (), ())


def test_negation_exchanges_kept_and_removed_and_leaves_unknown_order_unevaluable():
    prepared = prepared_from(BOUNDARIES)

    assert partition(select_cases(prepared, [StartsWithActivity("Open", negate=True)])) == (
        ("B3", "B6", "B7"), ("B1", "B2", "B4"), ("B5",))
    assert partition(select_cases(prepared, [EndsWithActivity("Close", negate=True)])) == (
        ("B2", "B4", "B7"), ("B1", "B3", "B6"), ("B5",))


def test_an_incident_of_unknown_order_belongs_to_neither_side_with_all_its_records():
    prepared = prepared_from(BOUNDARIES)

    for predicate in (StartsWithActivity("Open"), StartsWithActivity("Open", negate=True),
                      EndsWithActivity("Close"), EndsWithActivity("Close", negate=True)):
        result = select_cases(prepared, [predicate], ["B5"])
        assert partition(result) == ((), (), ("B5",))
        assert result.unevaluable.record_count == 2
    # A step that removes the incident decides over the one that cannot evaluate it.
    decided = select_cases(prepared, [StartsWithActivity("Open"), ContainsActivity("Assign")])
    assert partition(decided) == (("B1",), ("B2", "B3", "B4", "B5", "B6", "B7"), ())
    assert [chip.unevaluable.case_ids for chip in decided.predicate_results] == [("B5",), ()]


def test_the_steps_are_named_by_their_kind_and_give_the_selection_its_own_identity():
    prepared = prepared_from(BOUNDARIES)
    begins = select_cases(prepared, [StartsWithActivity("Open")], ["B1", "B2"])
    ends = select_cases(prepared, [EndsWithActivity("Open", negate=True)], ["B1"])

    assert begins.to_dict()["predicate_results"][0]["predicate"] == {
        "kind": "starts_with_activity", "activity": "Open", "negate": False}
    assert ends.to_dict()["predicate_results"][0]["predicate"] == {
        "kind": "ends_with_activity", "activity": "Open", "negate": True}
    # Both keep B1 and B2 of this parent, but they are different selections.
    contains = select_cases(prepared, [ContainsActivity("Open")], ["B1", "B2"])
    assert contains.kept.case_ids == begins.kept.case_ids
    assert contains.population_id != begins.population_id


@pytest.mark.parametrize("predicate", [
    StartsWithActivity(""), EndsWithActivity(""), StartsWithActivity(None), EndsWithActivity(7),
    StartsWithActivity("Open", negate=1), EndsWithActivity("Open", negate="false"),
])
def test_a_boundary_step_without_label_or_truth_value_is_refused(predicate):
    with pytest.raises(SelectionError) as refused:
        select_cases(prepared_from(BOUNDARIES), [predicate])
    assert refused.value.code == "invalid_predicate"


def test_the_boundaries_of_a_history_are_the_labels_of_its_first_and_last_record():
    prepared = prepared_from(BOUNDARIES)

    assert boundary_activities(prepared.histories["B1"]) == ("Open", "Close")
    assert boundary_activities(prepared.histories["B2"]) == ("Open", "Open")
    assert boundary_activities(prepared.histories["B3"]) == (None, "Close")
    assert boundary_activities(prepared.histories["B4"]) == ("Open", None)
    assert boundary_activities(prepared.histories["B6"]) == ("Assign", "Close")
    assert boundary_activities(prepared.histories["B7"]) == (None, None)
    assert boundary_activities(()) == (None, None)


def test_the_map_counts_the_starts_and_ends_worked_out_by_hand():
    def boundaries(lines):
        graph = build_process_graph(prepared_from(lines))
        assert graph["meta"]["boundary_policy"] == "incident.boundary.raw_labeled_start_end.v1"
        return {node["label"]: (node["metrics"]["starts"], node["metrics"]["ends"]) for node in graph["nodes"]}

    assert boundaries(BOUNDARIES) == {"Open": (3, 1), "Assign": (1, 0), "Close": (0, 3)}
    assert boundaries(REPEATS) == {"Check": (2, 3), "Fix": (2, 1)}


@pytest.mark.parametrize("lines", [BOUNDARIES, REPEATS], ids=["boundaries", "repeats"])
def test_every_population_keeps_as_many_incidents_as_its_map_counts_starts_and_ends(lines):
    prepared = prepared_from(lines)
    incidents = sorted(prepared.histories)
    activities = sorted({record.activity for history in prepared.histories.values() for record in history
                         if record.activity is not None})
    populations = [list(chosen) for size in range(len(incidents) + 1) for chosen in combinations(incidents, size)]
    assert len(populations) == 2 ** len(incidents)

    for population in populations:
        nodes = {node["label"]: node["metrics"] for node in build_process_graph(prepared, population)["nodes"]}
        for activity in activities:
            metrics = nodes.get(activity, {"starts": 0, "ends": 0})
            begins = select_cases(prepared, [StartsWithActivity(activity)], population)
            ends = select_cases(prepared, [EndsWithActivity(activity)], population)
            assert begins.kept.case_count == metrics["starts"], (population, activity)
            assert ends.kept.case_count == metrics["ends"], (population, activity)
        for predicate in (StartsWithActivity("Never recorded"), EndsWithActivity("Never recorded")):
            assert select_cases(prepared, [predicate], population).kept.case_count == 0


def test_the_map_of_the_kept_incidents_shows_one_start_or_one_end_only():
    prepared = prepared_from(REPEATS)
    begins = select_cases(prepared, [StartsWithActivity("Fix")])
    ends = select_cases(prepared, [EndsWithActivity("Check")])

    assert (begins.kept.case_ids, ends.kept.case_ids) == (("R2", "R4"), ("R1", "R2", "R4"))
    started = {node["label"]: node["metrics"]["starts"]
               for node in build_process_graph(prepared, begins.kept.case_ids)["nodes"]}
    ended = {node["label"]: node["metrics"]["ends"]
             for node in build_process_graph(prepared, ends.kept.case_ids)["nodes"]}
    assert started == {"Check": 0, "Fix": 2}
    assert ended == {"Check": 3, "Fix": 0}


def test_two_groups_are_compared_by_how_their_incidents_begin_and_end():
    prepared = prepared_from(BOUNDARIES)

    def group(name, predicate):
        return {"name": name, "definition": {"kind": "predicates", "predicates": [predicate]}}

    definition = {"mode": "two_named_groups",
                  "target": group("Begin with Open", {"kind": "starts_with_activity", "activity": "Open", "negate": False}),
                  "reference": group("Do not end with Close", {"kind": "ends_with_activity", "activity": "Close", "negate": True})}
    answer = compare_groups(prepared, prepared.identity_dict(), None, 3, OPENING_CONTEXT_POLICY, definition)

    assert answer["definition"] == definition
    assert answer["target"]["included"]["case_ids"] == ["B1", "B2", "B4"]
    assert answer["reference"]["included"]["case_ids"] == ["B2", "B4", "B7"]
    assert answer["target"]["unevaluable"]["case_ids"] == answer["reference"]["unevaluable"]["case_ids"] == ["B5"]
    assert {name: support["case_ids"] for name, support in answer["pair_support"].items()} == {
        "overlap": ["B2", "B4"], "target_only": ["B1"], "reference_only": ["B7"], "neither": ["B3", "B6"],
        "unevaluable": ["B5"]}
    partitioned = compare_groups(prepared, prepared.identity_dict(), None, 3, OPENING_CONTEXT_POLICY, {
        "mode": "selection_partition", "target_name": "Kept", "reference_name": "Removed", "target_side": "kept",
        "predicates": [{"kind": "ends_with_activity", "activity": "Close", "negate": False}]})
    assert partitioned["target"]["included"]["case_ids"] == ["B1", "B3", "B6"]
    assert partitioned["reference"]["included"]["case_ids"] == ["B2", "B4", "B7"]
    assert partitioned["pair_support"]["unevaluable"]["case_ids"] == ["B5"]


@pytest.mark.parametrize("predicate", [
    {"kind": "starts_with_activity", "activity": "Open"},
    {"kind": "starts_with_activity", "activity": "Open", "negate": False, "anchor_policy": OPENING_CONTEXT_POLICY},
    {"kind": "ends_with_activity", "activity": "", "negate": False},
    {"kind": "ends_with_activity", "activity": "Open", "negate": "false"},
])
def test_a_compared_group_refuses_a_boundary_step_that_is_not_exactly_its_three_fields(predicate):
    prepared = prepared_from(BOUNDARIES)
    definition = {"mode": "selection_partition", "target_name": "Kept", "reference_name": "Removed",
                  "target_side": "kept", "predicates": [predicate]}

    refused = compare_groups(prepared, prepared.identity_dict(), None, 3, OPENING_CONTEXT_POLICY, definition)

    assert refused.code == "invalid_predicate"
