"""#108 flow-specific completion cohorts over a literal before/after-GR source, at public HTTP.

Expected values are written from the rows below by hand. M and N are before-GR items with the receipt order
reversed; O is before-GR without Clear Invoice; P is after-GR and closed; Q is after-GR with a blank label.
"""

from copy import deepcopy
import json
from pathlib import Path
import socket

from fastapi.testclient import TestClient

from wise_platform_api.app import create_app
from wise_platform_analytics.bpic19_cohorts import default_query
from import_requests import envelope
from test_bpic19_measures_http import prepare_source
from test_bpic19_pipeline_http import start_process
from literal_profile_columns import with_profile_columns

BEFORE, AFTER = "3-way match, invoice before GR", "3-way match, invoice after GR"
LITERAL = with_profile_columns(("case,activity,time,case Item Category,event org:resource,event Cumulative net worth (EUR),case Purchasing Document,case Company,case Spend area text\n"
           + "".join(f'{case},{activity},2018-01-0{day}T00:00:00,"{flow}",user_1,10,D{case},1,Packaging\n' for case, flow, activities in (
               ("M", BEFORE, ["Create Purchase Order Item", "Record Invoice Receipt", "Record Goods Receipt", "Clear Invoice"]),
               ("N", BEFORE, ["Create Purchase Order Item", "Record Goods Receipt", "Record Invoice Receipt", "Clear Invoice"]),
               ("O", BEFORE, ["Create Purchase Order Item", "Record Invoice Receipt"]),
               ("P", AFTER, ["Create Purchase Order Item", "Record Goods Receipt", "Record Invoice Receipt", "Clear Invoice"]),
               ("Q", AFTER, ["Create Purchase Order Item", ""]))
               for day, activity in enumerate(activities, start=1))).encode())
ROUTE = "/api/investigations/bpic19-cohorts"
ROLES = {"item_category": 3, "purchasing_document": 6}
BROWSER_ANSWER = Path(__file__).resolve().parents[3] / "apps/web/src/bpic19/t06-cohorts-answer.json"


def selected(client, wid, base, parent, predicates=()):
    response = client.post("/api/investigations/select-cases", json=envelope("select_cases_request", workspace_id=wid,
        identity=base, parent_case_ids=parent, predicates=list(predicates)))
    assert response.status_code == 200, response.text
    return response.json()


def cohorts(client, wid, identity, **changes):
    query = default_query(ROLES, "wall_clock")
    for key, value in changes.items():
        query[key] = value if not isinstance(value, dict) else {**query[key], **value}
    given = envelope("bpic19_cohorts_request", workspace_id=wid, identity=identity, query=query)
    response = client.post(ROUTE, json=given)
    assert response.status_code == 200, response.text
    return given, response.json()


def members(support):
    return support["case_ids"], support["case_count"], support["record_count"]


def test_t06_ac03_both_receipt_orders_close_before_gr_and_nothing_is_dropped(tmp_path):
    folder = tmp_path / "workspace"; folder.mkdir()
    with TestClient(create_app()) as client:
        wid, base = prepare_source(client, folder, LITERAL)
        _, answer = cohorts(client, wid, base)
        result = answer["cohorts"]
        items = {item["case_id"]: item for item in result["page"]["items"]}
        for case in ("M", "N"):
            assert (items[case]["flow_id"], items[case]["completion_state"]) == ("before_gr", "observed_closed")
            assert not any("Remove Payment Block" in group for group in items[case]["required_activity_sets"])
        assert (items["O"]["completion_state"], items["P"]["completion_state"], items["Q"]["completion_state"]) == ("open_recorded", "observed_closed", "unknown")
        groups = {group["state"]: members(group) for group in result["completion_groups"]}
        assert groups == {"observed_closed": (["M", "N", "P"], 3, 12), "open_recorded": (["O"], 1, 2), "unknown": (["Q"], 1, 2)}
        # T06-AC01 on literal rows: completion is shown, nothing is excluded, so every item and record is retained.
        assert result["original"] == {"case_count": 5, "record_count": 16, "document_count": 5, "document_unknown_case_count": 0}
        assert members(result["retention"]["retained"]) == (["M", "N", "O", "P", "Q"], 5, 16)
        assert members(result["inclusion"]["excluded"])[1:] == (0, 0)
        assert result["selection"]["case_ids"] == ["M", "N", "O", "P", "Q"]
        # The built browser's test renders exactly this public answer (Bpic19Cohorts.acceptance.test.tsx).
        public = {key: value for key, value in answer.items() if key not in ("request_id", "query_revision", "workspace_id")}
        assert public == json.loads(BROWSER_ANSWER.read_text(encoding="utf-8"))


def test_t06_every_meaning_field_is_a_new_definition_and_the_page_is_not(tmp_path):
    folder = tmp_path / "workspace"; folder.mkdir()
    with TestClient(create_app()) as client:
        wid, base = prepare_source(client, folder, LITERAL)
        _, reference = cohorts(client, wid, base)
        variants = {
            "inclusion kind and bounds": {"inclusion": {"kind": "item_start_window", "start_inclusive": "2018-01-01T00:00:00"}},
            "recipe": {"completion": {"recipe": "botti_mandatory_presence"}},
            "receipt": {"completion": {"receipt": "goods_or_service"}},
            "tie policy": {"completion": {"recipe": "kpmg_last_ending", "tie_policy": "source_position"}},
            "retain": {"retain": "observed_closed"},
            "horizon": {"horizon": {"value": "2018-06-01T00:00:00", "provenance": "Literal review of the five items"}},
            "roles": {"roles": {"item_category": 3, "purchasing_document": 7}},
        }
        seen = {reference["definition_id"]}
        for name, change in variants.items():
            _, changed = cohorts(client, wid, base, **change)
            assert changed["definition_id"] not in seen, name
            seen.add(changed["definition_id"])
        _, paged = cohorts(client, wid, base, page={"offset": 2, "limit": 2})
        assert paged["definition_id"] == reference["definition_id"]
        assert [item["case_id"] for item in paged["cohorts"]["page"]["items"]] == ["O", "P"]


def test_t06_refusals_name_their_field_and_change_nothing(tmp_path):
    folder = tmp_path / "workspace"; folder.mkdir()
    with TestClient(create_app()) as client:
        wid, base = prepare_source(client, folder, LITERAL)
        given, answer = cohorts(client, wid, base)
        for change, status, code, field in (
                (lambda g: g.update(schema_version=2), 422, "unsupported_schema", "schema_version"),
                (lambda g: g["query"]["roles"].update(purchasing_document=3), 422, "invalid_parameter", "query.roles"),
                (lambda g: g["query"]["horizon"].update(value="2018-06-01T00:00:00"), 422, "invalid_parameter", "query.horizon.provenance"),
                (lambda g: g["query"]["completion"].update(tie_policy="source_position"), 422, "invalid_parameter", "query.completion.tie_policy")):
            bad = deepcopy(given)
            change(bad)
            refused = client.post(ROUTE, json=bad)
            assert (refused.status_code, refused.json()["code"], refused.json()["field"]) == (status, code, field), refused.text
            assert "cohorts" not in refused.json()
        again = client.post(ROUTE, json=given)
        assert again.status_code == 200 and again.json() == answer


def keep_request(client, wid, base, support="retention_retained"):
    """Keep the observed-closed items of the before-GR flow parent [M, N, O]."""
    parent = selected(client, wid, base, ["M", "N", "O"])
    given, answer = cohorts(client, wid, parent["identity"], retain="observed_closed")
    predicate = {"kind": "case_id_in", "case_ids": ["M", "N"], "negate": False}
    child = selected(client, wid, base, ["M", "N", "O"], [predicate])
    action = {"operation": "bpic19_cohorts", "identity": parent["identity"], "query": given["query"],
              "definition_id": answer["definition_id"], "selection_prefix_length": 0,
              "selection_keep": {"policy_id": "bpic19.completion_cohort_keep.v1", "step_index": 0,
                                 "group": {"kind": "completion_cohort", "support": support}}}
    request = envelope("save_investigation_request", workspace_id=wid, investigation_id=None, expected_revision_id=None,
        name="Observed-closed before-GR items", base_identity=base, selection_identity=child["identity"],
        selection_recipe={"parent_case_ids": ["M", "N", "O"], "predicates": [predicate]},
        context_policy="incident.context.first_record_in_declared_order.v1", comparison=None,
        notes="Synthetic T06 rows", bookmarks=[], bpic19_pipeline={"schema_version": 1, "actions": [action]})
    return request, answer, child, parent


def test_t06_kept_closed_cohort_keeps_whole_histories_and_survives_a_new_process(tmp_path):
    with socket.socket() as reserving:
        reserving.bind(("127.0.0.1", 0))
        port = reserving.getsockname()[1]
    folder = tmp_path / "workspace"; folder.mkdir()
    first, client = start_process(port)
    try:
        wid, base = prepare_source(client, folder, LITERAL)
        request, answer, child, parent = keep_request(client, wid, base)
        result = answer["cohorts"]
        assert members(result["retention"]["retained"]) == (["M", "N"], 2, 8)
        assert members(next(group for group in result["completion_groups"] if group["state"] == "open_recorded")) == (["O"], 1, 2)
        assert child["kept"] == {"case_ids": ["M", "N"], "case_count": 2, "record_count": 8}
        evidence = lambda identity, case: client.post("/api/investigations/case-evidence", json=envelope(
            "imported_case_evidence_request", workspace_id=wid, identity=identity, case_id=case))
        assert len(evidence(child["identity"], "M").json()["records"]) == 4
        # The open item that was not kept stays inspectable, whole, on the flow parent.
        assert len(evidence(parent["identity"], "O").json()["records"]) == 2
        for support, code in (("open_recorded", "selection_mismatch"), ("inclusion_excluded", "selection_mismatch")):
            bad = deepcopy(request)
            bad["bpic19_pipeline"]["actions"][0]["selection_keep"]["group"]["support"] = support
            refused = client.post("/api/investigations/save", json=bad)
            assert refused.status_code >= 400 and refused.json()["code"] == code, refused.text
        bad = deepcopy(request)
        bad["bpic19_pipeline"]["actions"][0]["selection_keep"]["policy_id"] = "bpic19.measure_cohort_keep.v1"
        assert client.post("/api/investigations/save", json=bad).json()["code"] == "unsupported_policy"
        saved = client.post("/api/investigations/save", json=request)
        assert saved.status_code == 200, saved.text
        saved = saved.json()
    finally:
        first.terminate()
        first.wait(timeout=15)
    assert first.returncode is not None
    second, fresh = start_process(port)
    try:
        assert second.pid != first.pid
        assert fresh.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(folder))).status_code == 200
        reopened = fresh.post("/api/investigations/reopen", json=envelope("reopen_investigation_request",
            workspace_id=wid, saved_revision_id=saved["revision"]["saved_revision_id"]))
        assert reopened.status_code == 200, reopened.text
        assert reopened.json()["revision"] == saved["revision"]
        assert reopened.json()["bpic19_outputs"] == saved["bpic19_outputs"]
        content = reopened.json()["revision"]["content"]
        assert content["bpic19_pipeline"]["actions"][0]["selection_keep"]["group"] == {"kind": "completion_cohort", "support": "retention_retained"}
        query = content["bpic19_pipeline"]["actions"][0]["query"]
        assert (query["retain"], query["completion"], query["inclusion"]["kind"]) == (
            "observed_closed", {"recipe": "flow_presence", "receipt": "goods_only", "tie_policy": "unknown"}, "all_items")
        # Undo's target, the flow parent, has the same statuses after the restart.
        _, again = cohorts(fresh, wid, parent["identity"], retain="observed_closed")
        assert again == answer
    finally:
        second.terminate()
        second.wait(timeout=15)
