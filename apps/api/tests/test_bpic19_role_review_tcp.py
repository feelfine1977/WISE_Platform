"""Literal header ambiguity review through an owned loopback HTTP service."""

from import_requests import envelope
from test_bpic19_historical_acceptance_tcp import tcp
from test_bpic19_profile_http import ROUTE, prepare_source, request


def test_normalized_header_collision_requires_explicit_category_choice(tcp, tmp_path):
    client, _ = tcp
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    raw = (
        'case_id,activity,time,case Item Category,case Item Type,case Goods Receipt,'
        'case GR-Based Inv. Verif.,case Purchasing Document,case Item,case concept:name,'
        ' SOURCE__case   item CATEGORY \n'
        'D_1,Opened,2018-01-01T00:00:00,"3-way match, invoice after GR",Standard,'
        'true,true,D,1,D_1,"3-way match, invoice before GR"\n'
        'D_1,Closed,2018-01-02T00:00:00,"3-way match, invoice after GR",Standard,'
        'true,true,D,1,D_1,"3-way match, invoice before GR"\n'
    ).encode()
    wid, identity = prepare_source(client, workspace, raw)
    proposed = client.post(ROUTE, json=request(wid, identity, roles=None))
    assert proposed.status_code == 200, proposed.text
    proposal = proposed.json()
    assert proposal["binding_state"] == "needs_review"
    assert proposal["profile"] is None
    assert proposal["suggested_roles"] == {
        "item_category": None, "item_type": 4, "goods_receipt": 5,
        "gr_based_iv": 6, "purchasing_document": 7, "item": 8, "source_case": 9,
    }
    assert proposal["columns"][3]["name"] == "case Item Category"
    assert proposal["columns"][10]["name"] == " SOURCE__case   item CATEGORY "

    given = request(wid, identity)
    first = client.post(ROUTE, json=given)
    assert first.status_code == 200, first.text
    assert {flow["flow_id"]: flow["case_ids"] for flow in first.json()["profile"]["flows"]} == {
        "after_gr": ["D_1"], "before_gr": [], "two_way": [], "consignment": [],
    }
    given["query"]["roles"]["item_category"] = 10
    second = client.post(ROUTE, json=given)
    assert second.status_code == 200, second.text
    assert {flow["flow_id"]: flow["case_ids"] for flow in second.json()["profile"]["flows"]} == {
        "after_gr": [], "before_gr": ["D_1"], "two_way": [], "consignment": [],
    }
    assert second.json()["profile"]["definition_id"] != first.json()["profile"]["definition_id"]
    evidence = client.post("/api/investigations/case-evidence", json=envelope(
        "imported_case_evidence_request", workspace_id=wid, identity=identity, case_id="D_1"))
    assert evidence.status_code == 200, evidence.text
    assert [row["original_cells"] for row in evidence.json()["records"]] == [
        ["D_1", "Opened", "2018-01-01T00:00:00", "3-way match, invoice after GR", "Standard",
         "true", "true", "D", "1", "D_1", "3-way match, invoice before GR"],
        ["D_1", "Closed", "2018-01-02T00:00:00", "3-way match, invoice after GR", "Standard",
         "true", "true", "D", "1", "D_1", "3-way match, invoice before GR"],
    ]
