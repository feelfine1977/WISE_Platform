"""Supplied FlowGraph data from complete raw histories and qualified sequences."""
from __future__ import annotations

from collections import Counter, defaultdict
from collections.abc import Iterable
import hashlib
import json
from statistics import median

from .selection import BOUNDARY_POLICY, PreparedDataLike, SelectionError, boundary_activities, case_ids


def activity_node_id(activity: str) -> str:
    return "activity.v1:sha256:" + hashlib.sha256(activity.encode("utf-8")).hexdigest()


def path_edge_id(source_activity: str, target_activity: str) -> str:
    encoded = json.dumps([source_activity, target_activity], ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return "path.v1:sha256:" + hashlib.sha256(encoded).hexdigest()


def build_process_graph(prepared: PreparedDataLike, selected_ids: Iterable[str] | None = None) -> dict[str, object]:
    """Return the library-owned FlowGraph, without layout or function-valued scenes.

    Activity occurrence/case supports concern all selected raw histories. Paths
    and boundaries concern only cases whose declared sequence is evaluable.
    Starts and ends are those of ``boundary_activities``, which the boundary
    predicates of a selection read too, so both always count the same incidents.
    Missing-label projection bridges carry their omitted raw-row witnesses.

    The hours of a passage are taken once, for its path. The same hours are the
    time since the event before for the activity the passage leads into, and the
    time until the next event for the activity it leaves. An activity's two
    medians are therefore medians over the lags of the paths into it and out of
    it, on the clock of ``lag_clock``; one without such a passage has no median.
    """
    selected = case_ids(prepared, selected_ids)
    eligible = tuple(case_id for case_id in selected if prepared.sequence_evaluable(case_id))
    eligible_set = set(eligible)
    unevaluable = tuple(case_id for case_id in selected if case_id not in eligible_set)
    occurrences: Counter[str] = Counter()
    activity_cases: dict[str, set[str]] = defaultdict(set)
    starts: Counter[str] = Counter()
    ends: Counter[str] = Counter()
    passages: Counter[tuple[str, str]] = Counter()
    path_cases: dict[tuple[str, str], set[str]] = defaultdict(set)
    lags: dict[tuple[str, str], list[float]] = defaultdict(list)
    # Sum integer microseconds, then render the sum once in hours. Repeated passages
    # and missing-label bridges have exactly the same domain as the medians below.
    path_microseconds: Counter[tuple[str, str]] = Counter()
    hours_before: dict[str, list[float]] = defaultdict(list)
    hours_after: dict[str, list[float]] = defaultdict(list)
    gap_cases: dict[tuple[str, str], set[str]] = defaultdict(set)
    gap_rows: dict[tuple[str, str], set[str]] = defaultdict(set)
    gap_passages: Counter[tuple[str, str]] = Counter()
    raw_count = 0
    omitted_count = 0
    kinds: set[str] = set()
    for case_id in selected:
        records = prepared.histories[case_id]
        raw_count += len(records)
        for record in records:
            kinds.add(record.timestamp_kind)
            if record.activity is None:
                omitted_count += 1
            else:
                occurrences[record.activity] += 1
                activity_cases[record.activity].add(case_id)
        if case_id not in eligible_set or not records:
            continue
        start, end = boundary_activities(records)
        if start is not None:
            starts[start] += 1
        if end is not None:
            ends[end] += 1
        mapped = [(index, record) for index, record in enumerate(records) if record.activity is not None]
        for (left_index, left), (right_index, right) in zip(mapped, mapped[1:]):
            assert left.activity is not None and right.activity is not None
            key = (left.activity, right.activity)
            if left.time_value is None or right.time_value is None:
                raise SelectionError("inconsistent_sequence", "An evaluable sequence contains an unavailable time.")
            delta = right.time_value - left.time_value
            hours = delta.total_seconds() / 3600
            if hours < 0:
                raise SelectionError("inconsistent_sequence", "An evaluable history is not in declared time order.")
            passages[key] += 1
            path_cases[key].add(case_id)
            lags[key].append(hours)
            path_microseconds[key] += (delta.days * 86_400 + delta.seconds) * 1_000_000 + delta.microseconds
            hours_after[left.activity].append(hours)
            hours_before[right.activity].append(hours)
            omitted = records[left_index + 1:right_index]
            if omitted:
                gap_passages[key] += 1
                gap_cases[key].add(case_id)
                gap_rows[key].update(record.row_id for record in omitted)
    if len(kinds) > 1:
        raise SelectionError("mixed_time_kinds", "One graph cannot mix UTC and recorded-wall interpretations.")
    time_policy = prepared.policies["time"]["id"]
    time_kind = "wall_clock" if time_policy == "incident.time.wall_clock_as_recorded.v1" else "utc_instant"
    if kinds and kinds != {time_kind}:
        raise SelectionError("inconsistent_time_kind", "Record times do not match the prepared interpretation.")
    nodes = []
    for activity in sorted(occurrences):
        before, after = hours_before.get(activity, []), hours_after.get(activity, [])
        metrics: dict[str, object] = {
            "count": occurrences[activity], "events": occurrences[activity],
            "cases": len(activity_cases[activity]), "starts": starts[activity], "ends": ends[activity]}
        if before:
            metrics["medianPreviousHours"] = median(before)
        metrics["usablePreviousCount"] = len(before)
        if after:
            metrics["medianNextHours"] = median(after)
        metrics["usableNextCount"] = len(after)
        nodes.append({"id": activity_node_id(activity), "kind": "activity", "label": activity, "metrics": metrics})
    total_microseconds = sum(path_microseconds.values())
    # The supplied default ranking shares the table's tie rule: total, incidents,
    # then the existing supplied source/target order. Artificial boundary flows
    # are presentation and have no passage time to contribute.
    top_five = sorted(passages, key=lambda key: (-path_microseconds[key], -len(path_cases[key]), key))[:5]
    top_microseconds = sum(path_microseconds[key] for key in top_five)
    edges = []
    for source, target in sorted(passages):
        key = (source, target)
        edge = {"id": path_edge_id(source, target), "kind": "follows",
                "source": activity_node_id(source), "target": activity_node_id(target),
                "metrics": {"count": passages[key], "cases": len(path_cases[key]),
                            "medianLagHours": median(lags[key]), "usableLagCount": len(lags[key]),
                            "totalLagHours": path_microseconds[key] / 3_600_000_000,
                            "totalLagMicroseconds": str(path_microseconds[key]),
                            "shareOfTotalLag": path_microseconds[key] / total_microseconds if total_microseconds else None},
                "payload": {"source_activity": source, "target_activity": target,
                            "case_ids": sorted(path_cases[key]), "gap_case_ids": sorted(gap_cases[key]),
                            "omitted_row_ids": sorted(gap_rows[key]), "bridged_passage_count": gap_passages[key]}}
        if gap_passages[key]:
            edge["tags"] = ["bridged_missing_activity"]
        edges.append(edge)
    identity = prepared.identity_dict()
    return {"nodes": nodes, "edges": edges, "meta": {
        "representation_id": identity["representation_id"], "case_dictionary_id": identity["case_dictionary_id"],
        "selected_case_ids": list(selected), "selected_case_count": len(selected), "cases": len(selected),
        "events": raw_count - omitted_count, "raw_record_count": raw_count,
        "mapped_record_count": raw_count - omitted_count, "omitted_activity_record_count": omitted_count,
        "sequence_evaluable_case_ids": list(eligible), "sequence_evaluable_case_count": len(eligible),
        "sequence_unevaluable_case_ids": list(unevaluable), "sequence_unevaluable_case_count": len(unevaluable),
        "sequence_unevaluable_record_count": sum(len(prepared.histories[case_id]) for case_id in unevaluable),
        "node_support_basis": "all_selected_raw_histories", "node_case_denominator": len(selected),
        "path_support_basis": "sequence_evaluable_cases", "path_case_denominator": len(eligible),
        "activity_projection_policy": "incident.activity.omit_missing_retain_raw_gaps.v1",
        "path_adjacency": "mapped_sequence_with_disclosed_raw_gaps",
        "boundary_support_basis": "sequence_evaluable_cases_with_labeled_raw_boundaries",
        "boundary_policy": BOUNDARY_POLICY,
        "timestamp_kind": time_kind, "lag_unit": "hours",
        "lag_clock": "recorded_wall_clock_hours" if time_kind == "wall_clock" else "elapsed_utc_hours",
        "path_lag_totals": {
            "total_hours": total_microseconds / 3_600_000_000,
            "total_microseconds": str(total_microseconds),
            "usable_passage_count": sum(passages.values()),
            "usable_path_count": len(passages),
            "top_five_path_ids": [path_edge_id(*key) for key in top_five],
            "top_five_total_hours": top_microseconds / 3_600_000_000,
            "top_five_total_microseconds": str(top_microseconds),
            "top_five_share": top_microseconds / total_microseconds if total_microseconds else None,
        },
        "clock_limitation": "Recorded wall-clock differences may differ from physical elapsed time across clock changes."
                            if time_kind == "wall_clock" else None,
    }}
