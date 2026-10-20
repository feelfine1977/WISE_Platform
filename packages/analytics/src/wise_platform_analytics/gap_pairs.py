"""The recorded gaps between records, by the pair of activities around them, for the kept incidents against the parent.

A gap is the time from one record to the next under one of two relations:

- ``raw_adjacent``: two adjacent raw records in the declared order; a record without an activity label is an endpoint of
  its own ("no activity label"), never passed over;
- ``mapped_path``: two adjacent labelled records, a record without a label passed over, as the map's paths and their lags
  are.

Only an incident whose order is known has gaps; the others are counted apart. A gap is a recorded difference of times,
never a working or waiting time.

Two stated policies:

- ``incident.gap.weighting.each_passage_once.v1``: every passage of a pair counts once, so an incident that passes a pair
  twice counts twice in its median and percentile, and once in its incident support;
- ``incident.gap.quantiles.median_midpoint_p90_nearest_rank.v1``: the median is the middle passage, or the midpoint of the
  two middle ones; the 90th percentile is the passage at the nearest rank, the ceil(0.9 n)-th smallest.

A passage is above the analyst's threshold when it is longer than it.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable
import math
from statistics import median

RELATIONS = ("raw_adjacent", "mapped_path")
WEIGHTING_POLICY = "incident.gap.weighting.each_passage_once.v1"
QUANTILE_POLICY = "incident.gap.quantiles.median_midpoint_p90_nearest_rank.v1"
HOUR = 3600


def p90(values: list[float]) -> float:
    """The 90th percentile by nearest rank: the ceil(0.9 n)-th smallest value."""
    ordered = sorted(values)
    return ordered[math.ceil(0.9 * len(ordered)) - 1]


def passages(prepared, case_id: str, relation: str) -> list[tuple[str | None, str | None, float]] | None:
    """The gaps of one incident as (from activity, to activity, hours), or None where its order is not known."""
    if not prepared.sequence_evaluable(case_id):
        return None
    records = prepared.histories[case_id]
    if relation == "mapped_path":
        records = [record for record in records if record.activity is not None]
    return [(left.activity, right.activity, (right.time_value - left.time_value).total_seconds() / HOUR) for left, right in zip(records, records[1:])]


def _figures(hours: list[float], cases: set[str], evaluable: int, threshold: float, longer: set[str]) -> dict[str, object]:
    return {"incident_count": len(cases), "incident_share": len(cases) / evaluable if evaluable else None, "passage_count": len(hours),
            "median_hours": median(hours) if hours else None, "p90_hours": p90(hours) if hours else None,
            "above_threshold_passage_count": sum(value > threshold for value in hours), "above_threshold_incident_count": len(longer)}


def gap_pairs(prepared, kept_ids: Iterable[str], parent_ids: Iterable[str], relation: str, threshold_hours: float, limit: int,
              chosen: tuple[str | None, str | None] | None = None, case_limit: int = 200) -> dict[str, object]:
    """Every pair with its gaps among the kept incidents and in the parent, the longest 90th percentile first."""
    kept, parent = tuple(kept_ids), tuple(parent_ids)
    kept_set = set(kept)
    gaps: dict[str, dict[tuple, list[float]]] = {"kept": defaultdict(list), "parent": defaultdict(list)}
    cases: dict[str, dict[tuple, set[str]]] = {"kept": defaultdict(set), "parent": defaultdict(set)}
    longer: dict[str, dict[tuple, set[str]]] = {"kept": defaultdict(set), "parent": defaultdict(set)}
    evaluable = {"kept": 0, "parent": 0}
    longest: dict[str, float] = {}
    for case_id in parent:
        found = passages(prepared, case_id, relation)
        sides = ("parent", "kept") if case_id in kept_set else ("parent",)
        if found is None:
            continue
        for side in sides:
            evaluable[side] += 1
        for source, target, hours in found:
            pair = (source, target)
            for side in sides:
                gaps[side][pair].append(hours)
                cases[side][pair].add(case_id)
                if hours > threshold_hours:
                    longer[side][pair].add(case_id)
            if chosen is not None and pair == chosen and case_id in kept_set:
                longest[case_id] = max(hours, longest.get(case_id, hours))
    pairs = []
    for pair in gaps["parent"]:
        figures = {side: _figures(gaps[side].get(pair, []), cases[side].get(pair, set()), evaluable[side], threshold_hours, longer[side].get(pair, set()))
                   for side in ("kept", "parent")}
        pairs.append({"from_activity": pair[0], "to_activity": pair[1], **figures})
    # The longest 90th percentile among the kept incidents first; pairs no kept incident passes last.
    pairs.sort(key=lambda item: (item["kept"]["p90_hours"] is None, -(item["kept"]["p90_hours"] or 0), -item["kept"]["passage_count"],
                                 item["from_activity"] is None, item["from_activity"] or "", item["to_activity"] is None, item["to_activity"] or ""))
    answer: dict[str, object] = {
        "relation": relation, "weighting_policy": WEIGHTING_POLICY, "quantile_policy": QUANTILE_POLICY, "threshold_hours": threshold_hours,
        "kept": {"case_count": len(kept), "evaluable_case_count": evaluable["kept"], "order_unknown_case_count": len(kept) - evaluable["kept"]},
        "parent": {"case_count": len(parent), "evaluable_case_count": evaluable["parent"], "order_unknown_case_count": len(parent) - evaluable["parent"]},
        "pair_count": len(pairs), "pairs": pairs[:limit], "pairs_truncated": len(pairs) > limit, "chosen": None,
    }
    if chosen is not None:
        ordered = sorted(longest, key=lambda case_id: (-longest[case_id], case_id))
        answer["chosen"] = {"from_activity": chosen[0], "to_activity": chosen[1], "case_count": len(ordered),
                            "cases": [{"case_id": case_id, "longest_hours": longest[case_id]} for case_id in ordered[:case_limit]],
                            "cases_truncated": len(ordered) > case_limit}
    return answer
