"""The time before and after the records of an activity, as the map supplies it.

For every passage of a path the map takes the hours between its two labelled
records. An activity's time since the event before is the median of those
hours over the passages into it, and its time until the next event the median
over the passages out of it. Every expected figure below was worked out by
hand from the literal logs.
"""

from itertools import combinations
from statistics import median

import pytest

from literal_logs import POLICIES, prepared_from
from wise_platform_analytics.preparation import PreparationResult, prepare
from wise_platform_analytics.process_graph import build_process_graph

# T1  Open 08:00, Assign 10:00, Close 16:00                    2 h, then 6 h
# T2  Open 08:00, Assign 09:00, Assign 16:00, Close 21:00      1 h, 7 h from Assign to Assign, 5 h
# T3  Open 08:00, Assign 08:00, Close 20:00                    0 h between two records of the same time, 12 h
# T4  Open 08:00, (no label) 08:15, Close 08:30                half an hour from Open to Close over the record without label
# T5  Open 08:00, Assign at an unreadable time, Close 09:00    its order cannot be evaluated
# T6  Check 08:00                                              one record: nothing before it and nothing after it
#
# Passages of the incidents whose order is known, in hours:
#   Open > Assign    2, 1, 0      Assign > Assign   7
#   Assign > Close   6, 5, 12     Open > Close      0.5
TIMES = [
    "Incident;Event;At;Desk;Priority",
    "T1;Open;2026-10-01T08:00:00Z;East;P1",
    "T1;Assign;2026-10-01T10:00:00Z;East;P1",
    "T1;Close;2026-10-01T16:00:00Z;East;P1",
    "T2;Open;2026-10-02T08:00:00Z;East;P1",
    "T2;Assign;2026-10-02T09:00:00Z;East;P1",
    "T2;Assign;2026-10-02T16:00:00Z;East;P1",
    "T2;Close;2026-10-02T21:00:00Z;East;P1",
    "T3;Open;2026-10-03T08:00:00Z;East;P1",
    "T3;Assign;2026-10-03T08:00:00Z;East;P1",
    "T3;Close;2026-10-03T20:00:00Z;East;P1",
    "T4;Open;2026-10-04T08:00:00Z;West;P1",
    "T4;;2026-10-04T08:15:00Z;West;P1",
    "T4;Close;2026-10-04T08:30:00Z;West;P1",
    "T5;Open;2026-10-05T08:00:00Z;West;P1",
    "T5;Assign;later;West;P1",
    "T5;Close;2026-10-05T09:00:00Z;West;P1",
    "T6;Check;2026-10-06T08:00:00Z;West;P1",
]

# Every activity has one path into it and one path out of it at most:
#   L1  Receive 08:00, Check 09:00, Ship 12:00      1 h, then 3 h
#   L2  Receive 08:00, Check 11:00, Ship 12:00      3 h, then 1 h
#   L3  Receive 08:00, Check 10:00, Ship 20:00      2 h, then 10 h
LINE = [
    "Incident;Event;At;Desk;Priority",
    "L1;Receive;2026-11-01T08:00:00Z;East;P2",
    "L1;Check;2026-11-01T09:00:00Z;East;P2",
    "L1;Ship;2026-11-01T12:00:00Z;East;P2",
    "L2;Receive;2026-11-02T08:00:00Z;East;P2",
    "L2;Check;2026-11-02T11:00:00Z;East;P2",
    "L2;Ship;2026-11-02T12:00:00Z;East;P2",
    "L3;Receive;2026-11-03T08:00:00Z;East;P2",
    "L3;Check;2026-11-03T10:00:00Z;East;P2",
    "L3;Ship;2026-11-03T20:00:00Z;East;P2",
]

TIME_KEYS = ("medianPreviousHours", "usablePreviousCount", "medianNextHours", "usableNextCount")


def nodes_of(graph):
    return {node["label"]: node["metrics"] for node in graph["nodes"]}


def times_of(graph):
    """The time figures of every activity: (hours before, passages, hours after, passages); None for an absent figure."""
    return {label: tuple(metrics.get(key) for key in TIME_KEYS) for label, metrics in nodes_of(graph).items()}


def test_every_activity_carries_its_counts_and_the_time_figures_it_has():
    nodes = nodes_of(build_process_graph(prepared_from(TIMES)))

    assert nodes == {
        # Open is only ever the first labelled record: nothing leads into it.
        "Open": {"count": 5, "events": 5, "cases": 5, "starts": 4, "ends": 0,
                 "usablePreviousCount": 0, "medianNextHours": 0.75, "usableNextCount": 4},
        "Assign": {"count": 5, "events": 5, "cases": 4, "starts": 0, "ends": 0,
                   "medianPreviousHours": 1.5, "usablePreviousCount": 4, "medianNextHours": 6.5, "usableNextCount": 4},
        # Close is only ever the last labelled record: nothing leads out of it.
        "Close": {"count": 5, "events": 5, "cases": 5, "starts": 0, "ends": 4,
                  "medianPreviousHours": 5.5, "usablePreviousCount": 4, "usableNextCount": 0},
        "Check": {"count": 1, "events": 1, "cases": 1, "starts": 1, "ends": 1,
                  "usablePreviousCount": 0, "usableNextCount": 0},
    }


def test_the_time_before_and_after_an_activity_are_the_medians_of_the_passages_into_and_out_of_it():
    times = times_of(build_process_graph(prepared_from(TIMES)))

    assert times["Open"] == (None, 0, median([0, 0.5, 1, 2]), 4)
    assert times["Assign"] == (median([0, 1, 2, 7]), 4, median([5, 6, 7, 12]), 4)
    assert times["Close"] == (median([0.5, 5, 6, 12]), 4, None, 0)
    assert times["Check"] == (None, 0, None, 0)


def test_an_activity_in_the_middle_of_one_incident_has_both_times():
    times = times_of(build_process_graph(prepared_from(TIMES), ["T1"]))

    assert times == {"Open": (None, 0, 2, 1), "Assign": (2, 1, 6, 1), "Close": (6, 1, None, 0)}


def test_an_activity_repeated_in_one_incident_counts_every_occurrence_with_its_own_neighbours():
    graph = build_process_graph(prepared_from(TIMES), ["T2"])

    # The first Assign comes 1 h after Open and 7 h before the second; the second 7 h after the first and 5 h before Close.
    assert times_of(graph)["Assign"] == (median([1, 7]), 2, median([7, 5]), 2)
    assert times_of(graph)["Open"] == (None, 0, 1, 1)
    assert times_of(graph)["Close"] == (5, 1, None, 0)
    assert nodes_of(graph)["Assign"]["count"] == 2


def test_two_records_of_the_same_time_are_zero_hours_apart_and_zero_is_a_figure():
    nodes = nodes_of(build_process_graph(prepared_from(TIMES), ["T3"]))

    assert nodes["Open"]["medianNextHours"] == 0 and nodes["Open"]["usableNextCount"] == 1
    assert nodes["Assign"]["medianPreviousHours"] == 0 and nodes["Assign"]["usablePreviousCount"] == 1
    assert nodes["Assign"]["medianNextHours"] == 12


def test_a_record_without_label_is_passed_over_as_for_the_path():
    graph = build_process_graph(prepared_from(TIMES), ["T4"])

    assert times_of(graph) == {"Open": (None, 0, 0.5, 1), "Close": (0.5, 1, None, 0)}
    [edge] = graph["edges"]
    assert edge["metrics"]["medianLagHours"] == 0.5
    assert edge["payload"]["bridged_passage_count"] == 1


def test_an_incident_whose_order_is_not_known_gives_no_time_as_it_gives_no_path():
    prepared = prepared_from(TIMES)
    alone = build_process_graph(prepared, ["T5"])

    assert alone["edges"] == []
    assert alone["meta"]["sequence_unevaluable_case_ids"] == ["T5"]
    assert nodes_of(alone) == {label: {"count": 1, "events": 1, "cases": 1, "starts": 0, "ends": 0,
                                       "usablePreviousCount": 0, "usableNextCount": 0}
                               for label in ("Open", "Assign", "Close")}
    # Beside other incidents it adds its records to the counts and nothing to the times.
    without = [case_id for case_id in prepared.histories if case_id != "T5"]
    assert times_of(build_process_graph(prepared)) == times_of(build_process_graph(prepared, without))


def test_an_incident_of_one_record_gives_no_time():
    graph = build_process_graph(prepared_from(TIMES), ["T6"])

    assert times_of(graph) == {"Check": (None, 0, None, 0)}
    assert set(nodes_of(graph)["Check"]) == {"count", "events", "cases", "starts", "ends",
                                             "usablePreviousCount", "usableNextCount"}


def test_an_activity_with_one_path_into_it_and_one_out_of_it_has_the_lags_of_those_paths():
    graph = build_process_graph(prepared_from(LINE))
    lags = {(edge["payload"]["source_activity"], edge["payload"]["target_activity"]):
            (edge["metrics"]["medianLagHours"], edge["metrics"]["usableLagCount"]) for edge in graph["edges"]}

    assert lags == {("Receive", "Check"): (2, 3), ("Check", "Ship"): (3, 3)}
    assert times_of(graph) == {"Receive": (None, 0, 2, 3), "Check": (2, 3, 3, 3), "Ship": (3, 3, None, 0)}


@pytest.mark.parametrize("lines", [TIMES, LINE], ids=["times", "line"])
def test_the_times_of_every_activity_of_every_population_follow_from_the_lags_of_its_paths(lines):
    prepared = prepared_from(lines)
    incidents = sorted(prepared.histories)
    populations = [list(chosen) for size in range(len(incidents) + 1) for chosen in combinations(incidents, size)]

    for population in populations:
        graph = build_process_graph(prepared, population)
        for node in graph["nodes"]:
            for median_key, count_key, end in (("medianPreviousHours", "usablePreviousCount", "target"),
                                               ("medianNextHours", "usableNextCount", "source")):
                paths = [edge["metrics"] for edge in graph["edges"] if edge[end] == node["id"]]
                metrics = node["metrics"]
                # As many passages as its paths count, and a figure exactly where there is a passage.
                assert metrics[count_key] == sum(path["usableLagCount"] for path in paths) == sum(
                    path["count"] for path in paths), (population, node["label"], count_key)
                assert (median_key in metrics) is bool(paths), (population, node["label"], median_key)
                if len(paths) == 1:
                    assert metrics[median_key] == paths[0]["medianLagHours"]
                elif paths:
                    # A median of all the lags lies between the smallest and the largest median of the single paths.
                    medians = [path["medianLagHours"] for path in paths]
                    assert min(medians) <= metrics[median_key] <= max(medians)


def wall_clock(lines):
    raw = ("\n".join(lines) + "\n").encode("utf-8")
    time = {"id": "incident.time.wall_clock_as_recorded.v1", "parameters": {
        "format": "iso8601", "timezone": "none_as_recorded", "snapshot_cutoff_local": "2027-01-01T00:00:00"}}
    result = prepare(raw, {"encoding": "utf-8", "delimiter": ";", "quotechar": '"', "header": "first_record"},
                     {"case_column": 0, "activity_column": 1, "timestamp_column": 2, "sequence_column": None,
                      "context_columns": [3, 4]}, {**POLICIES, "time": time}, True)
    assert isinstance(result, PreparationResult) and result.preparation is not None, result
    return result.preparation


def test_times_of_the_recorded_wall_clock_are_differences_of_the_times_as_recorded():
    # In many places the clocks went forward by an hour in this night; the recorded times are taken as they are.
    graph = build_process_graph(wall_clock([
        "Incident;Event;At;Desk;Priority",
        "W1;Start;2026-03-29T01:30:00;East;P1",
        "W1;Finish;2026-03-29T03:30:00;East;P1",
        "W2;Start;2026-03-29T00:00:00;East;P1",
        "W2;Finish;2026-03-29T05:00:00;East;P1",
    ]))

    assert graph["meta"]["lag_clock"] == "recorded_wall_clock_hours"
    assert graph["meta"]["clock_limitation"]
    assert graph["edges"][0]["metrics"]["medianLagHours"] == 3.5
    assert times_of(graph) == {"Start": (None, 0, 3.5, 2), "Finish": (3.5, 2, None, 0)}
