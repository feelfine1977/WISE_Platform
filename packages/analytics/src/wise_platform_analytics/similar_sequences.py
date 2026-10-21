"""Incidents whose recorded sequence is close to a chosen one, as suggestions to review, never as membership.

One method, ``incident.sequence.similar.edit_distance.v1``, fixed before anything is filtered: an incident's sequence is
its labelled activities in the declared order (records without an activity label left out, repeats kept); the distance
between two sequences is the least number of activities to insert, remove or replace to turn one into the other. The
method is applied to every incident of the frozen parent, whatever the kept incidents are, so the suggestion of a
distance does not change when a step is taken; only the counts among the kept incidents follow the selection.

An incident whose order is not known, or that has no labelled activity, is not eligible and is counted apart. Each
suggestion is a family of incidents with exactly the same sequence, with its distance to the chosen sequence; the
chosen sequence's own family is at distance zero. Nothing is a class, a cause or a prediction.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence

POLICY = "incident.sequence.similar.edit_distance.v1"


def edit_distance(one: Sequence[str], other: Sequence[str], bound: int) -> int | None:
    """The edit distance of two sequences, or None when it exceeds the bound (banded, so long sequences stay cheap)."""
    if abs(len(one) - len(other)) > bound:
        return None
    previous = list(range(len(other) + 1))
    for row, left in enumerate(one, start=1):
        current = [row] + [0] * len(other)
        lowest = current[0]
        for column, right in enumerate(other, start=1):
            current[column] = min(previous[column] + 1, current[column - 1] + 1, previous[column - 1] + (left != right))
            lowest = min(lowest, current[column])
        if lowest > bound:
            return None
        previous = current
    return previous[-1] if previous[-1] <= bound else None


def similar(prepared, parent_ids: Iterable[str], kept_ids: Iterable[str], anchor: Sequence[str], maximum_edits: int, exemplar_limit: int = 1) -> dict[str, object]:
    """The families of the parent within the edit bound of the anchor sequence, nearest first, with their support."""
    parent, kept = tuple(parent_ids), set(kept_ids)
    families: dict[tuple[str, ...], list[str]] = {}
    unevaluable = []
    for case_id in parent:
        sequence = tuple(record.activity for record in prepared.histories[case_id] if record.activity is not None)
        if not prepared.sequence_evaluable(case_id) or not sequence:
            unevaluable.append(case_id)
            continue
        families.setdefault(sequence, []).append(case_id)
    found = []
    for sequence, members in families.items():
        distance = edit_distance(tuple(anchor), sequence, maximum_edits)
        if distance is None:
            continue
        kept_members = [case_id for case_id in members if case_id in kept]
        found.append({"activities": list(sequence), "distance": distance, "parent_case_count": len(members), "kept_case_ids": kept_members,
                      "exemplars": members[:exemplar_limit]})
    # The nearest first; at equal distance the family with more incidents of the parent first, then by its sequence.
    found.sort(key=lambda item: (item["distance"], -item["parent_case_count"], item["activities"]))
    eligible = len(parent) - len(unevaluable)
    return {
        "policy": POLICY,
        "anchor": list(anchor),
        "maximum_edits": maximum_edits,
        "parent": {"case_count": len(parent), "eligible_case_count": eligible, "unevaluable_case_count": len(unevaluable)},
        "kept_case_count": len(kept),
        "suggested_parent_case_count": sum(item["parent_case_count"] for item in found),
        "suggested_kept_case_count": sum(len(item["kept_case_ids"]) for item in found),
        "family_count": len(found),
        "families": found,
    }
