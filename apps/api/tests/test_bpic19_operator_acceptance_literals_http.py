"""Actual imported-CSV boundary receipts for the remaining G08 literal clauses.

Expected values and original-position witnesses are written independently of
the engine. Source instructions/programs are never executed.
"""

from fastapi.testclient import TestClient
from import_requests import envelope
from test_bpic19_operators_http import (
    CANCELLATION,
    FIFO,
    ORDINAL,
    ROUTE,
    RULE,
    VALIDATOR,
    WAITING,
    original_ids,
    prepare,
    request,
)
from wise_platform_api.app import create_app

RAW = b"""case,activity,time,eventID,category,value
O,Record Goods Receipt,2018-01-01T00:00:00,1,"3-way match, invoice after GR",100
O,Record Goods Receipt,2018-01-02T00:00:00,2,"3-way match, invoice after GR",100
O,Record Invoice Receipt,2018-01-03T00:00:00,3,"3-way match, invoice after GR",100
O,Record Invoice Receipt,2018-01-04T00:00:00,4,"3-way match, invoice after GR",100
O,Clear Invoice,2018-01-05T00:00:00,5,"3-way match, invoice after GR",100
O,Clear Invoice,2018-01-10T00:00:00,6,"3-way match, invoice after GR",100
P,Record Goods Receipt,2018-01-01T00:00:00,7,"3-way match, invoice after GR",100
P,Record Invoice Receipt,2018-01-02T00:00:00,8,"3-way match, invoice after GR",100
P,Record Goods Receipt,2018-01-03T00:00:00,9,"3-way match, invoice after GR",100
P,Record Invoice Receipt,2018-01-04T00:00:00,10,"3-way match, invoice after GR",100
P,Clear Invoice,2018-01-05T00:00:00,11,"3-way match, invoice after GR",100
V,Create Purchase Order Item,2017-12-31T00:00:00,12,2-way match,100
V,Record Invoice Receipt,2018-01-01T00:00:00,13,2-way match,100
V,Record Invoice Receipt,2018-01-02T00:00:00,14,2-way match,-20
V,Record Invoice Receipt,2018-01-03T00:00:00,15,2-way match,0
V,Cancel Invoice Receipt,2018-01-02T12:00:00,16,2-way match,-20
E,A,2018-01-02T00:00:00,17,2-way match,0
F,A,2018-01-02T00:00:00,18,2-way match,0
F,B,,19,2-way match,0
G,A,2018-01-05T00:00:00,20,2-way match,0
G,B,2018-01-03T00:00:00,21,2-way match,0
U,A,2018-01-01T00:00:00,22,2-way match,0
U,B,2018-01-02T00:00:00,23,2-way match,0
U,,,24,2-way match,0
X,A,2018-01-01T00:00:00,25,2-way match,0
X,B,2018-01-02T00:00:00,26,2-way match,0
X,Change Price,,27,2-way match,0
"""


def literal_answers(client, workspace):
    """Capture public replies only after an actual immutable CSV import."""
    wid, identity = prepare(client, workspace, RAW)
    answers = {}
    for name, recipe in [
        ("ordinal", ORDINAL),
        ("fifo", FIFO),
        ("cancellation", CANCELLATION),
        ("waiting", WAITING),
        ("every", RULE),
        ("some", {**RULE, "quantifier": "some"}),
    ]:
        response = client.post(ROUTE, json=request(wid, identity, recipe))
        assert response.status_code == 200, response.text
        answer = response.json()
        VALIDATOR.validate(answer)
        assert answer["identity"] == identity
        assert (
            answer["population_case_count"] == 8
            and answer["population_record_count"] == 27
        )
        answers[name] = answer
    return wid, identity, answers


def assert_literal_receipts(answers):
    """Hand-authored expected outputs; never rederive an operator from its answer."""
    rows = original_ids(RAW, 27)
    cases = {
        name: {case["case_id"]: case for case in answer["cases"]}
        for name, answer in answers.items()
    }
    o = cases["ordinal"]["O"]
    assert o["record_row_ids"] == [rows[1], rows[2], rows[3], rows[4], rows[5], rows[6]]
    assert [obs["stage_row_ids"] for obs in o["observations"]] == [
        [rows[1], rows[3], rows[5]],
        [rows[2], rows[4], rows[6]],
    ]
    assert [obs["intervals"]["stage_2_to_3"]["value"] for obs in o["observations"]] == [
        2,
        6,
    ]
    assert o["record_count"] == 6 and [
        obs["native_invoice_id"] for obs in o["observations"]
    ] == [None, None]
    p = cases["fifo"]["P"]
    assert [obs["stage_row_ids"] for obs in p["observations"]] == [
        [rows[7], rows[8], rows[11]],
        [rows[9], rows[10], None],
    ]
    assert p["included_row_ids"] == [rows[7], rows[8], rows[11]] and p[
        "unmatched_row_ids"
    ] == [rows[9], rows[10]]
    assert p["totals"]["paired_episode_count"]["value"] == 1
    assert p["totals"]["stage_1_unmatched_event_count"]["value"] == 1
    assert p["totals"]["stage_2_unmatched_event_count"]["value"] == 1
    assert p["totals"]["stage_3_unmatched_event_count"]["value"] == 0
    v = cases["cancellation"]["V"]
    for key, expected in {
        "raw_receipt_sum": 80,
        "raw_receipt_mean": 80 / 3,
        "raw_receipt_maximum_absolute": 100,
        "raw_receipt_zero_count": 1,
        "raw_receipt_negative_count": 1,
        "unique_creation_value": 100,
        "retained_receipt_sum": 100,
        "retained_receipt_mean": 50,
    }.items():
        assert v["totals"][key]["available"] and v["totals"][key]["value"] == expected
    assert v["excluded_row_ids"] == [rows[14]]
    # The reviewed preparation presents complete histories in declared clock
    # order; original source-position IDs/cells remain unchanged.
    assert v["record_row_ids"] == [rows[12], rows[13], rows[14], rows[16], rows[15]]
    e, f, g = cases["waiting"]["E"], cases["waiting"]["F"], cases["waiting"]["G"]
    assert (
        e["observations"][0]["state"] == "censored"
        and e["observations"][0]["response_row_ids"] == []
    )
    assert (
        e["observations"][0]["activation_row_ids"] == [rows[17]]
        and e["observations"][0]["intervals"]["waiting_duration"]["value"] == 5
    )
    assert e["observations"][0]["end"] == "2018-01-07T00:00:00"
    assert f["reason"] == "unknown_response_time" and f["unknown_row_ids"] == [rows[19]]
    assert g["observations"][0]["state"] == "reversed"
    assert (
        g["observations"][0]["intervals"]["waiting_duration"][
            "recorded_difference_days"
        ]
        == -2
    )
    assert g["observations"][0]["intervals"]["waiting_duration"]["value"] is None
    u = cases["every"]["U"]
    assert u["activation_count"] is None and u["known_activation_count"] == 1
    assert u["truth"] == "unknown" and cases["some"]["U"]["truth"] == "true"
    assert u["observations"][0]["response_row_ids"] == [rows[23]] and u[
        "unknown_row_ids"
    ] == [rows[24]]
    x = cases["every"]["X"]
    assert x["truth"] == "true" and cases["some"]["X"]["truth"] == "true"
    assert x["unknown_row_ids"] == [] and x["record_row_ids"] == [
        rows[25],
        rows[26],
        rows[27],
    ]


def test_g08_literals_cross_registered_http_and_keep_complete_original_histories(
    tmp_path,
):
    workspace = tmp_path / "literal-acceptance"
    workspace.mkdir()
    with TestClient(create_app()) as client:
        wid, identity, answers = literal_answers(client, workspace)
        assert_literal_receipts(answers)
        rows = original_ids(RAW, 27)
        for case_id, expected_ids, expected_activities in [
            (
                "V",
                [rows[12], rows[13], rows[14], rows[16], rows[15]],
                [
                    "Create Purchase Order Item",
                    "Record Invoice Receipt",
                    "Record Invoice Receipt",
                    "Cancel Invoice Receipt",
                    "Record Invoice Receipt",
                ],
            ),
            ("U", [rows[22], rows[23], rows[24]], ["A", "B", None]),
            ("X", [rows[25], rows[26], rows[27]], ["A", "B", "Change Price"]),
        ]:
            selected = client.post(
                "/api/investigations/select-cases",
                json=envelope(
                    "select_cases_request",
                    workspace_id=wid,
                    identity=identity,
                    parent_case_ids=None,
                    predicates=[
                        {"kind": "case_id_in", "case_ids": [case_id], "negate": False}
                    ],
                ),
            )
            assert selected.status_code == 200, selected.text
            assert selected.json()["kept"]["record_count"] == len(expected_ids)
            evidence = client.post(
                "/api/investigations/case-evidence",
                json=envelope(
                    "imported_case_evidence_request",
                    workspace_id=wid,
                    identity=selected.json()["identity"],
                    case_id=case_id,
                ),
            )
            assert evidence.status_code == 200, evidence.text
            assert [row["row_id"] for row in evidence.json()["records"]] == expected_ids
            assert [
                row["activity"] for row in evidence.json()["records"]
            ] == expected_activities
