"""Real import/population/operator HTTP seam with independently literal row witnesses."""

import hashlib
import json
from copy import deepcopy
from pathlib import Path

from fastapi.testclient import TestClient
from jsonschema import Draft202012Validator
from wise_platform_api.app import create_app
from import_requests import envelope, wall_policies

ROOT = Path(__file__).resolve().parents[3]
VALIDATOR = Draft202012Validator(
    json.loads((ROOT / "contracts/bpic19-operators.schema.json").read_text())
)
ROUTE = "/api/investigations/bpic19-operators"
ROLES = {"event_id": 3, "item_category": 4, "net_worth": 5}
# CSV quoting is literal; the trailing source activity X remains a raw adjacency witness.
RAW = b"""case,activity,time,eventID,category,value
a,Record Goods Receipt,2018-01-01T00:00:00,1,"3-way match, invoice after GR",100
a,Record Invoice Receipt,2018-01-02T00:00:00,2,"3-way match, invoice after GR",100
a,Clear Invoice,2018-01-04T00:00:00,3,"3-way match, invoice after GR",100
a,Change Price,2018-01-05T00:00:00,4,"3-way match, invoice after GR",100
b,Record Invoice Receipt,2018-01-02T00:00:00,5,2-way match,100
b,Record Invoice Receipt,2018-01-03T00:00:00,6,2-way match,100
b,Cancel Invoice Receipt,2018-01-04T00:00:00,7,2-way match,100
b,Cancel Invoice Receipt,2018-01-05T00:00:00,8,2-way match,100
b,Cancel Invoice Receipt,2018-01-06T00:00:00,9,2-way match,100
c,A,2018-01-01T00:00:00,10,2-way match,0
c,X,2018-01-01T12:00:00,11,2-way match,0
c,B,2018-01-02T00:00:00,12,2-way match,0
c,A,2018-01-03T00:00:00,13,2-way match,0
d,B,2018-01-01T00:00:00,14,Consignment,-20
d,A,2018-01-02T00:00:00,15,Consignment,0
d,B,2018-01-03T00:00:00,16,Consignment,-20
e,A,2018-01-02T00:00:00,17,2-way match,0
f,A,2018-01-02T00:00:00,18,2-way match,0
f,B,,19,2-way match,0
g,A,2018-01-05T00:00:00,20,2-way match,0
g,B,2018-01-03T00:00:00,21,2-way match,0
"""
ORDINAL = {
    "kind": "ordinal",
    "order": "numeric_event_id",
    "stages": "gr_ir_ci",
    "receipt": "goods",
    "cancellation": "retain",
    "ties": "source_position",
}
FIFO = {
    "kind": "fifo",
    "order": "source_position",
    "stages": "gr_ir_ci",
    "receipt": "goods",
    "cancellation": "retain",
    "ties": "allow_equal",
}
CANCELLATION = {
    "kind": "cancellation",
    "target_activities": ["Record Invoice Receipt"],
    "cancellation_activities": ["Cancel Invoice Receipt"],
    "reuse": "consume",
    "ties": "strict_before",
    "ambiguity": "refuse",
    "amount_filter": "ignore",
    "tolerance": 0,
    "max_window_days": None,
}
RULE = {
    "kind": "rule",
    "left_activities": ["A"],
    "right_activities": ["B"],
    "relation": "response",
    "position": "eventual",
    "quantifier": "every",
    "reuse": "allow",
    "ties": "allow_equal",
    "vacuity": "not_activated",
    "flow_scope": "all",
}
WAITING = {
    "kind": "waiting",
    "activation_activities": ["A"],
    "response_activities": ["B"],
    "endpoints": "first_first",
    "completion": "right_censored",
    "horizon_start": "2018-01-01T00:00:00",
    "horizon_end": "2018-01-07T00:00:00",
    "horizon_provenance": "Independent literal source snapshot; reviewed day6 observation cutoff",
    "horizon_policy": "refuse_outside",
    "calendar": "elapsed_segments",
}


def original_ids(raw=RAW, count=21):
    source_id = "source.v1:sha256:" + hashlib.sha256(raw).hexdigest()
    return {
        n: "row.v1:sha256:"
        + hashlib.sha256(
            json.dumps(
                {"format_version": 1, "source_id": source_id, "source_position": n - 1},
                sort_keys=True,
                separators=(",", ":"),
            ).encode()
        ).hexdigest()
        for n in range(1, count + 1)
    }


def prepare(client, workspace, raw=RAW):
    opened = client.post(
        "/api/workspaces/open",
        json=envelope("open_workspace_request", path=str(workspace)),
    )
    assert opened.status_code == 200, opened.text
    wid = opened.json()["workspace_id"]
    stored = client.put(
        "/api/sources",
        params=envelope(
            "upload_source_metadata", workspace_id=wid, filename="operator-literal.csv"
        ),
        content=raw,
        headers={"Content-Type": "application/octet-stream"},
    )
    assert stored.status_code == 200, stored.text
    ready = client.post(
        "/api/preparations",
        json=envelope(
            "confirm_mapping_request",
            workspace_id=wid,
            source_id=stored.json()["source"]["source_id"],
            dialect={
                "encoding": "utf-8",
                "delimiter": ",",
                "quotechar": '"',
                "header": "first_record",
            },
            mapping={
                "case_column": 0,
                "activity_column": 1,
                "timestamp_column": 2,
                "sequence_column": None,
                "context_columns": [4],
            },
            policies=wall_policies("iso8601", "2018-01-21T00:00:00"),
            accept_report_issues=True,
        ),
    )
    assert ready.status_code == 200 and ready.json()["state"] == "ready", ready.text
    opened = client.post(
        "/api/investigations/open-population",
        json=envelope(
            "open_population_request",
            workspace_id=wid,
            preparation_id=ready.json()["preparation"]["preparation_id"],
        ),
    )
    assert opened.status_code == 200, opened.text
    return wid, opened.json()["identity"]


def request(wid, identity, recipe=ORDINAL, offset=0, limit=20):
    return envelope(
        "bpic19_operator_request",
        "operator-literal-" + str(offset),
        2,
        workspace_id=wid,
        identity=identity,
        query={
            "policy_id": "bpic19.declared_operators.v1",
            "roles": deepcopy(ROLES),
            "recipe": deepcopy(recipe),
            "offset": offset,
            "limit": limit,
        },
    )


def test_timestamp_numeric_fifo_http_is_distinct_and_refuses_unmapped_ids(tmp_path):
    raw = b"""case,activity,time,eventID,category,value
a,Record Invoice Receipt,2018-01-01T00:00:00,2,"3-way match, invoice after GR",100
a,Record Goods Receipt,2018-01-01T00:00:00,1,"3-way match, invoice after GR",100
a,Clear Invoice,2018-01-01T00:00:00,3,"3-way match, invoice after GR",100
b,Record Goods Receipt,2018-01-01T00:00:00,4,"3-way match, invoice after GR",100
b,Record Invoice Receipt,2018-01-01T00:00:00,5,"3-way match, invoice after GR",100
b,Clear Invoice,2018-01-01T00:00:00,6,"3-way match, invoice after GR",100
b,Change Price,2018-01-01T00:00:00,,"3-way match, invoice after GR",100
"""
    workspace = tmp_path / "numeric-fifo"
    workspace.mkdir()
    rows = original_ids(raw, 7)
    recipe = {**FIFO, "order": "timestamp_numeric_event_id"}
    with TestClient(create_app()) as client:
        wid, identity = prepare(client, workspace, raw)
        answers = []
        for order in [
            "source_position",
            "timestamp_source_position",
            "timestamp_numeric_event_id",
        ]:
            response = client.post(
                ROUTE, json=request(wid, identity, {**recipe, "order": order})
            )
            assert response.status_code == 200, response.text
            answer = response.json()
            VALIDATOR.validate(answer)
            answers.append(answer)
        assert len({answer["definition_id"] for answer in answers}) == 3
        assert [
            answer["cases"][0]["totals"]["paired_episode_count"]["value"]
            for answer in answers
        ] == [0, 0, 1]
        a, b = answers[2]["cases"]
        assert a["record_row_ids"] == [rows[1], rows[2], rows[3]]
        assert a["observations"][0]["stage_row_ids"] == [rows[2], rows[1], rows[3]]
        assert a["observations"][0]["state"] == "zero"
        assert b["state"] == "unknown" and b["reason"] == "invalid_event_id"
        assert b["unknown_row_ids"] == [rows[7]]
        assert b["record_row_ids"] == [rows[n] for n in range(4, 8)]
        assert (
            answers[2]["population_case_count"] == 2
            and answers[2]["population_record_count"] == 7
        )
        bad = request(wid, identity, recipe)
        bad["query"]["roles"]["event_id"] = None
        refused = client.post(ROUTE, json=bad)
        assert refused.status_code == 400, refused.text
        assert refused.json()["code"] == "invalid_parameter"
        assert "reviewed event_id column" in refused.json()["message"]


def test_five_real_http_operators_witnesses_and_frozen_paging(tmp_path):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    rows = original_ids()
    with TestClient(create_app()) as client:
        wid, identity = prepare(client, workspace)
        replies = {}
        for recipe in [ORDINAL, FIFO, CANCELLATION, RULE, WAITING, None]:
            response = client.post(ROUTE, json=request(wid, identity, recipe))
            assert response.status_code == 200, response.text
            answer = response.json()
            VALIDATOR.validate(answer)
            replies[recipe["kind"] if recipe else "catalogue"] = answer
            assert (
                answer["population_case_count"] == 7
                and answer["population_record_count"] == 21
            )
        assert replies["ordinal"]["cases"][0]["observations"][0]["stage_row_ids"] == [
            rows[1],
            rows[2],
            rows[3],
        ]
        assert (
            replies["fifo"]["cases"][0]["observations"][0]["intervals"]["stage_2_to_3"][
                "value"
            ]
            == 2
        )
        b = replies["cancellation"]["cases"][1]
        assert [obs["response_row_ids"] for obs in b["observations"]] == [
            [rows[6]],
            [rows[5]],
            [],
        ]
        assert (
            b["record_count"] == 5 and b["totals"]["retained_receipt_sum"]["value"] == 0
        )
        c = replies["rule"]["cases"][2]
        assert c["truth"] == "false" and [
            obs["response_row_ids"] for obs in c["observations"]
        ] == [[rows[12]], []]
        assert c["record_row_ids"] == [rows[10], rows[11], rows[12], rows[13]]
        f = replies["waiting"]["cases"][5]
        assert (
            f["observations"][0]["state"] == "unknown"
            and f["observations"][0]["start"] is None
        )
        assert replies["waiting"]["cases"][4]["observations"][0]["state"] == "censored"
        assert (
            replies["catalogue"]["operation"] == "bpic19_catalogue"
            and replies["catalogue"]["cases"] == []
        )
        first = client.post(ROUTE, json=request(wid, identity, RULE, 0, 1))
        second = client.post(ROUTE, json=request(wid, identity, RULE, 2, 1))
        assert first.status_code == second.status_code == 200
        assert (
            first.json()["result_id"]
            == second.json()["result_id"]
            == replies["rule"]["result_id"]
        )
        assert (
            second.json()["summary"] == replies["rule"]["summary"]
            and second.json()["cases"][0]["case_id"] == "c"
        )
        given = request(wid, identity, FIFO)
    # A new app/registry qualification; actual distinct-OS-process restart is separately tested.
    with TestClient(create_app()) as fresh:
        fresh.post(
            "/api/workspaces/open",
            json=envelope("open_workspace_request", path=str(workspace)),
        )
        replayed = fresh.post(ROUTE, json=given)
        assert replayed.status_code == 200, replayed.text
        assert replayed.json()["result_id"] == replies["fifo"]["result_id"]


def test_operator_keep_uses_complete_items_and_counterexample_witnesses(tmp_path):
    workspace = tmp_path / "selected"
    workspace.mkdir()
    rows = original_ids()
    with TestClient(create_app()) as client:
        wid, identity = prepare(client, workspace)
        original = client.post(ROUTE, json=request(wid, identity, RULE)).json()
        ids = next(
            group["case_ids"]
            for group in original["selection_groups"]
            if group["key"] == "truth_false"
        )
        assert ids == ["c", "e", "g"]
        kept = client.post(
            "/api/investigations/select-cases",
            json=envelope(
                "select_cases_request",
                "operator-keep",
                3,
                workspace_id=wid,
                identity=identity,
                parent_case_ids=None,
                predicates=[{"kind": "case_id_in", "case_ids": ["c"], "negate": False}],
            ),
        )
        assert kept.status_code == 200, kept.text
        selected = client.post(
            ROUTE,
            json=request(
                wid, kept.json()["identity"], {**RULE, "position": "raw_direct"}
            ),
        )
        assert selected.status_code == 200, selected.text
        answer = selected.json()
        VALIDATOR.validate(answer)
        assert (
            answer["population_case_count"] == 1
            and answer["population_record_count"] == 4
        )
        assert answer["cases"][0]["record_row_ids"] == [
            rows[10],
            rows[11],
            rows[12],
            rows[13],
        ]
        assert answer["summary"]["observation_state_counts"] == {"unmatched": 2}
        assert {
            key: value
            for key, value in answer["parent_identity"].items()
            if key != "population_id"
        } == {key: value for key, value in identity.items() if key != "population_id"}
        assert (
            answer["parent_identity"]["population_id"]
            != answer["identity"]["population_id"]
            and answer["identity"] != identity
        )


def test_strict_contracts_missing_cutoff_and_foreign_populations(tmp_path):
    workspace = tmp_path / "refusal"
    workspace.mkdir()
    with TestClient(create_app()) as client:
        wid, identity = prepare(client, workspace)
        bad = request(wid, identity)
        bad["query"]["roles"]["event_id"] = True
        response = client.post(ROUTE, json=bad)
        assert response.status_code == 400, response.text
        assert response.json()["code"] == "invalid_request"
        bad = request(wid, identity)
        bad["query"]["roles"]["event_id"] = 99
        response = client.post(ROUTE, json=bad)
        assert (
            response.status_code == 400
            and response.json()["code"] == "invalid_parameter"
        )
        bad = request(wid, identity, RULE)
        bad["query"]["recipe"]["left_activities"] = ["A", "A"]
        response = client.post(ROUTE, json=bad)
        assert (
            response.status_code == 400 and response.json()["code"] == "invalid_request"
        )
        bad = request(wid, identity, {**WAITING, "horizon_end": "2018-02-01T00:00:00"})
        response = client.post(ROUTE, json=bad)
        assert (
            response.status_code == 400
            and response.json()["code"] == "invalid_parameter"
        )
        response = client.post(
            ROUTE,
            json=request(
                wid, {**identity, "population_id": "population.v1:sha256:" + "f" * 64}
            ),
        )
        assert (
            response.status_code == 404
            and response.json()["code"] == "population_unavailable"
        )
        bad = request(wid, identity)
        bad["query"]["recipe"]["callback"] = "eval"
        response = client.post(ROUTE, json=bad)
        assert (
            response.status_code == 400 and response.json()["code"] == "invalid_request"
        )
