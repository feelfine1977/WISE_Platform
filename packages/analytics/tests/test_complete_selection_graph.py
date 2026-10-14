"""Literal complete-case selection, gaps, support and chronology examples."""
from dataclasses import dataclass, replace
from datetime import datetime, timedelta, timezone
from itertools import product
from types import MappingProxyType
import json

import pytest

from wise_platform_analytics.selection import (
    ContainsActivity, DirectlyFollows, EndsWithActivity, OpeningAttributeEquals, SelectionError,
    StartsWithActivity, select_cases,
)
from wise_platform_analytics.process_graph import activity_node_id, build_process_graph


@dataclass(frozen=True)
class Context:
    column_index: int
    value: str | None


@dataclass(frozen=True)
class Record:
    row_id: str
    source_position: int
    activity: str | None
    time_value: datetime | None
    context: tuple[Context, ...] = ()
    timestamp_kind: str = "utc_instant"
    source_sequence: int | None = None


@dataclass(frozen=True)
class Prepared:
    histories: object
    mapping: object
    policies: object

    def sequence_evaluable(self, case_id):
        return all(record.time_value is not None for record in self.histories[case_id])

    def identity_dict(self):
        return {"source_id": "source.v1:sha256:" + "a" * 64,
                "preparation_id": "preparation.v1:sha256:" + "b" * 64,
                "representation_id": "representation.v1:sha256:" + "c" * 64,
                "case_dictionary_id": "case-dictionary.v1:sha256:" + "d" * 64,
                "population_id": "population.v1:sha256:" + "e" * 64, "implementation_version": "0.1.0"}


def data(histories):
    kind = next((record.timestamp_kind for rows in histories.values() for record in rows), "utc_instant")
    time_id = "incident.time.wall_clock_as_recorded.v1" if kind == "wall_clock" else "incident.time.explicit_format_timezone_utc.v1"
    return Prepared(MappingProxyType(histories), MappingProxyType({"context_columns": (3,)}), MappingProxyType({"time": {"id": time_id}}))


def row(case, index, activity, hours=0, context=None, wall=False):
    moment = None if hours is None else datetime(2026, 10, 9, tzinfo=None if wall else timezone.utc) + timedelta(hours=hours)
    return Record(f"row-{case}-{index}", index, activity, moment, (Context(3, context),),
                  "wall_clock" if wall else "utc_instant", index)


@pytest.fixture
def cases():
    return data({
        "P1": (row("P1", 0, "A", 0), row("P1", 1, None, 0.5, "Desktop"), row("P1", 2, "B", 1, "Desktop")),
        "P2": (row("P2", 3, "B", 0, "Unknown"),),
        "P3": (row("P3", 4, "B", 0, "Desktop"), row("P3", 5, "A", None, "Desktop")),
    })


def test_whole_case_and_three_way_partition_preserve_nonadditive_chip_support(cases):
    result = select_cases(cases, [ContainsActivity("A"), DirectlyFollows("A", "B")])
    assert result.parent.to_dict() == {"case_ids": ["P1", "P2", "P3"], "case_count": 3, "record_count": 6}
    assert result.kept.to_dict() == {"case_ids": ["P1"], "case_count": 1, "record_count": 3}
    assert result.removed.to_dict() == {"case_ids": ["P2"], "case_count": 1, "record_count": 1}
    assert result.unevaluable.to_dict() == {"case_ids": ["P3"], "case_count": 1, "record_count": 2}
    assert [chip.removed.case_ids for chip in result.predicate_results] == [("P2",), ("P2",)]
    assert [chip.unevaluable.case_ids for chip in result.predicate_results] == [(), ("P3",)]
    assert len(cases.histories["P1"]) == 3
    json.dumps(result.to_dict(), allow_nan=False)


def test_negation_preserves_unknown_and_false_dominates_unknown(cases):
    negative = select_cases(cases, [DirectlyFollows("A", "B", negate=True)])
    assert negative.kept.case_ids == ("P2",) and negative.removed.case_ids == ("P1",)
    assert negative.unevaluable.case_ids == ("P3",)
    absent = select_cases(cases, [DirectlyFollows("A", "B"), ContainsActivity("Z")])
    assert absent.kept.case_ids == () and absent.unevaluable.case_ids == ()
    assert absent.removed.case_ids == ("P1", "P2", "P3")
    presence = select_cases(cases, [ContainsActivity("A", negate=True)])
    assert presence.kept.case_ids == ("P2",) and presence.unevaluable.case_ids == ()


def test_opening_context_keeps_missing_and_literal_unknown_separate(cases):
    missing = select_cases(cases, [OpeningAttributeEquals(3, None)])
    assert missing.kept.case_ids == ("P1",) and missing.removed.case_ids == ("P2",)
    assert missing.unevaluable.case_ids == ("P3",)
    literal = select_cases(cases, [OpeningAttributeEquals(3, "Unknown")])
    assert literal.kept.case_ids == ("P2",) and literal.removed.case_ids == ("P1",)
    assert literal.unevaluable.case_ids == ("P3",)


def test_frozen_parent_and_semantic_identity_do_not_depend_on_chip_order(cases):
    first = select_cases(cases, [ContainsActivity("A"), DirectlyFollows("A", "B")], ["P3", "P1"])
    second = select_cases(cases, [DirectlyFollows("A", "B"), ContainsActivity("A")], ["P1", "P3"])
    assert first.population_id == second.population_id
    assert first.parent.case_ids == ("P1", "P3")
    assert first.population_id != select_cases(cases, [ContainsActivity("A")]).population_id
    assert select_cases(cases).kept.case_ids == ("P1", "P2", "P3")
    assert select_cases(cases, parent_ids=[]).parent.record_count == 0


def test_invalid_predicates_or_dictionary_membership_refuse(cases):
    for predicate in (ContainsActivity(""), ContainsActivity("A", negate=1), OpeningAttributeEquals(True, None), OpeningAttributeEquals(9, "X")):
        with pytest.raises(SelectionError):
            select_cases(cases, [predicate])
    with pytest.raises(SelectionError):
        select_cases(cases, parent_ids=["not-in-dictionary"])
    with pytest.raises(SelectionError):
        select_cases(cases, parent_ids=["P1", "P1"])


def test_all_two_label_sequences_match_literal_direct_follow_truth_table():
    truth = {"AA": False, "AB": True, "BA": False, "BB": False}
    for left, right in product("AB", repeat=2):
        prepared = data({"X": (row("X", 0, left, 0), row("X", 1, right, 1))})
        result = select_cases(prepared, [DirectlyFollows("A", "B")])
        assert bool(result.kept.case_count) is truth[left + right]
        assert bool(select_cases(prepared, [DirectlyFollows("A", "B", True)]).kept.case_count) is not truth[left + right]


def test_repeated_passages_distinct_incidents_and_zero_lag_have_exact_support():
    prepared = data({
        "X": (row("X", 0, "A", 0), row("X", 1, "B", 1), row("X", 2, "A", 2), row("X", 3, "B", 4)),
        "Y": (row("Y", 4, "A", 0), row("Y", 5, "B", 0)),
    })
    graph = build_process_graph(prepared)
    nodes = {node["label"]: node for node in graph["nodes"]}
    # Into A leads the one passage from B (1 h); out of it the three to B (1, 2 and 0 h). For B it is the other way round.
    assert nodes["A"]["metrics"] == {"count": 3, "events": 3, "cases": 2, "starts": 2, "ends": 0,
                                     "medianPreviousHours": 1.0, "usablePreviousCount": 1,
                                     "medianNextHours": 1.0, "usableNextCount": 3}
    assert nodes["B"]["metrics"] == {"count": 3, "events": 3, "cases": 2, "starts": 0, "ends": 2,
                                     "medianPreviousHours": 1.0, "usablePreviousCount": 3,
                                     "medianNextHours": 1.0, "usableNextCount": 1}
    edges = {(edge["payload"]["source_activity"], edge["payload"]["target_activity"]): edge for edge in graph["edges"]}
    assert edges["A", "B"]["metrics"] == {"count": 3, "cases": 2, "medianLagHours": 1.0, "usableLagCount": 3}
    assert edges["B", "A"]["metrics"]["count"] == 1
    zero = build_process_graph(prepared, ["Y"])["edges"][0]
    assert zero["metrics"]["medianLagHours"] == 0 and zero["metrics"]["count"] == 1
    json.dumps(graph, allow_nan=False)


def test_raw_missing_boundaries_never_manufacture_starts_ends_or_terminal_paths():
    prepared = data({"X": (row("X", 0, None, 0), row("X", 1, "A", 1), row("X", 2, "B", 2), row("X", 3, None, 3))})
    graph = build_process_graph(prepared)
    assert all(node["metrics"]["starts"] == node["metrics"]["ends"] == 0 for node in graph["nodes"])
    assert len(graph["edges"]) == 1
    assert graph["meta"]["boundary_policy"] == "incident.boundary.raw_labeled_start_end.v1"
    single = build_process_graph(data({"X": (row("X", 0, "A", 0), row("X", 1, None, 1))}))
    assert single["edges"] == [] and single["nodes"][0]["metrics"]["ends"] == 0
    unlabeled = build_process_graph(data({"X": (row("X", 0, None, 0),)}))
    assert unlabeled["nodes"] == unlabeled["edges"] == []
    assert unlabeled["meta"]["raw_record_count"] == unlabeled["meta"]["omitted_activity_record_count"] == 1


def test_boundary_predicates_keep_exactly_the_incidents_the_graph_counts_as_starts_and_ends(cases):
    # P4 has no record at all: it starts and ends nowhere, in the graph and for the predicates.
    prepared = data({**cases.histories, "P4": ()})
    nodes = {node["label"]: node["metrics"] for node in build_process_graph(prepared)["nodes"]}
    assert {label: (metrics["starts"], metrics["ends"]) for label, metrics in nodes.items()} == {"A": (1, 0), "B": (1, 2)}
    starts = select_cases(prepared, [StartsWithActivity("A")])
    assert starts.kept.case_ids == ("P1",) and starts.removed.case_ids == ("P2", "P4")
    assert starts.unevaluable.case_ids == ("P3",)
    ends = select_cases(prepared, [EndsWithActivity("B")])
    assert ends.kept.case_ids == ("P1", "P2") and ends.removed.case_ids == ("P4",)
    assert ends.unevaluable.case_ids == ("P3",)
    opposite = select_cases(prepared, [EndsWithActivity("B", negate=True)])
    assert opposite.kept.case_ids == ("P4",) and opposite.removed.case_ids == ("P1", "P2")
    assert opposite.unevaluable.case_ids == ("P3",)
    for label, metrics in nodes.items():
        assert select_cases(prepared, [StartsWithActivity(label)]).kept.case_count == metrics["starts"]
        assert select_cases(prepared, [EndsWithActivity(label)]).kept.case_count == metrics["ends"]


def test_missing_label_bridge_discloses_raw_gap_witness_and_keeps_whole_case(cases):
    graph = build_process_graph(cases, ["P1"])
    edge = graph["edges"][0]
    assert edge["payload"]["omitted_row_ids"] == ["row-P1-1"]
    assert edge["payload"]["gap_case_ids"] == ["P1"] and edge["payload"]["bridged_passage_count"] == 1
    assert edge["tags"] == ["bridged_missing_activity"]
    assert edge["metrics"]["count"] == edge["metrics"]["cases"] == 1
    assert select_cases(cases, [DirectlyFollows("A", "B")]).kept.record_count == 3


def test_unevaluable_sequences_keep_activity_presence_but_publish_no_false_paths(cases):
    graph = build_process_graph(cases, ["P3"])
    assert {node["label"] for node in graph["nodes"]} == {"A", "B"}
    assert graph["edges"] == []
    assert graph["meta"]["node_case_denominator"] == 1
    assert graph["meta"]["path_case_denominator"] == 0
    assert graph["meta"]["sequence_unevaluable_case_ids"] == ["P3"]
    assert graph["meta"]["sequence_unevaluable_record_count"] == 2
    assert all(node["metrics"]["starts"] == node["metrics"]["ends"] == 0 for node in graph["nodes"])


def test_graph_ids_are_stable_through_subset_and_reserved_labels_are_safe(cases):
    full = build_process_graph(cases)
    selected = build_process_graph(cases, ["P1"])
    by_label = {node["label"]: node["id"] for node in full["nodes"]}
    assert all(node["id"] == by_label[node["label"]] for node in selected["nodes"])
    assert activity_node_id("__proto__") != "__proto__"
    empty = build_process_graph(cases, [])
    assert empty["nodes"] == empty["edges"] == [] and empty["meta"]["selected_case_count"] == 0


def test_wall_clock_lags_are_labelled_and_mixed_time_kinds_refuse():
    prepared = data({"X": (row("X", 0, "A", 0, wall=True), row("X", 1, "B", 2, wall=True))})
    graph = build_process_graph(prepared)
    assert graph["edges"][0]["metrics"]["medianLagHours"] == 2
    assert graph["meta"]["lag_clock"] == "recorded_wall_clock_hours"
    assert graph["meta"]["clock_limitation"]
    assert build_process_graph(prepared, [])["meta"]["lag_clock"] == "recorded_wall_clock_hours"
    with pytest.raises(SelectionError):
        build_process_graph(data({"X": (replace(row("X", 0, "A", 0), timestamp_kind="wall_clock"), row("X", 1, "B", 1))}))


def real_prepared(raw=None):
    from wise_platform_analytics.preparation import prepare
    raw = raw or (b"Case;Activity;Time;Group\r\nX;A;2026-10-09T00:00:00Z;\r\n"
                  b"X;;2026-10-09T00:30:00Z;West\r\nX;B;2026-10-09T01:00:00Z;West\r\n"
                  b"Y;B;2026-10-09T02:00:00Z;Unknown\r\n")
    policy = {
        "time": {"id": "incident.time.explicit_format_timezone_utc.v1", "parameters": {"format": "iso8601", "timezone": {"mode": "from_values"}, "snapshot_cutoff_utc": "2027-01-01T00:00:00Z"}},
        "order": {"id": "incident.order.declared_time_optional_sequence_source_position.v1", "parameters": {"primary": "usable_declared_time_ascending", "secondary": "mapped_sequence_or_source_position", "tie_breaker": "source_position_ascending", "unavailable_timestamp": "presentation_tail_source_position", "unavailable_timestamp_case_sequence": "unevaluable"}},
        "rows": {"id": "incident.rows.missing_id_outside_invalid_time_retained.v1", "parameters": {"missing_case_id": "outside_population_preserve_source", "unavailable_timestamp": "retain_case_raw_flag_order_unknown", "invalid_mapped_sequence": "block_preparation", "duplicate_candidates": "retain_all"}},
        "missing_values": {"id": "incident.missing.empty_mapped_activity_context.v1", "parameters": {"empty_activity_context": "missing", "literal_values": "preserve"}},
        "identifier": {"id": "incident.identifier.trim_outer_whitespace.v1", "parameters": {"normalization": "trim_outer_whitespace_preserve_raw"}},
        "activity_projection": {"id": "incident.activity.omit_missing_retain_raw_gaps.v1", "parameters": {"missing_activity": "omit_from_mapped_sequence", "raw_records": "retain_all", "gap_evidence": "omitted_row_ids"}},
        "parent": {"id": "incident.parent.all_identified_cases.v1", "parameters": {"eligibility": "nonempty_normalized_case_identifier"}},
    }
    result = prepare(raw, {"encoding": "utf-8", "delimiter": ";", "quotechar": '"', "header": "first_record"},
                     {"case_column": 0, "activity_column": 1, "timestamp_column": 2, "sequence_column": None, "context_columns": [3]}, policy, True)
    assert result.state == "ready"
    return result.preparation


def test_real_prepared_selected_evidence_keeps_all_rows_and_selection_identity():
    from wise_platform_analytics.selection import open_selected_case
    from wise_platform_analytics.mapping import ImportRefusal
    prepared = real_prepared()
    selection = select_cases(prepared, [OpeningAttributeEquals(3, None)])
    supplied = selection.identity_dict()
    snapshot = dict(supplied)
    result = open_selected_case(prepared, selection, supplied, "X")
    assert not isinstance(result, ImportRefusal)
    assert result["identity"] == supplied
    assert supplied == snapshot
    assert result["identity"]["population_id"] != prepared.identity_dict()["population_id"]
    assert result["coverage"] == {"raw_record_count": 3, "mapped_record_count": 2, "omitted_activity_record_count": 1}
    assert [record["source_position"] for record in result["records"]] == [0, 1, 2]
    assert result["records"][1]["original_cells"] == ["X", "", "2026-10-09T00:30:00Z", "West"]
    for case_id in ("Y", "not-in-dictionary"):
        assert open_selected_case(prepared, selection, supplied, case_id).code == "case_not_found"
    assert open_selected_case(prepared, selection, prepared.identity_dict(), "X").code == "identity_mismatch"
    for field in supplied:
        wrong = {**supplied, field: "different"}
        assert open_selected_case(prepared, selection, wrong, "X").code == "identity_mismatch"
    changed = real_prepared(prepared.source.replace(b"X;A;", b"X;C;"))
    assert open_selected_case(changed, selection, supplied, "X").code == "identity_mismatch"


def test_presence_selection_can_open_complete_evidence_when_chronology_is_unknown():
    from wise_platform_analytics.selection import open_selected_case
    prepared = real_prepared(real_prepared().source.replace(b"Y;B;2026-10-09T02:00:00Z;", b"Y;B;not-a-time;"))
    selection = select_cases(prepared, [ContainsActivity("B")])
    assert selection.kept.case_ids == ("X", "Y") and selection.unevaluable.case_ids == ()
    result = open_selected_case(prepared, selection, selection.identity_dict(), "Y")
    assert result["sequence_evaluable"] is False
    assert result["records"][0]["original_cells"] == ["Y", "B", "not-a-time", "Unknown"]
    assert result["records"][0]["timestamp_status"] == "invalid"
