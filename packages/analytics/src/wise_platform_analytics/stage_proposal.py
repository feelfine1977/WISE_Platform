"""The values a context column holds on the records of each labelled activity, from which the analyst may propose stages.

One counting rule, ``incident.stage.proposal.every_record_value_counts.v1``: every raw record of the kept incidents that
has an activity label counts once for its activity, under the value of the column exactly as recorded; an empty cell is
missing. Every record counts, not only the first of an incident: an activity whose records hold several values shows all
of them. Records without an activity label belong to no activity and are counted apart.

Nothing here assigns a stage. The leading value of an activity is the one most of its records hold, when one value holds
more records than any other; on a tie, or with no value, there is none. It is offered for review only.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Iterable

POLICY = "incident.stage.proposal.every_record_value_counts.v1"


def value_counts(prepared, kept_ids: Iterable[str], column: int, value_limit: int) -> dict[str, object]:
    """For each labelled activity of the kept incidents, its records, incidents and the column's values on all its records."""
    kept = tuple(kept_ids)
    records: Counter[str] = Counter()
    missing: Counter[str] = Counter()
    incidents: dict[str, set[str]] = {}
    values: dict[str, Counter[str]] = {}
    unlabelled = 0
    total = 0
    for case_id in kept:
        for record in prepared.histories[case_id]:
            total += 1
            if record.activity is None:
                unlabelled += 1
                continue
            activity = record.activity
            records[activity] += 1
            incidents.setdefault(activity, set()).add(case_id)
            cell = record.context_value(column)
            if cell is None:
                missing[activity] += 1
            else:
                values.setdefault(activity, Counter())[cell] += 1
    activities = []
    # The activities with the most records first; on equal records by name.
    for activity in sorted(records, key=lambda name: (-records[name], name)):
        held = values.get(activity, Counter())
        ranked = sorted(held.items(), key=lambda item: (-item[1], item[0]))
        shown = ranked[:value_limit]
        leading = None
        if ranked and (len(ranked) == 1 or ranked[0][1] > ranked[1][1]):
            leading = {"value": ranked[0][0], "record_count": ranked[0][1]}
        activities.append({
            "activity": activity,
            "record_count": records[activity],
            "incident_count": len(incidents[activity]),
            "missing_record_count": missing[activity],
            "value_count": len(ranked),
            "values": [{"value": value, "record_count": count} for value, count in shown],
            "values_truncated": len(ranked) > len(shown),
            "other_record_count": sum(count for _, count in ranked[len(shown):]),
            "mixed": len(ranked) > 1,
            "leading": leading,
        })
    return {
        "policy": POLICY,
        "column_index": column,
        "kept": {"case_count": len(kept), "record_count": total, "labelled_record_count": total - unlabelled, "unlabelled_record_count": unlabelled},
        "activities": activities,
    }
