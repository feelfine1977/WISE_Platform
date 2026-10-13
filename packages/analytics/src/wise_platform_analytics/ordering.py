"""The declared order of records.

Records are never ordered by chance: the selected order policy gives a total
order. Under ``incident.order.timestamp_sequence_source_position.v1`` records
are ordered by their timestamp as an exact instant, then by their source
sequence as a number, then by their position in the source. The position is
unique, so no two records ever tie.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable, Mapping
from datetime import datetime

from .parsing import SourceRecord
from .policies import ORDER_TIMESTAMP_SEQUENCE_SOURCE_POSITION_V1, PolicyChoice

OrderKey = Callable[[SourceRecord], tuple[datetime, int, int]]


def _timestamp_sequence_source_position(
    record: SourceRecord,
) -> tuple[datetime, int, int]:
    return (record.timestamp_utc, record.sequence, record.source_position)


_ORDER_KEYS: Mapping[str, OrderKey] = {
    ORDER_TIMESTAMP_SEQUENCE_SOURCE_POSITION_V1: _timestamp_sequence_source_position,
}


def order_records(
    records: Iterable[SourceRecord], policy: PolicyChoice
) -> tuple[SourceRecord, ...]:
    """Return the records in the order the policy declares."""
    return tuple(sorted(records, key=_ORDER_KEYS[policy.policy_id]))
