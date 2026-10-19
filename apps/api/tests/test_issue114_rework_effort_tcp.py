"""#114 the eight-check rework and effort norm (C01–C03, C06 cancellation, C07 changes, C08 repeated invoice
receipt, C09 user events, C10 distinct users) with the packed Method.

Expected values are written from the rows below by hand. Every item is after-GR with one goods receipt, one
invoice and one clearing unless stated; "Vendor creates invoice" pads event counts because no selector here
may include it. C07 grades changes 0/1/3 as 0, 1/3, 1; C08 grades invoice receipts 1/2/4 as 0, 1/3, 1; C09
grades user events with threshold 5 and width 10; C10 grades distinct users with threshold 2 and width 5.
"""

import csv
import io
import socket

from fastapi.testclient import TestClient
import pytest

from wise_platform_api.app import create_app
from import_requests import envelope
from test_bpic19_pipeline_http import start_process
from test_bpic19_scoring_http import VALIDATOR, criterion, given, prepare, read

AFTER = "3-way match, invoice after GR"
GR, IR, CI, PAD = "Record Goods Receipt", "Record Invoice Receipt", "Clear Invoice", "Vendor creates invoice"
CANCEL, PRICE, QUANTITY = "Cancel Invoice Receipt", "Change Price", "Change Quantity"


def users(count, distinct=1):
    return [f"user_{index % distinct + 1}" for index in range(count)]


def item(activities, actors=None):
    actors = actors or ["user_1"] * len(activities)
    return list(zip(activities, actors))


ITEMS = {
    "X0": item([GR, IR, CI]), "X1": item([GR, IR, CANCEL, CI]), "X2": item([GR, IR, CANCEL, CANCEL, CI]),
    "Y0": item([GR, IR, CI]), "Y1": item([GR, IR, PRICE, CI]), "Y3": item([GR, IR, PRICE, PRICE, QUANTITY, CI]),
    "Z1": item([GR, IR, CI]), "Z2": item([GR, IR, IR, CI]), "Z4": item([GR, IR, IR, IR, IR, CI]),
    "U5": item([GR, IR, CI, PAD, PAD]), "U10": item([GR, IR, CI] + [PAD] * 7), "U15": item([GR, IR, CI] + [PAD] * 12),
    "D2": item([GR, IR, CI, PAD], users(4, 2)), "D3": item([GR, IR, CI, PAD], users(4, 3)), "D7": item([GR, IR, CI] + [PAD] * 4, users(7, 7)),
    "BB": item([GR, IR, CI, PAD], ["batch_1", " BATCH_2 ", "batch_1", "batch_3"]),
    "F": item([GR, IR, CANCEL] + [PAD] * 12, users(15, 7)),
    "K": item([GR, IR, CANCEL, "", CI]), "N": item([GR, IR, "", CI]),
}


def literal() -> bytes:
    output = io.StringIO(newline="")
    writer = csv.writer(output)
    writer.writerow(["case", "case Purchasing Document", "case Item", "case Item Category", "case Goods Receipt",
                     "case GR-Based IV", "case Item Type", "case Company", "case Spend area text", "activity", "time",
                     "event org:resource", "event Cumulative net worth (EUR)"])
    for case, events in ITEMS.items():
        for index, (activity, actor) in enumerate(events):
            writer.writerow([case, "D" + case, "00010", AFTER, "true", "true", "Standard", "0000", "Packaging", activity,
                             f"2018-01-{index + 1:02d}T00:00:00Z", actor, 10])
    return output.getvalue().encode()


FAMILY = {"criteria_family": "completion_rework_effort"}


def scored(client, wid, identity, **settings):
    reply = client.post("/api/investigations/bpic19-score", json=given(wid, identity, **{**FAMILY, **settings}))
    assert reply.status_code == 200, reply.text
    VALIDATOR.validate(reply.json())
    return reply.json(), {case["case_id"]: case for case in reply.json()["report"]["case_page"]["cases"]}


def deviation(cases, case, key):
    return criterion(cases[case], key)["deviation"]


def test_t12_rework_and_effort_grades(tmp_path):
    workspace = tmp_path / "workspace"; workspace.mkdir()
    with TestClient(create_app(static_dir=tmp_path / "unbuilt")) as client:
        wid, identity = prepare(client, workspace, literal())
        answer, cases = scored(client, wid, identity)
        assert answer["report"]["admitted_criterion_count"] == 8
        # T12-AC02.
        assert [deviation(cases, case, "C06") for case in ("X0", "X1", "X2")] == [0, 1, 1]
        assert [deviation(cases, case, "C07") for case in ("Y0", "Y1", "Y3")] == pytest.approx([0, 1 / 3, 1])
        assert [deviation(cases, case, "C08") for case in ("Z1", "Z2", "Z4")] == pytest.approx([0, 1 / 3, 1])
        # Vendor-created invoices are not invoice receipts: U15 has one receipt.
        assert deviation(cases, "U15", "C08") == 0
        # T12-AC05: user events 5/10/15 and distinct users 2/3/7.
        assert [deviation(cases, case, "C09") for case in ("U5", "U10", "U15")] == pytest.approx([0, .5, 1])
        assert [deviation(cases, case, "C10") for case in ("D2", "D3", "D7")] == pytest.approx([0, .2, 1])
        # A batch-only item has a known zero of users, so both effort checks are met.
        assert (deviation(cases, "BB", "C09"), deviation(cases, "BB", "C10")) == (0, 0)
        # T12-AC06: clearing absent, cancellation present, 15 user events and 7 users; four deviations of eight.
        f = cases["F"]
        assert [deviation(cases, "F", key) for key in ("C01", "C02", "C03", "C06", "C07", "C08", "C09", "C10")] == [0, 1, 0, 1, 0, 0, 1, 1]
        assert (f["score"], f["coverage"]) == (pytest.approx(.5), 1)
        # T12-AC08: a known cancellation proves presence despite another unknown label, with both witnesses;
        # without a match, an unknown label leaves C06 unavailable.
        k = criterion(cases["K"], "C06")
        assert k["deviation"] == 1 and k["measurement_evidence"]["unknown_row_ids"]
        assert deviation(cases, "N", "C06") is None and deviation(cases, "X0", "C06") == 0
        # C07 and C08 need exact counts, so the unknown label leaves them unavailable for K.
        assert (deviation(cases, "K", "C07"), deviation(cases, "K", "C08")) == (None, None)
        # 12-B05: timing checks are omitted from this profile.
        assert {entry["criterion_id"] for entry in answer["report"]["omissions"]} >= {"C04", "C05"}


def test_t12_view_weights_definitions_and_refusals(tmp_path):
    workspace = tmp_path / "workspace"; workspace.mkdir()
    with TestClient(create_app(static_dir=tmp_path / "unbuilt")) as client:
        wid, identity = prepare(client, workspace, literal())
        reference, _ = scored(client, wid, identity)
        seen = {reference["definition_id"]}
        for view in ("Completion", "Operations"):
            changed, cases = scored(client, wid, identity, view=view)
            assert changed["definition_id"] not in seen
            seen.add(changed["definition_id"])
        refused = client.post("/api/investigations/bpic19-score", json=given(wid, identity, **{**FAMILY, "view": "Automation"}))
        assert (refused.json()["code"], refused.json()["field"]) == ("unsupported_policy", "settings.view")


def test_t12_saved_run_reopens_unevaluated_in_a_different_process(tmp_path):
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
            investigation_id=None, expected_revision_id=None, name="T12 rework and effort", base_identity=identity,
            selection_identity=selected["identity"], selection_recipe={"parent_case_ids": selected["parent"]["case_ids"], "predicates": []},
            context_policy="incident.context.first_record_in_declared_order.v1", comparison=None, notes="Synthetic T12 rows",
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
        cases = {case["case_id"]: case for case in fresh.post("/api/investigations/bpic19-read", json=read(wid, answer["run_id"])).json()["report"]["case_page"]["cases"]}
        assert cases["F"]["score"] == pytest.approx(.5, abs=1e-8) and deviation(cases, "D3", "C10") == pytest.approx(.2, abs=1e-8)
    finally:
        second.terminate()
        second.wait(timeout=15)
