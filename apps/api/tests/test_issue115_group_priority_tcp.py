"""#115 business-group priority from the packed Method's scored items.

Expected values are written from the rows below by hand. Every item is after-GR with a goods receipt on
2 January and an invoice on 3 January 2018; the timing family's C04 (target 30, width 60 days) then gives a
clearing after 60 days score .9, after 45 days .95 and after 30 days 1. U is Consignment, so no check is in
its scope and it is unscored. PI is the scored count times the group's shortfall from the mean score of all
scored items (gamma 0), never negative.
"""

import csv
import io
import socket

from fastapi.testclient import TestClient
import pytest

from wise_platform_api.app import create_app
from import_requests import envelope
from test_bpic19_pipeline_http import start_process
from test_bpic19_scoring_http import VALIDATOR, given, prepare, read

AFTER = "3-way match, invoice after GR"
CLEARING = {.9: "2018-03-04", .95: "2018-02-17", 1: "2018-02-02"}


def item(case, company, score, category=AFTER, companies=None):
    events = [("Create Purchase Order Item", "2018-01-01"), ("Record Goods Receipt", "2018-01-02"),
              ("Record Invoice Receipt", "2018-01-03"), ("Clear Invoice", CLEARING[score])]
    companies = companies or [company] * len(events)
    return [[case, "D" + case, "00010", category, "true", "true", "Standard", value, "Packaging", activity, f"{date}T00:00:00Z", "user_1", 10]
            for (activity, date), value in zip(events, companies)]


def literal(*items) -> bytes:
    output = io.StringIO(newline="")
    writer = csv.writer(output)
    writer.writerow(["case", "case Purchasing Document", "case Item", "case Item Category", "case Goods Receipt",
                     "case GR-Based IV", "case Item Type", "case Company", "case Spend area text", "activity", "time",
                     "event org:resource", "event Cumulative net worth (EUR)"])
    for rows in items:
        writer.writerows(rows)
    return output.getvalue().encode()


AC02 = literal(item("A", "G", .9), item("B", "G", .95), item("C", "H", 1), item("U", "G", 1, "Consignment"))
RANKING = literal(item("A", "G", .9), item("B", "G", .95), item("C", "H", 1), item("M", "", 1),
                  item("P1", "P1", .9), item("P2", "P2", .9), item("U", "G", 1, "Consignment"))
PRIORITY = {"criteria_family": "completion_timing", "group_by": ["company"]}


def scored(client, wid, identity, **settings):
    reply = client.post("/api/investigations/bpic19-score", json=given(wid, identity, **{**PRIORITY, **settings}))
    assert reply.status_code == 200, reply.text
    VALIDATOR.validate(reply.json())
    return reply.json()


def groups(answer):
    return [(group["company"], group["n_cases"], group["mean_score"], group["PI"]) for group in answer["report"]["groups"]]


def test_t13_reference_uses_every_scored_item_while_minimum_support_hides_a_group(tmp_path):
    workspace = tmp_path / "workspace"; workspace.mkdir()
    with TestClient(create_app(static_dir=tmp_path / "unbuilt")) as client:
        wid, identity = prepare(client, workspace, AC02)
        answer = scored(client, wid, identity, min_cases=2)
        report = answer["report"]
        scores = {case["case_id"]: case["score"] for case in report["case_page"]["cases"]}
        assert (scores["A"], scores["B"], scores["C"], scores["U"]) == (pytest.approx(.9), pytest.approx(.95), pytest.approx(1), None)
        # T13-AC02: H is below minimum support, yet C still counts in the reference (.9 + .95 + 1) / 3.
        assert report["mean_score"] == pytest.approx(.95)
        assert groups(answer) == [("G", 2, pytest.approx(.925), pytest.approx(.05))]
        assert report["groups"][0]["global_mean"] == pytest.approx(.95)
        # T13-AC03: U is unscored, outside the means and counts, and reported separately.
        assert (report["scored_case_count"], report["unscored_case_count"], report["population_case_count"]) == (3, 1, 4)
        # 13-B04: the ranked row's members are the exact complete scored items of this run.
        members = client.post("/api/investigations/bpic19-read", json=read(wid, answer["run_id"], case_filter={"group_values": {"company": "G"}}))
        assert members.status_code == 200, members.text
        # The group's members are its complete items: the scored A and B, which make its count and mean, and the
        # unscored U, which keeps its membership with no score.
        listed = {case["case_id"]: case["score"] for case in members.json()["report"]["case_page"]["cases"]}
        assert listed == {"A": pytest.approx(.9), "B": pytest.approx(.95), "U": None}
        assert members.json()["run_id"] == answer["run_id"]


def test_t13_missing_group_ties_and_zero_priority(tmp_path):
    workspace = tmp_path / "workspace"; workspace.mkdir()
    with TestClient(create_app(static_dir=tmp_path / "unbuilt")) as client:
        wid, identity = prepare(client, workspace, RANKING)
        answer = scored(client, wid, identity, min_cases=1)
        reference = (.9 + .95 + 1 + 1 + .9 + .9) / 6
        assert answer["report"]["mean_score"] == pytest.approx(reference)
        ranked = groups(answer)
        # T13-AC05: P1 and P2 tie on PI and count, so the declared key orders them; G follows.
        assert ranked[:3] == [("P1", 1, pytest.approx(.9), pytest.approx(reference - .9)),
                              ("P2", 1, pytest.approx(.9), pytest.approx(reference - .9)),
                              ("G", 2, pytest.approx(.925), pytest.approx(2 * (reference - .925)))]
        # Groups at or above the reference have PI 0, not a negative priority; the missing company is its own group.
        zero = {company: (count, pi) for company, count, _, pi in ranked[3:]}
        assert zero == {"H": (1, 0), None: (1, 0)}
        assert [company for company, *_ in ranked[3:]] in (["H", None], [None, "H"])


def test_t13_conflicting_company_is_refused_and_another_grouping_is_reviewable(tmp_path):
    workspace = tmp_path / "workspace"; workspace.mkdir()
    conflict = literal(item("A", "G", .9), item("X", "K", 1, companies=["K", "K", "L", "L"]))
    with TestClient(create_app(static_dir=tmp_path / "unbuilt")) as client:
        wid, identity = prepare(client, workspace, conflict)
        refused = client.post("/api/investigations/bpic19-score", json=given(wid, identity, **PRIORITY, min_cases=1))
        assert (refused.status_code, refused.json()["code"], refused.json()["field"]) == (400, "context_conflict", "settings.group_by"), refused.text
        assert "report" not in refused.json()
        alternative = scored(client, wid, identity, group_by=["spend_area"], min_cases=1)
        assert [(group["spend_area"], group["n_cases"]) for group in alternative["report"]["groups"]] == [("Packaging", 2)]


def test_t13_saved_ranking_reopens_unevaluated_in_a_different_process(tmp_path):
    with socket.socket() as reserving:
        reserving.bind(("127.0.0.1", 0))
        port = reserving.getsockname()[1]
    workspace = tmp_path / "workspace"; workspace.mkdir()
    first, client = start_process(port)
    try:
        wid, identity = prepare(client, workspace, AC02)
        answer = scored(client, wid, identity, min_cases=2)
        selected = client.post("/api/investigations/select-cases", json=envelope("select_cases_request", workspace_id=wid,
            identity=identity, parent_case_ids=None, predicates=[])).json()
        action = {"operation": "bpic19_score", "identity": identity, "definition_id": answer["definition_id"],
                  "query": {"run_id": answer["run_id"], "case_offset": 0, "case_limit": 50, "group_offset": 0, "group_limit": 50}}
        saved = client.post("/api/investigations/save", json=envelope("save_investigation_request", workspace_id=wid,
            investigation_id=None, expected_revision_id=None, name="T13 group priority", base_identity=identity,
            selection_identity=selected["identity"], selection_recipe={"parent_case_ids": selected["parent"]["case_ids"], "predicates": []},
            context_policy="incident.context.first_record_in_declared_order.v1", comparison=None, notes="Synthetic T13 rows",
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
        assert groups(snapshot) == [("G", 2, pytest.approx(.925, abs=1e-8), pytest.approx(.05, abs=1e-8))]
    finally:
        second.terminate()
        second.wait(timeout=15)
