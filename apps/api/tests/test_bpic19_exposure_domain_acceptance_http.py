"""Literal original-event T27 controls over real TCP and packed native Method.

These controls cover admitted recipes only. They do not admit first-creation,
event/receipt sums, historical rank-first qcut, a built browser or full-source
capacity. Expected source positions, cells, amounts and grades are literal.
"""
import csv
import hashlib
import io
import json
import math
import socket

import httpx
import pytest

from import_requests import envelope
from test_bpic19_pipeline_http import start_process
from test_bpic19_scoring_http import prepare, given, ROLES


HEADERS = ["case concept:name", "case Purchasing Document", "case Item", "case Item Category",
           "case Goods Receipt", "case GR-Based Inv. Verif.", "case Item Type", "case Company",
           "case Spend area text", "event concept:name", "event time:timestamp", "event org:resource",
           "event Cumulative net worth (EUR)"]


def original_csv(rows):
    stream = io.StringIO(newline="")
    writer = csv.writer(stream)
    writer.writerow(HEADERS)
    writer.writerows(rows)
    return stream.getvalue().encode()


def event(case, document, item, activity, day, value):
    return [case, document, item, "3-way match, invoice after GR", "TRUE", "TRUE", "Standard",
            case, "Literal exposure", activity, f"2018-01-{day:02}T00:00:00Z", "batch_1", value]


def row_ids(raw, positions):
    source = "source.v1:sha256:" + hashlib.sha256(raw).hexdigest()
    return ["row.v1:sha256:" + hashlib.sha256(json.dumps(
        {"format_version": 1, "source_id": source, "source_position": position},
        sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()
        for position in positions]


@pytest.fixture
def tcp(tmp_path):
    folder = tmp_path / "workspace"; folder.mkdir()
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0)); port = sock.getsockname()[1]
    process, _ = start_process(port)
    with httpx.Client(base_url=f"http://127.0.0.1:{port}", timeout=30) as client:
        try:
            yield client, folder
        finally:
            process.terminate(); process.wait(timeout=15)
    assert process.returncode is not None, "The owned actual HTTP process must exit."


def select(client, wid, base, ids, parent):
    response = client.post("/api/investigations/select-cases", json=envelope(
        "select_cases_request", workspace_id=wid, identity=base, parent_case_ids=parent,
        predicates=[] if ids is None else [{"kind": "case_id_in", "case_ids": ids, "negate": False}]))
    assert response.status_code == 200, response.text
    return response.json()


def measures(client, wid, identity, reducer="unique_creation_value", edges=()):
    query = {"policy_id": "bpic19.source_witnessed_measures.v1", "measure_profile": "paper_v1",
             "roles": ROLES, "offset": 0, "limit": 100, "value_reducer": reducer,
             "value_unit": "EUR", "calibration_population": "selected", "value_band_edges": list(edges)}
    response = client.post("/api/investigations/bpic19-measures", json=envelope(
        "bpic19_measures_request", workspace_id=wid, identity=identity, query=query))
    assert response.status_code == 200, response.text
    answer = response.json()
    return answer, {"definition_id": answer["definition_id"], "identity": identity, "query": query}


def score(client, wid, base, identity, reference=None, **settings):
    request = given(wid, base, **settings)
    request["named_population"] = {"name": "Literal original exposure items", "identity": identity}
    if reference is not None:
        request["exposure_review"] = reference
    response = client.post("/api/investigations/bpic19-score", json=request)
    assert response.status_code == 200, response.text
    return response.json()


def history(client, wid, identity, case):
    response = client.post("/api/investigations/case-evidence", json=envelope(
        "imported_case_evidence_request", workspace_id=wid, identity=identity, case_id=case))
    assert response.status_code == 200, response.text
    return response.json()["records"]


def test_ac06_exact_three_observations_total_fifty_is_not_creation_document_thirty(tcp):
    client, folder = tcp
    rows = [event("A", "D", "00010", "Create Purchase Order Item", 1, 10),
            event("A", "D", "00010", "Record Goods Receipt", 2, 10),
            event("A", "D", "00010", "Record Invoice Receipt", 3, 10),
            event("B", "D", "00020", "Create Purchase Order Item", 1, 20)]
    raw = original_csv(rows)
    assert sum(row[12] for row in rows) == 50  # Diagnostic arithmetic, not an admitted event-sum recipe.
    wid, base = prepare(client, folder, raw)
    parent = select(client, wid, base, None, ["A", "B"])["identity"]
    _, reference = measures(client, wid, parent)
    count = score(client, wid, base, parent)
    exposure = score(client, wid, base, parent, reference, volume="exposure", exposure_policy="creation_unique_value")
    cases = {case["case_id"]: case for case in exposure["report"]["case_page"]["cases"]}
    assert set(cases) == {"A", "B"}
    # DF1 includes C05: A's known invoice-after-receipt observation is healthy,
    # while B has neither endpoint. A evaluates9 criteria (only C02 violated);
    # B evaluates8 (C01–C03 violated). C04 is unavailable for both.
    assert {key: case["score"] for key, case in cases.items()} == pytest.approx({"A": 8/9, "B": 5/8}, abs=1e-8)
    assert [case["score"] for case in count["report"]["case_page"]["cases"]] == pytest.approx([8/9, 5/8], abs=1e-8)
    assert count["report"]["mean_score"] == exposure["report"]["mean_score"] == pytest.approx(109/144, abs=1e-8)
    document = exposure["report"]["documents"]
    assert len(document) == 1 and document[0]["document"] == "D"
    assert document[0]["n_cases"] == document[0]["member_count"] == 2
    assert document[0]["volume"] == 30 and document[0]["volume"] != 50
    assert cases["A"]["value_evidence"]["creation_value"]["value"] == 10
    assert cases["B"]["value_evidence"]["creation_value"]["value"] == 20
    assert cases["A"]["value_evidence"]["creation_value"]["row_ids"] == row_ids(raw, [0])
    assert cases["B"]["value_evidence"]["creation_value"]["row_ids"] == row_ids(raw, [3])
    for cid, positions in [("A", [0, 1, 2]), ("B", [3])]:
        records = history(client, wid, base, cid)
        assert [record["row_id"] for record in records] == row_ids(raw, positions)
        assert [record["original_cells"] for record in records] == [[str(cell) for cell in rows[i]] for i in positions]
    assert exposure["report"]["exposure_calibration"]["value_reducer"] == "unique_creation_value"
    # Unknown source methods cannot silently inherit the successful creation result.
    unsupported = {**reference["query"], "value_reducer": "event_sum"}
    refused = client.post("/api/investigations/bpic19-measures", json=envelope(
        "bpic19_measures_request", workspace_id=wid, identity=parent, query=unsupported))
    assert refused.status_code == 400 and refused.json()["code"] == "unsupported_definition"


def test_ac07_five_equal_items_keep_one_fixed_band_preserves_native_grades_and_full_fit(tcp):
    client, folder = tcp
    # Five equal10 items, plus an explicit outside20 control: the full P95 is
    # 10 + .75*(20-10) =17.5; silently refitting the kept five would yield10.
    ids = ["A", "B", "C", "D", "E", "Z"]
    rows = [event(cid, cid, "00010", activity, day, 20 if cid == "Z" else 10)
            for cid in ids for activity, day in [("Create Purchase Order Item", 1), ("Record Goods Receipt", 2),
                                                ("Record Invoice Receipt", 3), ("Clear Invoice", 4)]]
    raw = original_csv(rows); wid, base = prepare(client, folder, raw)
    parent = select(client, wid, base, None, ids)["identity"]
    raw_values, reference = measures(client, wid, parent, "maximum_absolute_event_value", [5, 15])
    assert [band["case_ids"] for band in raw_values["value_bands"]] == [[], ["A", "B", "C", "D", "E"], ["Z"]]
    assert raw_values["value_band_unavailable_case_ids"] == []
    assert raw_values["definition"]["value_band_edges"] == [5, 15]
    full = score(client, wid, base, parent, reference, volume="exposure", exposure_policy="max_absolute_p95")
    receipt = full["report"]["exposure_calibration"]
    assert receipt["cutoff"] == 17.5 and receipt["population_case_ids"] == ids
    assert receipt["population_identity"] == receipt["fit_population_identity"] == parent
    assert receipt["quantile_method"] == "linear"
    assert receipt["value_row_ids"] == row_ids(raw, range(24))
    assert all(case["score"] == 1 for case in full["report"]["case_page"]["cases"])
    kept = select(client, wid, base, raw_values["value_bands"][1]["case_ids"], ids)
    assert kept["kept"]["case_ids"] == ["A", "B", "C", "D", "E"]
    assert kept["kept"]["record_count"] == 20
    child = score(client, wid, base, kept["identity"], reference, volume="exposure", exposure_policy="max_absolute_p95")
    assert child["report"]["exposure_calibration"] == receipt
    assert child["report"]["exposure_calibration"]["cutoff"] != 10
    assert child["report"]["population_case_count"] == child["report"]["scored_case_count"] == 5
    full_cases = {case["case_id"]: case for case in full["report"]["case_page"]["cases"]}
    for case in child["report"]["case_page"]["cases"]:
        cid = case["case_id"]; position = ids.index(cid) * 4
        assert case["score"] == 1 and case["criteria"] == full_cases[cid]["criteria"]
        assert case["record_row_ids"] == row_ids(raw, range(position, position + 4))
        assert case["value_evidence"]["exposure"]["row_ids"] == row_ids(raw, range(position, position + 4))
    assert all(group["volume"] == pytest.approx(4/7, abs=1e-8) for group in child["report"]["groups"])
    assert child["definition"]["exposure_review"] == full["definition"]["exposure_review"]
    assert child["definition_id"] == full["definition_id"] and child["run_id"] != full["run_id"]
    # This proves the admitted tie-preserving fixed-band branch, not qcut.


def test_ac05_historical_missing_fill_is_labelled_and_original_missing_rows_remain_exact(tcp):
    client, folder = tcp
    rows = [event("A", "A", "00010", activity, day, "") for activity, day in [
        ("Create Purchase Order Item", 1), ("Record Goods Receipt", 2), ("Record Invoice Receipt", 3),
        ("Clear Invoice", 4), ("Cancel Invoice Receipt", 5)]]
    rows += [event("B", "B", "00020", activity, day, 20) for activity, day in [
        ("Create Purchase Order Item", 1), ("Record Goods Receipt", 2), ("Record Invoice Receipt", 3), ("Clear Invoice", 4)]]
    raw = original_csv(rows); wid, base = prepare(client, folder, raw)
    parent = select(client, wid, base, None, ["A", "B"])["identity"]
    _, reference = measures(client, wid, parent, "maximum_absolute_event_value")
    historical = score(client, wid, base, parent, reference, profile="historical", view="Finance",
                       mode="layer_balanced", volume="exposure", exposure_policy="max_absolute_p95")
    receipt = historical["report"]["exposure_calibration"]
    assert receipt["missing_policy"] == receipt["source_value_missing_policy"] == "source_compatible_fill_zero"
    assert receipt["missing_case_count"] == 1 and receipt["invalid_case_count"] == 0
    assert receipt["quantile"] == receipt["denominator"] == 19
    assert receipt["source_field"] == 12 and receipt["source_unit"] == "EUR"
    assert receipt["population_case_ids"] == ["A", "B"] and receipt["fit_population_identity"] == parent
    assert historical["report"]["scored_case_count"] == 2
    cases = {case["case_id"]: case for case in historical["report"]["case_page"]["cases"]}
    assert all(math.isfinite(case["score"]) for case in cases.values())
    assert cases["A"]["value_evidence"]["exposure"]["available"] is False
    assert cases["A"]["value_evidence"]["exposure"]["value"] is None  # No claimed raw zero.
    assert cases["A"]["value_evidence"]["exposure"]["row_ids"] == row_ids(raw, [0, 1, 2, 3, 4])
    assert cases["B"]["value_evidence"]["exposure"]["value"] == 20
    assert cases["B"]["value_evidence"]["exposure"]["row_ids"] == row_ids(raw, [5, 6, 7, 8])
    groups = {row["company"]: row for row in historical["report"]["groups"]}
    assert groups["A"]["volume"] == 0 and groups["B"]["volume"] == 1
    original = history(client, wid, base, "A")
    assert [row["row_id"] for row in original] == row_ids(raw, [0, 1, 2, 3, 4])
    assert [row["source_position"] for row in original] == [0, 1, 2, 3, 4]
    assert [row["original_cells"] for row in original] == [[str(cell) for cell in record] for record in rows[:5]]
    assert all(row["original_cells"][12] == "" for row in original)
    # Reviewed paper maxabs cannot inherit the historical missing→zero policy.
    request = given(wid, base, volume="exposure", exposure_policy="max_absolute_p95")
    request["named_population"]["identity"] = parent; request["exposure_review"] = reference
    refused = client.post("/api/investigations/bpic19-score", json=request)
    assert refused.status_code == 409 and refused.json()["code"] == "exposure_unavailable"
