"""#107 activity count, presence and repetition over the literal A–F source, at public HTTP.

Expected values are written from the rows below by hand. Source positions (one-based, as in literal_row_ids):
A 1–2 Record Invoice Receipt, 3 Clear Invoice, 4 Change Price, 5 Change Quantity, 6 Cancel Invoice Receipt;
B 7 Vendor creates invoice; C 8 an unrelated record without a time; D 9 a blank label, 10 an unrelated label;
E 11 Record Invoice Receipt, 12 a blank label; F 13–14 Record Invoice Receipt, 15 a blank label.
"""

from copy import deepcopy
import hashlib
import json
from pathlib import Path
import socket

from fastapi.testclient import TestClient

from wise_platform_api.app import create_app
from import_requests import envelope
from test_bpic19_measures_http import ROUTE, VALIDATOR, prepare_source, request
from test_bpic19_pipeline_http import start_process
from literal_profile_columns import with_profile_columns

LITERAL = with_profile_columns(b'''case,activity,time,case Item Category,event org:resource,event Cumulative net worth (EUR),case Purchasing Document,case Company,case Spend area text
A,Record Invoice Receipt,2018-01-01T00:00:00,,user_1,100,D,1,Packaging
A,Record Invoice Receipt,2018-01-02T00:00:00,,user_1,100,D,1,Packaging
A,Clear Invoice,2018-01-03T00:00:00,,user_1,100,D,1,Packaging
A,Change Price,2018-01-04T00:00:00,,user_2,100,D,1,Packaging
A,Change Quantity,2018-01-05T00:00:00,,user_2,100,D,1,Packaging
A,Cancel Invoice Receipt,2018-01-06T00:00:00,,user_2,100,D,1,Packaging
B,Vendor creates invoice,2018-01-01T00:00:00,,robot,10,E,1,Packaging
C,Other,,,user_1,10,F,1,Packaging
D,,2018-01-01T00:00:00,,user_1,10,G,1,Packaging
D,Other,2018-01-02T00:00:00,,user_1,10,G,1,Packaging
E,Record Invoice Receipt,2018-01-01T00:00:00,,user_1,10,H,1,Packaging
E,,2018-01-02T00:00:00,,user_1,10,H,1,Packaging
F,Record Invoice Receipt,2018-01-01T00:00:00,,user_1,10,I,1,Packaging
F,Record Invoice Receipt,2018-01-02T00:00:00,,user_1,10,I,1,Packaging
F,,2018-01-03T00:00:00,,user_1,10,I,1,Packaging
''')
ALL = ["A", "B", "C", "D", "E", "F"]
BROWSER_ANSWER = Path(__file__).resolve().parents[3] / "apps/web/src/bpic19/t05-measures-answer.json"
SELECT = "/api/investigations/select-cases"


def rows():
    """Original-row identities from the published content format, independent of the service."""
    source_id = "source.v1:sha256:" + hashlib.sha256(LITERAL).hexdigest()
    return {position: "row.v1:sha256:" + hashlib.sha256(json.dumps({"format_version": 1, "source_id": source_id,
            "source_position": position - 1}, sort_keys=True, separators=(",", ":")).encode()).hexdigest() for position in range(1, 16)}


def measured(client, wid, identity, **query):
    given = request(wid, identity)
    given["query"].update({"limit": 100, **query})
    response = client.post(ROUTE, json=given)
    assert response.status_code == 200, response.text
    VALIDATOR.validate(response.json())
    return given, response.json()


def selected(client, wid, base, parent, predicates):
    response = client.post(SELECT, json=envelope("select_cases_request", workspace_id=wid, identity=base,
        parent_case_ids=parent, predicates=predicates))
    assert response.status_code == 200, response.text
    return response.json()


def finite(case):
    """The four indicators of one case, as (value, available) pairs, with its lower bound and unknown labels."""
    measure = case["activity_measure"]
    return ({name: measure[name]["value"] for name in ("count", "presence", "repeat_quantity", "repeated_presence")},
            measure["lower_bound"], measure["unknown_label_count"])


def test_t05_literal_counts_presence_repetition_and_missing_labels(tmp_path):
    folder = tmp_path / "workspace"; folder.mkdir()
    r = rows()
    with TestClient(create_app()) as client:
        wid, base = prepare_source(client, folder, LITERAL)
        _, answer = measured(client, wid, base)
        assert (answer["population_case_count"], answer["population_record_count"]) == (6, 15)
        assert answer["definition"]["activity_selector"] == ["Record Invoice Receipt"]
        cases = {case["case_id"]: case for case in answer["cases"]}
        assert finite(cases["A"]) == ({"count": 2, "presence": 1, "repeat_quantity": 1, "repeated_presence": 1}, 2, 0)
        assert cases["A"]["activity_measure"]["matching_row_ids"] == [r[1], r[2]]
        assert cases["A"]["record_row_ids"] == [r[i] for i in range(1, 7)]
        # Known zero: B and C have complete labels and no receipt; their whole history is the absence witness.
        for case, position in (("B", 7), ("C", 8)):
            assert finite(cases[case]) == ({"count": 0, "presence": 0, "repeat_quantity": 0, "repeated_presence": 0}, 0, 0)
            assert cases[case]["activity_measure"]["absence_row_ids"] == [r[position]]
        # T05-AC06: a blank label never erases witnessed presence nor proves absence.
        assert finite(cases["D"]) == ({"count": None, "presence": None, "repeat_quantity": None, "repeated_presence": None}, 0, 1)
        assert cases["D"]["activity_measure"]["unknown_row_ids"] == [r[9]]
        assert cases["D"]["activity_measure"]["absence_row_ids"] == []
        assert finite(cases["E"]) == ({"count": None, "presence": 1, "repeat_quantity": None, "repeated_presence": None}, 1, 1)
        assert cases["E"]["activity_measure"]["presence"]["row_ids"] == [r[11]]
        assert finite(cases["F"]) == ({"count": None, "presence": 1, "repeat_quantity": None, "repeated_presence": 1}, 2, 1)
        assert cases["F"]["activity_measure"]["repeated_presence"]["row_ids"] == [r[13], r[14]]
        for case in "DEF":
            assert cases[case]["activity_measure"]["count"]["reason"] == "missing_activity_label"

        # T05-AC04: a selector naming Change Price twice counts each original record once.
        _, edits = measured(client, wid, base, activity_selector=["Change Price", "Change Quantity", "Change Price"])
        _, deduplicated = measured(client, wid, base, activity_selector=["Change Quantity", "Change Price"])
        assert edits["definition_id"] == deduplicated["definition_id"]
        assert edits["definition"]["activity_selector"] == ["Change Price", "Change Quantity"]
        a = next(case for case in edits["cases"] if case["case_id"] == "A")
        assert finite(a) == ({"count": 2, "presence": 1, "repeat_quantity": 1, "repeated_presence": 1}, 2, 0)
        assert a["activity_measure"]["matching_row_ids"] == [r[4], r[5]]
        # Each operator names its own unit, and the unknown-label policy is stated with every answer.
        assert {name: a["activity_measure"][name]["unit"] for name in ("count", "presence", "repeat_quantity", "repeated_presence")} == {
            "count": "event_occurrences", "presence": "case_presence_boolean",
            "repeat_quantity": "repeated_event_occurrences", "repeated_presence": "case_repeated_presence_boolean"}
        assert a["activity_measure"]["policy_id"] == "bpic19.exact_activity_finite_indicators.v1"
        # The built browser's test renders exactly this public answer (Bpic19Measures.acceptance.test.tsx).
        public = {key: value for key, value in answer.items() if key not in ("request_id", "query_revision", "workspace_id")}
        assert public == json.loads(BROWSER_ANSWER.read_text(encoding="utf-8"))


def test_t05_count_cohorts_over_a_frozen_parent_and_an_empty_parent(tmp_path):
    folder = tmp_path / "workspace"; folder.mkdir()
    with TestClient(create_app()) as client:
        wid, base = prepare_source(client, folder, LITERAL)
        parent = selected(client, wid, base, ["A", "B", "C"], [])
        _, answer = measured(client, wid, parent["identity"], activity_operator="presence")
        cohorts = answer["activity_cohorts"]
        assert (answer["population_case_count"], answer["population_record_count"]) == (3, 8)
        assert (cohorts["presence_positive_case_ids"], cohorts["presence_absent_case_ids"], cohorts["presence_unknown_case_ids"]) == (["A"], ["B", "C"], [])
        assert (cohorts["positive_case_ids"], cohorts["zero_case_ids"], cohorts["unavailable_case_ids"]) == (["A"], ["B", "C"], [])
        assert (cohorts["presence_fraction"], cohorts["repeated_presence_fraction"], cohorts["denominator"]) == (1 / 3, 1 / 3, 3)
        assert cohorts["reason"] is None
        empty = selected(client, wid, base, ALL, [{"kind": "contains_activity", "activity": "Not recorded anywhere", "negate": False}])
        assert empty["kept"]["case_count"] == 0
        _, nothing = measured(client, wid, empty["identity"], activity_operator="presence")
        assert (nothing["population_case_count"], nothing["population_record_count"]) == (0, 0)
        assert (nothing["activity_cohorts"]["presence_fraction"], nothing["activity_cohorts"]["repeated_presence_fraction"]) == (None, None)
        assert (nothing["activity_cohorts"]["denominator"], nothing["activity_cohorts"]["reason"]) == (0, "empty_denominator")
        assert nothing["cases"] == []


def test_t05_unavailable_activity_role_and_unsupported_operator_or_policy_refuse_without_a_count(tmp_path):
    folder = tmp_path / "workspace"; folder.mkdir()
    with TestClient(create_app()) as client:
        wid, base = prepare_source(client, folder, LITERAL)
        given, answer = measured(client, wid, base)
        for change, code, field in (
                (lambda q: q["roles"].update(activity=99), "invalid_parameter", None),
                (lambda q: q["roles"].update(activity=None), "role_unavailable", "query.roles.activity"),
                (lambda q: q.update(activity_operator="net_count"), "unsupported_definition", None),
                (lambda q: q.update(policy_id="bpic19.source_witnessed_measures.v2"), "unsupported_policy", "query.policy_id")):
            asked = deepcopy(given)
            change(asked["query"])
            refused = client.post(ROUTE, json=asked)
            assert refused.status_code == 400, refused.text
            body = refused.json()
            assert body["code"] == code and body["message_type"] == "bpic19_measures_refusal"
            if field is not None:
                assert body["field"] == field
            assert not {"cases", "activity_cohorts", "summaries"} & set(body)
        # The reviewed answer is unchanged by the refusals.
        again = client.post(ROUTE, json=given)
        assert again.status_code == 200 and again.json()["result_id"] == answer["result_id"]
        assert again.json()["cases"] == answer["cases"]


def test_t05_selector_operator_and_parent_change_identities(tmp_path):
    folder = tmp_path / "workspace"; folder.mkdir()
    with TestClient(create_app()) as client:
        wid, base = prepare_source(client, folder, LITERAL)
        _, counted = measured(client, wid, base)
        _, present = measured(client, wid, base, activity_operator="presence")
        _, union = measured(client, wid, base, activity_selector=["Record Invoice Receipt", "Vendor creates invoice"])
        assert len({counted["definition_id"], present["definition_id"], union["definition_id"]}) == 3
        parent = selected(client, wid, base, ["A", "B", "C"], [])
        _, narrower = measured(client, wid, parent["identity"])
        # The parent is part of the result, not of the reviewed recipe.
        assert narrower["definition_id"] == counted["definition_id"]
        assert narrower["result_id"] != counted["result_id"]
        _, page = measured(client, wid, base, offset=2, limit=2)
        assert (page["definition_id"], page["result_id"]) == (counted["definition_id"], counted["result_id"])


def keep_request(client, wid, base, cohort="positive"):
    parent = selected(client, wid, base, ["A", "B", "C"], [])
    query, answer = measured(client, wid, parent["identity"], activity_operator="presence")
    predicate = {"kind": "case_id_in", "case_ids": ["A"], "negate": False}
    child = selected(client, wid, base, ["A", "B", "C"], [predicate])
    action = {"operation": "bpic19_measures", "identity": parent["identity"], "query": query["query"],
              "definition_id": answer["definition_id"], "selection_prefix_length": 0,
              "selection_keep": {"policy_id": "bpic19.measure_cohort_keep.v1", "step_index": 0,
                                 "group": {"kind": "activity_cohort", "cohort": cohort}}}
    given = envelope("save_investigation_request", workspace_id=wid, investigation_id=None, expected_revision_id=None,
        name="Literal presence cohort Keep", base_identity=base, selection_identity=child["identity"],
        selection_recipe={"parent_case_ids": ["A", "B", "C"], "predicates": [predicate]},
        context_policy="incident.context.first_record_in_declared_order.v1", comparison=None,
        notes="Synthetic T05 rows", bookmarks=[], bpic19_pipeline={"schema_version": 1, "actions": [action]})
    return given, answer, child, parent


def test_t05_kept_presence_cohort_is_saved_with_its_measure_and_survives_a_new_process(tmp_path):
    with socket.socket() as reserving:
        reserving.bind(("127.0.0.1", 0))
        port = reserving.getsockname()[1]
    folder = tmp_path / "workspace"; folder.mkdir()
    r = rows()
    first, client = start_process(port)
    try:
        wid, base = prepare_source(client, folder, LITERAL)
        given, answer, child, parent = keep_request(client, wid, base)
        assert child["kept"] == {"case_ids": ["A"], "case_count": 1, "record_count": 6}
        # The kept item opens with all six records, not only its two receipts.
        evidence = client.post("/api/investigations/case-evidence", json=envelope("imported_case_evidence_request",
            workspace_id=wid, identity=child["identity"], case_id="A"))
        assert evidence.status_code == 200, evidence.text
        assert [record["row_id"] for record in evidence.json()["records"]] == [r[i] for i in range(1, 7)]
        # A wrong cohort, a wrong policy or a measure on another operation is refused before anything is written.
        for change, code in ((lambda a: a["selection_keep"]["group"].update(cohort="zero"), "selection_mismatch"),
                             (lambda a: a["selection_keep"].update(policy_id="bpic19.profile_group_keep.v1"), "unsupported_policy")):
            bad = deepcopy(given)
            change(bad["bpic19_pipeline"]["actions"][0])
            refused = client.post("/api/investigations/save", json=bad)
            assert refused.status_code >= 400 and refused.json()["code"] == code, refused.text
            assert refused.json()["field"].startswith(("bpic19_pipeline.actions.0.selection_keep", "selection_recipe.predicates.0")), refused.text
        listed = client.post("/api/investigations/list-saved", json=envelope("list_saved_request", workspace_id=wid))
        assert listed.status_code == 200 and listed.json()["investigations"] == [], listed.text
        saved = client.post("/api/investigations/save", json=given)
        assert saved.status_code == 200, saved.text
        saved = saved.json()
        output = saved["bpic19_outputs"]["outputs"][0]["output"]
        assert output["activity_cohorts"]["positive_case_ids"] == ["A"]
        assert saved["revision"]["content"]["bpic19_pipeline"]["actions"][0]["selection_keep"]["group"] == {"kind": "activity_cohort", "cohort": "positive"}
    finally:
        first.terminate()
        first.wait(timeout=15)
    assert first.returncode is not None
    second, fresh = start_process(port)
    try:
        assert second.pid != first.pid
        opened = fresh.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(folder)))
        assert opened.status_code == 200, opened.text
        reopened = fresh.post("/api/investigations/reopen", json=envelope("reopen_investigation_request",
            workspace_id=wid, saved_revision_id=saved["revision"]["saved_revision_id"]))
        assert reopened.status_code == 200, reopened.text
        assert reopened.json()["revision"] == saved["revision"]
        assert reopened.json()["bpic19_outputs"] == saved["bpic19_outputs"]
        # Undo's target, the frozen parent, is reopenable with its own unchanged measures.
        _, again = measured(fresh, wid, parent["identity"], activity_operator="presence")
        assert again == answer
        # A stale save naming the opened revision's predecessor is refused.
        stale = deepcopy(given)
        stale.update(investigation_id=saved["revision"]["investigation_id"], expected_revision_id="saved-revision.v1:sha256:" + "0" * 64)
        refused = fresh.post("/api/investigations/save", json=stale)
        assert refused.status_code == 409, refused.text
    finally:
        second.terminate()
        second.wait(timeout=15)
