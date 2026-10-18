"""Estimates of the memory prepared data holds, read from samples rather than by walking every record."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
import json
import sys
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .preparation import PreparedData, PreparedRecord, SourceReading

_BLOCKS = 8
_BLOCK_RECORDS = 512
_POINTER = 8
# A history is a tuple per case, held in a dictionary under the case identifier.
_HISTORY_OVERHEAD = 56 + 104


def records_footprint(records: Sequence[PreparedRecord]) -> int:
    """Estimated bytes held by prepared records and the tuple holding them.

    Each sampled record's own objects are measured exactly. Its text and times are counted once per object
    within a block of consecutive records, so a value repeated across a case or drawn from a small vocabulary
    costs little and a value distinct for every record costs in full. Blocks are spread over the whole source."""
    count = len(records)
    if not count:
        return 0
    block = min(_BLOCK_RECORDS, count)
    starts = sorted({(count - block) * index // max(1, _BLOCKS - 1) for index in range(_BLOCKS)})
    sampled = measured = 0
    for start in starts:
        seen: set[int] = set()
        for record in records[start:start + block]:
            sampled += 1
            measured += sys.getsizeof(record) + sys.getsizeof(record.original_cells) + _POINTER
            for value in (record.row_id, record.case_id, record.activity, record.utc_instant, record.local_timestamp,
                          record.time_value, *record.original_cells):
                if value is not None and id(value) not in seen:
                    seen.add(id(value))
                    measured += sys.getsizeof(value)
    return round(measured / sampled * count) + sys.getsizeof(()) + _POINTER * count


def histories_footprint(histories: Mapping[str, Sequence[PreparedRecord]]) -> int:
    """Estimated bytes of the per-case history tuples and their dictionary; the records are counted separately."""
    return sum(_HISTORY_OVERHEAD + _POINTER * len(rows) for rows in histories.values())


def report_footprint(report: Mapping[str, object]) -> int:
    """Estimated bytes of an interpretation report, from the size of its JSON."""
    return 4 * len(json.dumps(report, default=list, ensure_ascii=False))


def prepared_footprint(prepared: PreparedData) -> int:
    """Estimated bytes a prepared source holds while it is kept."""
    return records_footprint(prepared.records) + histories_footprint(prepared.histories) + report_footprint(prepared.report)


def reading_footprint(reading: SourceReading) -> int:
    """Estimated bytes a held parse keeps until its preparation is confirmed."""
    return records_footprint(reading.records) + 4 * len(json.dumps(list(reading.issues), default=list, ensure_ascii=False))
