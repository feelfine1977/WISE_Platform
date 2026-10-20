"""Incidents whose last request, as the analyst defines requests and answers, has no later answer in the history recorded.

One rule, ``incident.request.last_unanswered.v1``, over the records of each kept incident in the declared order:

- a *request* is a record whose activity is one of the request activities and, when a turn is given, whose value in the
  turn column is exactly the turn value; an *answer* is a record whose activity is one of the answer activities;
- with a gap threshold, a record that follows the record before it by more than the threshold starts a new matter, and
  only the latest matter of an incident is read; without one, the whole history is one matter;
- the incident's last request of that matter is *without a later answer* when no answer follows it in the matter.

The outcome is one of ``without_answer``, ``answered``, ``no_request`` (no request in the latest matter) and
``order_unknown`` (the order of the records is not known). Nothing is resolved or unresolved, no rate is formed, and no
activity is read as a closure: the outcome says only what the export recorded.

The hours since the last record run from the incident's last record to the cutoff accepted at import, on the reading's
clock: how long the export holds no further record of the incident, not a waiting time and not an age of a request.
"""

from __future__ import annotations

from collections.abc import Iterable

from .time_formats import iso_local, iso_utc, validate_time_policy

POLICY = "incident.request.last_unanswered.v1"
OUTCOMES = ("without_answer", "answered", "no_request", "order_unknown")
HOUR = 3600


def _latest_matter(records, gap_hours: float | None):
    if gap_hours is None:
        return records
    start = 0
    for index in range(1, len(records)):
        if (records[index].time_value - records[index - 1].time_value).total_seconds() / HOUR > gap_hours:
            start = index
    return records[start:]


def unanswered(prepared, kept_ids: Iterable[str], request_activities: Iterable[str], answer_activities: Iterable[str],
               turn: tuple[int, str] | None, gap_hours: float | None, case_limit: int) -> dict[str, object]:
    """For each kept incident the outcome of the rule, and for those without an answer the last request and the hours since the last record."""
    kept = tuple(kept_ids)
    requests, answers = frozenset(request_activities), frozenset(answer_activities)
    clock = validate_time_policy(prepared.policies["time"])
    written = iso_local if clock.kind == "wall_clock" else iso_utc
    outcomes: dict[str, list[str]] = {outcome: [] for outcome in OUTCOMES}
    found = []
    for case_id in kept:
        if not prepared.sequence_evaluable(case_id):
            outcomes["order_unknown"].append(case_id)
            continue
        history = prepared.histories[case_id]
        matter = _latest_matter(history, gap_hours)
        last = None
        for index, record in enumerate(matter):
            if record.activity in requests and (turn is None or record.context_value(turn[0]) == turn[1]):
                last = index
        if last is None:
            outcomes["no_request"].append(case_id)
            continue
        if any(record.activity in answers for record in matter[last + 1:]):
            outcomes["answered"].append(case_id)
            continue
        outcomes["without_answer"].append(case_id)
        request, final = matter[last], history[-1]
        found.append({
            "case_id": case_id,
            "last_request": {"row_id": request.row_id, "position": history.index(request) + 1, "activity": request.activity, "time": written(request.time_value)},
            "records_after_request": len(matter) - last - 1,
            "matter_record_count": len(matter),
            "record_count": len(history),
            "last_record_time": written(final.time_value),
            "hours_since_last_record": (clock.cutoff - final.time_value).total_seconds() / HOUR,
        })
    # The longest time without a further record first; on equal hours by incident.
    found.sort(key=lambda item: (-item["hours_since_last_record"], item["case_id"]))
    return {
        "policy": POLICY,
        "clock": {"timestamp_kind": clock.kind, "snapshot_cutoff": written(clock.cutoff)},
        "kept_case_count": len(kept),
        "outcomes": {outcome: len(ids) for outcome, ids in outcomes.items()},
        "order_unknown_case_ids": outcomes["order_unknown"][:case_limit],
        "cases": found[:case_limit],
        "cases_truncated": len(found) > case_limit,
    }
