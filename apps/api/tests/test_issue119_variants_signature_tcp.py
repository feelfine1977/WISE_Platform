"""#119 exact variants and the first-occurrence signature, at public HTTP.

Expected values are written from the rows below by hand. Source positions are one-based, as in rows():
L 1 A, 2 B, 3 B, 4 A (a loop); T 5 A, 6 B, 7 B at the same instant as 6; X 8 A, 9 X, 10 B; U 11 A, 12 B with an
unparseable time; V 13 A, 14 a blank label (and a blank category).
"""

from copy import deepcopy
import hashlib
import json
import socket

from fastapi.testclient import TestClient

from wise_platform_api.app import create_app
from import_requests import envelope
from literal_profile_columns import with_profile_columns
from test_bpic19_measures_http import ROUTE, VALIDATOR, prepare_source, request
from test_bpic19_pipeline_http import start_process

ROWS = [("L", "A", "2018-01-01T00:00:00"), ("L", "B", "2018-01-02T00:00:00"), ("L", "B", "2018-01-03T00:00:00"), ("L", "A", "2018-01-04T00:00:00"),
        ("T", "A", "2018-01-01T00:00:00"), ("T", "B", "2018-01-02T00:00:00"), ("T", "B", "2018-01-02T00:00:00"),
        ("X", "A", "2018-01-01T00:00:00"), ("X", "X", "2018-01-02T00:00:00"), ("X", "B", "2018-01-03T00:00:00"),
        ("U", "A", "2018-01-01T00:00:00"), ("U", "B", "not-a-time"),
        ("V", "A", "2018-01-01T00:00:00"), ("V", "", "2018-01-02T00:00:00")]
CATEGORY = {"V": ""}
LITERAL = with_profile_columns(("case,activity,time,case Item Category,event org:resource,event Cumulative net worth (EUR),case Purchasing Document,case Company,case Spend area text\n"
           + "".join(f'{case},{activity},{time},"{CATEGORY.get(case, "3-way match, invoice after GR")}",user_1,10,D{case},1,Packaging\n'
                     for case, activity, time in ROWS)).encode())


def rows():
    source_id = "source.v1:sha256:" + hashlib.sha256(LITERAL).hexdigest()
    return {position: "row.v1:sha256:" + hashlib.sha256(json.dumps({"format_version": 1, "source_id": source_id,
            "source_position": position - 1}, sort_keys=True, separators=(",", ":")).encode()).hexdigest() for position in range(1, len(ROWS) + 1)}


def measured(client, wid, identity, **query):
    given = request(wid, identity)
    given["query"].update({"limit": 100, **query})
    response = client.post(ROUTE, json=given)
    assert response.status_code == 200, response.text
    VALIDATOR.validate(response.json())
    return given, response.json(), {case["case_id"]: case for case in response.json()["cases"]}


def test_t17_exact_variants_keep_repeats_and_the_signature_names_what_it_suppresses(tmp_path):
    folder = tmp_path / "workspace"; folder.mkdir()
    r = rows()
    with TestClient(create_app()) as client:
        wid, base = prepare_source(client, folder, LITERAL)
        _, answer, cases = measured(client, wid, base)
        loop = cases["L"]["representations"]
        # 17-B01/B02: the exact path keeps the repeated B and the returning A; the signature keeps first occurrences.
        assert (loop["exact_sequence"], loop["first_occurrence_signature"]) == (["A", "B", "B", "A"], ["A", "B"])
        assert (loop["signature_retained_row_ids"], loop["signature_suppressed_row_ids"]) == ([r[1], r[2]], [r[3], r[4]])
        tie = cases["T"]["representations"]
        assert (tie["exact_sequence"], tie["first_occurrence_signature"], tie["signature_suppressed_row_ids"]) == (["A", "B", "B"], ["A", "B"], [r[7]])
        assert loop["exact_representation_id"] != loop["signature_representation_id"]
        # 17-B04: grouping keeps whole items and their full record counts.
        exact = {tuple(group["sequence"]): group for group in answer["representation_groups"]["exact"]}
        signature = {tuple(group["sequence"]): group for group in answer["representation_groups"]["first_occurrence"]}
        assert (exact[("A", "B", "B", "A")]["case_ids"], exact[("A", "B", "B", "A")]["record_count"]) == (["L"], 4)
        assert (sorted(signature[("A", "B")]["case_ids"]), signature[("A", "B")]["record_count"]) == (["L", "T"], 7)
        assert exact[("A", "X", "B")]["case_ids"] == ["X"]
        # T17-AC05: an unparseable time leaves U's order unknown and a blank label leaves V's path unavailable;
        # both stay in the population and V's blank category is not read from its path.
        assert (cases["U"]["representations"]["available"], cases["U"]["representations"]["reason"]) == (False, "order_unknown")
        assert (cases["V"]["representations"]["available"], cases["V"]["representations"]["reason"]) == (False, "missing_activity_label")
        assert sorted(answer["representation_unavailable_case_ids"]) == ["U", "V"]
        assert (cases["V"]["flow"], cases["V"]["context"]["item_category"]["reason"]) == (None, "missing_case_attribute")
        assert answer["population_case_count"] == 5 and cases["U"]["record_row_ids"] == [r[11], r[12]]


def test_t17_identities_and_unadmitted_transformations(tmp_path):
    folder = tmp_path / "workspace"; folder.mkdir()
    with TestClient(create_app()) as client:
        wid, base = prepare_source(client, folder, LITERAL)
        given, exact, _ = measured(client, wid, base, representation_policy="exact")
        _, signature, _ = measured(client, wid, base, representation_policy="first_occurrence")
        # T17-AC07: the representation is part of the definition; a page is not.
        assert exact["definition_id"] != signature["definition_id"]
        _, page, _ = measured(client, wid, base, representation_policy="exact", offset=2, limit=2)
        assert page["definition_id"] == exact["definition_id"]
        # T17-AC03 and AC07: omission and same-time collapse are not admitted here; they are refused by name and no
        # projected passage is returned.
        for policy in ("selected_label_omission", "adjacent_same_label_same_time"):
            bad = deepcopy(given)
            bad["query"]["representation_policy"] = policy
            refused = client.post(ROUTE, json=bad)
            assert (refused.status_code, refused.json()["code"], refused.json()["field"]) == (400, "unsupported_definition", "query.representation_policy"), refused.text
            assert "representation_groups" not in refused.json()
        # The core answer is unaffected.
        assert client.post(ROUTE, json=given).json()["representation_groups"] == exact["representation_groups"]


def test_t17_saved_exact_and_signature_answers_survive_a_different_process(tmp_path):
    with socket.socket() as reserving:
        reserving.bind(("127.0.0.1", 0))
        port = reserving.getsockname()[1]
    folder = tmp_path / "workspace"; folder.mkdir()
    first, client = start_process(port)
    try:
        wid, base = prepare_source(client, folder, LITERAL)
        exact_query, exact, _ = measured(client, wid, base, representation_policy="exact")
        signature_query, signature, _ = measured(client, wid, base, representation_policy="first_occurrence")
        selected = client.post("/api/investigations/select-cases", json=envelope("select_cases_request", workspace_id=wid,
            identity=base, parent_case_ids=None, predicates=[])).json()
        actions = [{"operation": "bpic19_measures", "identity": base, "query": query["query"], "definition_id": answer["definition_id"]}
                   for query, answer in ((exact_query, exact), (signature_query, signature))]
        saved = client.post("/api/investigations/save", json=envelope("save_investigation_request", workspace_id=wid,
            investigation_id=None, expected_revision_id=None, name="Exact and signature", base_identity=base,
            selection_identity=selected["identity"], selection_recipe={"parent_case_ids": selected["parent"]["case_ids"], "predicates": []},
            context_policy="incident.context.first_record_in_declared_order.v1", comparison=None, notes="Synthetic T17 rows",
            bookmarks=[], bpic19_pipeline={"schema_version": 1, "actions": actions}))
        assert saved.status_code == 200, saved.text
        saved = saved.json()
    finally:
        first.terminate()
        first.wait(timeout=15)
    assert first.returncode is not None
    second, fresh = start_process(port)
    try:
        assert second.pid != first.pid
        assert fresh.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(folder))).status_code == 200
        reopened = fresh.post("/api/investigations/reopen", json=envelope("reopen_investigation_request",
            workspace_id=wid, saved_revision_id=saved["revision"]["saved_revision_id"]))
        assert reopened.status_code == 200, reopened.text
        assert reopened.json()["bpic19_outputs"] == saved["bpic19_outputs"]
        # T17-AC06: the loop's suppressed rows and both recipes come back exactly.
        outputs = [output["output"] for output in reopened.json()["bpic19_outputs"]["outputs"]]
        assert [output["definition"]["representation_policy"] for output in outputs] == ["exact", "first_occurrence"]
        loop = next(case for case in outputs[0]["cases"] if case["case_id"] == "L")["representations"]
        r = rows()
        assert (loop["exact_sequence"], loop["signature_suppressed_row_ids"]) == (["A", "B", "B", "A"], [r[3], r[4]])
    finally:
        second.terminate()
        second.wait(timeout=15)
