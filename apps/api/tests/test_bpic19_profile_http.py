"""Real HTTP source/role/profile/complete-evidence behavior, including a fresh service."""

import json
from copy import deepcopy
from pathlib import Path

from fastapi.testclient import TestClient
from jsonschema import Draft202012Validator
from wise_platform_api.app import create_app
from import_requests import envelope, wall_policies
from test_bpic19_profiles import source, ROLES, h7_prepared, h7_source, source_definition

ROOT = Path(__file__).resolve().parents[3]
VALIDATOR = Draft202012Validator(json.loads((ROOT / "contracts/bpic19-profile.schema.json").read_text()))
ROUTE = "/api/investigations/bpic19-profile"


def request(wid, identity, roles=ROLES, revision=2):
    return envelope("bpic19_profile_request", "bpic19-"+str(revision), revision, workspace_id=wid,
                    identity=identity, query={"roles": deepcopy(roles), "profile_columns": None, "policy_id": "bpic19.all_raw_case_attributes.v1"})


def prepare_source(client, workspace, raw=None, policies=None):
    wid = client.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(workspace))).json()["workspace_id"]
    stored = client.put("/api/sources", params=envelope("upload_source_metadata", workspace_id=wid, filename="literal-bpic19.csv"),
                        content=source() if raw is None else raw, headers={"Content-Type": "application/octet-stream"})
    assert stored.status_code == 200, stored.text
    prepared = client.post("/api/preparations", json=envelope("confirm_mapping_request", workspace_id=wid,
        source_id=stored.json()["source"]["source_id"], dialect={"encoding": "utf-8", "delimiter": ",", "quotechar": '"', "header": "first_record"},
        mapping={"case_column": 0, "activity_column": 1, "timestamp_column": 2, "sequence_column": None, "context_columns": list(range(3,10))},
        policies=wall_policies("iso8601", "2027-01-01T00:00:00") if policies is None else policies, accept_report_issues=True))
    assert prepared.status_code == 200 and prepared.json()["state"] == "ready", prepared.text
    opened = client.post("/api/investigations/open-population", json=envelope("open_population_request", workspace_id=wid, preparation_id=prepared.json()["preparation"]["preparation_id"]))
    assert opened.status_code == 200
    return wid, opened.json()["identity"]


def test_review_roles_partition_select_full_history_and_reopen_source_profile(tmp_path):
    workspace = tmp_path / "workspace"; workspace.mkdir()
    with TestClient(create_app()) as client:
        wid, identity = prepare_source(client, workspace)
        proposal = client.post(ROUTE, json=request(wid, identity, None))
        assert proposal.status_code == 200, proposal.text
        VALIDATOR.validate(proposal.json())
        assert proposal.json()["binding_state"] == "needs_review" and proposal.json()["profile"] is None
        assert proposal.json()["suggested_roles"] == ROLES
        given = request(wid, identity)
        VALIDATOR.validate(given)
        answered = client.post(ROUTE, json=given)
        assert answered.status_code == 200, answered.text
        answer = answered.json(); VALIDATOR.validate(answer)
        assert answer["identity"] == identity and answer["query"] == given["query"]
        profile = answer["profile"]
        assert profile["population"]["case_count"] == 10 and profile["population"]["record_count"] == 14
        assert {row["flow_id"]: row["case_ids"] for row in profile["flows"]} == {
            "after_gr": ["D1_1"], "before_gr": ["B_1", "D1_2", "F_1", "G_1"], "two_way": ["D3_1"], "consignment": ["D2_1"]}
        selected = client.post("/api/investigations/select-cases", json=envelope("select_cases_request", "keep-after", 3, workspace_id=wid,
            identity=identity, parent_case_ids=None, predicates=[{"kind": "case_id_in", "case_ids": ["D1_1"], "negate": False}]))
        assert selected.status_code == 200
        assert selected.json()["kept"]["record_count"] == 2
        evidence = client.post("/api/investigations/case-evidence", json=envelope("imported_case_evidence_request", "evidence-after", 3,
            workspace_id=wid, identity=selected.json()["identity"], case_id="D1_1"))
        assert evidence.status_code == 200, evidence.text
        assert [row["activity"] for row in evidence.json()["records"]] == ["Record Invoice Receipt", "Record Goods Receipt"]
        child = client.post(ROUTE, json=request(wid, selected.json()["identity"], revision=4))
        assert child.status_code == 200 and child.json()["profile"]["population"]["case_count"] == 1
    with TestClient(create_app()) as fresh:
        reopened = fresh.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(workspace)))
        assert reopened.status_code == 200 and reopened.json()["workspace_id"] == wid
        replayed = fresh.post(ROUTE, json=given)
        assert replayed.status_code == 200, replayed.text
        assert replayed.json()["profile"] == profile


def test_invalid_json_types_roles_and_foreign_population_refuse_before_computation(tmp_path):
    workspace = tmp_path / "workspace"; workspace.mkdir()
    with TestClient(create_app()) as client:
        wid, identity = prepare_source(client, workspace)
        bad = request(wid, identity); bad["query"]["roles"]["item_type"] = True
        response = client.post(ROUTE, json=bad)
        assert response.status_code == 400
        assert response.json()["code"] == "invalid_request" and response.json()["field"] == "query.roles.item_type"
        bad = request(wid, identity); bad["query"]["roles"] = {**ROLES, "item_type": 3}
        response = client.post(ROUTE, json=bad)
        assert response.status_code == 422 and response.json()["code"] == "invalid_parameter"
        bad = request(wid, {**identity, "population_id": "population.v1:sha256:"+"f"*64})
        response = client.post(ROUTE, json=bad)
        assert response.status_code == 409 and response.json()["code"] == "population_unavailable"



def test_h7_public_http_reviews_source_overlay_distinct_grains_and_original_exclusion_witness(tmp_path):
    workspace = tmp_path / "source-policy-workspace"; workspace.mkdir()
    literal = h7_prepared()
    with TestClient(create_app()) as client:
        wid, identity = prepare_source(client, workspace, h7_source(), literal.descriptor()["policies"])
        given = request(wid, identity); given["query"]["source_interpretation"] = source_definition("document_start", horizon="2019-01-28T00:00:00Z", provenance="Synthetic extraction contract")
        response = client.post(ROUTE, json=given)
        assert response.status_code == 200, response.text
        answer = response.json(); VALIDATOR.validate(answer)
        review = answer["profile"]["source_review"]
        assert review["retained"]["case_ids"] == ["C"] and review["excluded"]["case_ids"] == ["A", "B"]
        assert review["observed_raw_maximum"] == "2020-01-02T00:00:00Z" and review["horizon_state"] == "reviewed"
        assert review["interpretation"]["horizon"]["value"] == "2019-01-28T00:00:00Z"
        assert review["discrepancies"][0]["difference"] == 387
        witness = next(e for e in review["inclusion_evidence"] if e["case_id"] == "B")
        assert witness["witness_case_ids"] == ["A"]
        evidence = client.post("/api/investigations/case-evidence", json=envelope("imported_case_evidence_request", "h7-exclusion", 5,
            workspace_id=wid, identity=identity, case_id="A"))
        assert evidence.status_code == 200, evidence.text
        assert [r["original_cells"][2] for r in evidence.json()["records"]] == ["1948-01-01T00:00:00Z", "2018-01-01T00:00:00Z", "2020-01-02T00:00:00Z"]
        assert witness["row_ids"] == [evidence.json()["records"][0]["row_id"]]
        item_request = deepcopy(given); item_request["query"]["source_interpretation"]["inclusion"]["kind"] = "item_start"
        item = client.post(ROUTE, json=item_request)
        assert item.status_code == 200 and item.json()["profile"]["source_review"]["retained"]["case_ids"] == ["B", "C"]
        assert item.json()["profile"]["definition_id"] != answer["profile"]["definition_id"]
        projected_request = deepcopy(given); projected_request["query"]["source_interpretation"]["inclusion"] = source_definition("record_projection")["inclusion"]
        projected = client.post(ROUTE, json=projected_request)
        assert projected.status_code == 200 and projected.json()["profile"]["source_review"]["projection"]["record_count"] == 5
        assert projected.json()["profile"]["population"]["record_count"] == 7
        bad = deepcopy(given); bad["query"]["source_interpretation"]["horizon"]["provenance"] = None
        refusal = client.post(ROUTE, json=bad)
        assert refusal.status_code == 422 and refusal.json()["field"].endswith("horizon.provenance")
        bad = deepcopy(given); bad["query"]["source_interpretation"]["policy_id"] = "unreviewed.execute_code.v99"
        refusal = client.post(ROUTE, json=bad)
        assert refusal.status_code == 422 and refusal.json()["code"] == "unsupported_policy"
    # This is service re-creation coverage only. A distinct serving-PID receipt is a separate qualification gate.
    with TestClient(create_app()) as fresh:
        assert fresh.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(workspace))).status_code == 200
        replayed = fresh.post(ROUTE, json=given)
        assert replayed.status_code == 200 and replayed.json()["profile"] == answer["profile"]
