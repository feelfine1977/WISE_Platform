"""#113 the five-check timing norm (C01–C03 presence, C04 invoice-to-clearing, C05 receipt-before-invoice).

Expected values are written from the rows below by hand: C04 measures earliest Record Invoice Receipt to
earliest Clear Invoice, each chosen independently, then admits only a nonnegative 2017–2019 interval, with
target 30 and width 60 days; C05 applies to after-GR (DF1) items and admits an equal receipt and invoice
time. Balanced weights are equal and aggregation is flat.
"""

import csv
from copy import deepcopy
import io
import socket

from fastapi.testclient import TestClient
import pytest

from wise_platform_api.app import create_app
from import_requests import envelope
from test_bpic19_pipeline_http import start_process
from test_bpic19_scoring_http import VALIDATOR, criterion, given, prepare, read

AFTER, BEFORE = "3-way match, invoice after GR", "3-way match, invoice before GR"
CREATE, GR, IR, CI = "Create Purchase Order Item", "Record Goods Receipt", "Record Invoice Receipt", "Clear Invoice"
ITEMS = {
    "K30": (AFTER, [(CREATE, "2018-01-01"), (GR, "2018-01-02"), (IR, "2018-01-03"), (CI, "2018-02-02")]),
    "K60": (AFTER, [(CREATE, "2018-01-01"), (GR, "2018-01-02"), (IR, "2018-01-03"), (CI, "2018-03-04")]),
    "K90": (AFTER, [(CREATE, "2018-01-01"), (GR, "2018-01-02"), (IR, "2018-01-03"), (CI, "2018-04-03")]),
    "M": (AFTER, [(CREATE, "2018-01-01"), (GR, "2018-01-02"), (IR, "2018-01-03")]),
    "E": (AFTER, [(CREATE, "2018-01-01"), (GR, "2018-01-03"), (IR, "2018-01-03"), (CI, "2018-02-02")]),
    "V": (AFTER, [(CREATE, "2018-01-01"), (GR, "2018-01-04"), (IR, "2018-01-03"), (CI, "2018-02-02")]),
    "B": (BEFORE, [(CREATE, "2018-01-01"), (IR, "2018-01-02"), (GR, "2018-01-03"), (CI, "2018-02-01")]),
    "R": (AFTER, [(CREATE, "2018-01-01"), (GR, "2018-01-02"), (CI, "2018-01-03"), (IR, "2018-01-05")]),
    "G": (AFTER, [(CREATE, "2016-12-01"), (GR, "2016-12-02"), (IR, "2016-12-30"), (IR, "2018-01-05"), (CI, "2018-02-01")]),
}
TIMING = {"criteria_family": "completion_timing"}


def literal() -> bytes:
    output = io.StringIO(newline="")
    writer = csv.writer(output)
    writer.writerow(["case", "case Purchasing Document", "case Item", "case Item Category", "case Goods Receipt",
                     "case GR-Based IV", "case Item Type", "case Company", "case Spend area text", "activity", "time",
                     "event org:resource", "event Cumulative net worth (EUR)"])
    for case, (category, events) in ITEMS.items():
        for activity, date in events:
            writer.writerow([case, "D" + case, "00010", category, "true", "true", "Standard", "0000", "Packaging", activity,
                             f"{date}T00:00:00Z", "user_1", 10])
    return output.getvalue().encode()


def scored(client, wid, identity, **settings):
    reply = client.post("/api/investigations/bpic19-score", json=given(wid, identity, **{**TIMING, **settings}))
    assert reply.status_code == 200, reply.text
    VALIDATOR.validate(reply.json())
    return reply.json(), {case["case_id"]: case for case in reply.json()["report"]["case_page"]["cases"]}


def deviations(case):
    return [criterion(case, key)["deviation"] for key in ("C01", "C02", "C03", "C04", "C05")]


def test_t11_invoice_to_clearing_saturation_receipt_order_and_admission(tmp_path):
    workspace = tmp_path / "workspace"; workspace.mkdir()
    with TestClient(create_app(static_dir=tmp_path / "unbuilt")) as client:
        wid, identity = prepare(client, workspace, literal())
        answer, cases = scored(client, wid, identity)
        assert answer["report"]["admitted_criterion_count"] == 5
        # T11-AC06: 30, 60 and 90 days against target 30 and width 60.
        for case, days, deviation, score in (("K30", 30, 0, 1), ("K60", 60, .5, .9), ("K90", 90, 1, .8)):
            c04 = criterion(cases[case], "C04")
            assert deviations(cases[case]) == pytest.approx([0, 0, 0, deviation, 0]), case
            evidence = c04["measurement_evidence"]
            assert (c04["measurement"], evidence["unit"], evidence["activation_timestamp"][:10]) == (pytest.approx(days), "days", "2018-01-03")
            assert evidence["activation_row_ids"] and evidence["response_row_ids"] and c04["row_ids"] == evidence["activation_row_ids"] + evidence["response_row_ids"]
            assert cases[case]["score"] == pytest.approx(score) and cases[case]["coverage"] == 1
        # T11-AC02: no Clear Invoice, so C02 deviates and C04 is unavailable; four evaluated checks weigh 1/4 each.
        m = cases["M"]
        assert deviations(m)[:3] == [0, 1, 0] and deviations(m)[4] == 0 and criterion(m, "C04")["deviation"] is None
        assert [criterion(m, key)["effective_weight"] for key in ("C01", "C02", "C03", "C05")] == pytest.approx([.25] * 4)
        assert (m["score"], m["coverage"]) == (pytest.approx(.75), pytest.approx(.8))
        # 11-B02: an equal receipt and invoice time satisfies C05; a later receipt violates it; C05 is DF1 only.
        assert criterion(cases["E"], "C05")["deviation"] == 0
        assert criterion(cases["V"], "C05")["deviation"] == 1
        assert criterion(cases["B"], "C05")["reason"] == "out_of_scope" and criterion(cases["B"], "C04")["deviation"] == 0
        # 11-B03: a reversed interval and an earliest invoice before 2017 leave C04 unavailable; the later 2018
        # invoice does not replace G's earlier minimum.
        for case, reason in (("R", "reversed_interval"), ("G", "minimum_outside_admissible_range")):
            c04 = criterion(cases[case], "C04")
            assert (c04["deviation"], c04["in_scope"], c04["measurement_reason"]) == (None, True, reason), case
        assert criterion(cases["R"], "C04")["measurement_evidence"]["recorded_difference_days"] == -2
        assert criterion(cases["G"], "C04")["measurement_evidence"]["activation_timestamp"][:10] == "2016-12-30"
        # 11-B04: C02's known absence is evaluated while C04 is unavailable (M above).


def test_t11_definitions_and_refusals(tmp_path):
    workspace = tmp_path / "workspace"; workspace.mkdir()
    with TestClient(create_app(static_dir=tmp_path / "unbuilt")) as client:
        wid, identity = prepare(client, workspace, literal())
        reference, _ = scored(client, wid, identity)
        seen = {reference["definition_id"]}
        for name, settings in {"family": {"criteria_family": "completion"}, "view": {"view": "Operations"},
                               "mode": {"mode": "layer_balanced"}}.items():
            changed, _ = scored(client, wid, identity, **settings)
            assert changed["definition_id"] not in seen, name
            seen.add(changed["definition_id"])
        refused = client.post("/api/investigations/bpic19-score", json=given(wid, identity, **{**TIMING, "view": "Logistics"}))
        assert (refused.json()["code"], refused.json()["field"]) == ("unsupported_policy", "settings.view")


def test_t11_saved_timing_run_reopens_unevaluated_in_a_different_process(tmp_path):
    with socket.socket() as reserving:
        reserving.bind(("127.0.0.1", 0))
        port = reserving.getsockname()[1]
    workspace = tmp_path / "workspace"; workspace.mkdir()
    first, client = start_process(port)
    try:
        wid, identity = prepare(client, workspace, literal())
        answer, _ = scored(client, wid, identity)
        selected = client.post("/api/investigations/select-cases", json=envelope("select_cases_request", workspace_id=wid,
            identity=identity, parent_case_ids=None, predicates=[])).json()
        action = {"operation": "bpic19_score", "identity": identity, "definition_id": answer["definition_id"],
                  "query": {"run_id": answer["run_id"], "case_offset": 0, "case_limit": 50, "group_offset": 0, "group_limit": 50}}
        saved = client.post("/api/investigations/save", json=envelope("save_investigation_request", workspace_id=wid,
            investigation_id=None, expected_revision_id=None, name="T11 timing norm", base_identity=identity,
            selection_identity=selected["identity"], selection_recipe={"parent_case_ids": selected["parent"]["case_ids"], "predicates": []},
            context_policy="incident.context.first_record_in_declared_order.v1", comparison=None, notes="Synthetic T11 rows",
            bookmarks=[], bpic19_pipeline={"schema_version": 1, "actions": [action]}))
        assert saved.status_code == 200, saved.text
        saved = saved.json()
    finally:
        first.terminate()
        first.wait(timeout=15)
    assert first.returncode is not None
    second, fresh = start_process(port)
    try:
        assert second.pid != first.pid
        assert fresh.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(workspace))).status_code == 200
        reopened = fresh.post("/api/investigations/reopen", json=envelope("reopen_investigation_request",
            workspace_id=wid, saved_revision_id=saved["revision"]["saved_revision_id"]))
        assert reopened.status_code == 200, reopened.text
        assert reopened.json()["bpic19_outputs"] == saved["bpic19_outputs"]
        snapshot = fresh.post("/api/investigations/bpic19-read", json=read(wid, answer["run_id"])).json()
        cases = {case["case_id"]: case for case in snapshot["report"]["case_page"]["cases"]}
        assert criterion(cases["K60"], "C04")["deviation"] == pytest.approx(.5, abs=1e-8)
        assert (cases["M"]["score"], cases["M"]["coverage"]) == (pytest.approx(.75, abs=1e-8), pytest.approx(.8, abs=1e-8))
    finally:
        second.terminate()
        second.wait(timeout=15)
