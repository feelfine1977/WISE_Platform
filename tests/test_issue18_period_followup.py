"""#18: two start periods under one definition, their follow-up exposure and endpoint coverage, and a declared restriction.

On groups-and-periods.csv with the cutoff 2026-10-10 12:00 UTC, the early period (1–2 October) and the period
including the latest starts (9–10 October) are measured to the same cutoff with a four-hour minimum follow-up and the
recorded activity Resolved, as tests/fixtures/comparisons/expected.json says: G06, started an hour before the cutoff,
is not fully observed and has no recorded resolution; G07 starts in the period and keeps its resolution recorded after
the period's end. Restricting the parent to the incidents followed for at least four hours removes G06 and nothing else.
"""

import json
from pathlib import Path

from test_comparison_acceptance import client, source_population, workspace  # noqa: F401  (fixtures)
from test_import_acceptance import envelope, evidence

ROOT = Path(__file__).resolve().parents[1]
PERIODS = json.loads((ROOT / "tests/fixtures/comparisons/expected.json").read_text(encoding="utf-8"))["periods"]
POLICY = "incident.context.first_record_in_declared_order.v1"


def definition(early, late):
    def period(name, case):
        return {"name": name, "window": {"timestamp_kind": "utc_instant", "start_inclusive": case["start_inclusive"], "end_exclusive": case["end_exclusive"]}}
    return {"target": period("Early", early), "reference": period("Latest", late), "minimum_followup_hours": 4, "endpoint_activity": "Resolved"}


def compare(client, workspace, base, parent=None):  # noqa: F811
    response = client.post("/api/investigations/compare-periods", json=envelope("compare_periods_request", workspace_id=workspace["workspace_id"], identity=base["identity"],
        parent_case_ids=parent, context_column_index=4, context_policy=POLICY, definition=definition(PERIODS["early"], PERIODS["including_latest"])))
    assert response.status_code == 200, response.text
    return response.json()


def test_both_periods_show_measured_missing_and_inadequate_support(client, workspace):  # noqa: F811
    base = source_population(client, workspace)
    answer = compare(client, workspace, base)
    for side, case in (("target", PERIODS["early"]), ("reference", PERIODS["including_latest"])):
        cohort = answer[side]
        assert cohort["included"]["case_ids"] == case["case_ids"]
        assert cohort["exposure"]["inadequate"]["case_ids"] == case["inadequate_four_hour_followup_case_ids"]
        coverage = cohort["endpoint_coverage"]
        assert (coverage["recorded"]["case_count"], coverage["not_recorded"]["case_count"]) == (case["recorded_resolution_count"], case["no_recorded_resolution_count"])
    # The cross-period incident keeps its resolution recorded after the period's end.
    records = evidence(client, workspace, {"identity": answer["reference"]["identity"], "query_revision": 3}, "G07")["records"]
    assert [record["activity"] for record in records] == ["Opened", "Resolved"]
    assert records[-1]["utc_instant"] >= PERIODS["recent"]["end_exclusive"]


def test_the_follow_up_restriction_is_a_declared_parent_that_removes_only_the_unobserved(client, workspace):  # noqa: F811
    base = source_population(client, workspace)
    answer = compare(client, workspace, base)
    adequate = sorted(answer["target"]["exposure"]["adequate"]["case_ids"] + answer["reference"]["exposure"]["adequate"]["case_ids"])
    restricted = compare(client, workspace, base, parent=adequate)
    assert restricted["parent"]["case_ids"] == adequate
    assert restricted["target"]["included"]["case_ids"] == PERIODS["early"]["case_ids"]
    assert restricted["reference"]["included"]["case_ids"] == [case for case in PERIODS["including_latest"]["case_ids"] if case not in PERIODS["including_latest"]["inadequate_four_hour_followup_case_ids"]]
    assert restricted["reference"]["exposure"]["inadequate"]["case_count"] == 0
