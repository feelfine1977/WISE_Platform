"""#91: every measure column of the incident list is ordered by the local service both ways.

Records, span, longest gap and first recorded time, ascending and descending, over tests/fixtures/span-gap: the orders of
the hand-written expected.json and heads.json, and in every order equal values stand by number and incidents without the
value stand last.
"""

import json

import pytest

from test_issue10_interval_tail import ROOT, client, read  # noqa: F401  (client is a fixture)
from test_issue58_span_gap_list import EXPECTED, RAW, answer_of

HEADS = json.loads((ROOT / "tests/fixtures/span-gap/heads.json").read_text(encoding="utf-8"))
FIELDS = ("record_count", "observed_span_hours", "maximum_adjacent_raw_gap_hours", "first_recorded_time")


@pytest.fixture
def listed(client, tmp_path):  # noqa: F811
    return read(client, tmp_path, RAW, EXPECTED["file"], dict(EXPECTED["mapping"]), EXPECTED["cutoff_utc"])


def value(row, field):
    if field == "record_count":
        return row["record_count"]
    time = row["time_summary"]
    return time["first_recorded_timestamp"] if field == "first_recorded_time" else time[field]


@pytest.mark.parametrize("direction", ["ascending", "descending"])
@pytest.mark.parametrize("field", FIELDS)
def test_each_measure_column_orders_both_ways_with_ties_by_number_and_the_unavailable_last(client, listed, field, direction):  # noqa: F811
    workspace, base = listed
    rows = answer_of(client, workspace, base["identity"], field=field, direction=direction)["rows"]
    order = [row["case_id"] for row in rows]
    oracle = {**EXPECTED["orders"], **{key: ids for key, ids in HEADS.items() if key != "about"}}
    assert order == oracle[f"{field} {direction}"]
    known = [row for row in rows if value(row, field) is not None]
    assert rows[:len(known)] == known, "an incident without the value stands before one with it"
    unknown = [row["case_id"] for row in rows[len(known):]]
    assert unknown == sorted(unknown)
    for left, right in zip(known, known[1:]):
        if value(left, field) == value(right, field):
            assert left["case_id"] < right["case_id"], (left["case_id"], right["case_id"])
        else:
            assert (value(left, field) < value(right, field)) == (direction == "ascending")
