"""#109 independent-minimum interval endpoints and their distribution comparison, at public HTTP.

Expected values are written from the rows below by hand. Source positions are one-based, as in rows():
A 1 IR Jan 1, 2 CI Jan 2, 3 IR Jan 3, 4 CI Jan 10; G 5 GR Jan 3, 6 SES Jan 2, 7 CI Jan 5;
R 8 IR Jan 5, 9 CI Jan 3 (reversed); O 10 IR 2016-12-30, 11 CI 2017-01-02 (source before the 2017 gate);
Z 12 IR and 13 CI at the same instant; T 14 and 15 IR Jan 1 (co-minima), 16 CI Jan 4. All 2018 unless stated.
"""

from copy import deepcopy
import hashlib
import json
from pathlib import Path
import socket

from fastapi.testclient import TestClient

from wise_platform_api.app import create_app
from import_requests import envelope
from test_bpic19_measures_http import ROUTE as MEASURES, VALIDATOR as MEASURES_SCHEMA, prepare_source, request
from test_bpic19_pipeline_http import start_process

IR, CI, GR, SES = "Record Invoice Receipt", "Clear Invoice", "Record Goods Receipt", "Record Service Entry Sheet"
ROWS = [("A", IR, "2018-01-01T00:00:00"), ("A", CI, "2018-01-02T00:00:00"), ("A", IR, "2018-01-03T00:00:00"), ("A", CI, "2018-01-10T00:00:00"),
        ("G", GR, "2018-01-03T00:00:00"), ("G", SES, "2018-01-02T00:00:00"), ("G", CI, "2018-01-05T00:00:00"),
        ("R", IR, "2018-01-05T00:00:00"), ("R", CI, "2018-01-03T00:00:00"),
        ("O", IR, "2016-12-30T00:00:00"), ("O", CI, "2017-01-02T00:00:00"),
        ("Z", IR, "2018-01-01T10:00:00"), ("Z", CI, "2018-01-01T10:00:00"),
        ("T", IR, "2018-01-01T00:00:00"), ("T", IR, "2018-01-01T00:00:00"), ("T", CI, "2018-01-04T00:00:00")]
LITERAL = ("case,activity,time,case Item Category,event org:resource,event Cumulative net worth (EUR),case Purchasing Document,case Company,case Spend area text\n"
           + "".join(f"{case},{activity},{time},,user_1,10,D{case},1,Packaging\n" for case, activity, time in ROWS)).encode()
COMPARE = "/api/investigations/bpic19-interval-comparison"
BROWSER_ANSWER = Path(__file__).resolve().parents[3] / "apps/web/src/bpic19/t07-interval-answer.json"
BROWSER_REFERENCE_PAGE = BROWSER_ANSWER.with_name("t07-interval-reference-page.json")


def rows():
    source_id = "source.v1:sha256:" + hashlib.sha256(LITERAL).hexdigest()
    return {position: "row.v1:sha256:" + hashlib.sha256(json.dumps({"format_version": 1, "source_id": source_id,
            "source_position": position - 1}, sort_keys=True, separators=(",", ":")).encode()).hexdigest() for position in range(1, len(ROWS) + 1)}


def measured(client, wid, identity, **query):
    given = request(wid, identity)
    given["query"].update({"limit": 100, **query})
    response = client.post(MEASURES, json=given)
    assert response.status_code == 200, response.text
    MEASURES_SCHEMA.validate(response.json())
    return {case["case_id"]: case for case in response.json()["cases"]}, response.json()


def comparison_request(wid, identity, target=("A", "T", "Z"), reference=("O", "R"), **changes):
    query = {"policy_id": "bpic19.interval_distribution_comparison.v1", "interval_policy": "independent_minimum",
             "interval_source": [IR], "interval_target": [CI],
             "target": {"label": "Admitted invoice-to-clearing items", "recipe": {"kind": "complete_case_ids", "case_ids": list(target)}},
             "reference": {"label": "Reversed or gated items", "recipe": {"kind": "complete_case_ids", "case_ids": list(reference)}},
             "page": {"role": "target", "offset": 0, "limit": 100}, **changes}
    return envelope("bpic19_interval_comparison_request", workspace_id=wid, identity=identity, query=query)


def compared(client, given):
    response = client.post(COMPARE, json=given)
    assert response.status_code == 200, response.text
    return response.json()


def test_t07_independent_minima_union_selector_reversed_gated_zero_and_co_minima(tmp_path):
    folder = tmp_path / "workspace"; folder.mkdir()
    r = rows()
    with TestClient(create_app()) as client:
        wid, base = prepare_source(client, folder, LITERAL)
        cases, _ = measured(client, wid, base)
        a = cases["A"]
        # T07-AC01: the earliest invoice and the earliest clearing, each chosen on its own; later rows stay visible.
        assert (a["milestones"]["source"]["row_ids"], a["milestones"]["source"]["later_row_ids"]) == ([r[1]], [r[3]])
        assert (a["milestones"]["target"]["row_ids"], a["milestones"]["target"]["later_row_ids"]) == ([r[2]], [r[4]])
        interval = a["measures"]["selected_interval"]
        assert (interval["value"], interval["unit"], interval["interval_state"], interval["recorded_difference_days"]) == (1, "days", "available", 1)
        assert 9 not in (interval["value"], interval["recorded_difference_days"])  # not first-to-last
        assert set(interval) >= {"activation_row_ids", "response_row_ids"} and "cycles" not in interval
        # Reversed: the signed diagnostic stays, the admitted value does not.
        reversed_ = cases["R"]["measures"]["selected_interval"]
        assert (reversed_["value"], reversed_["interval_state"], reversed_["reason"], reversed_["recorded_difference_days"]) == (None, "reversed", "reversed_interval", -2)
        # The 2017 gate applies after the minimum is selected: O's earliest invoice is 2016, so O is unavailable, not moved.
        gated = cases["O"]["milestones"]["source"]
        assert (gated["endpoint_state"], gated["reason"], gated["row_ids"]) == ("out_of_range", "minimum_outside_admissible_range", [r[10]])
        assert (cases["O"]["measures"]["selected_interval"]["value"], cases["O"]["measures"]["selected_interval"]["interval_state"]) == (None, "endpoint_unavailable")
        assert cases["Z"]["measures"]["selected_interval"]["value"] == 0
        tie = cases["T"]["milestones"]["source"]
        assert (tie["row_ids"], tie["selected_row_id"], cases["T"]["measures"]["selected_interval"]["value"]) == ([r[14], r[15]], r[14], 3)
        # T07-AC11: an explicit GR+SES union picks the earlier SES record; it is not narrowed to goods receipts.
        union, answer = measured(client, wid, base, interval_source=[GR, SES])
        assert answer["definition"]["interval_source"] == [GR, SES]
        g = union["G"]["milestones"]["source"]
        assert (g["timestamp"][:10], g["row_ids"], g["later_row_ids"]) == ("2018-01-02", [r[6]], [r[5]])
        assert union["G"]["measures"]["selected_interval"]["value"] == 3


def test_t07_distribution_comparison_identities_and_refusals(tmp_path):
    folder = tmp_path / "workspace"; folder.mkdir()
    with TestClient(create_app()) as client:
        wid, base = prepare_source(client, folder, LITERAL)
        given = comparison_request(wid, base)
        answer = compared(client, given)
        comparison = answer["comparison"]
        assert (comparison["parent"]["case_count"], comparison["parent"]["record_count"]) == (6, 16)
        target, reference = comparison["target"], comparison["reference"]
        assert (sorted(target["available_case_ids"]), target["zero_case_ids"], target["unavailable_case_ids"]) == (["A", "T", "Z"], ["Z"], [])
        assert (target["summary"]["minimum"], target["summary"]["median"], target["summary"]["maximum"]) == (0, 1, 3)
        assert abs(target["summary"]["mean"] - 4 / 3) < 1e-8
        assert (sorted(reference["unavailable_case_ids"]), reference["unavailable_reasons"]) == (
            ["O", "R"], {"minimum_outside_admissible_range": 1, "reversed_interval": 1})
        assert comparison["outside_case_ids"] == ["G"]
        # The built browser's test renders exactly these public answers (Bpic19IntervalComparison.acceptance.test.tsx).
        public = lambda reply: {key: value for key, value in reply.items() if key not in ("request_id", "query_revision", "workspace_id")}
        assert public(answer) == json.loads(BROWSER_ANSWER.read_text(encoding="utf-8"))
        reference_page = compared(client, comparison_request(wid, base, page={"role": "reference", "offset": 0, "limit": 100}))
        assert public(reference_page) == json.loads(BROWSER_REFERENCE_PAGE.read_text(encoding="utf-8"))
        # Every meaning-bearing field is a new definition; the page is not.
        seen = {answer["definition_id"]}
        for name, changes in {"source set": {"interval_source": [IR, GR]}, "target set": {"interval_target": [CI, "Vendor creates debit memo"]}}.items():
            changed = compared(client, comparison_request(wid, base, **changes))
            assert changed["definition_id"] not in seen, name
            seen.add(changed["definition_id"])
        for name, sides in {"target members": (("A", "T"), ("O", "R")), "swapped sides": (("O", "R"), ("A", "T", "Z"))}.items():
            changed = compared(client, comparison_request(wid, base, *sides))
            assert changed["definition_id"] not in seen, name
            seen.add(changed["definition_id"])
        paged = compared(client, comparison_request(wid, base, page={"role": "reference", "offset": 0, "limit": 1}))
        assert paged["definition_id"] == answer["definition_id"]
        # Refusals name the field and change nothing.
        for change, code, field in (
                (lambda q: q.update(policy_id="bpic19.interval_distribution_comparison.v2"), "unsupported_policy", "query.policy_id"),
                (lambda q: q.update(interval_policy="first_after"), "unsupported_policy", "query.interval_policy"),
                (lambda q: q["target"]["recipe"].update(case_ids=["A", "A"]), "invalid_parent", "query.target.recipe.case_ids"),
                (lambda q: q["target"]["recipe"].update(case_ids=["foreign"]), "unknown_case", "query.target.recipe.case_ids")):
            bad = deepcopy(given)
            change(bad["query"])
            refused = client.post(COMPARE, json=bad)
            assert (refused.json()["code"], refused.json()["field"]) == (code, field), refused.text
            assert "comparison" not in refused.json()
        bad = request(wid, base)
        bad["query"]["interval_policy"] = "first_after"
        refused = client.post(MEASURES, json=bad)
        assert (refused.status_code, refused.json()["code"], refused.json()["field"]) == (400, "unsupported_definition", "query.interval_policy")
        assert compared(client, given) == answer


def test_t07_kept_unavailable_side_and_its_endpoint_witnesses_survive_a_new_process(tmp_path):
    with socket.socket() as reserving:
        reserving.bind(("127.0.0.1", 0))
        port = reserving.getsockname()[1]
    folder = tmp_path / "workspace"; folder.mkdir()
    r = rows()
    first, client = start_process(port)
    try:
        wid, base = prepare_source(client, folder, LITERAL)
        parent = client.post("/api/investigations/select-cases", json=envelope("select_cases_request", workspace_id=wid,
            identity=base, parent_case_ids=["A", "G", "O", "R", "T", "Z"], predicates=[])).json()
        given = comparison_request(wid, parent["identity"], page={"role": "reference", "offset": 0, "limit": 100})
        answer = compared(client, given)
        predicate = {"kind": "case_id_in", "case_ids": ["O", "R"], "negate": False}
        child = client.post("/api/investigations/select-cases", json=envelope("select_cases_request", workspace_id=wid,
            identity=base, parent_case_ids=["A", "G", "O", "R", "T", "Z"], predicates=[predicate])).json()
        assert child["kept"] == {"case_ids": ["O", "R"], "case_count": 2, "record_count": 4}
        # The excluded endpoint and the counterexample stay whole and navigable on the kept step.
        for case, positions in (("O", [10, 11]), ("R", [8, 9])):
            evidence = client.post("/api/investigations/case-evidence", json=envelope("imported_case_evidence_request",
                workspace_id=wid, identity=child["identity"], case_id=case))
            assert sorted(record["row_id"] for record in evidence.json()["records"]) == sorted(r[p] for p in positions)
        action = {"operation": "bpic19_interval_comparison", "identity": parent["identity"], "query": given["query"],
                  "definition_id": answer["definition_id"], "selection_prefix_length": 0,
                  "selection_keep": {"policy_id": "bpic19.interval_side_keep.v1", "step_index": 0,
                                     "group": {"kind": "interval_side", "side": "reference", "support": "unavailable"}}}
        save = envelope("save_investigation_request", workspace_id=wid, investigation_id=None, expected_revision_id=None,
            name="Reversed and gated intervals", base_identity=base, selection_identity=child["identity"],
            selection_recipe={"parent_case_ids": ["A", "G", "O", "R", "T", "Z"], "predicates": [predicate]},
            context_policy="incident.context.first_record_in_declared_order.v1", comparison=None,
            notes="Synthetic T07 rows", bookmarks=[], bpic19_pipeline={"schema_version": 1, "actions": [action]})
        for change, code in ((lambda g: g.update(support="zero"), "selection_mismatch"), (lambda g: g.update(side="target"), "selection_mismatch")):
            bad = deepcopy(save)
            change(bad["bpic19_pipeline"]["actions"][0]["selection_keep"]["group"])
            assert client.post("/api/investigations/save", json=bad).json()["code"] == code
        saved = client.post("/api/investigations/save", json=save)
        assert saved.status_code == 200, saved.text
        saved = saved.json()
        stale = deepcopy(save)
        stale.update(investigation_id=saved["revision"]["investigation_id"], expected_revision_id="saved-revision.v1:sha256:" + "0" * 64)
        assert client.post("/api/investigations/save", json=stale).status_code == 409
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
        assert reopened.json()["revision"] == saved["revision"]
        assert reopened.json()["bpic19_outputs"] == saved["bpic19_outputs"]
        output = reopened.json()["bpic19_outputs"]["outputs"][0]["output"]["comparison"]
        items = {item["case_id"]: item for item in output["page"]["items"]}
        assert items["O"]["source"]["endpoint_state"] == "out_of_range" and items["O"]["source"]["row_ids"] == [r[10]]
        assert items["R"]["interval"]["recorded_difference_days"] == -2 and items["R"]["interval"]["value"] is None
        assert (output["target"]["summary"]["mean"], output["target"]["zero_case_ids"]) == (answer["comparison"]["target"]["summary"]["mean"], ["Z"])
        assert compared(fresh, given) == answer
    finally:
        second.terminate()
        second.wait(timeout=15)
