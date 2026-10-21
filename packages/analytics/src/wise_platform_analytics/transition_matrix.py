"""The transition matrix of a population: direct successions in the activity sequence, with typed, separate measures.

One registered relation, ``incident.relation.direct_succession_in_activity_sequence.v1``: in an incident whose order is
known, two labelled records that directly follow each other in the declared order once the records without a label are
left out (``incident.activity.omit_missing_retain_raw_gaps.v1``) form one passage of the pair (source, target). Records
without a label passed over are disclosed as a bridge, with their rows. The same pair as the map's paths.

For each pair: the distinct incidents with it, its passages (a repeat adds a passage, never an incident), its outgoing
share (its passages over all passages leaving its source activity: the row's denominator), and the hours of its
passages on the preparation's clock (usable count, mean, median, measured zeros). A zero is a passage between two
records with the same time, a tie the declared order resolved; it is disclosed. An activity no pair leaves has an
empty denominator. Incidents whose order is not known are in no cell and are counted apart.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from collections.abc import Iterable
from statistics import fmean, median

from .selection import PreparedDataLike, SelectionError, case_ids

RELATION_POLICY = "incident.relation.direct_succession_in_activity_sequence.v1"
ACTIVITY_PROJECTION_POLICY = "incident.activity.omit_missing_retain_raw_gaps.v1"


def transition_matrix(prepared: PreparedDataLike, selected_ids: Iterable[str] | None, witness_limit: int) -> dict[str, object]:
    selected = case_ids(prepared, selected_ids)
    evaluable = [case_id for case_id in selected if prepared.sequence_evaluable(case_id)]
    occurrences: Counter[str] = Counter()
    passages: Counter[tuple[str, str]] = Counter()
    cases: dict[tuple[str, str], set[str]] = defaultdict(set)
    hours: dict[tuple[str, str], list[float]] = defaultdict(list)
    bridged: Counter[tuple[str, str]] = Counter()
    bridged_cases: dict[tuple[str, str], set[str]] = defaultdict(set)
    tied: Counter[tuple[str, str]] = Counter()
    witnesses: dict[tuple[str, str], list[dict[str, object]]] = defaultdict(list)
    for case_id in evaluable:
        records = prepared.histories[case_id]
        mapped = [(index, record) for index, record in enumerate(records) if record.activity is not None]
        for _, record in mapped:
            occurrences[record.activity] += 1
        for (left_index, left), (right_index, right) in zip(mapped, mapped[1:]):
            key = (left.activity, right.activity)
            if left.time_value is None or right.time_value is None:
                raise SelectionError("inconsistent_sequence", "An evaluable sequence contains an unavailable time.")
            lag = (right.time_value - left.time_value).total_seconds() / 3600
            passages[key] += 1
            cases[key].add(case_id)
            hours[key].append(lag)
            omitted = [record.row_id for record in records[left_index + 1:right_index]]
            if omitted:
                bridged[key] += 1
                bridged_cases[key].add(case_id)
            if lag == 0:
                tied[key] += 1
            witnesses[key].append({"case_id": case_id, "source_row_id": left.row_id, "target_row_id": right.row_id,
                                   "omitted_row_ids": omitted, "hours": lag, "tied": lag == 0})
    activities = sorted(occurrences, key=lambda activity: (-occurrences[activity], activity))
    outgoing: Counter[str] = Counter()
    for (source, _), count in passages.items():
        outgoing[source] += count
    order = {activity: place for place, activity in enumerate(activities)}
    cells = []
    for key in sorted(passages, key=lambda pair: (order[pair[0]], order[pair[1]])):
        lags = hours[key]
        listed = sorted(witnesses[key], key=lambda witness: (witness["case_id"], witness["source_row_id"]))
        cells.append({"source_activity": key[0], "target_activity": key[1], "case_count": len(cases[key]), "case_ids": sorted(cases[key]),
                      "case_share": len(cases[key]) / len(evaluable),
                      "passage_count": passages[key], "outgoing_share": passages[key] / outgoing[key[0]],
                      "lag": {"usable_count": len(lags), "mean_hours": fmean(lags) if lags else None, "median_hours": median(lags) if lags else None,
                              "zero_count": sum(1 for lag in lags if lag == 0)},
                      "bridged_passage_count": bridged[key], "bridged_case_count": len(bridged_cases[key]), "tied_passage_count": tied[key],
                      "witnesses": listed[:witness_limit], "witnesses_truncated": len(listed) > witness_limit})
    time_policy = prepared.policies["time"]["id"]
    wall = time_policy == "incident.time.wall_clock_as_recorded.v1"
    return {
        "representation": "activity",
        "relation": {"policy": RELATION_POLICY, "activity_projection_policy": ACTIVITY_PROJECTION_POLICY,
                     "adjacency": "mapped_sequence_with_disclosed_raw_gaps", "order_policy": prepared.policies["order"]["id"],
                     "case_basis": "sequence_evaluable_cases"},
        "clock": {"unit": "hours", "timestamp_kind": "wall_clock" if wall else "utc_instant",
                  "lag_clock": "recorded_wall_clock_hours" if wall else "elapsed_utc_hours"},
        "case_count": len(selected), "case_denominator": len(evaluable), "unevaluable_case_count": len(selected) - len(evaluable),
        "activities": activities,
        "rows": [{"activity": activity, "outgoing_passage_count": outgoing[activity]} for activity in activities],
        "cells": cells,
    }
