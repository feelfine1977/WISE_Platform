"""Check synthetic threshold input consistency, not product analytics execution."""
import csv
from datetime import datetime, timezone
import json
import operator
from pathlib import Path

import pytest


FIXTURES = Path(__file__).parent / "fixtures" / "incidents"
EXPECTED = json.loads((FIXTURES / "threshold_expected.json").read_text(encoding="utf-8"))


def fixture_rows():
    with (FIXTURES / "exact-four-hour.csv").open(encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        assert reader.fieldnames == [
            "incident_id", "source_event_id", "source_sequence", "activity",
            "timestamp_utc", "service", "assignment_group",
        ]
        return list(reader)


def independent_intervals(rows):
    """Read this literal fixture using the standard library only."""
    intervals = {}
    for case_id in EXPECTED["case_ids"]:
        history = [row for row in rows if row["incident_id"] == case_id]
        ordered = sorted(
            enumerate(history),
            key=lambda pair: (
                pair[1]["timestamp_utc"], int(pair[1]["source_sequence"]), pair[0],
            ),
        )
        opened = [row for _, row in ordered if row["activity"] == "Opened"]
        resolved = [row for _, row in ordered if row["activity"] == "Resolved"]
        assert len(opened) == 1
        assert len(resolved) in (0, 1)
        if not resolved:
            intervals[case_id] = None
            continue
        start = datetime.fromisoformat(opened[0]["timestamp_utc"].replace("Z", "+00:00"))
        end = datetime.fromisoformat(resolved[0]["timestamp_utc"].replace("Z", "+00:00"))
        assert start.tzinfo == end.tzinfo == timezone.utc
        intervals[case_id] = (end - start).total_seconds() / 3600
    return intervals


def test_threshold_fixture_has_four_cases_and_seven_unique_source_records():
    rows = fixture_rows()
    assert len(rows) == EXPECTED["records"] == 7
    assert sorted({row["incident_id"] for row in rows}) == EXPECTED["case_ids"]
    assert len(EXPECTED["case_ids"]) == EXPECTED["cases"] == 4
    assert len({row["source_event_id"] for row in rows}) == len(rows)
    assert all(row["service"] == "S" and row["assignment_group"] == "Synthetic" for row in rows)
    assert all(row["timestamp_utc"].endswith("Z") for row in rows)


def test_literal_threshold_intervals_include_exact_equality_and_a_missing_endpoint():
    intervals = independent_intervals(fixture_rows())
    assert intervals == EXPECTED["measured_hours"]
    assert intervals == {
        "BOUNDARY3": 3, "BOUNDARY4": 4, "BOUNDARY5": 5, "BOUNDARYMISSING": None,
    }
    assert EXPECTED["unit"] == "elapsed_utc_hours"
    assert EXPECTED["unevaluable_reason"] == "missing_resolution_endpoint"


@pytest.mark.parametrize("name, compare", [("strict", operator.gt), ("inclusive", operator.ge)])
def test_threshold_partitions_match_independently_authored_ids(name, compare):
    intervals = independent_intervals(fixture_rows())
    expected = EXPECTED[name]
    observed = {"true_ids": [], "false_ids": [], "unevaluable_ids": []}
    for case_id, hours in intervals.items():
        bucket = (
            "unevaluable_ids" if hours is None
            else "true_ids" if compare(hours, expected["hours"])
            else "false_ids"
        )
        observed[bucket].append(case_id)
    for key, ids in observed.items():
        assert ids == expected[key]
    partitions = [set(ids) for ids in observed.values()]
    assert set.union(*partitions) == set(EXPECTED["case_ids"])
    assert all(not left & right for index, left in enumerate(partitions) for right in partitions[index + 1:])
