"""Document eligibility sees source siblings without enlarging a frozen parent."""

from copy import deepcopy

from import_requests import envelope
from test_bpic19_historical_acceptance_tcp import tcp
from test_bpic19_profile_http import ROUTE, prepare_source, request


SOURCE = b'''case,activity,time,case Item Category,case Item Type,case Goods Receipt,case GR-Based IV,case Purchasing Document,case Item,case concept:name
A,Opened,2017-12-31T00:00:00,2-way match,Limit,false,false,D,1,A
B,Opened,2018-01-02T00:00:00,2-way match,Limit,false,false,D,2,B
B,Closed,2018-01-03T00:00:00,2-way match,Limit,false,false,D,2,B
C,Opened,2018-01-02T00:00:00,2-way match,Limit,false,false,E,1,C
'''


def test_document_start_uses_outside_sibling_but_preserves_exact_parent(tcp, tmp_path):
    client, _ = tcp
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    wid, identity = prepare_source(client, workspace, SOURCE)
    selected = client.post("/api/investigations/select-cases", json=envelope(
        "select_cases_request", workspace_id=wid, identity=identity, parent_case_ids=None,
        predicates=[{"kind": "case_id_in", "case_ids": ["B", "C"], "negate": False}]))
    assert selected.status_code == 200, selected.text
    parent = selected.json()["identity"]
    given = request(wid, parent)
    given["query"]["source_interpretation"] = {
        "profile_name": "Whole document start on selected items",
        "policy_id": "bpic19.raw_source_interpretation.v1",
        "inclusion": {"kind": "document_start", "timestamp_kind": "wall_clock",
                      "start_inclusive": "2018-01-01T00:00:00", "end_exclusive": None},
        "horizon": {"timestamp_kind": "wall_clock", "value": None, "provenance": None},
        "discrepancies": []}
    answer = client.post(ROUTE, json=given)
    assert answer.status_code == 200, answer.text
    profile = answer.json()["profile"]
    review = profile["source_review"]
    assert review["retained"]["case_ids"] == ["C"]
    assert review["excluded"]["case_ids"] == ["B"]
    assert review["raw_support"]["case_count"] == 2
    assert review["raw_support"]["record_count"] == 3
    assert review["excluded"]["record_count"] == 2
    assert profile["population"]["case_count"] == 2
    witness = next(row for row in review["inclusion_evidence"] if row["case_id"] == "B")
    assert witness["witness_case_ids"] == ["A"]
    original = client.post("/api/investigations/case-evidence", json=envelope(
        "imported_case_evidence_request", workspace_id=wid, identity=identity, case_id="A"))
    assert original.status_code == 200, original.text
    assert witness["row_ids"] == [original.json()["records"][0]["row_id"]]
    item_request = deepcopy(given)
    item_request["query"]["source_interpretation"]["inclusion"]["kind"] = "item_start"
    items = client.post(ROUTE, json=item_request)
    assert items.status_code == 200, items.text
    assert items.json()["profile"]["source_review"]["retained"]["case_ids"] == ["B", "C"]
    assert items.json()["profile"]["definition_id"] != profile["definition_id"]
