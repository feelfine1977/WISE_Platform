"""#6: preview, commit, open a whole incident, return and undo, against the independent oracle of the explorer core fixture.

A preview is the same selection asked for without taking it: its identity is the one the committed step then has. The
committed selection keeps whole incidents with every record; an incident outside it cannot be opened through it; undo
gives back exactly the earlier identity; an empty selection keeps nothing and draws nothing; and a combination the
contract does not know, such as or between steps, is refused by name.
"""

from test_explorer_core_http import intent, reading, select, selection_request  # noqa: F401  (reading is a fixture)
from test_explorer_core_predicates import EXPECTED
from test_import_acceptance import client, envelope, workspace  # noqa: F401  (fixtures)

EAST = intent("record_attribute_in", column_index=4, values=["East"])
GAP = intent("max_raw_gap_at_least", hours=1)
NONE = intent("observed_span_at_least", True, hours=0)


def partition(answer):
    return {key: answer[key] for key in ("kept", "removed", "unevaluable")}


def asked(client, workspace, reading, predicates, request_id, revision):  # noqa: F811
    request = {**selection_request(workspace, reading, predicates), "request_id": request_id, "query_revision": revision}
    response = client.post("/api/investigations/select-cases", json=request)
    assert response.status_code == 200, response.text
    return response.json()


def test_preview_commit_open_return_and_undo_keep_exact_identities(client, workspace, reading):  # noqa: F811
    base = select(client, workspace, reading, [])
    assert base["kept"] == {**EXPECTED["all"]}
    # A preview of the first step, then the step taken: the same incidents under the same identity.
    preview = asked(client, workspace, reading, [EAST], "preview-1", 3)
    first = asked(client, workspace, reading, [EAST], "select-1", 4)
    assert partition(preview) == partition(first) == EXPECTED["any_record_East"]
    assert preview["identity"] == first["identity"] != base["identity"]
    # A second step, previewed and taken: the conjunction of the oracle.
    preview = asked(client, workspace, reading, [EAST, GAP], "preview-2", 5)
    both = asked(client, workspace, reading, [EAST, GAP], "select-2", 6)
    assert partition(preview) == partition(both) == EXPECTED["any_record_East_AND_gap_at_least_1"]
    assert preview["identity"] == both["identity"]
    # A kept incident opens with every one of its records; a removed one cannot be opened through this selection.
    kept = both["kept"]["case_ids"][0]
    opened = client.post("/api/investigations/case-evidence", json=envelope("imported_case_evidence_request", workspace_id=workspace["workspace_id"],
                                                                            identity=both["identity"], case_id=kept))
    assert opened.status_code == 200, opened.text
    whole = client.post("/api/investigations/case-evidence", json=envelope("imported_case_evidence_request", workspace_id=workspace["workspace_id"],
                                                                           identity=reading["identity"], case_id=kept)).json()
    assert [row["row_id"] for row in opened.json()["records"]] == [row["row_id"] for row in whole["records"]]
    removed = both["removed"]["case_ids"][0]
    refused = client.post("/api/investigations/case-evidence", json=envelope("imported_case_evidence_request", workspace_id=workspace["workspace_id"],
                                                                             identity=both["identity"], case_id=removed))
    assert refused.status_code == 404 and refused.json()["code"] == "case_not_found", refused.text
    assert refused.json()["message"] == "This incident is not in the selected kept population."
    # Return to the incidents changes nothing; undo gives back exactly the earlier identities, step by step.
    undone = asked(client, workspace, reading, [EAST], "select-3", 7)
    assert undone["identity"] == first["identity"] and partition(undone) == EXPECTED["any_record_East"]
    assert asked(client, workspace, reading, [], "select-4", 8)["identity"] == base["identity"]


def test_an_empty_selection_keeps_nothing_and_draws_nothing(client, workspace, reading):  # noqa: F811
    empty = select(client, workspace, reading, [NONE])
    assert partition(empty) == EXPECTED["negated_observed_span_at_least_0"]
    graph = client.post("/api/investigations/process-graph", json=envelope("process_graph_request", workspace_id=workspace["workspace_id"],
                                                                         identity=empty["identity"])).json()
    assert (graph["graph"]["nodes"], graph["graph"]["edges"]) == ([], [])


def test_a_combination_the_contract_does_not_know_is_refused_by_name(client, workspace, reading):  # noqa: F811
    either = {"kind": "any_of", "predicates": [EAST, GAP], "negate": False}
    response = client.post("/api/investigations/select-cases", json=selection_request(workspace, reading, [either]))
    assert response.status_code == 422
    assert (response.json()["code"], response.json()["field"]) == ("invalid_predicate", "predicates.0.kind")
    assert "not a kind of predicate this contract knows" in response.json()["message"]
