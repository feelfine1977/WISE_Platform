"""Selecting whole incidents and the map of a selection, through their routes.

The literal log below has four incidents. Every expected membership and count
was worked out by hand from it:

    A  Opened 08:00, Assigned 09:00, Resolved 11:00           3 records, order known
    B  Opened 08:00, Resolved 08:30                            2 records, order known
    C  Opened 08:00, Assigned 10:00, Assigned 12:00            3 records, order known
    D  Opened (unreadable time), Assigned 09:00                2 records, order not known
"""

import hashlib
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from import_requests import envelope, policies
from jsonschema import Draft202012Validator

from wise_platform_analytics.selection import SelectionError
from wise_platform_api import selections as selections_module
from wise_platform_api.app import create_app
from wise_platform_api.registry import SelectionRegistry
from wise_platform_api.selection_boundary import STATUS

ROOT = Path(__file__).resolve().parents[3]
SCHEMA = json.loads((ROOT / "contracts" / "selection.schema.json").read_text(encoding="utf-8"))
VALIDATOR = Draft202012Validator(SCHEMA)
SELECT = "/api/investigations/select-cases"
GRAPH = "/api/investigations/process-graph"
EVIDENCE = "/api/investigations/case-evidence"

LOG = (
    "Ticket,Activity,At,Desk\r\n"
    "A,Opened,2026-10-09T08:00:00Z,East\r\n"
    "A,Assigned,2026-10-09T09:00:00Z,East\r\n"
    "A,Resolved,2026-10-09T11:00:00Z,East\r\n"
    "B,Opened,2026-10-09T08:00:00Z,\r\n"
    "B,Resolved,2026-10-09T08:30:00Z,West\r\n"
    "C,Opened,2026-10-09T08:00:00Z,West\r\n"
    "C,Assigned,2026-10-09T10:00:00Z,West\r\n"
    "C,Assigned,2026-10-09T12:00:00Z,West\r\n"
    "D,Opened,not-a-time,Unknown\r\n"
    "D,Assigned,2026-10-09T09:00:00Z,Unknown\r\n"
).encode("utf-8")
LOG_ID = "source.v1:sha256:" + hashlib.sha256(LOG).hexdigest()


def contains(activity, negate=False):
    return {"kind": "contains_activity", "activity": activity, "negate": negate}


def follows(source, target, negate=False):
    return {"kind": "directly_follows", "source_activity": source, "target_activity": target, "negate": negate}


def opening(column, value, negate=False):
    return {"kind": "opening_attribute_equals", "column_index": column, "value": value, "negate": negate,
            "anchor_policy": "incident.context.first_record_in_declared_order.v1"}


def begins(activity, negate=False):
    return {"kind": "starts_with_activity", "activity": activity, "negate": negate}


def ends(activity, negate=False):
    return {"kind": "ends_with_activity", "activity": activity, "negate": negate}


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(static_dir=tmp_path / "unbuilt")) as active:
        yield active


def open_workspace(client, folder: Path) -> str:
    folder.mkdir()
    response = client.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(folder)))
    assert response.status_code == 200, response.text
    return response.json()["workspace_id"]


@pytest.fixture
def workspace_id(client, tmp_path):
    return open_workspace(client, tmp_path / "Arbeitsbereich")


@pytest.fixture
def base(client, workspace_id):
    """The population of the literal log, as the investigation opens it."""
    metadata = envelope("upload_source_metadata", "upload-1", workspace_id=workspace_id, filename="log.csv")
    response = client.put("/api/sources", params=metadata, content=LOG,
                          headers={"Content-Type": "application/octet-stream"})
    assert response.status_code == 200, response.text
    confirmation = envelope(
        "confirm_mapping_request", "prepare-1", workspace_id=workspace_id, source_id=LOG_ID,
        dialect={"encoding": "utf-8", "delimiter": ",", "quotechar": '"', "header": "first_record"},
        mapping={"case_column": 0, "activity_column": 1, "timestamp_column": 2, "sequence_column": None,
                 "context_columns": [3]},
        policies=policies("iso8601", None), accept_report_issues=True)
    prepared = client.post("/api/preparations", json=confirmation).json()
    assert prepared["state"] == "ready", prepared
    request = envelope("open_population_request", "population-1", workspace_id=workspace_id,
                       preparation_id=prepared["preparation"]["preparation_id"])
    response = client.post("/api/investigations/open-population", json=request)
    assert response.status_code == 200, response.text
    return response.json()


def selection_request(workspace_id, identity, predicates=(), parent=None, revision=2, request_id="select-2"):
    return envelope("select_cases_request", request_id, revision, workspace_id=workspace_id, identity=identity,
                    parent_case_ids=parent, predicates=list(predicates))


def selected(client, workspace_id, base, predicates=(), parent=None, revision=2) -> dict:
    request = selection_request(workspace_id, base["identity"], predicates, parent, revision)
    response = client.post(SELECT, json=request)
    assert response.status_code == 200, response.text
    answer = response.json()
    VALIDATOR.validate(answer)
    assert (answer["request_id"], answer["query_revision"], answer["workspace_id"]) == (
        request["request_id"], revision, workspace_id)
    return answer


def graph_of(client, workspace_id, identity, revision=2) -> dict:
    request = envelope("process_graph_request", "graph-2", revision, workspace_id=workspace_id, identity=identity)
    response = client.post(GRAPH, json=request)
    assert response.status_code == 200, response.text
    answer = response.json()
    VALIDATOR.validate(answer)
    assert answer["identity"] == identity
    return answer["graph"]


def refused(response, operation, code, field=None) -> dict:
    body = response.json()
    VALIDATOR.validate(body)
    assert body["message_type"] == "selection_refusal", body
    assert (body["operation"], body["code"]) == (operation, code), body
    assert response.status_code == STATUS[code]
    assert body["message"].strip()
    if field is not None:
        assert body["field"] == field, body
    return body


def support(ids, records):
    return {"case_ids": ids, "case_count": len(ids), "record_count": records}


def evidence(client, workspace_id, identity, case_id):
    request = envelope("imported_case_evidence_request", "evidence-2", 2, workspace_id=workspace_id,
                       identity=identity, case_id=case_id)
    return client.post(EVIDENCE, json=request)


# Counts -----------------------------------------------------------------------------------


def test_one_predicate_keeps_and_removes_whole_incidents_of_the_parent(client, workspace_id, base):
    answer = selected(client, workspace_id, base, [contains("Assigned")])

    assert answer["parent"] == support(["A", "B", "C", "D"], 10)
    assert answer["kept"] == support(["A", "C", "D"], 8)
    assert answer["removed"] == support(["B"], 2)
    assert answer["unevaluable"] == support([], 0)
    assert answer["predicate_results"] == [{"predicate": contains("Assigned"), "kept": support(["A", "C", "D"], 8),
                                            "removed": support(["B"], 2), "unevaluable": support([], 0)}]
    for field in ("source_id", "preparation_id", "representation_id", "case_dictionary_id", "implementation_version"):
        assert answer["identity"][field] == base["identity"][field]
    assert answer["identity"]["population_id"] != base["identity"]["population_id"]
    assert answer["parent_identity"]["population_id"] not in (
        answer["identity"]["population_id"], base["identity"]["population_id"])


def test_a_path_predicate_leaves_an_incident_of_unknown_order_unevaluable(client, workspace_id, base):
    answer = selected(client, workspace_id, base, [follows("Opened", "Assigned")])

    assert answer["kept"] == support(["A", "C"], 6)
    assert answer["removed"] == support(["B"], 2)
    assert answer["unevaluable"] == support(["D"], 2)


def test_two_predicates_answer_the_conjunction_and_each_chip_over_the_whole_parent(client, workspace_id, base):
    answer = selected(client, workspace_id, base, [contains("Assigned"), follows("Opened", "Assigned")])

    assert answer["kept"] == support(["A", "C"], 6)
    assert answer["removed"] == support(["B"], 2)
    assert answer["unevaluable"] == support(["D"], 2)
    first, second = answer["predicate_results"]
    assert (first["kept"], first["removed"], first["unevaluable"]) == (
        support(["A", "C", "D"], 8), support(["B"], 2), support([], 0))
    assert (second["kept"], second["removed"], second["unevaluable"]) == (
        support(["A", "C"], 6), support(["B"], 2), support(["D"], 2))
    # Both chips remove B: their removals overlap, so they add up to more than the conjunction removes.
    assert first["removed"]["case_count"] + second["removed"]["case_count"] == 2
    assert answer["removed"]["case_count"] == 1


def test_a_false_predicate_decides_the_conjunction_over_an_unevaluable_one(client, workspace_id, base):
    answer = selected(client, workspace_id, base, [contains("Resolved"), follows("Opened", "Assigned")])

    assert answer["kept"] == support(["A"], 3)
    assert answer["removed"] == support(["B", "C", "D"], 7)
    assert answer["unevaluable"] == support([], 0)


def test_a_parent_is_frozen_and_named_by_its_own_identity(client, workspace_id, base):
    answer = selected(client, workspace_id, base, [contains("Assigned")], parent=["B", "C"])
    whole = selected(client, workspace_id, base, parent=["B", "C"], revision=3)

    assert answer["parent"] == support(["B", "C"], 5)
    assert answer["kept"] == support(["C"], 3)
    assert answer["removed"] == support(["B"], 2)
    assert whole["identity"] == whole["parent_identity"] == answer["parent_identity"]


# Negation ---------------------------------------------------------------------------------


def test_negation_keeps_what_the_predicate_removes(client, workspace_id, base):
    answer = selected(client, workspace_id, base, [contains("Assigned", negate=True)])

    assert answer["kept"] == support(["B"], 2)
    assert answer["removed"] == support(["A", "C", "D"], 8)
    assert answer["unevaluable"] == support([], 0)


def test_negation_of_a_path_keeps_an_unevaluable_incident_unevaluable(client, workspace_id, base):
    answer = selected(client, workspace_id, base, [follows("Opened", "Assigned", negate=True)])

    assert answer["kept"] == support(["B"], 2)
    assert answer["removed"] == support(["A", "C"], 6)
    assert answer["unevaluable"] == support(["D"], 2)


def test_opening_context_missing_and_literal_unknown_are_different_values(client, workspace_id, base):
    missing = selected(client, workspace_id, base, [opening(3, None)])
    literal = selected(client, workspace_id, base, [opening(3, "Unknown")], revision=3)

    # B opens without a desk; D's order is not known, so its opening record is not known either.
    assert (missing["kept"], missing["removed"], missing["unevaluable"]) == (
        support(["B"], 2), support(["A", "C"], 6), support(["D"], 2))
    assert (literal["kept"], literal["unevaluable"]) == (support([], 0), support(["D"], 2))


# Beginning and ending ---------------------------------------------------------------------


def test_incidents_that_begin_with_an_activity_are_those_whose_first_record_carries_it(client, workspace_id, base):
    answer = selected(client, workspace_id, base, [begins("Opened")])

    # D's order is not known, so its first record is not known either.
    assert answer["kept"] == support(["A", "B", "C"], 8)
    assert answer["removed"] == support([], 0)
    assert answer["unevaluable"] == support(["D"], 2)
    assert answer["predicate_results"] == [{"predicate": begins("Opened"), "kept": support(["A", "B", "C"], 8),
                                            "removed": support([], 0), "unevaluable": support(["D"], 2)}]
    opposite = selected(client, workspace_id, base, [begins("Opened", negate=True)], revision=3)
    assert (opposite["kept"], opposite["removed"], opposite["unevaluable"]) == (
        support([], 0), support(["A", "B", "C"], 8), support(["D"], 2))
    assert opposite["identity"]["population_id"] != answer["identity"]["population_id"]
    # Assigned is recorded in A, C and D, but no incident begins with it.
    assigned = selected(client, workspace_id, base, [begins("Assigned")], revision=4)
    assert (assigned["kept"], assigned["removed"]) == (support([], 0), support(["A", "B", "C"], 8))


def test_incidents_that_end_with_an_activity_are_those_whose_last_record_carries_it(client, workspace_id, base):
    answer = selected(client, workspace_id, base, [ends("Resolved")])

    assert (answer["kept"], answer["removed"], answer["unevaluable"]) == (
        support(["A", "B"], 5), support(["C"], 3), support(["D"], 2))
    opposite = selected(client, workspace_id, base, [ends("Resolved", negate=True)], revision=3)
    assert (opposite["kept"], opposite["removed"], opposite["unevaluable"]) == (
        support(["C"], 3), support(["A", "B"], 5), support(["D"], 2))
    # Assigned is recorded in A, C and D, but only C ends with it.
    assigned = selected(client, workspace_id, base, [ends("Assigned")], revision=4)
    assert (assigned["kept"], assigned["removed"]) == (support(["C"], 3), support(["A", "B"], 5))


def test_a_beginning_and_an_ending_step_answer_their_conjunction_with_the_other_steps(client, workspace_id, base):
    answer = selected(client, workspace_id, base, [begins("Opened"), ends("Resolved"), contains("Assigned")])

    # A step that removes D decides over the two that cannot evaluate it.
    assert (answer["kept"], answer["removed"], answer["unevaluable"]) == (
        support(["A"], 3), support(["B", "C"], 5), support(["D"], 2))
    decided = selected(client, workspace_id, base, [begins("Opened"), contains("Resolved")], revision=3)
    assert (decided["kept"], decided["removed"], decided["unevaluable"]) == (
        support(["A", "B"], 5), support(["C", "D"], 5), support([], 0))


def test_beginning_and_ending_keep_as_many_incidents_as_the_map_counts_starts_and_ends(client, workspace_id, base):
    populations = [(base["identity"], None)]
    for index, predicates in enumerate(([contains("Assigned")], [ends("Resolved")], [contains("Assigned", True)])):
        answer = selected(client, workspace_id, base, predicates, revision=3 + index)
        populations.append((answer["identity"], answer["kept"]["case_ids"]))
    assert [case_ids for _, case_ids in populations] == [None, ["A", "C", "D"], ["A", "B"], ["B"]]

    counted = []
    for identity, case_ids in populations:
        graph = graph_of(client, workspace_id, identity)
        assert graph["meta"]["boundary_policy"] == "incident.boundary.raw_labeled_start_end.v1"
        for node in graph["nodes"]:
            for step, metric in ((begins, "starts"), (ends, "ends")):
                answer = selected(client, workspace_id, base, [step(node["label"])], parent=case_ids, revision=9)
                assert answer["kept"]["case_count"] == node["metrics"][metric], (case_ids, node["label"], metric)
                counted.append(answer["kept"]["case_count"])
    # Every incident whose order is known begins once and ends once: 3 + 2 + 2 + 1 of them.
    assert sum(counted) == 2 * (3 + 2 + 2 + 1)


@pytest.mark.parametrize("step", [begins, ends])
@pytest.mark.parametrize("change, field", [
    (lambda predicate: predicate.update(activity=""), "predicates.0.activity"),
    (lambda predicate: predicate.update(activity=7), "predicates.0.activity"),
    (lambda predicate: predicate.pop("activity"), "predicates.0.activity"),
    (lambda predicate: predicate.update(negate="false"), "predicates.0.negate"),
    (lambda predicate: predicate.pop("negate"), "predicates.0.negate"),
    (lambda predicate: predicate.update(target_activity="Resolved"), "predicates.0.target_activity"),
])
def test_a_beginning_or_ending_step_is_checked_as_a_containing_step_is(client, workspace_id, base, step, change, field):
    for kind in (step, contains):
        predicate = kind("Opened")
        change(predicate)
        request = selection_request(workspace_id, base["identity"], [predicate])

        refused(client.post(SELECT, json=request), "select_cases", "invalid_predicate", field)


# Refusals ---------------------------------------------------------------------------------


def test_an_activity_without_a_label_is_refused(client, workspace_id, base):
    request = selection_request(workspace_id, base["identity"], [contains("")])

    refused(client.post(SELECT, json=request), "select_cases", "invalid_predicate", "predicates.0.activity")


def test_an_activity_no_record_carries_is_contained_by_no_incident(client, workspace_id, base):
    answer = selected(client, workspace_id, base, [contains("Closed")])

    assert answer["kept"] == support([], 0)
    assert answer["removed"] == support(["A", "B", "C", "D"], 10)


@pytest.mark.parametrize("change, operation_code, field", [
    (lambda request: request.update(schema_version=2), "unsupported_schema", "schema_version"),
    (lambda request: request.update(query_revision=True), "invalid_request", "query_revision"),
    (lambda request: request.update(norm_id="x"), "invalid_request", "norm_id"),
    (lambda request: request["predicates"].append({"kind": "eventually_follows", "activity": "A", "negate": False}),
     "invalid_predicate", "predicates.0.kind"),
    (lambda request: request["predicates"].append(contains("Opened") | {"negate": "false"}),
     "invalid_predicate", "predicates.0.negate"),
    (lambda request: request["predicates"].append(opening(3, None) | {"anchor_policy": "first_nonmissing"}),
     "unsupported_policy", "predicates.0.anchor_policy"),
    (lambda request: request["predicates"].append(opening(2, None)), "unmapped_context_column", "predicates"),
    (lambda request: request.update(parent_case_ids=["A", "Z"]), "unknown_case", "parent_case_ids"),
    (lambda request: request.update(parent_case_ids=["A", "A"]), "invalid_parent", "parent_case_ids"),
])
def test_a_selection_outside_what_is_supported_is_refused_with_its_place(
        client, workspace_id, base, change, operation_code, field):
    request = selection_request(workspace_id, base["identity"])
    change(request)

    body = refused(client.post(SELECT, json=request), "select_cases", operation_code, field)
    assert body["request_id"] == "select-2"


def test_a_selection_is_made_from_the_opened_population_only(client, workspace_id, base):
    answer = selected(client, workspace_id, base, [contains("Assigned")])
    request = selection_request(workspace_id, answer["identity"], [contains("Resolved")])

    refused(client.post(SELECT, json=request), "select_cases", "identity_mismatch", "identity")


def test_a_failure_of_the_package_becomes_a_typed_refusal(client, workspace_id, base, monkeypatch):
    def unordered(prepared, selected_ids=None):
        raise SelectionError("inconsistent_sequence", "An evaluable history is not in declared time order.")

    monkeypatch.setattr(selections_module, "build_process_graph", unordered)
    refused(client.post(GRAPH, json=envelope("process_graph_request", "graph-2", 2, workspace_id=workspace_id,
                                             identity=base["identity"])), "process_graph", "inconsistent_sequence")


def test_an_unexpected_failure_is_computation_failed(client, workspace_id, base, monkeypatch):
    def broken(*arguments):
        raise RuntimeError("broken")

    monkeypatch.setattr(selections_module, "select_cases", broken)
    body = refused(client.post(SELECT, json=selection_request(workspace_id, base["identity"])),
                   "select_cases", "computation_failed")
    assert body["retryable"] is True


# The map ----------------------------------------------------------------------------------


def test_the_map_of_the_opened_population_is_the_map_of_every_incident(client, workspace_id, base):
    graph = graph_of(client, workspace_id, base["identity"])

    nodes = {node["label"]: node["metrics"] for node in graph["nodes"]}
    # Out of Opened lead passages of 1, 0.5 and 2 hours; into Assigned of 1, 2 and 2 hours and out of it
    # of 2 and 2 hours; into Resolved of 2 and 0.5 hours. D's order is not known and adds no passage.
    assert nodes == {"Opened": {"count": 4, "events": 4, "cases": 4, "starts": 3, "ends": 0,
                                "usablePreviousCount": 0, "medianNextHours": 1, "usableNextCount": 3},
                     "Assigned": {"count": 4, "events": 4, "cases": 3, "starts": 0, "ends": 1,
                                  "medianPreviousHours": 2, "usablePreviousCount": 3,
                                  "medianNextHours": 2, "usableNextCount": 2},
                     "Resolved": {"count": 2, "events": 2, "cases": 2, "starts": 0, "ends": 2,
                                  "medianPreviousHours": 1.25, "usablePreviousCount": 2, "usableNextCount": 0}}
    paths = {(edge["payload"]["source_activity"], edge["payload"]["target_activity"]): edge["metrics"]
             for edge in graph["edges"]}
    assert paths == {("Opened", "Assigned"): {"count": 2, "cases": 2, "medianLagHours": 1.5, "usableLagCount": 2},
                     ("Opened", "Resolved"): {"count": 1, "cases": 1, "medianLagHours": 0.5, "usableLagCount": 1},
                     ("Assigned", "Resolved"): {"count": 1, "cases": 1, "medianLagHours": 2, "usableLagCount": 1},
                     ("Assigned", "Assigned"): {"count": 1, "cases": 1, "medianLagHours": 2, "usableLagCount": 1}}
    meta = graph["meta"]
    assert (meta["selected_case_ids"], meta["sequence_unevaluable_case_ids"]) == (["A", "B", "C", "D"], ["D"])
    assert (meta["node_case_denominator"], meta["path_case_denominator"]) == (4, 3)
    assert (meta["lag_clock"], meta["clock_limitation"]) == ("elapsed_utc_hours", None)


def test_the_map_of_a_selection_is_the_map_of_its_kept_incidents(client, workspace_id, base):
    answer = selected(client, workspace_id, base, [contains("Assigned")])
    graph = graph_of(client, workspace_id, answer["identity"])

    assert {node["label"]: (node["metrics"]["events"], node["metrics"]["cases"]) for node in graph["nodes"]} == {
        "Opened": (3, 3), "Assigned": (4, 3), "Resolved": (1, 1)}
    assert {(edge["payload"]["source_activity"], edge["payload"]["target_activity"]) for edge in graph["edges"]} == {
        ("Opened", "Assigned"), ("Assigned", "Resolved"), ("Assigned", "Assigned")}
    assert graph["meta"]["selected_case_ids"] == ["A", "C", "D"]
    full = graph_of(client, workspace_id, base["identity"])
    ids = {node["label"]: node["id"] for node in full["nodes"]}
    assert all(node["id"] == ids[node["label"]] for node in graph["nodes"])


def times_of(graph):
    """For every activity: (hours before, passages into it, hours after, passages out of it); None where absent."""
    return {node["label"]: tuple(node["metrics"].get(key) for key in (
        "medianPreviousHours", "usablePreviousCount", "medianNextHours", "usableNextCount")) for node in graph["nodes"]}


def test_the_map_of_a_selection_gives_every_activity_its_times_over_the_kept_incidents(client, workspace_id, base):
    answer = selected(client, workspace_id, base, [contains("Assigned")])
    graph = graph_of(client, workspace_id, answer["identity"])

    # A and C are kept with a known order: Opened is 1 and 2 hours before Assigned, Assigned twice 2 hours
    # before the next record, Resolved 2 hours after Assigned. D is kept too and adds no passage.
    assert graph["meta"]["selected_case_ids"] == ["A", "C", "D"]
    assert times_of(graph) == {"Opened": (None, 0, 1.5, 2), "Assigned": (2, 3, 2, 2), "Resolved": (2, 1, None, 0)}
    assert graph["meta"]["lag_clock"] == "elapsed_utc_hours"
    # The times of an activity rest on the passages its paths count.
    for node in graph["nodes"]:
        into = [edge["metrics"]["count"] for edge in graph["edges"] if edge["target"] == node["id"]]
        out_of = [edge["metrics"]["count"] for edge in graph["edges"] if edge["source"] == node["id"]]
        assert (node["metrics"]["usablePreviousCount"], node["metrics"]["usableNextCount"]) == (sum(into), sum(out_of))


def test_an_activity_without_a_record_before_or_after_it_has_no_time_and_says_so_by_its_count(
        client, workspace_id, base):
    one = selected(client, workspace_id, base, parent=["B"])
    unknown = selected(client, workspace_id, base, parent=["D"], revision=3)

    # B is Opened and, half an hour later, Resolved.
    assert times_of(graph_of(client, workspace_id, one["identity"])) == {
        "Opened": (None, 0, 0.5, 1), "Resolved": (0.5, 1, None, 0)}
    # D's order is not known: its two activities are counted, and no time is given for either.
    graph = graph_of(client, workspace_id, unknown["identity"])
    assert graph["edges"] == []
    assert {node["label"]: node["metrics"] for node in graph["nodes"]} == {
        label: {"count": 1, "events": 1, "cases": 1, "starts": 0, "ends": 0,
                "usablePreviousCount": 0, "usableNextCount": 0} for label in ("Opened", "Assigned")}


def test_the_map_of_a_population_never_selected_is_unavailable(client, workspace_id, base):
    identity = base["identity"] | {"population_id": "population.v1:sha256:" + "1" * 64}

    refused(client.post(GRAPH, json=envelope("process_graph_request", "graph-2", 2, workspace_id=workspace_id,
                                             identity=identity)), "process_graph", "population_unavailable")


def test_the_map_refuses_an_identity_that_does_not_match_its_population(client, workspace_id, base):
    answer = selected(client, workspace_id, base, [contains("Assigned")])
    identity = answer["identity"] | {"case_dictionary_id": "case-dictionary.v1:sha256:" + "0" * 64}

    refused(client.post(GRAPH, json=envelope("process_graph_request", "graph-2", 2, workspace_id=workspace_id,
                                             identity=identity)), "process_graph", "identity_mismatch", "identity")


# Evidence of a selection ------------------------------------------------------------------


def test_evidence_of_a_kept_incident_is_its_complete_history(client, workspace_id, base):
    answer = selected(client, workspace_id, base, [follows("Opened", "Assigned")])

    response = evidence(client, workspace_id, answer["identity"], "C")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["identity"] == answer["identity"]
    assert [record["activity"] for record in body["records"]] == ["Opened", "Assigned", "Assigned"]
    assert body["coverage"]["raw_record_count"] == 3


def test_evidence_of_an_incident_outside_the_selection_is_refused(client, workspace_id, base):
    answer = selected(client, workspace_id, base, [follows("Opened", "Assigned")])

    for case_id in ("B", "D"):
        body = evidence(client, workspace_id, answer["identity"], case_id).json()
        assert (body["message_type"], body["code"]) == ("import_refusal", "case_not_found"), body
    tampered = answer["identity"] | {"representation_id": "representation.v1:sha256:" + "0" * 64}
    body = evidence(client, workspace_id, tampered, "C").json()
    assert (body["message_type"], body["code"]) == ("import_refusal", "identity_mismatch"), body


# The registry -----------------------------------------------------------------------------


def test_a_selection_is_found_under_its_population_identity_in_its_workspace_only(client, workspace_id, base, tmp_path):
    answer = selected(client, workspace_id, base, [contains("Resolved")])
    other = open_workspace(client, tmp_path / "Anderer Arbeitsbereich")

    request = envelope("process_graph_request", "graph-2", 2, workspace_id=other, identity=answer["identity"])
    refused(client.post(GRAPH, json=request), "process_graph", "preparation_unavailable")
    body = evidence(client, other, answer["identity"], "A").json()
    assert body["code"] == "preparation_unavailable", body
    assert graph_of(client, workspace_id, answer["identity"])["meta"]["selected_case_ids"] == ["A", "B"]


def test_the_registry_keeps_each_selection_under_its_workspace_and_population_identity():
    class Selected:
        def __init__(self, population_id):
            self.population_id = population_id

    registry = SelectionRegistry(limit=2)
    first, second, third = Selected("population.v1:one"), Selected("population.v1:two"), Selected("population.v1:three")
    registry.keep("workspace.v1:aaaaaaaa", first)
    registry.keep("workspace.v1:aaaaaaaa", second)

    assert registry.find("workspace.v1:aaaaaaaa", "population.v1:one") is first
    assert registry.find("workspace.v1:bbbbbbbb", "population.v1:one") is None
    assert registry.find("workspace.v1:aaaaaaaa", "population.v1:other") is None
    assert registry.find("workspace.v1:aaaaaaaa", None) is None
    registry.keep("workspace.v1:aaaaaaaa", third)
    # The selection used longest ago gives way: the first was looked up after the second was kept.
    assert registry.find("workspace.v1:aaaaaaaa", "population.v1:two") is None
    assert registry.find("workspace.v1:aaaaaaaa", "population.v1:one") is first


def test_every_code_of_the_contract_has_a_status():
    codes = set(SCHEMA["$defs"]["SelectionRefusal"]["properties"]["code"]["enum"])
    assert set(STATUS) == codes
    assert all(400 <= status < 500 for code, status in STATUS.items() if code not in {"computation_failed", "memory_unavailable"})
    assert STATUS["memory_unavailable"] == 503
