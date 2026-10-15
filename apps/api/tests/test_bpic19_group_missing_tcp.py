"""Literal missing-looking text is not unavailable context in a frozen run."""

from test_bpic19_historical_acceptance_tcp import tcp
from test_bpic19_scoring_http import given, prepare, read
from import_requests import envelope


SOURCE = b'''case,case Purchasing Document,case Item,case Item Category,case Goods Receipt,case GR-Based IV,case Item Type,case Company,case Spend area text,activity,time,event org:resource,event Cumulative net worth (EUR)
L,L,1,2-way match,false,false,Limit,(missing),Area,Create Purchase Order Item,2018-01-01T00:00:00Z,user_1,100
M,M,1,2-way match,false,false,Limit,,Area,Create Purchase Order Item,2018-01-01T00:00:00Z,user_1,100
K,K,1,2-way match,false,false,Limit,Known,Area,Create Purchase Order Item,2018-01-01T00:00:00Z,user_1,100
'''


def test_literal_missing_association_selects_only_literal_members(tcp, tmp_path):
    client, _ = tcp
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    wid, identity = prepare(client, workspace, SOURCE)
    scored = client.post("/api/investigations/bpic19-score", json=given(wid, identity, group_by=["spend_area"]))
    assert scored.status_code == 200, scored.text
    run_id = scored.json()["run_id"]
    for value, ids in [("(missing)", ["L"]), (None, ["M"]), ("Known", ["K"])]:
        query = {"policy_id": "bpic19.frozen_native_associations.v1",
                 "target": {"name": "Selected company", "selector": {"kind": "group", "group_values": {"company": value}}},
                 "comparator": {"name": "Other companies", "selector": {"kind": "outside_target"}},
                 "criteria": ["C01"], "positive_threshold": 0, "min_support": 1,
                 "pair_mode": "jointly_eligible", "pooled_sd": True}
        result = client.post("/api/investigations/bpic19-associate", json=envelope(
            "bpic19_association_request", workspace_id=wid, run_id=run_id, query=query, case_offset=0, case_limit=100))
        assert result.status_code == 200, result.text
        assert result.json()["report"]["association_analysis"]["populations"]["target"]["case_ids"] == ids


def test_literal_missing_member_filter_does_not_alias_unavailable(tcp, tmp_path):
    client, _ = tcp
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    wid, identity = prepare(client, workspace, SOURCE.replace(b"(missing)", b"Literal"))
    scored = client.post("/api/investigations/bpic19-score", json=given(wid, identity, group_by=["company"]))
    assert scored.status_code == 200, scored.text
    for value, ids in [("(missing)", []), (None, ["M"]), ("Literal", ["L"])]:
        result = client.post("/api/investigations/bpic19-read", json=read(
            wid, scored.json()["run_id"], case_filter={"group_values": {"company": value}}))
        assert result.status_code == 200, result.text
        assert [case["case_id"] for case in result.json()["report"]["case_page"]["cases"]] == ids


def test_supplied_native_groups_keep_nullable_keys_for_linked_member_intents(tcp, tmp_path):
    client, _ = tcp
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    wid, identity = prepare(client, workspace, SOURCE.replace(b"(missing)", b"Literal"))
    scored = client.post("/api/investigations/bpic19-score", json=given(wid, identity, group_by=["company"]))
    assert scored.status_code == 200, scored.text
    answer = scored.json()
    groups = answer["report"]["groups"]
    assert {group["company"]: group["n_cases"] for group in groups} == {"Known": 1, "Literal": 1, None: 1}
    expected_ids = {"Known": ["K"], "Literal": ["L"], None: ["M"]}
    for group in groups:
        result = client.post("/api/investigations/bpic19-read", json=read(
            wid, answer["run_id"], case_filter={"group_values": {"company": group["company"]}}))
        assert result.status_code == 200, result.text
        assert [case["case_id"] for case in result.json()["report"]["case_page"]["cases"]] == expected_ids[group["company"]]


def test_native_reserved_group_label_collision_refuses_without_replacing_a_run(tcp, tmp_path):
    client, _ = tcp
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    wid, identity = prepare(client, workspace, SOURCE)
    scored = client.post("/api/investigations/bpic19-score", json=given(wid, identity, group_by=["spend_area"]))
    assert scored.status_code == 200, scored.text
    previous = scored.json()
    refused = client.post("/api/investigations/bpic19-score", json=given(wid, identity, group_by=["company"]))
    assert refused.status_code == 400, refused.text
    assert refused.json()["code"] == "invalid_parameter"
    assert "literal '(missing)'" in refused.json()["message"]
    assert "Choose another grouping" in refused.json()["message"]
    reopened = client.post("/api/investigations/bpic19-read", json=read(wid, previous["run_id"]))
    assert reopened.status_code == 200, reopened.text
    assert reopened.json()["report"] == previous["report"]


def test_missing_document_shortlist_preserves_nullable_member_identity(tcp, tmp_path):
    client, _ = tcp
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    source = SOURCE.replace(b"(missing)", b"Literal").replace(b"M,M,1,", b"M,,1,") + b"K,K,1,2-way match,false,false,Limit,Known,Area,Record Invoice Receipt,2018-01-02T00:00:00Z,user_1,100\n"
    wid, identity = prepare(client, workspace, source)
    scored = client.post("/api/investigations/bpic19-score", json=given(wid, identity, group_by=["company"], criteria_family="completion"))
    assert scored.status_code == 200, scored.text
    answer = scored.json()
    documents = answer["report"]["ranking_comparisons"]["views"]["Balanced"]["documents"]
    assert {row["document"] for row in documents} == {"L", None}
    missing = next(row for row in documents if row["document"] is None)
    members = client.post("/api/investigations/bpic19-read", json=read(
        wid, answer["run_id"], case_filter={"group_values": {"document": missing["document"]}}))
    assert members.status_code == 200, members.text
    assert [case["case_id"] for case in members.json()["report"]["case_page"]["cases"]] == ["M"]
    assert next(row for row in answer["report"]["documents"] if row["document"] is None)["member_count"] == 1
