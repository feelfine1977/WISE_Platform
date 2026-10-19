"""#118 count priorities at purchasing-document grain with the packed Method.

Expected values are written from the rows below by hand, with the timing family (score 1 − deviation / 5,
C04 deviation (days − 30) / 60). Document D1 holds A (90 days, .8), B (60 days, .9) and the Consignment sibling
U (unscored); D2 holds C (75 days, .85); D3 holds E (30 days, 1). The all-scored reference is
(.8 + .9 + .85 + 1) / 4 = .8875, so the count PIs are D1 2 × (.8875 − .85) = .075, D2 .0375 and D3 0: shares of
the positive mass 2/3, 1/3 and 0.
"""

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


def item(case, documents, days, category=AFTER, repeat_invoice=False):
    events = [("Create Purchase Order Item", date(2018, 1, 1)), ("Record Goods Receipt", date(2018, 1, 2)),
              ("Record Invoice Receipt", date(2018, 1, 3))]
    if repeat_invoice:
        events.append(events[-1])
    if days is not None:
        events.append(("Clear Invoice", date(2018, 1, 3) + timedelta(days=days)))
    documents = documents if isinstance(documents, list) else [documents] * len(events)
    return [[case, document, "00010", category, "true", "true", "Standard", "0000", "Packaging", activity, f"{day.isoformat()}T00:00:00Z", "user_1", 10]
            for (activity, day), document in zip(events, documents)]


def literal(*items) -> bytes:
    output = io.StringIO(newline="")
    writer = csv.writer(output)
    writer.writerow(["case", "case Purchasing Document", "case Item", "case Item Category", "case Goods Receipt",
                     "case GR-Based IV", "case Item Type", "case Company", "case Spend area text", "activity", "time",
                     "event org:resource", "event Cumulative net worth (EUR)"])
    for rows in items:
        writer.writerows(rows)
    return output.getvalue().encode()


DOCUMENTS = literal(item("A", "D1", 90, repeat_invoice=True), item("B", "D1", 60), item("U", "D1", 30, "Consignment"),
                    item("C", "D2", 75), item("E", "D3", 30))
GRAIN = {"criteria_family": "completion_timing", "group_by": ["document"], "min_cases": 1}


def scored(client, wid, identity, **settings):
    reply = client.post("/api/investigations/bpic19-score", json=given(wid, identity, **{**GRAIN, **settings}))
    assert reply.status_code == 200, reply.text
    VALIDATOR.validate(reply.json())
    return reply.json()


def rollups(answer):
    return {row["document"]: row for row in answer["report"]["documents"]}


def test_t16_document_multiplier_members_and_concentration(tmp_path):
    workspace = tmp_path / "workspace"; workspace.mkdir()
    with TestClient(create_app(static_dir=tmp_path / "unbuilt")) as client:
        wid, identity = prepare(client, workspace, DOCUMENTS)
        answer = scored(client, wid, identity)
        report = answer["report"]
        assert report["mean_score"] == pytest.approx(.8875)
        d1, d2, d3 = (rollups(answer)[name] for name in ("D1", "D2", "D3"))
        # T16-AC02: the multiplier counts D1's two scored items; its three members and the unscored one are separate.
        assert (d1["n_cases"], d1["volume"], d1["member_count"], d1["unscored_member_count"]) == (2, 2, 3, 1)
        assert (d1["mean_score"], d1["PI"]) == (pytest.approx(.85), pytest.approx(.075))
        # T16-AC03: A's repeated invoice record does not add an item; each sibling keeps its own scope.
        cases = {case["case_id"]: case for case in report["case_page"]["cases"]}
        assert cases["U"]["score"] is None and {criterion(cases["U"], key)["reason"] for key in ("C01", "C02", "C03", "C04", "C05")} == {"out_of_scope"}
        assert criterion(cases["A"], "C05")["in_scope"] is True
        # T16-AC05: positive mass .1125 split 2/3 and 1/3; D3 stays listed with no share.
        assert (d2["PI"], d3["PI"]) == (pytest.approx(.0375), 0)
        assert (d1["positive_PI_share"], d2["positive_PI_share"], d3["positive_PI_share"]) == pytest.approx((2 / 3, 1 / 3, 0))
        assert [row["document"] for row in report["documents"]] == ["D1", "D2", "D3"]
        assert report["document_grain"] == "scored PO items within each purchasing document"
        # 16-B05: the document's members are exactly its original items.
        members = client.post("/api/investigations/bpic19-read", json=read(wid, answer["run_id"], case_filter={"group_values": {"document": "D1"}})).json()
        assert {case["case_id"]: case["score"] for case in members["report"]["case_page"]["cases"]} == {"A": pytest.approx(.8), "B": pytest.approx(.9), "U": None}


def test_t16_conflicting_document_field_is_refused(tmp_path):
    workspace = tmp_path / "workspace"; workspace.mkdir()
    conflict = literal(item("A", "D1", 90), item("X", ["D4", "D4", "D5", "D5"], 30))
    with TestClient(create_app(static_dir=tmp_path / "unbuilt")) as client:
        wid, identity = prepare(client, workspace, conflict)
        refused = client.post("/api/investigations/bpic19-score", json=given(wid, identity, **GRAIN))
        assert (refused.status_code, refused.json()["code"], refused.json()["field"]) == (400, "context_conflict", "settings.group_by"), refused.text
        assert "report" not in refused.json()


def test_t16_document_membership_survives_a_different_process(tmp_path):
    with socket.socket() as reserving:
        reserving.bind(("127.0.0.1", 0))
        port = reserving.getsockname()[1]
    workspace = tmp_path / "workspace"; workspace.mkdir()
    first, client = start_process(port)
    try:
        wid, identity = prepare(client, workspace, DOCUMENTS)
        answer = scored(client, wid, identity)
    finally:
        first.terminate()
        first.wait(timeout=15)
    assert first.returncode is not None
    second, fresh = start_process(port)
    try:
        assert second.pid != first.pid
        assert fresh.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(workspace))).status_code == 200
        snapshot = fresh.post("/api/investigations/bpic19-read", json=read(wid, answer["run_id"])).json()
        assert snapshot["report"]["documents"] == answer["report"]["documents"]
        assert rollups(snapshot)["D1"]["positive_PI_share"] == pytest.approx(2 / 3, abs=1e-8)
    finally:
        second.terminate()
        second.wait(timeout=15)
