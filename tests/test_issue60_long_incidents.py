"""#60: keeping long incidents by recorded span or longest gap, against hand-written spans and gaps.

Equality is inclusive (exactly four hours is kept, here and in the exact four-hour fixture); an incident whose order is
not known stays unevaluable also when the step is negated; in a conjunction a false step removes an incident whose other
step is unknown; and the step keeps exactly the incidents whose span the incident list shows at or above the threshold.
"""

import json

from test_import_acceptance import envelope
from test_issue10_interval_tail import ROOT, THRESHOLD, client, intervals, read, select  # noqa: F401  (client and intervals are fixtures)

LONG = json.loads((ROOT / "tests/fixtures/intervals/long-incidents.json").read_text(encoding="utf-8"))


def span(hours, negate=False):
    return {"kind": "observed_span_at_least", "hours": hours, "negate": negate}


def partition(answer):
    return answer["kept"]["case_ids"], answer["removed"]["case_ids"], answer["unevaluable"]["case_ids"]


def test_span_and_gap_thresholds_are_inclusive_and_unknown_stays_unevaluable(client, intervals):  # noqa: F811
    workspace, base = intervals
    expected = LONG["span_at_least_4"]
    assert partition(select(client, workspace, base, [span(4)])) == (expected["kept"], expected["removed"], expected["unevaluable"])
    below = select(client, workspace, base, [span(4, True)])
    assert (below["kept"]["case_ids"], below["unevaluable"]["case_ids"]) == (LONG["span_below_4"]["kept"], LONG["span_below_4"]["unevaluable"])
    gap = select(client, workspace, base, [{"kind": "max_raw_gap_at_least", "hours": 5, "negate": False}])
    assert (gap["kept"]["case_ids"], gap["unevaluable"]["case_ids"]) == (LONG["gap_at_least_5"]["kept"], LONG["gap_at_least_5"]["unevaluable"])


def test_a_false_step_dominates_an_unknown_one(client, intervals):  # noqa: F811
    workspace, base = intervals
    both = select(client, workspace, base, [span(4), {"kind": "contains_activity", "activity": "Assigned", "negate": False}])
    assert (both["kept"]["case_ids"], both["unevaluable"]["case_ids"]) == (LONG["span_4_and_assigned"]["kept"], LONG["span_4_and_assigned"]["unevaluable"])
    assert "I-UNK" in both["removed"]["case_ids"]


def test_the_step_keeps_the_incidents_the_list_shows_at_or_above_the_threshold(client, intervals):  # noqa: F811
    workspace, base = intervals
    listed = client.post("/api/investigations/case-list", json=envelope("case_list_request", "list-1", 3, workspace_id=workspace["workspace_id"],
                         identity=base["identity"], query={"search_text": None, "sort": {"field": "observed_span_hours", "direction": "descending"},
                                                           "offset": 0, "limit": 100})).json()
    spans = {row["case_id"]: row["time_summary"].get("observed_span_hours") for row in listed["rows"]}
    assert {case: hours for case, hours in spans.items() if hours is not None} == LONG["spans"]
    assert [case for case, hours in spans.items() if hours is None] == LONG["unknown"]
    kept = select(client, workspace, base, [span(4)])["kept"]["case_ids"]
    assert kept == sorted(case for case, hours in spans.items() if hours is not None and hours >= 4)


def test_exactly_four_hours_is_kept_in_the_exact_four_hour_fixture(client, tmp_path):  # noqa: F811
    raw = (ROOT / "tests/fixtures/incidents" / THRESHOLD["fixture"]).read_bytes()
    workspace, base = read(client, tmp_path, raw, THRESHOLD["fixture"], {"case_column": 0, "activity_column": 3, "timestamp_column": 4,
                           "sequence_column": 2, "context_columns": []}, "2026-10-02T00:00:00Z")
    kept = select(client, workspace, base, [span(THRESHOLD["inclusive"]["hours"])])["kept"]["case_ids"]
    assert kept == THRESHOLD["inclusive"]["true_ids"]
