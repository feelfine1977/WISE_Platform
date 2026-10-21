"""#11: incidents selected by the period of their first record, against a hand-written oracle.

The lower bound is included and the upper bound excluded; the start is the first raw record in declared order, not the
first labelled activity; an incident whose first record is not known stays unevaluable, also when negated; a selected
incident keeps its later records outside the period; the start trend counts the same incidents in the same half-open
periods the parent fixes.
"""

import json
from pathlib import Path

from test_import_acceptance import envelope, evidence
from test_issue10_interval_tail import client, read, select  # noqa: F401  (client is a fixture)

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "tests/fixtures/starts"
EXPECTED = json.loads((FIXTURES / "expected.json").read_text(encoding="utf-8"))


def window(negate=False):
    return {"kind": "case_start_in_window", "window": EXPECTED["window"], "negate": negate}


def test_a_period_keeps_whole_incidents_by_their_first_raw_record(client, tmp_path):  # noqa: F811
    workspace, base = read(client, tmp_path, (FIXTURES / EXPECTED["file"]).read_bytes(), EXPECTED["file"], dict(EXPECTED["mapping"]), EXPECTED["cutoff_utc"])
    selected = select(client, workspace, base, [window()])
    expected = EXPECTED["in_window"]
    assert (selected["kept"]["case_ids"], selected["removed"]["case_ids"], selected["unevaluable"]["case_ids"]) == (expected["kept"], expected["removed"], expected["unevaluable"])
    negated = select(client, workspace, base, [window(True)])
    assert (negated["kept"]["case_ids"], negated["unevaluable"]["case_ids"]) == (EXPECTED["outside_window"]["kept"], EXPECTED["outside_window"]["unevaluable"])
    later = EXPECTED["later_record"]
    records = evidence(client, workspace, selected, later["case"])["records"]
    assert len(records) == later["records"] and later["outside_period_position"] in [record["source_position"] for record in records]


def test_the_start_trend_counts_the_same_incidents_in_half_open_periods(client, tmp_path):  # noqa: F811
    workspace, base = read(client, tmp_path, (FIXTURES / EXPECTED["file"]).read_bytes(), EXPECTED["file"], dict(EXPECTED["mapping"]), EXPECTED["cutoff_utc"])
    request = envelope("start_trend_request", "trend-1", 3, workspace_id=workspace["workspace_id"], identity=base["identity"],
                       definition={"policy_id": "incident.start_trend.first_raw_declared_order_half_open.v1",
                                   "binning": {"kind": "explicit_edges", "timestamp_kind": "utc_instant", "edges": EXPECTED["edges"]}})
    response = client.post("/api/investigations/start-trend", json=request)
    assert response.status_code == 200, response.text
    answer = response.json()
    assert answer["anchor_policy"] == "first_raw_record_in_declared_order_of_sequence_evaluable_case" and answer["grain"] == "distinct_incident_starts"
    assert [item["parent_support"]["case_count"] for item in answer["bins"]] == EXPECTED["bins"]
    assert answer["unevaluable"]["parent_support"]["case_count"] == EXPECTED["unevaluable"]
    assert answer["clock"]["snapshot_cutoff"] == EXPECTED["cutoff_utc"]
