"""T25-AC07: independent original records over a real TCP service.

The approved F29-Raw rows, native values and original-position witnesses below
are literal scientific oracles. They do not call a production measure, selector,
threshold, calibration or identity helper to construct an expected result.
The separate prepared-attribute arithmetic test is explicitly an internal native
Method check: the public application does not admit that synthetic feature input.
These fixtures do not qualify the full source, browser or release.
"""

import csv
from datetime import datetime, timedelta
import hashlib
import io
import json
import math
import os
from pathlib import Path
import socket
import subprocess
import sys
import time

import httpx
import pytest

from import_requests import envelope, wall_policies


ROOT = Path(__file__).resolve().parents[3]
SCORE = "/api/investigations/bpic19-score"
HEADERS = ["case concept:name", "case Purchasing Document", "case Item",
           "case Item Category", "case Goods Receipt", "case GR-Based Inv. Verif.",
           "case Item Type", "case Company", "case Spend area text", "event concept:name",
           "event time:timestamp", "event org:resource", "event Cumulative net worth (EUR)"]
ROLES = {"source_case": 0, "purchasing_document": 1, "item": 2, "item_category": 3,
         "goods_receipt": 4, "gr_based_iv": 5, "item_type": 6, "company": 7,
         "spend_area": 8, "resource": 11, "net_worth": 12, "value": 12}
# Activity=9 and timestamp=10 are the explicitly confirmed preparation roles;
# the scoring boundary uses those frozen roles rather than accepting remapping.
VIEWS = {
    "Finance": [.24, .08, .24, .06, .08, .24, .06],
    "Logistics": [.08, .24, .22, .22, .08, .04, .12],
    "Compliance": [.12, .30, .10, .06, .26, .06, .10],
    "Automation": [.06, .08, .10, .28, .06, .08, .34],
}
CASE_IDS = ("docD_00010", "docD_00020", "docE_00010", "docF_00010")
FLOW_NAMES = ("DF1", "DF2", "two_way", "Consignment")
CASE_POSITIONS = ((0, 1, 2, 3), (4, 5, 6, 7, 8), (9, 10, 11, 12, 13), (14, 15, 16, 17, 18))
F29_ROWS = [
    [CASE_IDS[0], "docD", "00010", "3-way match, invoice after GR", "TRUE", "TRUE", "Standard", "0000", "Packaging", "Record Goods Receipt", "2018-01-01T00:00:00", "user_1", 10],
    [CASE_IDS[0], "docD", "00010", "3-way match, invoice after GR", "TRUE", "TRUE", "Standard", "0000", "Packaging", "Vendor creates invoice", "2018-01-11T00:00:00", "user_2", 10],
    [CASE_IDS[0], "docD", "00010", "3-way match, invoice after GR", "TRUE", "TRUE", "Standard", "0000", "Packaging", "Record Invoice Receipt", "2018-01-21T00:00:00", "UNKNOWN", 10],
    [CASE_IDS[0], "docD", "00010", "3-way match, invoice after GR", "TRUE", "TRUE", "Standard", "0000", "Packaging", "Clear Invoice", "2018-03-22T00:00:00", "batch_1", 10],
    [CASE_IDS[1], "docD", "00020", "3-way match, invoice before GR", "TRUE", "FALSE", "Standard", "0000", "Packaging", "Create Purchase Order Item", "2018-01-01T00:00:00", "user_1", 20],
    [CASE_IDS[1], "docD", "00020", "3-way match, invoice before GR", "TRUE", "FALSE", "Standard", "0000", "Packaging", "Record Invoice Receipt", "2018-01-02T00:00:00", "user_1", 20],
    [CASE_IDS[1], "docD", "00020", "3-way match, invoice before GR", "TRUE", "FALSE", "Standard", "0000", "Packaging", "Record Goods Receipt", "2018-01-03T00:00:00", "batch_1", 20],
    [CASE_IDS[1], "docD", "00020", "3-way match, invoice before GR", "TRUE", "FALSE", "Standard", "0000", "Packaging", "Remove Payment Block", "2018-01-05T00:00:00", "batch_1", 20],
    [CASE_IDS[1], "docD", "00020", "3-way match, invoice before GR", "TRUE", "FALSE", "Standard", "0000", "Packaging", "Clear Invoice", "2018-01-10T00:00:00", "user_2", 20],
    [CASE_IDS[2], "docE", "00010", "2-way match", "FALSE", "FALSE", "Limit", "0000", "Logistics", "Create Purchase Order Item", "2018-01-01T00:00:00", "user_3", 30],
    [CASE_IDS[2], "docE", "00010", "2-way match", "FALSE", "FALSE", "Limit", "0000", "Logistics", "Vendor creates invoice", "2018-01-02T00:00:00", "user_3", 30],
    [CASE_IDS[2], "docE", "00010", "2-way match", "FALSE", "FALSE", "Limit", "0000", "Logistics", "Record Invoice Receipt", "2018-01-03T00:00:00", "batch_1", 30],
    [CASE_IDS[2], "docE", "00010", "2-way match", "FALSE", "FALSE", "Limit", "0000", "Logistics", "Record Goods Receipt", "2018-01-04T00:00:00", "user_4", 30],
    [CASE_IDS[2], "docE", "00010", "2-way match", "FALSE", "FALSE", "Limit", "0000", "Logistics", "Clear Invoice", "2018-01-05T00:00:00", "user_4", 30],
    [CASE_IDS[3], "docF", "00010", "Consignment", "TRUE", "FALSE", "Consignment", "0000", "MRO", "Create Purchase Order Item", "2018-01-01T00:00:00", "batch_1", 40],
    [CASE_IDS[3], "docF", "00010", "Consignment", "TRUE", "FALSE", "Consignment", "0000", "MRO", "Record Goods Receipt", "2018-01-02T00:00:00", "batch_1", 40],
    [CASE_IDS[3], "docF", "00010", "Consignment", "TRUE", "FALSE", "Consignment", "0000", "MRO", "Cancel Goods Receipt", "2018-01-03T00:00:00", "batch_1", 40],
    [CASE_IDS[3], "docF", "00010", "Consignment", "TRUE", "FALSE", "Consignment", "0000", "MRO", "Delete Purchase Order Item", "2018-01-04T00:00:00", "batch_1", 40],
    [CASE_IDS[3], "docF", "00010", "Consignment", "TRUE", "FALSE", "Consignment", "0000", "MRO", "Clear Invoice", "2018-01-05T00:00:00", "batch_1", 40],
]

# Each entry is (raw measurements, native deviations; None here means OOS,
# exact zero-based original witness positions for A/B/C/D). Native OOS retains
# the raw value/evidence. Count zero therefore has an empty matching witness.
F29_ORACLE = {
    "c_l1_invoice_present": ([2, 1, 2, 0], [0, 0, 0, None], ((1, 2), (5,), (10, 11), ())),
    "c_l1_clear_invoice_present": ([1, 1, 1, 1], [0, 0, 0, None], ((3,), (8,), (13,), (18,))),
    "c_l1_goods_or_ses_present": ([1, 1, 1, 1], [0, 0, None, None], ((0,), (6,), (12,), (15,))),
    "c_l2_df1_invoice_after_goods": ([0, 1, 1, None], [0, None, None, None], ((0, 1), (6, 5), (12, 10), (15,))),
    "c_l2_df2_release_after_goods": ([None, 0, None, None], [None, 0, None, None], ((0,), (6, 7), (12,), (15,))),
    "c_l2_2way_no_goods_expected": ([1, 1, 1, 1], [None, None, 1, None], ((0,), (6,), (12,), (15,))),
    "c_l2_consignment_no_clear_invoice": ([1, 1, 1, 1], [None, None, None, 1], ((3,), (8,), (13,), (18,))),
    "c_l3_df1_goods_to_invoice_days": ([10, None, None, None], [0, None, None, None], ((0, 1), (6, 5), (12, 10), (15,))),
    "c_l3_invoice_to_clear_days": ([70, 8, 3, None], [2 / 3, 0, 0, None], ((1, 3), (5, 8), (10, 13), (18,))),
    "c_l3_df2_goods_to_rpb_days": ([None, 2, None, None], [None, 0, None, None], ((0,), (6, 7), (12,), (15,))),
    "c_l3_df2_rpb_to_clear_days": ([None, 5, None, None], [None, 0, None, None], ((3,), (7, 8), (13,), (18,))),
    "c_l4_goods_fragmentation": ([1, 1, 1, 1], [0, 0, None, 0], ((0,), (6,), (12,), (15,))),
    "c_l4_change_approval_repeats": ([0, 0, 0, 0], [0, 0, 0, 0], ((), (), (), ())),
    "c_l4_repeated_invoice_receipt": ([1, 1, 1, 0], [0, 0, 0, None], ((2,), (5,), (11,), ())),
    "c_l4_change_payment_terms_repeats": ([0, 0, 0, 0], [0, 0, 0, 0], ((), (), (), ())),
    "c_l5_cancel_invoice_receipt": ([0, 0, 0, 0], [0, 0, 0, None], ((), (), (), ())),
    "c_l5_cancel_goods_receipt": ([0, 0, 0, 1], [0, 0, None, 1], ((), (), (), (16,))),
    "c_l5_delete_item": ([0, 0, 0, 1], [0, 0, 0, 1], ((), (), (), (17,))),
    "c_l5_debit_memo": ([0, 0, 0, 0], [0, 0, 0, 0], ((), (), (), ())),
    "c_l5_credit_memo": ([0, 0, 0, 0], [0, 0, 0, 0], ((), (), (), ())),
    "c_l6_change_price": ([0, 0, 0, 0], [0, 0, 0, 0], ((), (), (), ())),
    "c_l6_change_quantity": ([0, 0, 0, 0], [0, 0, 0, 0], ((), (), (), ())),
    "c_l6_high_exposure_memo": ([0, 0, 0, 0], [0, 0, 0, 0], ((), (), (), ())),
    "c_l6_high_exposure_price_change": ([0, 0, 0, 0], [0, 0, 0, 0], ((), (), (), ())),
    "c_l7_manual_touches": ([3, 3, 4, 0], [0, 0, 0, 0], ((0, 1, 2), (4, 5, 8), (9, 10, 12, 13), ())),
    "c_l7_distinct_human_resources": ([3, 2, 2, 0], [1 / 4, 0, 0, 0], ((0, 1, 2), (4, 5, 8), (9, 10, 12, 13), ())),
    "c_l7_total_events": ([4, 5, 5, 5], [0, 0, 0, 0], CASE_POSITIONS),
    "c_l7_manual_share": ([3 / 4, 3 / 5, 4 / 5, 0], [1 / 2, 1 / 5, 3 / 5, 0], ((0, 1, 2), (4, 5, 8), (9, 10, 12, 13), ())),
    "c_l6_bal_networth_volatility": ([0, 0, 0, 0], [0, 0, 0, None], CASE_POSITIONS),
}
F29_LAYERS = ([0, 0, 5 / 14, 0, 0, 0, 29 / 176], [0, 0, 0, 0, 0, 0, 9 / 220],
              [0, 1, 0, 0, 0, 0, 27 / 220], [None, 1, None, 0, 7 / 15, 0, 0])
F29_ENDPOINTS = {
    "c_l3_df1_goods_to_invoice_days": (((0,), (1,)), ((6,), (5,)), ((12,), (10,)), ((15,), ())),
    "c_l3_invoice_to_clear_days": (((1,), (3,)), ((5,), (8,)), ((10,), (13,)), ((), (18,))),
    "c_l3_df2_goods_to_rpb_days": (((0,), ()), ((6,), (7,)), ((12,), ()), ((15,), ())),
    "c_l3_df2_rpb_to_clear_days": (((), (3,)), ((7,), (8,)), ((), (13,)), ((), (18,))),
}


def encoded_rows(rows):
    output = io.StringIO(newline="")
    writer = csv.writer(output)
    writer.writerow(HEADERS)
    writer.writerows(rows)
    return output.getvalue().encode("utf-8")


def literal_row_ids(raw, positions):
    """The public row-ID encoding, independently implemented without product code."""
    sid = "source.v1:sha256:" + hashlib.sha256(raw).hexdigest()
    return ["row.v1:sha256:" + hashlib.sha256(json.dumps(
        {"format_version": 1, "source_id": sid, "source_position": position},
        sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()
        for position in positions]


def proof_file(name, value):
    destination = os.environ.get("WISE_BPIC19_HISTORICAL_PROOF_DIR")
    if destination:
        folder = Path(destination)
        folder.mkdir(parents=True, exist_ok=True)
        (folder / name).write_text(json.dumps(value, indent=2, allow_nan=False) + "\n")


def source_hashes():
    names = ("apps/api/src/wise_platform_api/app.py", "apps/api/src/wise_platform_api/bpic19_scoring.py",
             "apps/api/src/wise_platform_api/bpic19_method.py", "apps/api/src/wise_platform_api/method.py",
             "packages/analytics/src/wise_platform_analytics/bpic19_measures.py",
             "contracts/bpic19-scoring.schema.json", "vendor/wise_pm-0.2.0-py3-none-any.whl")
    return {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in names}


@pytest.fixture(scope="module")
def tcp(tmp_path_factory):
    """An owned public application subprocess; no shared host or TestClient."""
    folder = tmp_path_factory.mktemp("historical-tcp")
    with socket.socket() as reserving:
        reserving.bind(("127.0.0.1", 0))
        port = reserving.getsockname()[1]
    command = [sys.executable, "-m", "uvicorn", "wise_platform_api.app:create_app", "--factory",
               "--host", "127.0.0.1", "--port", str(port), "--log-level", "warning"]
    environment = {**os.environ, "PYTHONPATH": os.pathsep.join(
        [str(ROOT / "apps/api/src"), str(ROOT / "packages/analytics/src")])}
    started = time.monotonic()
    log_path = folder / "service.log"
    receipt = {"command": command, "port": port, "scope": "synthetic original records only", "source_hashes": source_hashes(),
               "source_commit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()}
    with log_path.open("wb") as log:
        child = subprocess.Popen(command, cwd=ROOT, env=environment, stdout=log, stderr=log)
        receipt["pid"] = child.pid
        client = httpx.Client(base_url=f"http://127.0.0.1:{port}", timeout=60)
        try:
            for _ in range(200):
                assert child.poll() is None, log_path.read_text()
                try:
                    if client.get("/api/health").status_code == 200:
                        break
                except httpx.TransportError:
                    pass
                time.sleep(.05)
            else:
                pytest.fail("Owned real TCP service did not become ready")
            receipt["health_ready"] = True
            yield client, folder
        finally:
            client.close()
            if child.poll() is None:
                child.terminate()
            child.wait(timeout=15)
            assert child.poll() is not None
            receipt.update({"exit_code": child.returncode, "observed_exit": True,
                            "elapsed_seconds": time.monotonic() - started})
            assert source_hashes() == receipt["source_hashes"], "The checked component files changed while this process was running"
            proof_file("tcp-process.json", receipt)


def prepare_tcp(client, folder, name, rows):
    workspace = folder / name
    workspace.mkdir()
    raw = encoded_rows(rows)
    opened = client.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(workspace)))
    assert opened.status_code == 200, opened.text
    wid = opened.json()["workspace_id"]
    uploaded = client.put("/api/sources", params=envelope("upload_source_metadata", workspace_id=wid, filename=name + ".csv"),
                          content=raw, headers={"Content-Type": "application/octet-stream"})
    assert uploaded.status_code == 200, uploaded.text
    sid = "source.v1:sha256:" + hashlib.sha256(raw).hexdigest()
    assert uploaded.json()["source"]["source_id"] == sid
    request = envelope("confirm_mapping_request", workspace_id=wid, source_id=sid,
        dialect={"encoding": "utf-8", "delimiter": ",", "quotechar": '"', "header": "first_record"},
        mapping={"case_column": 0, "activity_column": 9, "timestamp_column": 10,
                 "sequence_column": None, "context_columns": [1, 2, 3, 4, 5, 6, 7, 8, 11, 12]},
        policies=wall_policies("iso8601", "2027-01-01T00:00:00"), accept_report_issues=True)
    confirmed = client.post("/api/preparations", json=request)
    assert confirmed.status_code == 200 and confirmed.json()["state"] == "ready", confirmed.text
    population = client.post("/api/investigations/open-population", json=envelope("open_population_request",
        workspace_id=wid, preparation_id=confirmed.json()["preparation"]["preparation_id"]))
    assert population.status_code == 200, population.text
    return wid, population.json()["identity"], raw


def score_request(wid, identity, view, gamma=0, roles=None, **settings):
    return envelope("bpic19_score_request", workspace_id=wid, base_identity=identity,
        named_population={"name": "Independent historical literal fixture", "identity": identity},
        roles=ROLES if roles is None else roles,
        settings={"profile": "historical", "criteria_family": "full", "view": view, "mode": "layer_balanced",
                  "gamma": gamma, "group_by": ["company", "spend_area"], "min_cases": 1, "volume": "cases",
                  "exposure_policy": "max_absolute_p95", **settings}, case_offset=0, case_limit=200)


def scored(client, request):
    reply = client.post(SCORE, json=request)
    assert reply.status_code == 200, reply.text
    answer = reply.json()
    assert answer["report"]["admitted_criterion_count"] == 29
    assert answer["report"]["requested_criterion_count"] == 29
    assert answer["report"]["profile_complete"] is True
    assert answer["report"]["omissions"] == []
    return answer, {case["case_id"]: case for case in answer["report"]["case_page"]["cases"]}


def cell(case, criterion_id):
    return next(row for row in case["criteria"] if row["criterion_id"] == criterion_id)


def assert_number(actual, expected):
    if expected is None:
        assert actual is None
    else:
        assert actual == pytest.approx(expected, abs=1e-8, rel=0)


def assert_cell(case, cid, raw, value, deviation, positions, *, reason="evaluated", measurement_reason=None):
    actual = cell(case, cid)
    assert_number(actual["measurement"], value)
    assert_number(actual["deviation"], deviation)
    # The approved clause fixes exact original members, not selector-union
    # presentation order. Compare the entire independently expected list after
    # sorting, including its cardinality (an extra/duplicate ID still fails).
    assert sorted(actual["row_ids"]) == sorted(literal_row_ids(raw, positions)), (case["case_id"], cid, actual)
    assert actual["measurement_evidence"]["row_ids"] == actual["row_ids"]
    assert actual["measurement_reason"] == measurement_reason
    # Total-record support is intrinsically known and its transport has no
    # optional availability member; all other bindings disclose it explicitly.
    if cid != "c_l7_total_events":
        assert actual["measurement_evidence"]["available"] is (value is not None)
    assert actual["reason"] == reason
    assert actual["in_scope"] is (reason != "out_of_scope" and reason != "scope_unknown")
    if deviation is None:
        assert actual["effective_weight"] == 0 and actual["penalty"] == 0
    else:
        assert actual["effective_weight"] > 0


def test_exact_approved_f29_all_29_original_witnesses_four_views_and_gamma_through_tcp(tcp):
    client, folder = tcp
    wid, identity, raw = prepare_tcp(client, folder, "f29-approved", F29_ROWS)
    assert len(F29_ORACLE) == 29
    responses = {}
    for view, weights in VIEWS.items():
        expected_scores = [1 - sum(p * w for p, w in zip(layers, weights) if p is not None) /
                           sum(w for p, w in zip(layers, weights) if p is not None) for layers in F29_LAYERS]
        for gamma in (0, 20):
            answer, cases = scored(client, score_request(wid, identity, view, gamma))
            assert list(cases) == list(CASE_IDS)
            assert answer["report"]["population_case_count"] == answer["report"]["scored_case_count"] == 4
            assert_number(answer["report"]["mean_score"], sum(expected_scores) / 4)
            assert answer["report"]["settings"]["gamma"] == gamma
            for i, cid in enumerate(CASE_IDS):
                case = cases[cid]
                assert case["flow"] == FLOW_NAMES[i]
                assert case["coverage"] == 1 and case["scope_unknown_count"] == 0
                assert case["record_row_ids"] == literal_row_ids(raw, CASE_POSITIONS[i])
                assert sum(row["in_scope"] for row in case["criteria"]) == (24, 25, 20, 16)[i]
                assert len(case["criteria"]) == 29
                assert_number(case["score"], expected_scores[i])
                assert_number(sum(row["penalty"] or 0 for row in case["criteria"]), 1 - expected_scores[i])
                for key, (values, deviations, witnesses) in F29_ORACLE.items():
                    measurement_reason = None
                    if values[i] is None:
                        measurement_reason = ("reversed_interval" if key == "c_l3_df1_goods_to_invoice_days" and i in (1, 2)
                                              else "no_parsed_endpoint")
                    assert_cell(case, key, raw, values[i], deviations[i], witnesses[i],
                                reason="out_of_scope" if deviations[i] is None else "evaluated",
                                measurement_reason=measurement_reason)
                for key, endpoints in F29_ENDPOINTS.items():
                    evidence = cell(case, key)["measurement_evidence"]
                    assert evidence["activation_row_ids"] == literal_row_ids(raw, endpoints[i][0])
                    assert evidence["response_row_ids"] == literal_row_ids(raw, endpoints[i][1])
                for role, column in ROLES.items():
                    if role in case["context_evidence"]:
                        assert case["context_evidence"][role]["value"] == str(F29_ROWS[CASE_POSITIONS[i][0]][column])
                for other_view, other_weights in VIEWS.items():
                    layers = F29_LAYERS[i]
                    assert_number(case["scores"][other_view], 1 - sum(p * w for p, w in zip(layers, other_weights) if p is not None) /
                                  sum(w for p, w in zip(layers, other_weights) if p is not None))
            # Group/reference arithmetic is independent of native aggregation:
            # A/B share Packaging and docD, C/D are singleton groups/documents.
            groups = {group["spend_area"]: group for group in answer["report"]["groups"]}
            for name, positions in (("Packaging", (0, 1)), ("Logistics", (2,)), ("MRO", (3,))):
                group = groups[name]
                count = len(positions)
                mean_score = sum(expected_scores[i] for i in positions) / count
                gap = sum(expected_scores) / 4 - mean_score
                assert group["n_cases"] == count
                assert_number(group["mean_score"], mean_score)
                assert_number(group["global_mean"], sum(expected_scores) / 4)
                assert_number(group["PI"], count * max(gap, 0))
                assert_number(group["stable_PI"], count * max(gap, 0) * count / (count + gamma))
            documents = {document["document"]: document for document in answer["report"]["documents"]}
            for name, positions in (("docD", (0, 1)), ("docE", (2,)), ("docF", (3,))):
                document = documents[name]
                count = len(positions)
                mean_score = sum(expected_scores[i] for i in positions) / count
                assert document["member_count"] == document["n_cases"] == count
                assert document["unscored_member_count"] == 0
                assert_number(document["mean_score"], mean_score)
                assert_number(document["PI"], count * max(sum(expected_scores) / 4 - mean_score, 0))
            # Exact raw source cells are independently compared through the
            # public source witness route, not inferred from a score response.
            if gamma == 0:
                for i, cid in enumerate(CASE_IDS):
                    evidence = client.post("/api/investigations/case-evidence", json=envelope(
                        "imported_case_evidence_request", workspace_id=wid, identity=identity, case_id=cid))
                    assert evidence.status_code == 200, evidence.text
                    records = evidence.json()["records"]
                    assert [row["source_position"] for row in records] == list(CASE_POSITIONS[i])
                    assert [row["row_id"] for row in records] == literal_row_ids(raw, CASE_POSITIONS[i])
                    assert [row["original_cells"] for row in records] == [[str(value) for value in F29_ROWS[p]] for p in CASE_POSITIONS[i]]
                    assert all(row["timestamp_kind"] == "wall_clock" for row in records)
            responses[view + "/gamma" + str(gamma)] = answer
    measure = client.post("/api/investigations/bpic19-measures", json=envelope("bpic19_measures_request",
        workspace_id=wid, identity=identity, query={"policy_id": "bpic19.source_witnessed_measures.v1",
        "measure_profile": "historical_v1", "roles": ROLES, "offset": 0, "limit": 200, "calibration_population": "parent"}))
    assert measure.status_code == 200, measure.text
    measurements = measure.json()
    calibration = measurements["definition"]["calibration"]
    assert calibration["population_case_ids"] == list(CASE_IDS)
    assert calibration["case_count"] == 4 and calibration["quantile"] == 38.5
    assert calibration["interpolation"] == "linear"
    for i, case in enumerate(measurements["cases"]):
        assert case["case_id"] == CASE_IDS[i]
        historical = case["historical_measures"]
        assert_number(historical["exposure_norm"]["value"], (20 / 77, 40 / 77, 60 / 77, 1)[i])
        assert historical["exposure_norm"]["row_ids"] == literal_row_ids(raw, CASE_POSITIONS[i])
        assert historical["exposure_abs_max"]["value"] == (10, 20, 30, 40)[i]
        assert historical["exposure_norm"]["calibration_id"] == calibration["calibration_id"]
        for response in responses.values():
            scored_case = response["report"]["case_page"]["cases"][i]
            for key in ("c_l6_high_exposure_memo", "c_l6_high_exposure_price_change"):
                assert cell(scored_case, key)["measurement_evidence"]["calibration_id"] == calibration["calibration_id"]
    bad = client.post(SCORE, json=score_request(wid, identity, "Finance", mode="flat"))
    assert bad.status_code == 400 and bad.json()["code"] == "unsupported_policy"
    proof_file("f29-approved.json", {"identity": identity, "source_sha256": hashlib.sha256(raw).hexdigest(),
        "original_rows": F29_ROWS, "roles": ROLES, "literal_oracle": F29_ORACLE,
        "calibration": calibration, "responses": responses, "flat_refusal": bad.json(),
        "scope": "8 real TCP runs; 4 original cases, 19 original rows, 29 exact cells per case/run"})


def boundary_rows_and_oracle():
    """Expand declared raw multiplicities; expectations never inspect product output."""
    rows, expected = [], {}
    def add(cid, events, key, value, deviation, witnesses, *, category="3-way match, invoice after GR",
            measurement_reason=None, reason="evaluated"):
        start = len(rows)
        for label, day, actor, amount in events:
            stamp = day if isinstance(day, str) else (datetime(2018, 1, 1) + timedelta(days=day)).isoformat()
            rows.append([cid, "boundary-" + cid, "00010", category, "TRUE", "TRUE", "Standard", "0000", "Endpoints",
                         label, stamp, actor, amount])
        expected[cid] = {"criterion": key, "value": value, "deviation": deviation,
                         "positions": tuple(start + offset for offset in witnesses),
                         "reason": reason, "measurement_reason": measurement_reason}
    observation = ("Fixture observation", 0, "batch_1", 100)
    # All exact activity selectors, binary zero/positive, independent of source catalogue.
    binary = [
        ("c_l1_invoice_present", "Vendor creates invoice", 1, 0, "3-way match, invoice after GR"),
        ("c_l1_clear_invoice_present", "Clear Invoice", 1, 0, "3-way match, invoice after GR"),
        ("c_l1_goods_or_ses_present", "Record Service Entry Sheet", 1, 0, "3-way match, invoice after GR"),
        ("c_l2_2way_no_goods_expected", "Record Goods Receipt", 0, 1, "2-way match"),
        ("c_l2_consignment_no_clear_invoice", "Clear Invoice", 0, 1, "Consignment"),
        ("c_l5_cancel_invoice_receipt", "Cancel Invoice Receipt", 0, 1, "3-way match, invoice after GR"),
        ("c_l5_cancel_goods_receipt", "Cancel Goods Receipt", 0, 1, "3-way match, invoice after GR"),
        ("c_l5_delete_item", "Delete Purchase Order Item", 0, 1, "3-way match, invoice after GR"),
        ("c_l5_debit_memo", "Vendor creates debit memo", 0, 1, "3-way match, invoice after GR"),
        ("c_l5_credit_memo", "Vendor creates credit memo", 0, 1, "3-way match, invoice after GR"),
    ]
    for index, (key, label, absent, present, category) in enumerate(binary):
        for count, deviation in ((0, absent), (1, present)):
            add(f"binary-{index}-{count}", [observation] + [(label, 1, "batch_1", 100)] * count,
                key, count, deviation, (1,) if count else (), category=category)
    count_cases = [
        ("c_l4_goods_fragmentation", "Record Goods Receipt", (2, 3, 5), (0, 1 / 3, 1)),
        ("c_l4_change_approval_repeats", "Change Approval for Purchase Order", (0, 1, 2), (0, .5, 1)),
        ("c_l4_repeated_invoice_receipt", "Record Invoice Receipt", (1, 2, 3), (0, .5, 1)),
        ("c_l4_change_payment_terms_repeats", "Change Payment Terms", (0, 1, 2), (0, .5, 1)),
        ("c_l6_change_price", "Change Price", (0, 1, 2), (0, .5, 1)),
        ("c_l6_change_quantity", "Change Quantity", (0, 1, 2), (0, .5, 1)),
    ]
    for index, (key, label, counts, deviations) in enumerate(count_cases):
        for count, deviation in zip(counts, deviations):
            add(f"count-{index}-{count}", [observation] + [(label, n + 1, "batch_1", 100) for n in range(count)],
                key, count, deviation, tuple(range(1, count + 1)))
    for index, (key, endpoint, category) in enumerate([
        ("c_l2_df1_invoice_after_goods", "Vendor creates invoice", "3-way match, invoice after GR"),
        ("c_l2_df2_release_after_goods", "Remove Payment Block", "3-way match, invoice before GR"),
    ]):
        for offset, observed, deviation in ((-1, 1, 1), (0, 0, 0), (1, 0, 0)):
            add(f"order-{index}-{offset}", [("Record Goods Receipt", 2, "batch_1", 100), (endpoint, 2 + offset, "batch_1", 100)],
                key, observed, deviation, (0, 1), category=category)
    intervals = [
        ("c_l3_df1_goods_to_invoice_days", "Record Goods Receipt", "Vendor creates invoice", (10, 20, 30), "3-way match, invoice after GR"),
        ("c_l3_invoice_to_clear_days", "Vendor creates invoice", "Clear Invoice", (30, 60, 90), "3-way match, invoice after GR"),
        ("c_l3_df2_goods_to_rpb_days", "Record Goods Receipt", "Remove Payment Block", (2, 7, 12), "3-way match, invoice before GR"),
        ("c_l3_df2_rpb_to_clear_days", "Remove Payment Block", "Clear Invoice", (5, 15, 25), "3-way match, invoice before GR"),
    ]
    for index, (key, first, last, days, category) in enumerate(intervals):
        for lag, deviation in zip(days, (0, .5, 1)):
            add(f"lag-{index}-{lag}", [(first, 0, "batch_1", 100), (last, lag, "batch_1", 100)],
                key, lag, deviation, (0, 1), category=category)
        # Independent minima keep reversed raw differences and zero-length ties.
        add(f"reverse-{index}", [(first, 2, "batch_1", 100), (last, 1, "batch_1", 100)], key, None, None, (0, 1),
            category=category, measurement_reason="reversed_interval", reason="missing_attribute")
        add(f"tie-{index}", [(first, 0, "batch_1", 100), (last, 0, "batch_1", 100)], key, 0, 0, (0, 1), category=category)
        add(f"missing-first-{index}", [(last, 1, "batch_1", 100)], key, None, None, (0,),
            category=category, measurement_reason="no_parsed_endpoint", reason="missing_attribute")
        add(f"missing-last-{index}", [(first, 0, "batch_1", 100)], key, None, None, (0,),
            category=category, measurement_reason="no_parsed_endpoint", reason="missing_attribute")
        add(f"bad-first-{index}", [(first, "bad-time", "batch_1", 100), (last, 1, "batch_1", 100)], key, None, None, (1,),
            category=category, measurement_reason="no_parsed_endpoint", reason="missing_attribute")
        add(f"tie-minima-{index}", [(first, 0, "batch_1", 100), (first, 0, "batch_1", 100),
            (last, 0, "batch_1", 100), (last, 0, "batch_1", 100)], key, 0, 0, (0, 1, 2, 3), category=category)
    for count, deviation in ((4, 0), (7, .5), (10, 1)):
        add(f"manual-{count}", [("Fixture observation", n, "source_human", 100) for n in range(count)],
            "c_l7_manual_touches", count, deviation, tuple(range(count)))
    for count, deviation in ((2, 0), (4, .5), (6, 1)):
        add(f"actors-{count}", [("Fixture observation", n, f"source_human_{n}", 100) for n in range(count)],
            "c_l7_distinct_human_resources", count, deviation, tuple(range(count)))
    for count, deviation in ((10, 0), (17, 7 / 15), (25, 1)):
        add(f"events-{count}", [("Fixture observation", n, "batch_1", 100) for n in range(count)],
            "c_l7_total_events", count, deviation, tuple(range(count)))
    for human, deviation in ((2, 0), (3, .5), (4, 1)):
        add(f"share-{human}", [("Fixture observation", n, "source_human" if n < human else "batch_1", 100) for n in range(4)],
            "c_l7_manual_share", human / 4, deviation, tuple(range(human)))
    for index, (key, label) in enumerate([("c_l6_high_exposure_memo", "Vendor creates debit memo"),
                                          ("c_l6_high_exposure_price_change", "Change Price")]):
        for amount, product in ((0, 0), (50, .5), (100, 1)):
            add(f"product-{index}-{amount}", [(label, 0, "batch_1", amount)], key, product, product, (0,))
    for cv, deviation in ((.5, 0), (1, .5), (1.5, 1)):
        add(f"cv-{cv}", [("Fixture observation", 0, "batch_1", 1 - cv / math.sqrt(2)),
                          ("Fixture observation", 1, "batch_1", 1 + cv / math.sqrt(2))],
            "c_l6_bal_networth_volatility", cv, deviation, (0, 1))
    # Original raw spelling is significant to distinctness, while historical
    # classification trims/lowercases and uses a batch PREFIX, not a full regex.
    actors = ("user_1", " User_1 ", "UNKNOWN", "batchworker", "", "NaN", "None", "null")
    add("actor-raw-identities", [("Fixture observation", n, actor, 100) for n, actor in enumerate(actors)],
        "c_l7_distinct_human_resources", 3, .25, (0, 1, 2))
    add("singular-payment", [observation, ("Change payment term", 1, "batch_1", 100)],
        "c_l4_change_payment_terms_repeats", 0, 0, ())
    add("unavailable-label", [("Record Invoice Receipt", 0, "batch_1", 100), ("", 1, "batch_1", 100)],
        "c_l1_invoice_present", None, None, (0,), measurement_reason="missing_activity_label", reason="missing_attribute")
    add("sentinel-historical", [("Vendor creates invoice", "1948-01-01T00:00:00", "batch_1", 100),
                                ("Clear Invoice", "1948-01-02T00:00:00", "batch_1", 100)],
        "c_l3_invoice_to_clear_days", 1, 0, (0, 1))
    return rows, expected


def test_each_selector_positive_saturation_missing_reversed_tied_and_legacy_states_through_tcp(tcp):
    client, folder = tcp
    rows, expected = boundary_rows_and_oracle()
    assert len({value["criterion"] for value in expected.values()}) == 29
    wid, identity, raw = prepare_tcp(client, folder, "raw-boundaries", rows)
    responses = {}
    for view in VIEWS:
        answer, cases = scored(client, score_request(wid, identity, view))
        assert set(cases) == set(expected)
        for case_id, oracle in expected.items():
            assert_cell(cases[case_id], oracle["criterion"], raw, oracle["value"], oracle["deviation"], oracle["positions"],
                        reason=oracle["reason"], measurement_reason=oracle["measurement_reason"])
        # Both empirical orderings of tied independent minima retain EVERY
        # minimum witness. A reversed elapsed difference stays unavailable.
        for index in range(4):
            key = ("c_l3_df1_goods_to_invoice_days", "c_l3_invoice_to_clear_days",
                   "c_l3_df2_goods_to_rpb_days", "c_l3_df2_rpb_to_clear_days")[index]
            assert cell(cases[f"reverse-{index}"], key)["measurement_evidence"]["recorded_difference_days"] == -1
            reverse = expected[f"reverse-{index}"]["positions"]
            reverse_evidence = cell(cases[f"reverse-{index}"], key)["measurement_evidence"]
            assert reverse_evidence["activation_row_ids"] == literal_row_ids(raw, reverse[:1])
            assert reverse_evidence["response_row_ids"] == literal_row_ids(raw, reverse[1:])
            tied = expected[f"tie-minima-{index}"]["positions"]
            tie_evidence = cell(cases[f"tie-minima-{index}"], key)["measurement_evidence"]
            assert tie_evidence["activation_row_ids"] == literal_row_ids(raw, tied[:2])
            assert tie_evidence["response_row_ids"] == literal_row_ids(raw, tied[2:])
        assert answer["report"]["selector_warnings"][0]["observed_occurrence_count"] == 1
        responses[view] = answer
    # Independent global cutoff: seven commercial/CV cases have maxabs<100;
    # the other 98 of 105 have maxabs=100. At sorted position 98.8, both
    # bracketing values are therefore exactly 100.
    measures = client.post("/api/investigations/bpic19-measures", json=envelope("bpic19_measures_request", workspace_id=wid,
        identity=identity, query={"policy_id": "bpic19.source_witnessed_measures.v1", "measure_profile": "historical_v1",
        "roles": ROLES, "offset": 0, "limit": 200, "calibration_population": "parent"}))
    assert measures.status_code == 200, measures.text
    assert measures.json()["definition"]["calibration"]["quantile"] == 100
    proof_file("raw-boundaries.json", {"identity": identity, "source_sha256": hashlib.sha256(raw).hexdigest(),
        "original_rows": rows, "roles": ROLES, "literal_oracle": expected, "responses": responses,
        "case_count": len(expected), "record_count": len(rows), "all_29_target_bindings_checked": True,
        "calibration": measures.json()["definition"]["calibration"]})


def test_separate_prepared_attribute_arithmetic_retains_native_all_view_contribution_oracle():
    """Internal-only arithmetic; never an original-event or public-HTTP proof."""
    from wise_platform_api.bpic19_method import evaluate_features

    measures = {"invoice_count": 1, "clearing_count": 1, "receipt_count": 1,
                "invoice_to_clearing_days": 0, "invoice_precedes_receipt": 0,
                "cancellation_count": 0, "edit_count": 0, "user_event_count": 2,
                "distinct_user_count": 1, "creation_value": 10, "exposure": 10}
    historical = {"historical_invoice_precedes_receipt": 1, "historical_release_precedes_receipt": 0,
        "historical_goods_to_invoice_days": 20, "historical_invoice_to_clear_days": 60,
        "historical_goods_to_release_days": 0, "historical_release_to_clear_days": 0,
        "historical_manual_touch_count": 7, "historical_distinct_human_resources": 4,
        "historical_manual_share": .75, "historical_networth_cv": 1,
        "historical_memo_exposure": .25, "historical_price_exposure": .25}
    feature = {"case_id": "separate-arithmetic-DF1", "flow": "DF1", "company": "0000", "spend_area": "Arithmetic",
        "document": "prepared-attributes", "record_count": 25,
        "activity_counts": {"Record Invoice Receipt": 1, "Clear Invoice": 1, "Record Goods Receipt": 1,
            "Create Purchase Order Item": 1, "Change Price": 1, "Change Quantity": 1, "Vendor creates debit memo": 1},
        "measures": {key: {"value": value, "available": True, "reason": None, "row_ids": ["prepared:" + key]}
                     for key, value in measures.items()},
        "historical_measures": {key: {"value": value, "available": True, "reason": None, "row_ids": ["prepared:" + key]}
                                for key, value in historical.items()}}
    layers = [0, 1, .5, 0, 1.3 / 5.7, 2.35 / 5.8, 2.7 / 4.4]
    actual = {}
    for view, weights in VIEWS.items():
        assessment = evaluate_features([feature], profile="historical", view=view, mode="layer_balanced")
        case = assessment.case(feature["case_id"])
        assert len(case["criteria"]) == 29 and case["coverage"] == 1
        assert_number(case["score"], 1 - sum(p * w for p, w in zip(layers, weights)))
        assert_number(sum(criterion["penalty"] or 0 for criterion in case["criteria"]), 1 - case["score"])
        actual[view] = case
    proof_file("prepared-arithmetic-internal-only.json", {"literal_layer_penalties": layers, "features": [feature], "cases": actual,
        "proof_scope": "actual packed native Method, direct adapter call only; NOT HTTP or physically consistent source events",
        "unmet_conjunction": "No public full29 prepared-attribute request seam is admitted; no route or norm was added."})
