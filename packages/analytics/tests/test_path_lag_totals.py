"""Supplied passage totals, exact ordering and unavailable denominators (#88)."""

from datetime import datetime, timedelta, timezone

import pytest

from test_complete_selection_graph import Record, data
from wise_platform_analytics.process_graph import build_process_graph, path_edge_id


def prepared(wall=False):
    start = datetime(2001, 1, 1, tzinfo=None if wall else timezone.utc)
    kind = "wall_clock" if wall else "utc_instant"

    def history(case, items):
        return tuple(Record(f"{case}-{index}", index, activity,
                            None if hours is None else start + timedelta(hours=hours),
                            timestamp_kind=kind) for index, (activity, hours) in enumerate(items))

    return data({
        "T1": history("T1", [("A", 0), ("B", 1), ("A", 2), ("B", 100)]),
        "T2": history("T2", [("A", 0), ("B", 1)]),
        "Busy": history("Busy", [("C", 0), ("D", 30), ("C", 60), ("D", 90), ("C", 120), ("D", 150)]),
        "Rare": history("Rare", [("E", 0), ("F", 120)]),
        "Bridge": history("Bridge", [("G", 0), (None, 2), ("H", 5)]),
        "Zero": history("Zero", [("I", 0), ("I", 0)]),
        "Extra": history("Extra", [("J", 0), ("K", 2)]),
        "U": history("U", [("A", 0), ("B", None)]),
        "Single": history("Single", [("A", 0)]),
        "Outside": history("Outside", [("L", 0), ("M", 999)]),
    })


def edges(graph):
    return {(edge["payload"]["source_activity"], edge["payload"]["target_activity"]): edge for edge in graph["edges"]}


@pytest.mark.parametrize("wall", [False, True])
def test_totals_use_every_usable_mapped_passage_and_selected_denominator(wall):
    source = prepared(wall)
    selected = [case for case in source.histories if case != "Outside"]
    graph = build_process_graph(source, selected)
    paths = edges(graph)
    # Three A→B passages are 1, 98 and 1 hours: neither cases×median nor
    # passages×median can replace their total. The U history contributes no path.
    assert paths["A", "B"]["metrics"] == {
        "count": 3, "cases": 2, "medianLagHours": 1.0, "usableLagCount": 3,
        "totalLagHours": 100.0, "totalLagMicroseconds": "360000000000", "shareOfTotalLag": 100 / 378,
    }
    assert paths["C", "D"]["metrics"]["totalLagHours"] == 90
    assert paths["E", "F"]["metrics"]["medianLagHours"] == 120
    assert paths["G", "H"]["metrics"]["totalLagHours"] == 5
    assert paths["G", "H"]["payload"]["omitted_row_ids"] == ["Bridge-1"]
    assert paths["I", "I"]["metrics"]["totalLagHours"] == 0
    assert paths["I", "I"]["metrics"]["shareOfTotalLag"] == 0
    assert ("L", "M") not in paths
    assert graph["meta"]["path_lag_totals"] == {
        "total_hours": 378.0, "total_microseconds": "1360800000000",
        "usable_passage_count": 13, "usable_path_count": 8,
        "top_five_path_ids": [path_edge_id(*pair) for pair in [("E", "F"), ("A", "B"), ("C", "D"), ("D", "C"), ("G", "H")]],
        "top_five_total_hours": 375.0, "top_five_total_microseconds": "1350000000000",
        "top_five_share": 375 / 378,
    }
    assert graph["meta"]["lag_clock"] == ("recorded_wall_clock_hours" if wall else "elapsed_utc_hours")
    subset = build_process_graph(source, ["T1", "T2"])
    assert edges(subset)["A", "B"]["metrics"]["shareOfTotalLag"] == 100 / 101
    assert subset["meta"]["path_lag_totals"]["total_hours"] == 101
    assert subset["meta"]["path_lag_totals"]["top_five_share"] == 1
    assert len(source.histories["Bridge"]) == 3


@pytest.mark.parametrize("cases,paths,passages", [([], 0, 0), (["U"], 0, 0), (["Single"], 0, 0), (["Zero"], 1, 1)])
def test_zero_total_keeps_usable_zero_separate_from_no_passage(cases, paths, passages):
    graph = build_process_graph(prepared(), cases)
    totals = graph["meta"]["path_lag_totals"]
    assert totals["total_hours"] == totals["top_five_total_hours"] == 0
    assert totals["total_microseconds"] == totals["top_five_total_microseconds"] == "0"
    assert totals["top_five_share"] is None
    assert totals["usable_path_count"] == paths and totals["usable_passage_count"] == passages
    assert len(graph["edges"]) == paths
    if paths:
        metrics = graph["edges"][0]["metrics"]
        assert metrics["usableLagCount"] == 1 and metrics["totalLagMicroseconds"] == "0"
        assert metrics["totalLagHours"] == 0 and metrics["shareOfTotalLag"] is None


def test_exact_totals_and_top_five_order_survive_float_hour_ties():
    start = datetime(1, 1, 1, tzinfo=timezone.utc)
    histories = {}
    # Every duration renders as the same floating hour number; their exact
    # microseconds still determine the first five. Input order is the opposite.
    for index in range(6):
        histories[str(index)] = (
            Record(f"{index}-a", 0, f"A{index}", start),
            Record(f"{index}-b", 1, f"B{index}", datetime(7998, 12, 31, tzinfo=timezone.utc) + timedelta(microseconds=index)),
        )
    graph = build_process_graph(data(histories))
    assert len({edge["metrics"]["totalLagHours"] for edge in graph["edges"]}) == 1
    assert len({edge["metrics"]["totalLagMicroseconds"] for edge in graph["edges"]}) == 6
    assert graph["meta"]["path_lag_totals"]["top_five_path_ids"] == [path_edge_id(f"A{i}", f"B{i}") for i in range(5, 0, -1)]
    delta = datetime(7998, 12, 31, tzinfo=timezone.utc) - start
    exact = (delta.days * 86_400 + delta.seconds) * 1_000_000 + delta.microseconds
    assert graph["meta"]["path_lag_totals"]["total_microseconds"] == str(exact * 6 + 15)


def test_equal_totals_rank_by_distinct_incidents_then_supplied_names():
    source = prepared()
    pair = source.histories["T2"]
    source = data({"a": pair, "b": pair, "c": source.histories["Extra"]})
    graph = build_process_graph(source)
    assert graph["meta"]["path_lag_totals"]["top_five_path_ids"] == [path_edge_id("A", "B"), path_edge_id("J", "K")]
