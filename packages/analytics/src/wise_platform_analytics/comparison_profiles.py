"""Opening-context support over a fixed parent and complete incident cohorts."""

from __future__ import annotations

from collections import Counter
from collections.abc import Iterable

from .mapping import ImportRefusal
from .preparation import PreparedData


def population_support(prepared: PreparedData, ids: Iterable[str]) -> dict[str, object]:
    ordered = tuple(sorted(ids))
    return {"case_ids": list(ordered), "case_count": len(ordered),
            "record_count": sum(len(prepared.histories[case]) for case in ordered)}


def _opening_values(prepared: PreparedData, ids: tuple[str, ...], column: int
                    ) -> tuple[dict[str, str | None], tuple[str, ...]] | ImportRefusal:
    values: dict[str, str | None] = {}
    unavailable = []
    for case in ids:
        rows = prepared.histories[case]
        if not rows or not prepared.sequence_evaluable(case):
            unavailable.append(case)
            continue
        matches = [entry.value for entry in rows[0].context if entry.column_index == column]
        if len(matches) != 1 or (matches[0] is not None and not isinstance(matches[0], str)):
            return ImportRefusal("computation_failed", "The confirmed opening context is inconsistent with its mapped column.", "context_column_index")
        values[case] = matches[0]
    return values, tuple(unavailable)


def _category_support(count: int, denominator: int) -> dict[str, object]:
    share = ({"status": "available", "value": count / denominator} if denominator
             else {"status": "unavailable", "reason": "empty_profile_denominator"})
    return {"case_count": count, "denominator": denominator, "share": share}


def opening_context_profile(prepared: PreparedData, parent: tuple[str, ...], target: tuple[str, ...],
                            reference: tuple[str, ...], column: int) -> dict[str, object] | ImportRefusal:
    """A missing anchored value is a category; unknown chronology is separate support."""
    projected = []
    for ids in (parent, target, reference):
        result = _opening_values(prepared, ids, column)
        if isinstance(result, ImportRefusal):
            return result
        projected.append(result)
    (pv, pu), (tv, tu), (rv, ru) = projected
    pc, tc, rc = Counter(pv.values()), Counter(tv.values()), Counter(rv.values())
    categories = []
    for value in sorted(pc, key=lambda value: (value is not None, value or "")):
        if not tv or not rv:
            reason = ("empty_both_profiles" if not tv and not rv else
                      "empty_target_profile" if not tv else "empty_reference_profile")
            difference = {"status": "unavailable", "reason": reason}
            ratio = dict(difference)
        else:
            ts, rs = tc[value] / len(tv), rc[value] / len(rv)
            difference = {"status": "available", "value": 100 * (ts - rs)}
            ratio = ({"status": "available", "value": ts / rs} if rs
                     else {"status": "unavailable", "reason": "zero_reference_share"})
        categories.append({"value": value, "parent": _category_support(pc[value], len(pv)),
                           "target": _category_support(tc[value], len(tv)),
                           "reference": _category_support(rc[value], len(rv)),
                           "difference_percentage_points": difference, "concentration_ratio": ratio})
    if not parent:
        fixed = {"status": "unavailable", "value": None, "reason": "empty_parent"}
    elif pu:
        fixed = {"status": "unavailable", "value": None, "reason": "unevaluable_context"}
    elif len(pc) == 1:
        fixed = {"status": "fixed", "value": next(iter(pc)), "reason": None}
    else:
        fixed = {"status": "varying", "value": None, "reason": None}
    return {"denominator_basis": "context_evaluable_cases",
            "parent_evaluable": population_support(prepared, pv), "parent_unevaluable": population_support(prepared, pu),
            "target_evaluable": population_support(prepared, tv), "target_unevaluable": population_support(prepared, tu),
            "reference_evaluable": population_support(prepared, rv), "reference_unevaluable": population_support(prepared, ru),
            "parent_fixed": fixed, "categories": categories}
