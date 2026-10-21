"""#116 signed layer drivers, criterion summary quantities and timing exemplars from the packed Method.

Expected values are written from the rows below by hand. Every item is after-GR with a goods receipt on
2 January and an invoice on 3 January 2018, and is cleared after the stated number of days (or never). In the
timing family C04 (target 30, width 60) deviates (days − 30) / 60, capped at 1; each of the five checks has
effective weight 1/5 where all five are evaluated, 1/4 where C04 is unavailable.
"""

from copy import deepcopy
import csv
from datetime import date, timedelta
import io
import socket

from fastapi.testclient import TestClient
import pytest

from wise_platform_api.app import create_app
from import_requests import envelope
from test_bpic19_pipeline_http import start_process
from test_bpic19_scoring_http import VALIDATOR, criterion, given, prepare, read

AFTER = "3-way match, invoice after GR"


def item(case, company, days, resource="user_1"):
    events = [("Create Purchase Order Item", date(2018, 1, 1)), ("Record Goods Receipt", date(2018, 1, 2)),
              ("Record Invoice Receipt", date(2018, 1, 3))]
    if days is not None:
        events.append(("Clear Invoice", date(2018, 1, 3) + timedelta(days=days)))
    return [[case, "D" + case, "00010", AFTER, "true", "true", "Standard", company, "Packaging", activity, f"{day.isoformat()}T00:00:00Z", resource, 10]
            for activity, day in events]


def literal(*items) -> bytes:
    output = io.StringIO(newline="")
    writer = csv.writer(output)
    writer.writerow(["case", "case Purchasing Document", "case Item", "case Item Category", "case Goods Receipt",
                     "case GR-Based IV", "case Item Type", "case Company", "case Spend area text", "activity", "time",
                     "event org:resource", "event Cumulative net worth (EUR)"])
    for rows in items:
        writer.writerows(rows)
    return output.getvalue().encode()


# G: 90 and 60 days; H: 30 days and never cleared.
DRIVERS = literal(item("W90", "G", 90), item("W60", "G", 60), item("W30", "H", 30), item("WU", "H", None))
# E: evaluable 100, 40, 20 and 25 days. The all-evaluable median is 32.5, nearest positive W40; a positive-only
# median (70) would tie W40 and W100 and pick W100 by identifier.
EXEMPLAR = literal(item("W100", "E", 100), item("W40", "E", 40), item("W20", "E", 20), item("W25", "E", 25))
TIMING = {"criteria_family": "completion_timing", "group_by": ["company"], "min_cases": 1}


def scored(client, wid, identity, **settings):
    reply = client.post("/api/investigations/bpic19-score", json=given(wid, identity, **{**TIMING, **settings}))
    assert reply.status_code == 200, reply.text
    VALIDATOR.validate(reply.json())
    return reply.json()


def drivers(answer, company):
    row = next(entry for entry in answer["report"]["layer_drivers"] if entry["company"] == company)
    return {layer: row[layer + "__signed_PI"] for layer in ("Completion", "Timing", "Rework", "Effort")}


def test_t14_summary_quantities_are_distinct(tmp_path):
    workspace = tmp_path / "workspace"; workspace.mkdir()
    with TestClient(create_app(static_dir=tmp_path / "unbuilt")) as client:
        wid, identity = prepare(client, workspace, DRIVERS)
        answer = scored(client, wid, identity)
        c04 = next(entry for entry in answer["report"]["criterion_statistics"] if entry["criterion_id"] == "C04")
        # T14-AC03: deviations 1, .5, 0 and one unavailable.
        assert (c04["total_case_count"], c04["eligible_case_count"], c04["positive_case_count"], c04["unavailable_case_count"]) == (4, 3, 2, 1)
        assert (c04["eligible_firing_rate"], c04["eligible_mean_severity"], c04["conditional_positive_severity"],
                c04["total_case_positive_fraction"]) == pytest.approx((2 / 3, .5, .75, .5))
        # The summed mass uses the native effective weights (1/5 for both positive items), not the unweighted mean.
        assert (c04["native_penalty_sum"], c04["unweighted_severity_sum"]) == pytest.approx((.2 * 1 + .2 * .5, 1.5))
        # 14-B03: the never-cleared item's checks carry its own effective weights.
        cases = {case["case_id"]: case for case in answer["report"]["case_page"]["cases"]}
        assert [criterion(cases["WU"], key)["effective_weight"] for key in ("C01", "C02", "C03", "C05")] == pytest.approx([.25] * 4)
        assert criterion(cases["WU"], "C04")["effective_weight"] in (0, None)


def test_t14_signed_drivers_keep_offsets_and_reconcile_the_priority(tmp_path):
    workspace = tmp_path / "workspace"; workspace.mkdir()
    with TestClient(create_app(static_dir=tmp_path / "unbuilt")) as client:
        wid, identity = prepare(client, workspace, DRIVERS)
        answer = scored(client, wid, identity)
        # Global mean penalties: Completion .25/4 (WU's missing clearing), Timing (.2 + .1)/4.
        g, h = drivers(answer, "G"), drivers(answer, "H")
        assert g == pytest.approx({"Completion": 2 * (0 - .0625), "Timing": 2 * (.15 - .075), "Rework": 0, "Effort": 0})
        assert h == pytest.approx({"Completion": 2 * (.125 - .0625), "Timing": 2 * (0 - .075), "Rework": 0, "Effort": 0})
        priority = {group["company"]: group["PI"] for group in answer["report"]["groups"]}
        # 14-B01: offsets sum before clipping: G .025 is its PI; H's −.025 is clipped to 0.
        assert sum(g.values()) == pytest.approx(priority["G"]) and priority["G"] == pytest.approx(.025)
        assert sum(h.values()) == pytest.approx(-.025) and priority["H"] == 0


def test_t14_timing_exemplar_recipe_and_its_absence_without_timing(tmp_path):
    workspace = tmp_path / "workspace"; workspace.mkdir()
    with TestClient(create_app(static_dir=tmp_path / "unbuilt")) as client:
        wid, identity = prepare(client, workspace, EXEMPLAR)
        answer = scored(client, wid, identity)
        [exemplar] = answer["report"]["exemplars"]
        # T14-AC05: positive candidates only, nearest the median of every evaluable item.
        assert (exemplar["case_id"], exemplar["criterion_id"], exemplar["reference_median_days"], exemplar["measurement_days"]) == ("W40", "C04", 32.5, 40)
        assert (exemplar["evaluated_support"], exemplar["positive_support"]) == (4, 2)
        assert exemplar["selection_recipe"] == "positive_nearest_all_evaluable_median_then_case_id_ascending"
        w40 = {case["case_id"]: case for case in answer["report"]["case_page"]["cases"]}["W40"]
        assert exemplar["row_ids"] == criterion(w40, "C04")["row_ids"] and len(exemplar["row_ids"]) == 2
        # 14-B04: without timing checks there is no timing exemplar.
        assert scored(client, wid, identity, criteria_family="completion")["report"]["exemplars"] == []


def test_t14_unfavourable_completion_beside_unknown_effort_and_a_recorded_finding(tmp_path):
    workspace = tmp_path / "workspace"; workspace.mkdir()
    source = literal(item("A", "G", 30), item("M", "G", None, resource="NONE"))
    with TestClient(create_app(static_dir=tmp_path / "unbuilt")) as client:
        wid, identity = prepare(client, workspace, source)
        answer = scored(client, wid, identity, criteria_family="full")
        m = {case["case_id"]: case for case in answer["report"]["case_page"]["cases"]}["M"]
        # T14-AC04: the missing clearing is a known deviation; timing and effort stay unavailable with their reasons.
        assert criterion(m, "C02")["deviation"] == 1
        assert criterion(m, "C04")["deviation"] is None and criterion(m, "C04")["measurement_reason"]
        assert criterion(m, "C09")["deviation"] is None and criterion(m, "C09")["measurement_reason"] == "incomplete_resource_attribution"
        assert m["evaluated_raw_weight"] < m["in_scope_raw_weight"] and m["coverage"] == pytest.approx(m["evaluated_raw_weight"] / m["in_scope_raw_weight"])
        # T14-AC06: a finding keeps observation, proposal, adoption and outcome apart; nothing is filled in for the analyst.
        # The absence of clearing is witnessed by M's whole history: its three records.
        absence = criterion(m, "C02")["measurement_evidence"]["absence_row_ids"]
        assert absence == m["record_row_ids"] and len(absence) == 3
        empty = {"case_ids": [], "row_ids": [], "criterion_ids": []}
        review = {"policy_id": "bpic19.user_entered_interpretation.v1", "mandatory_controls": [], "findings": [{
            "id": "m-clearing", "title": "Recorded missing clearing",
            "observation": {"status": "observed", "note": "No Clear Invoice recorded", "evidence": {"case_ids": ["M"], "row_ids": absence, "criterion_ids": ["C02"]}},
            "proposed_change": {"status": "not_proposed", "note": "", "evidence": empty},
            "adoption": {"status": "unknown", "note": "", "evidence": empty},
            "tested_outcome": {"status": "untested", "note": "", "evidence": empty}}]}
        reply = client.post("/api/investigations/bpic19-review", json=envelope("bpic19_review_request", workspace_id=wid,
            run_id=answer["run_id"], review=review, case_offset=0, case_limit=100))
        assert reply.status_code == 200, reply.text
        assert reply.json()["report"]["analysis_review"] == review
        assert reply.json()["report"]["layer_drivers"] == answer["report"]["layer_drivers"]


def test_t14_drivers_exemplars_and_rows_survive_a_different_process(tmp_path):
    with socket.socket() as reserving:
        reserving.bind(("127.0.0.1", 0))
        port = reserving.getsockname()[1]
    workspace = tmp_path / "workspace"; workspace.mkdir()
    first, client = start_process(port)
    try:
        wid, identity = prepare(client, workspace, literal(item("W90", "G", 90), item("W60", "G", 60), item("W30", "H", 30), item("WU", "H", None)))
        answer = scored(client, wid, identity)
    finally:
        first.terminate()
        first.wait(timeout=15)
    assert first.returncode is not None
    second, fresh = start_process(port)
    try:
        assert second.pid != first.pid
        assert fresh.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(workspace))).status_code == 200
        snapshot = fresh.post("/api/investigations/bpic19-read", json=read(wid, answer["run_id"]))
        assert snapshot.status_code == 200, snapshot.text
        report = snapshot.json()["report"]
        # 14-B05: unrounded driver terms, exemplars and their raw rows are read back exactly.
        assert report["layer_drivers"] == answer["report"]["layer_drivers"]
        assert report["exemplars"] == answer["report"]["exemplars"]
        assert sum(drivers(snapshot.json(), "G").values()) == pytest.approx(.025, abs=1e-8)
    finally:
        second.terminate()
        second.wait(timeout=15)
