"""Exact supplied passage-total invariants lost by generated boundary models.

The authoritative schema's conditional absence rules and its declared aggregate
meaning survive generation here. This checks an answer; it creates no measures.
"""

from __future__ import annotations

import math
import re
from collections.abc import Mapping


_MICROSECONDS = re.compile(r"(?:0|[1-9][0-9]{0,63})\Z")
_HOUR = 3_600_000_000


def _whole(value: object) -> int:
    if type(value) is not int or value < 0:
        raise ValueError("Passage support must be a nonnegative JSON integer.")
    return value


def _micros(value: object) -> int:
    if not isinstance(value, str) or _MICROSECONDS.fullmatch(value) is None:
        raise ValueError("A total must carry canonical nonnegative integer microseconds.")
    return int(value)


def _number(value: object, expected: float) -> None:
    if type(value) not in (int, float) or not math.isfinite(value) or value != expected:
        raise ValueError("The rendered total or share does not match its supplied exact coordinates.")


def _share(value: object, numerator: int, denominator: int) -> None:
    if denominator == 0:
        if value is not None:
            raise ValueError("A zero lag denominator has no share.")
    else:
        _number(value, numerator / denominator)


def validate_graph_lag_totals(graph: Mapping[str, object]) -> None:
    """Refuse type coercions, missing/extra totals and inconsistent whole-graph shares.

    A future path without usable lag omits both total fields and has a null
    share. Current graph construction emits only paths with usable passages.
    A usable zero remains a measured zero, including in the exact ranking.
    """
    totals = graph["meta"]["path_lag_totals"]
    total = _micros(totals["total_microseconds"])
    _number(totals["total_hours"], total / _HOUR)
    ranked = []
    passages = 0
    seen = set()
    for edge in graph["edges"]:
        if edge["id"] in seen:
            raise ValueError("Each supplied path must occur exactly once.")
        seen.add(edge["id"])
        metrics = edge["metrics"]
        count = _whole(metrics["usableLagCount"])
        cases = _whole(metrics["cases"])
        if count == 0:
            if "totalLagHours" in metrics or "totalLagMicroseconds" in metrics or metrics["shareOfTotalLag"] is not None:
                raise ValueError("A path without usable passages has no total or share.")
            continue
        value = _micros(metrics["totalLagMicroseconds"])
        _number(metrics["totalLagHours"], value / _HOUR)
        _share(metrics["shareOfTotalLag"], value, total)
        passages += count
        ranked.append((value, cases, edge["payload"]["source_activity"], edge["payload"]["target_activity"], edge["id"]))
    if sum(item[0] for item in ranked) != total:
        raise ValueError("The graph total must cover all its usable paths exactly once.")
    if _whole(totals["usable_path_count"]) != len(ranked) or _whole(totals["usable_passage_count"]) != passages:
        raise ValueError("The supplied support does not match the path totals.")
    ranked.sort(key=lambda item: (-item[0], -item[1], item[2], item[3]))
    top = ranked[:5]
    if totals["top_five_path_ids"] != [item[4] for item in top]:
        raise ValueError("The supplied leading paths must match the exact total-lag ranking.")
    top_total = _micros(totals["top_five_total_microseconds"])
    if top_total != sum(item[0] for item in top):
        raise ValueError("The supplied leading total does not match the named paths.")
    _number(totals["top_five_total_hours"], top_total / _HOUR)
    _share(totals["top_five_share"], top_total, total)
