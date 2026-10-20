"""A separately named outcome over a fixed parent: a recorded activity's presence or absence, by opening value.

One registered policy, ``incident.outcome.recorded_activity_presence_at_snapshot.v1``: the outcome O of an incident is
whether its complete history, as exported at the snapshot cutoff, holds a record of the activity; it is counted as its
presence or its absence. Every incident's presence is known, so the known subset K is the whole parent; an activity no
record of the source ever carries cannot name an outcome, and its rates are unavailable rather than zero. An absence is
only what the export holds, not a business verdict that the incident is unresolved.

The rate of O among the parent's incidents first recorded with a value (the comparison's context reducer) is set beside
the parent's rate as their ratio, the outcome-rate lift; it is not the composition ratio of the comparison's profile.
"""

from __future__ import annotations

from collections.abc import Iterable

from .comparison_profiles import _opening_values
from .mapping import ImportRefusal
from .preparation import PreparedData
from .selection import case_ids

OUTCOME_POLICY = "incident.outcome.recorded_activity_presence_at_snapshot.v1"


def outcome_rates(prepared: PreparedData, parent_ids: Iterable[str], column: int, activity: str, counted: str) -> dict[str, object] | ImportRefusal:
    parent = case_ids(prepared, parent_ids)
    if column not in prepared.mapping["context_columns"]:
        return ImportRefusal("unmapped_context_column", "Choose one of the context columns of this preparation.", "context_column_index")
    recorded = any(record.activity == activity for history in prepared.histories.values() for record in history)
    has = {case: any(record.activity == activity for record in prepared.histories[case]) for case in parent}
    hit = {case: (has[case] if counted == "presence" else not has[case]) for case in parent}
    projected = _opening_values(prepared, parent, column)
    if isinstance(projected, ImportRefusal):
        return projected
    values, unevaluable = projected
    known = parent if recorded else ()
    counted_total = sum(1 for case in known if hit[case])
    rate = counted_total / len(known) if known else None
    categories = []
    for value in sorted(set(values.values()), key=lambda value: (value is not None, value or "")):
        members = [case for case in parent if case in values and values[case] == value]
        known_members = members if recorded else []
        with_o = [case for case in known_members if hit[case]]
        category_rate = len(with_o) / len(known_members) if known_members else None
        if not recorded:
            lift = {"status": "unavailable", "reason": "outcome_unavailable"}
        elif category_rate is None:
            lift = {"status": "unavailable", "reason": "empty_category"}
        elif not rate:
            lift = {"status": "unavailable", "reason": "zero_parent_rate"}
        else:
            lift = {"status": "available", "value": category_rate / rate}
        categories.append({"value": value, "case_count": len(members), "known_case_count": len(known_members),
                           "counted_case_ids": sorted(with_o), "other_case_ids": sorted(case for case in known_members if not hit[case]),
                           "rate": category_rate, "lift": lift})
    return {"status": "available" if recorded else "unavailable", "reason": None if recorded else "activity_never_recorded",
            "parent_case_count": len(parent), "known_case_count": len(known), "unknown_case_count": len(parent) - len(known),
            "counted_case_count": counted_total, "rate": rate, "context_unevaluable_case_count": len(unevaluable), "categories": categories}
