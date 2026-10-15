"""Independent native22/prepared29 category correspondence over public HTTP."""

import csv
import io
from copy import deepcopy
import socket

import pytest

from import_requests import envelope, wall_policies
from test_bpic19_historical_acceptance_tcp import tcp
from test_bpic19_profile_http import ROUTE, request
from test_bpic19_pipeline_http import start_process


NATIVE_HEADERS = [
    "eventID ", "case Spend area text", "case Company", "case Document Type",
    "case Sub spend area text", "case Purchasing Document", "case Purch. Doc. Category name",
    "case Vendor", "case Item Type", "case Item Category", "case Spend classification text",
    "case Source", "case Name", "case GR-Based Inv. Verif.", "case Item", "case concept:name",
    "case Goods Receipt", "event User", "event org:resource", "event concept:name",
    "event Cumulative net worth (EUR)", "event time:timestamp",
]
NATIVE_ROWS = [
    ["n1", "Area", "Company", "Type", "Subarea", "D", "PO", "Vendor", "Standard",
     "3-way match, invoice after GR", "Spend", "Source", "Name", "true", "1", "D_1",
     "true", "user_1", "user_1", "Opened", "100", "2018-01-01T00:00:00"],
    ["n2", "Area", "Company", "Type", "Subarea", "D", "PO", "Vendor", "Standard",
     "3-way match, invoice before GR", "Spend", "Source", "Name", "false", "1", "D_1",
     "true", "batch_2", "batch_2", "Closed", "200", "not-a-time"],
]
PREPARED_HEADERS = ["case_id", "activity", "timestamp", "source_path", "source_record",
                    "timestamp_kind", "source_field_count"] + ["source__" + name.strip() for name in NATIVE_HEADERS]
PREPARED_ROWS = [
    ["D_1", "Opened", "2018-01-01T00:00:00", "synthetic-native.csv", "1", "wall_clock", "22"] + NATIVE_ROWS[0],
    ["D_1", "Closed", "not-a-time", "synthetic-native.csv", "2", "wall_clock", "22"] + NATIVE_ROWS[1],
]
PREPARED_ROLES = {"item_category": 16, "item_type": 15, "goods_receipt": 23, "gr_based_iv": 20,
                  "purchasing_document": 12, "item": 21, "source_case": 22}


def upload_preparation(client, wid, headers, rows, mapping):
    stream = io.StringIO(newline="")
    writer = csv.writer(stream)
    writer.writerow(headers)
    writer.writerows(rows)
    uploaded = client.put("/api/sources", params=envelope("upload_source_metadata", workspace_id=wid,
        filename="synthetic-lineage.csv"), content=stream.getvalue().encode(),
        headers={"Content-Type": "application/octet-stream"})
    assert uploaded.status_code == 200, uploaded.text
    confirmed = client.post("/api/preparations", json=envelope("confirm_mapping_request", workspace_id=wid,
        source_id=uploaded.json()["source"]["source_id"],
        dialect={"encoding": "utf-8", "delimiter": ",", "quotechar": '"', "header": "first_record"},
        mapping=mapping, policies=wall_policies("iso8601", "2027-01-01T00:00:00"), accept_report_issues=True))
    assert confirmed.status_code == 200 and confirmed.json()["state"] == "ready", confirmed.text
    opened = client.post("/api/investigations/open-population", json=envelope("open_population_request",
        workspace_id=wid, preparation_id=confirmed.json()["preparation"]["preparation_id"]))
    assert opened.status_code == 200, opened.text
    return opened.json()["identity"]


def prepare_pair(client, workspace):
    workspace.mkdir()
    opened = client.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(workspace)))
    assert opened.status_code == 200, opened.text
    wid = opened.json()["workspace_id"]
    native = upload_preparation(client, wid, NATIVE_HEADERS, NATIVE_ROWS, {
        "case_column": 15, "activity_column": 19, "timestamp_column": 21, "sequence_column": None,
        "context_columns": [5, 8, 9, 13, 14, 16, 18, 20],
    })
    prepared = upload_preparation(client, wid, PREPARED_HEADERS, PREPARED_ROWS, {
        "case_column": 0, "activity_column": 1, "timestamp_column": 2, "sequence_column": None,
        "context_columns": list(range(3, 29)),
    })
    return wid, native, prepared


def lineage_request(wid, native, prepared):
    given = request(wid, prepared, roles=PREPARED_ROLES)
    given["query"]["category_lineage"] = {
        "policy_id": "bpic19.same_position_category_lineage.v1",
        "origin_preparation_id": native["preparation_id"], "origin_column_index": 9,
        "provenance": "Independently authored synthetic native22 to prepared29 copy",
    }
    return given


def test_review_category_lineage_pins_both_names_and_checks_invalid_time_rows(tcp, tmp_path):
    client, _ = tcp
    wid, native, prepared = prepare_pair(client, tmp_path / "workspace")
    given = lineage_request(wid, native, prepared)
    response = client.post(ROUTE, json=given)
    assert response.status_code == 200, response.text
    profile = response.json()["profile"]
    assert profile["definition"]["category_lineage"] == {
        **given["query"]["category_lineage"], "origin_source_id": native["source_id"],
        "origin_column_name": "case Item Category", "column_index": 16,
        "column_name": "source__case Item Category", "verified_record_count": 2,
    }
    assert profile["population"] == {"case_count": 1, "record_count": 2,
                                     "document_count": 1, "document_unknown_case_count": 0}
    assert next(group for group in profile["unresolved"] if group["state"] == "conflicting")["case_ids"] == ["D_1"]
    category = next(attribute for attribute in profile["attributes"] if attribute["column_index"] == 16)
    assert [(row["source_position"], row["value"]) for row in category["conflicting_witnesses"][0]["rows"]] == [
        (0, "3-way match, invoice after GR"), (1, "3-way match, invoice before GR"),
    ]


def test_unknown_category_lineage_policy_is_refused_without_substitution(tcp, tmp_path):
    client, _ = tcp
    wid, native, prepared = prepare_pair(client, tmp_path / "workspace")
    given = lineage_request(wid, native, prepared)
    given["query"]["category_lineage"]["policy_id"] = "bpic19.guess_from_headers.v99"
    refused = client.post(ROUTE, json=given)
    assert refused.status_code == 422, refused.text
    assert refused.json()["code"] == "unsupported_policy"
    assert refused.json()["field"] == "query.category_lineage.policy_id"


def test_linked_subtype_comparison_retains_the_reviewed_category_lineage(tcp, tmp_path):
    client, _ = tcp
    wid, native, prepared = prepare_pair(client, tmp_path / "workspace")
    given = lineage_request(wid, native, prepared)
    reviewed = client.post(ROUTE, json=given)
    assert reviewed.status_code == 200, reviewed.text
    query = {
        "policy_id": "bpic19.flow_item_type_comparison.v1",
        "profile_definition_id": reviewed.json()["profile"]["definition_id"], "profile_query": given["query"],
        "target": {"flow_id": "after_gr", "item_type_state": "invariant", "item_type_value": "Standard"},
        "reference": {"flow_id": "after_gr", "item_type_state": "invariant", "item_type_value": "Service"},
        "page": {"role": "target", "offset": 0, "limit": 10},
    }
    result = client.post("/api/investigations/bpic19-flow-comparison", json=envelope(
        "bpic19_flow_comparison_request", workspace_id=wid, identity=prepared, query=query))
    assert result.status_code == 200, result.text
    comparison = result.json()["comparison"]
    assert comparison["target"]["case_ids"] == []
    assert comparison["reference"]["case_ids"] == []
    assert comparison["scope_unavailable"]["case_ids"] == ["D_1"]
    assert comparison["definition"]["profile_query"]["category_lineage"] == given["query"]["category_lineage"]


@pytest.mark.parametrize("change,code,field", [
    ("value", "identity_mismatch", "query.category_lineage"),
    ("case", "identity_mismatch", "query.category_lineage"),
    ("shorter", "identity_mismatch", "query.category_lineage"),
    ("column", "invalid_parameter", "query.category_lineage.origin_column_index"),
    ("provenance", "invalid_parameter", "query.category_lineage.provenance"),
    ("missing_origin", "preparation_unavailable", "query.category_lineage.origin_preparation_id"),
    ("unreviewed", "invalid_parameter", "query.roles"),
    ("boolean", "invalid_request", "query.category_lineage.origin_column_index"),
])
def test_lineage_refuses_changed_or_unreviewed_inputs(tcp, tmp_path, change, code, field):
    client, _ = tcp
    wid, native, prepared = prepare_pair(client, tmp_path / "workspace")
    given = lineage_request(wid, native, prepared)
    if change in {"value", "case", "shorter"}:
        rows = deepcopy(NATIVE_ROWS)
        if change == "value":
            rows[1][9] = "Unknown"
        elif change == "case":
            rows[1][15] = "Other_1"
        else:
            rows.pop()
        changed = upload_preparation(client, wid, NATIVE_HEADERS, rows, {
            "case_column": 15, "activity_column": 19, "timestamp_column": 21,
            "sequence_column": None, "context_columns": [],
        })
        given["query"]["category_lineage"]["origin_preparation_id"] = changed["preparation_id"]
    elif change == "column":
        given["query"]["category_lineage"]["origin_column_index"] = 22
    elif change == "provenance":
        given["query"]["category_lineage"]["provenance"] = "   "
    elif change == "missing_origin":
        given["query"]["category_lineage"]["origin_preparation_id"] = "preparation.v1:sha256:" + "f" * 64
    elif change == "unreviewed":
        given["query"]["roles"] = None
    else:
        given["query"]["category_lineage"]["origin_column_index"] = True
    refused = client.post(ROUTE, json=given)
    assert refused.status_code in (400, 409, 422), refused.text
    assert refused.json()["code"] == code
    assert refused.json()["field"] == field


def save_profile(client, wid, identity, given, profile, **revision):
    selected = client.post("/api/investigations/select-cases", json=envelope("select_cases_request",
        workspace_id=wid, identity=identity, parent_case_ids=None, predicates=[]))
    assert selected.status_code == 200, selected.text
    result = client.post("/api/investigations/save", json=envelope("save_investigation_request",
        workspace_id=wid, investigation_id=revision.get("investigation_id"),
        expected_revision_id=revision.get("expected_revision_id"), name="Synthetic category lineage",
        base_identity=identity, selection_identity=selected.json()["identity"],
        selection_recipe={"parent_case_ids": ["D_1"], "predicates": []},
        context_policy="incident.context.first_record_in_declared_order.v1", comparison=None,
        notes="Invented native22/prepared29 category correspondence, not full-source qualification",
        bookmarks=[], bpic19_pipeline={"schema_version": 1, "actions": [{
            "operation": "bpic19_profile", "identity": identity, "query": given["query"],
            "definition_id": profile["definition_id"],
        }]}))
    assert result.status_code == 200, result.text
    return result.json()


def test_saved_lineage_and_conflict_reopen_after_actual_exit_and_new_pid(tmp_path):
    with socket.socket() as reserving:
        reserving.bind(("127.0.0.1", 0))
        port = reserving.getsockname()[1]
    workspace = tmp_path / "workspace"
    first, client = start_process(port)
    try:
        wid, native, prepared = prepare_pair(client, workspace)
        given = lineage_request(wid, native, prepared)
        reviewed = client.post(ROUTE, json=given)
        assert reviewed.status_code == 200, reviewed.text
        profile = reviewed.json()["profile"]
        saved = save_profile(client, wid, prepared, given, profile)
        changed = deepcopy(given)
        changed["query"]["category_lineage"]["provenance"] = "Second explicitly reviewed synthetic reference"
        revised = client.post(ROUTE, json=changed)
        assert revised.status_code == 200, revised.text
        assert revised.json()["profile"]["definition_id"] != profile["definition_id"]
        saved_b = save_profile(client, wid, prepared, changed, revised.json()["profile"],
            investigation_id=saved["revision"]["investigation_id"],
            expected_revision_id=saved["revision"]["saved_revision_id"])
        assert saved_b["revision"]["saved_revision_id"] != saved["revision"]["saved_revision_id"]
    finally:
        first.terminate()
        first.wait(timeout=15)
    assert first.returncode is not None
    second, fresh = start_process(port)
    try:
        assert first.pid != second.pid
        opened = fresh.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(workspace)))
        assert opened.status_code == 200, opened.text
        for original in (saved, saved_b):
            reopened = fresh.post("/api/investigations/reopen", json=envelope("reopen_investigation_request",
                workspace_id=wid, saved_revision_id=original["revision"]["saved_revision_id"]))
            assert reopened.status_code == 200, reopened.text
            assert reopened.json()["revision"] == original["revision"]
            assert reopened.json()["bpic19_outputs"] == original["bpic19_outputs"]
            output = reopened.json()["bpic19_outputs"]["outputs"][0]["output"]["profile"]
            assert output["definition"]["category_lineage"]["origin_column_index"] == 9
            assert output["definition"]["category_lineage"]["column_index"] == 16
            assert output["definition"]["category_lineage"]["verified_record_count"] == 2
            assert output["population"]["record_count"] == 2
        rerun = fresh.post(ROUTE, json=given)
        assert rerun.status_code == 200, rerun.text
        assert rerun.json()["profile"] == profile
    finally:
        second.terminate()
        second.wait(timeout=15)
