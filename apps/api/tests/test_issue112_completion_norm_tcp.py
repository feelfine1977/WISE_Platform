"""#112 the three-check Completion norm (C01 invoice, C02 clearing, C03 goods receipt) with the packed Method.

Expected values are written from the rows below by hand, with equal Balanced weights and flat aggregation:
A after-GR with all milestones; B before-GR without Clear Invoice; C two-way (goods receipt is outside its
scope); D Consignment (all three checks outside scope); U without a category (scope unknown); T after-GR
whose goods receipt has an unparseable time (presence needs no time).
"""

from copy import deepcopy
import csv
import io
import socket

from fastapi.testclient import TestClient
import pytest

from wise_platform_api.app import create_app
from import_requests import envelope
from test_bpic19_pipeline_http import start_process
from test_bpic19_scoring_http import ROLES, VALIDATOR, criterion, given, prepare, read

AFTER, BEFORE = "3-way match, invoice after GR", "3-way match, invoice before GR"
ITEMS = {
    "A": (AFTER, [("Create Purchase Order Item", "01-01"), ("Record Goods Receipt", "01-02"), ("Record Invoice Receipt", "01-03"), ("Clear Invoice", "01-04")]),
    "B": (BEFORE, [("Create Purchase Order Item", "01-01"), ("Record Invoice Receipt", "01-02"), ("Record Goods Receipt", "01-03")]),
    "C": ("2-way match", [("Create Purchase Order Item", "01-01"), ("Record Invoice Receipt", "01-02"), ("Clear Invoice", "01-03")]),
    "D": ("Consignment", [("Create Purchase Order Item", "01-01"), ("Record Goods Receipt", "01-02")]),
    "U": ("", [("Create Purchase Order Item", "01-01"), ("Record Invoice Receipt", "01-02"), ("Clear Invoice", "01-03")]),
    "T": (AFTER, [("Create Purchase Order Item", "01-01"), ("Record Goods Receipt", None), ("Record Invoice Receipt", "01-03"), ("Clear Invoice", "01-04")]),
}
COMPLETION = {"criteria_family": "completion"}


def literal() -> bytes:
    output = io.StringIO(newline="")
    writer = csv.writer(output)
    writer.writerow(["case", "case Purchasing Document", "case Item", "case Item Category", "case Goods Receipt",
                     "case GR-Based IV", "case Item Type", "case Company", "case Spend area text", "activity", "time",
                     "event org:resource", "event Cumulative net worth (EUR)"])
    for case, (category, events) in ITEMS.items():
        for activity, date in events:
            writer.writerow([case, "D" + case, "00010", category, "true", "true", "Standard", "0000", "Packaging", activity,
                             "not-a-time" if date is None else f"2018-{date}T00:00:00Z", "user_1", 10])
    return output.getvalue().encode()


def scored(client, wid, identity, **settings):
    reply = client.post("/api/investigations/bpic19-score", json=given(wid, identity, **{**COMPLETION, **settings}))
    assert reply.status_code == 200, reply.text
    VALIDATOR.validate(reply.json())
    return reply.json(), {case["case_id"]: case for case in reply.json()["report"]["case_page"]["cases"]}


def checks(case):
    return [(criterion(case, key)["in_scope"], criterion(case, key)["deviation"]) for key in ("C01", "C02", "C03")]


def test_t10_three_checks_scope_states_presence_without_time_and_coverage(tmp_path):
    workspace = tmp_path / "workspace"; workspace.mkdir()
    with TestClient(create_app(static_dir=tmp_path / "unbuilt")) as client:
        wid, identity = prepare(client, workspace, literal())
        answer, cases = scored(client, wid, identity)
        report = answer["report"]
        assert report["admitted_criterion_count"] == 3
        assert checks(cases["A"]) == [(True, 0), (True, 0), (True, 0)]
        assert (cases["A"]["score"], cases["A"]["coverage"]) == (1, 1)
        # B: the missing Clear Invoice is a deviation of one of three equally weighted checks.
        assert checks(cases["B"]) == [(True, 0), (True, 1), (True, 0)]
        assert cases["B"]["score"] == pytest.approx(2 / 3) and cases["B"]["coverage"] == 1
        # C: goods receipt is outside the two-way scope; the two in-scope checks are evaluated.
        assert checks(cases["C"])[:2] == [(True, 0), (True, 0)] and criterion(cases["C"], "C03")["reason"] == "out_of_scope"
        assert (cases["C"]["score"], cases["C"]["coverage"]) == (1, 1)
        # T10-AC04: Consignment has every check outside scope, so no score and no coverage.
        assert [criterion(cases["D"], key)["reason"] for key in ("C01", "C02", "C03")] == ["out_of_scope"] * 3
        assert (cases["D"]["score"], cases["D"]["coverage"]) == (None, None)
        # Without a category the flow scope is unknown: coverage is unavailable and the unknown scope is counted.
        assert {criterion(cases["U"], key)["reason"] for key in ("C01", "C02", "C03")} == {"scope_unknown"}
        assert cases["U"]["coverage"] is None and cases["U"]["scope_unknown_count"] == 3
        # 10-B03: an unparseable goods-receipt time does not block its known presence.
        assert checks(cases["T"]) == [(True, 0), (True, 0), (True, 0)]
        assert cases["T"]["score"] == 1
        statistics = {entry["criterion_id"]: entry for entry in report["criterion_statistics"]}
        assert [statistics[key]["out_of_scope_case_count"] for key in ("C01", "C02", "C03")] == [1, 1, 2]
        assert [statistics[key]["scope_unknown_case_count"] for key in ("C01", "C02", "C03")] == [1, 1, 1]
        assert [statistics[key]["in_scope_unavailable_case_count"] for key in ("C01", "C02", "C03")] == [0, 0, 0]
        assert report["scored_case_count"] == 4 and report["population_case_count"] == 6
        # 10-B04: Method-supplied effective weights of the three equal raw weights.
        assert [criterion(cases["A"], key)["effective_weight"] for key in ("C01", "C02", "C03")] == pytest.approx([1 / 3] * 3)


def test_t10_meaning_fields_are_new_definitions_and_refusals_name_their_field(tmp_path):
    workspace = tmp_path / "workspace"; workspace.mkdir()
    with TestClient(create_app(static_dir=tmp_path / "unbuilt")) as client:
        wid, identity = prepare(client, workspace, literal())
        reference, _ = scored(client, wid, identity)
        seen = {reference["definition_id"]}
        for name, settings in {"view": {"view": "Completion"}, "mode": {"mode": "layer_balanced"},
                               "family": {"criteria_family": "completion_timing"}, "volume": {"volume": "exposure"}}.items():
            changed, _ = scored(client, wid, identity, **settings)
            assert changed["definition_id"] not in seen, name
            seen.add(changed["definition_id"])
        paged = client.post("/api/investigations/bpic19-score", json={**given(wid, identity, **COMPLETION), "case_offset": 2, "case_limit": 2})
        assert paged.json()["definition_id"] == reference["definition_id"]
        for settings, code, field in (({"view": "Finance"}, "unsupported_policy", "settings.view"),
                                      ({"profile": "historical"}, "unsupported_policy", "settings")):
            refused = client.post("/api/investigations/bpic19-score", json=given(wid, identity, **{**COMPLETION, **settings}))
            assert (refused.json()["code"], refused.json()["field"]) == (code, field), refused.text
            assert "report" not in refused.json()
        bad = given(wid, identity, **COMPLETION)
        bad["roles"] = {**ROLES, "item_category": 99}
        refused = client.post("/api/investigations/bpic19-score", json=bad)
        assert (refused.status_code, refused.json()["code"], refused.json()["field"]) == (400, "invalid_parameter", "roles.item_category"), refused.text


def test_t10_saved_completion_run_reopens_unevaluated_in_a_different_process(tmp_path):
    with socket.socket() as reserving:
        reserving.bind(("127.0.0.1", 0))
        port = reserving.getsockname()[1]
    workspace = tmp_path / "workspace"; workspace.mkdir()
    first, client = start_process(port)
    try:
        wid, identity = prepare(client, workspace, literal())
        answer, _ = scored(client, wid, identity)
        selected = client.post("/api/investigations/select-cases", json=envelope("select_cases_request", workspace_id=wid,
            identity=identity, parent_case_ids=None, predicates=[]))
        action = {"operation": "bpic19_score", "identity": identity, "definition_id": answer["definition_id"],
                  "query": {"run_id": answer["run_id"], "case_offset": 0, "case_limit": 50, "group_offset": 0, "group_limit": 50}}
        request = envelope("save_investigation_request", workspace_id=wid, investigation_id=None, expected_revision_id=None,
            name="T10 completion norm", base_identity=identity, selection_identity=selected.json()["identity"],
            selection_recipe={"parent_case_ids": selected.json()["parent"]["case_ids"], "predicates": []},
            context_policy="incident.context.first_record_in_declared_order.v1", comparison=None, notes="Synthetic T10 rows",
            bookmarks=[], bpic19_pipeline={"schema_version": 1, "actions": [action]})
        saved = client.post("/api/investigations/save", json=request)
        assert saved.status_code == 200, saved.text
        saved = saved.json()
        stale = deepcopy(request)
        stale.update(investigation_id=saved["revision"]["investigation_id"], expected_revision_id="saved-revision.v1:sha256:" + "0" * 64)
        assert client.post("/api/investigations/save", json=stale).status_code == 409
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
        snapshot = fresh.post("/api/investigations/bpic19-read", json=read(wid, answer["run_id"]))
        assert snapshot.status_code == 200, snapshot.text
        assert snapshot.json()["report"] == answer["report"] and snapshot.json()["definition"] == answer["definition"]
        cases = {case["case_id"]: case for case in snapshot.json()["report"]["case_page"]["cases"]}
        assert cases["B"]["score"] == pytest.approx(2 / 3, abs=1e-8) and cases["D"]["score"] is None
    finally:
        second.terminate()
        second.wait(timeout=15)
