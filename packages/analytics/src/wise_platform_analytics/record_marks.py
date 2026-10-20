"""The records of a page of incidents as marks on one elapsed-time axis, aligned at each incident's first record.

One projection, ``incident.records.elapsed_from_first_record.v1``, for at most a bounded number of incidents at once: every
raw record of each incident, in the declared order. A record with a usable time is placed at its elapsed microseconds
from the incident's earliest usable time; records at the same time are counted together as one mark; a record without a
usable time is not placed and is counted in a lane of its own. Nothing is sampled or dropped.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Iterable

POLICY = "incident.records.elapsed_from_first_record.v1"
MICROSECONDS = 1_000_000


def marks(prepared, case_ids: Iterable[str]) -> dict[str, object]:
    """For each incident its record count, its timed marks with their counts, and its records without a usable time."""
    cases = []
    for case_id in case_ids:
        records = prepared.histories[case_id]
        times = [record.time_value for record in records if record.timestamp_status == "usable" and record.time_value is not None]
        first = min(times) if times else None
        offsets = Counter(round((time - first).total_seconds() * MICROSECONDS) for time in times) if first is not None else Counter()
        cases.append({
            "case_id": case_id,
            "record_count": len(records),
            "order_known": prepared.sequence_evaluable(case_id),
            "span_microseconds": max(offsets) if offsets else None,
            "marks": [{"offset_microseconds": offset, "record_count": count} for offset, count in sorted(offsets.items())],
            "untimed_record_count": len(records) - len(times),
        })
    return {"policy": POLICY, "cases": cases}
