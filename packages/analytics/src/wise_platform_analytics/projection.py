"""The activity projection: which records enter the mapped sequence.

Under ``incident.activity.omit_missing_retain_raw_gaps.v1`` a record without
an activity label is left out of the mapped sequence. It stays in the raw
evidence, is flagged there and is counted, so the omission is always
disclosed. A label is missing only when its cell is empty; text such as
``Unknown`` is a label like any other.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping

from .parsing import SourceRecord
from .policies import ACTIVITY_OMIT_MISSING_RETAIN_RAW_GAPS_V1, PolicyChoice

OmissionRule = Callable[[SourceRecord], bool]


def _has_no_activity_label(record: SourceRecord) -> bool:
    return record.activity is None


_OMISSION_RULES: Mapping[str, OmissionRule] = {
    ACTIVITY_OMIT_MISSING_RETAIN_RAW_GAPS_V1: _has_no_activity_label,
}


def omitted_from_mapped_sequence(record: SourceRecord, policy: PolicyChoice) -> bool:
    """Say whether the policy leaves this record out of the mapped sequence."""
    return _OMISSION_RULES[policy.policy_id](record)
