"""Literal mixed-document grain and explicit category lineage at public HTTP."""

import socket

from import_requests import envelope
from test_bpic19_category_lineage_tcp import (
    NATIVE_HEADERS, PREPARED_HEADERS, PREPARED_ROLES, lineage_request, upload_preparation,
)
from test_bpic19_historical_acceptance_tcp import tcp
from test_bpic19_profile_http import ROUTE
from test_bpic19_pipeline_http import start_process


GRAIN_ROWS = [
    ["f01", "Area", "Company", "Type", "Subarea", "D1", "PO", "Vendor", "Service",
     "3-way match, invoice after GR", "Spend", "Source", "Name", "true", "1", "D1_1",
     "true", "user_1", "user_1", "Record Invoice Receipt", "100", "2018-01-02T00:00:00"],
    ["f02", "Area", "Company", "Type", "Subarea", "D1", "PO", "Vendor", "Service",
     "3-way match, invoice after GR", "Spend", "Source", "Name", "true", "1", "D1_1",
     "true", "user_1", "user_1", "Record Goods Receipt", "100", "2018-01-03T00:00:00"],
    ["f03", "Area", "Company", "Type", "Subarea", "D1", "PO", "Vendor", "Standard",
     "3-way match, invoice before GR", "Spend", "Source", "Name", "false", "2", "D1_2",
     "true", "user_1", "user_1", "Create Purchase Order Item", "100", "2018-01-01T00:00:00"],
    ["f04", "Area", "Company", "Type", "Subarea", "D1", "PO", "Vendor", "Standard",
     "3-way match, invoice before GR", "Spend", "Source", "Name", "false", "2", "D1_2",
     "true", "user_1", "user_1", "Record Goods Receipt", "100", "2018-01-04T00:00:00"],
    ["f13", "Area", "Company", "Type", "Subarea", "G", "PO", "Vendor", "Standard",
     "3-way match, invoice before GR", "Spend", "Source", "Name", "false", "1", "G_1",
     "true", "user_1", "user_1", "Create Purchase Order Item", "100", "2018-01-01T00:00:00"],
    ["f14", "Area", "Company", "Type", "Subarea", "Other", "PO", "Vendor", "Standard",
     "3-way match, invoice before GR", "Spend", "Source", "Name", "false", "1", "G_1",
     "true", "batch_2", "batch_2", "Change Quantity", "200", "not-a-time"],
    ["f16", "Area", "Company", "Type", "Subarea", "D1", "PO", "Vendor", "Limit",
     "2-way match", "Spend", "Source", "Name", "false", "3", "D1_3",
     "false", "user_1", "user_1", "Observed", "100", "2018-01-01T00:00:00"],
    ["f05", "Area", "Company", "Type", "Subarea", "D2", "PO", "Vendor", "Consignment",
     "Consignment", "Spend", "Source", "Name", "false", "1", "D2_1",
     "true", "batch_1", "batch_1", "Record Goods Receipt", "0", ""],
]
ALL_IDS = ["D1_1", "D1_2", "D1_3", "D2_1", "G_1"]


def prepare_grain_pair(client, workspace):
    workspace.mkdir()
    opened = client.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(workspace)))
    assert opened.status_code == 200, opened.text
    wid = opened.json()["workspace_id"]
    native = upload_preparation(client, wid, NATIVE_HEADERS, GRAIN_ROWS, {
        "case_column": 15, "activity_column": 19, "timestamp_column": 21,
        "sequence_column": None, "context_columns": [5, 8, 9, 13, 14, 16, 17, 20],
    })
    rows = [[row[15], row[19], row[21], "synthetic-native.csv", str(i + 1), "wall_clock", "22"] + row
            for i, row in enumerate(GRAIN_ROWS)]
    prepared = upload_preparation(client, wid, PREPARED_HEADERS, rows, {
        "case_column": 0, "activity_column": 1, "timestamp_column": 2,
        "sequence_column": None, "context_columns": list(range(3, 29)),
    })
    return wid, native, prepared


def grain_request(wid, native, prepared):
    given = lineage_request(wid, native, prepared)
    given["query"]["profile_columns"] = [12, 16, 24, 27]
    given["query"]["category_lineage"]["provenance"] = "Synthetic G_1 grain and native22/prepared29 correspondence"
    given["query"]["include_document_siblings"] = True
    return given


def save_grain_profile(client, wid, identity, given, profile, parent_case_ids=ALL_IDS):
    selected = client.post("/api/investigations/select-cases", json=envelope("select_cases_request",
        workspace_id=wid, identity=identity, parent_case_ids=parent_case_ids, predicates=[]))
    assert selected.status_code == 200, selected.text
    saved = client.post("/api/investigations/save", json=envelope("save_investigation_request",
        workspace_id=wid, investigation_id=None, expected_revision_id=None,
        name="Synthetic G_1 grain lineage" if parent_case_ids == ALL_IDS else "Synthetic D1 parent lineage", base_identity=identity,
        selection_identity=selected.json()["identity"],
        selection_recipe={"parent_case_ids": parent_case_ids, "predicates": []},
        context_policy="incident.context.first_record_in_declared_order.v1", comparison=None,
        notes="Synthetic grain qualification; not real-source acceptance", bookmarks=[],
        bpic19_pipeline={"schema_version": 1, "actions": [{"operation": "bpic19_profile",
            "identity": given["identity"], "query": given["query"], "definition_id": profile["definition_id"]}]}))
    assert saved.status_code == 200, saved.text
    return saved.json()


def test_g1_document_conflict_and_event_variation_do_not_invent_document_or_spend(tcp, tmp_path):
    client, _ = tcp
    wid, native, prepared = prepare_grain_pair(client, tmp_path / "workspace")
    given = grain_request(wid, native, prepared)
    response = client.post(ROUTE, json=given)
    assert response.status_code == 200, response.text
    profile = response.json()["profile"]
    assert profile["population"] == {"case_count": 5, "record_count": 8,
        "document_count": 2, "document_unknown_case_count": 1}
    assert profile["definition"]["roles"] == PREPARED_ROLES
    assert profile["definition"]["category_lineage"]["verified_record_count"] == 8
    assert next(group for group in profile["grain"]["identity_issues"]
        if group["state"] == "conflicting_document_or_item")["case_ids"] == ["G_1"]
    assert profile["grain"]["mixed_flow_document_count"] == 1
    assert next(group for group in profile["flows"] if group["flow_id"] == "before_gr")["case_ids"] == ["D1_2", "G_1"]
    for index, values in [(12, ["G", "Other"]), (24, ["user_1", "batch_2"]), (27, ["100", "200"])]:
        attribute = next(item for item in profile["attributes"] if item["column_index"] == index)
        assert attribute["conflicting_case_count"] == 1
        witness = next(item for item in attribute["conflicting_witnesses"] if item["case_id"] == "G_1")
        assert [(row["source_position"], row["value"]) for row in witness["rows"]] == [(4, values[0]), (5, values[1])]
    evidence = client.post("/api/investigations/case-evidence", json=envelope("imported_case_evidence_request",
        workspace_id=wid, identity=prepared, case_id="G_1"))
    assert evidence.status_code == 200, evidence.text
    assert [record["original_cells"][12] for record in evidence.json()["records"]] == ["G", "Other"]


def test_d1_parent_excludes_siblings_and_g1_but_retains_source_lineage_after_new_pid(tmp_path):
    with socket.socket() as reserving:
        reserving.bind(("127.0.0.1", 0))
        port = reserving.getsockname()[1]
    workspace = tmp_path / "workspace"
    first, client = start_process(port)
    try:
        wid, native, prepared = prepare_grain_pair(client, workspace)
        selected = client.post("/api/investigations/select-cases", json=envelope("select_cases_request",
            workspace_id=wid, identity=prepared, parent_case_ids=["D1_1", "D1_2"], predicates=[]))
        assert selected.status_code == 200, selected.text
        given = grain_request(wid, native, prepared)
        given["identity"] = selected.json()["identity"]
        reviewed = client.post(ROUTE, json=given)
        assert reviewed.status_code == 200, reviewed.text
        profile = reviewed.json()["profile"]
        assert profile["population"] == {"case_count": 2, "record_count": 4,
            "document_count": 1, "document_unknown_case_count": 0}
        assert profile["definition"]["category_lineage"]["verified_record_count"] == 8
        assert profile["grain"]["mixed_flow_document_count"] == 1
        assert profile["grain"]["mixed_flow_document_examples"] == [{"document": "D1",
            "flow_ids": ["after_gr", "before_gr"], "case_ids": ["D1_1", "D1_2"]}]
        assert next(group for group in profile["grain"]["identity_issues"]
            if group["state"] == "conflicting_document_or_item")["case_ids"] == []
        category = next(item for item in profile["attributes"] if item["column_index"] == 16)
        assert category["invariant_case_count"] == 2
        assert category["conflicting_case_count"] == 0
        outside = profile["grain"]["outside_parent_siblings"]
        assert (outside["case_ids"], outside["case_count"], outside["record_count"], outside["document_count"]) == (["D1_3"], 1, 1, 1)
        saved = save_grain_profile(client, wid, prepared, given, profile, ["D1_1", "D1_2"])
    finally:
        first.terminate()
        first.wait(timeout=15)
    assert first.returncode is not None
    second, fresh = start_process(port)
    try:
        assert first.pid != second.pid
        opened = fresh.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(workspace)))
        assert opened.status_code == 200, opened.text
        reopened = fresh.post("/api/investigations/reopen", json=envelope("reopen_investigation_request",
            workspace_id=wid, saved_revision_id=saved["revision"]["saved_revision_id"]))
        assert reopened.status_code == 200, reopened.text
        assert reopened.json()["revision"] == saved["revision"]
        assert reopened.json()["bpic19_outputs"] == saved["bpic19_outputs"]
        rerun = fresh.post(ROUTE, json=given)
        assert rerun.status_code == 200, rerun.text
        assert rerun.json()["profile"] == profile
    finally:
        second.terminate()
        second.wait(timeout=15)
