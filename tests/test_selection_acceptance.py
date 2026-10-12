"""Independent complete-case selection and supplied-graph HTTP acceptance."""
from copy import deepcopy
import json
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker
import pytest

from test_import_acceptance import (
    client, workspace, checked as checked_import, envelope, evidence,
    evidence_request, mapping_request, policies, population, prepare, read_input,
    refused as refused_import, upload,
)


ROOT = Path(__file__).resolve().parents[1]
SCHEMA = json.loads((ROOT / "contracts" / "selection.schema.json").read_text(encoding="utf-8"))
VALIDATOR = Draft202012Validator(SCHEMA, format_checker=FormatChecker())
SELECT_ROUTE = "/api/investigations/select-cases"
GRAPH_ROUTE = "/api/investigations/process-graph"


def contains(activity, negate=False):
    return {"kind": "contains_activity", "activity": activity, "negate": negate}


def follows(source, target, negate=False):
    return {"kind": "directly_follows", "source_activity": source, "target_activity": target, "negate": negate}


def opening(column, value, negate=False):
    return {"kind": "opening_attribute_equals", "column_index": column, "value": value, "negate": negate,
            "anchor_policy": "incident.context.first_record_in_declared_order.v1"}


def checked_c(response, message_type, request):
    assert 200 <= response.status_code < 300, response.text
    answer = response.json()
    VALIDATOR.validate(answer)
    assert answer["message_type"] == message_type
    assert answer["request_id"] == request["request_id"]
    assert answer["query_revision"] == request["query_revision"]
    assert answer["workspace_id"] == request["workspace_id"]
    return answer


def refused_c(response, operation, codes, request):
    assert 400 <= response.status_code < 500, response.text
    answer = response.json()
    VALIDATOR.validate(answer)
    assert answer["message_type"] == "selection_refusal" and answer["operation"] == operation
    assert answer["code"] in ({codes} if isinstance(codes, str) else set(codes))
    assert answer["message"].strip()
    assert answer["request_id"] == request["request_id"]
    if type(request["query_revision"]) is int and request["query_revision"] >= 1:
        assert answer["query_revision"] == request["query_revision"]
    return answer


def imported(client, workspace, name="B4"):
    literal, raw, _ = read_input(name)
    source = upload(client, workspace, raw, literal["file"])
    interpretation = prepare(client, mapping_request(workspace, source, name))
    return population(client, workspace, interpretation)


def selection_request(workspace, base, predicates=(), parent=None, revision=1, request_id="select-1"):
    return envelope("select_cases_request", request_id, revision,
        workspace_id=workspace["workspace_id"], identity=deepcopy(base["identity"]),
        parent_case_ids=None if parent is None else list(parent), predicates=deepcopy(list(predicates)))


def select(client, workspace, base, predicates=(), parent=None, revision=1, request_id="select-1"):
    request = selection_request(workspace, base, predicates, parent, revision, request_id)
    VALIDATOR.validate(request)
    answer = checked_c(client.post(SELECT_ROUTE, json=request), "selection_answer", request)
    assert answer["parent_identity"] == base["identity"]
    for field in ("source_id", "preparation_id", "representation_id", "case_dictionary_id", "implementation_version"):
        assert answer["identity"][field] == base["identity"][field]
    assert [result["predicate"] for result in answer["predicate_results"]] == request["predicates"]
    return answer


def graph_request(workspace, answer, revision=None):
    return envelope("process_graph_request", "graph-1", answer["query_revision"] if revision is None else revision,
                    workspace_id=workspace["workspace_id"], identity=deepcopy(answer["identity"]))


def graph(client, workspace, answer):
    request = graph_request(workspace, answer)
    VALIDATOR.validate(request)
    result = checked_c(client.post(GRAPH_ROUTE, json=request), "process_graph_answer", request)
    assert result["identity"] == answer["identity"]
    meta = result["graph"]["meta"]
    assert meta["representation_id"] == answer["identity"]["representation_id"]
    assert meta["case_dictionary_id"] == answer["identity"]["case_dictionary_id"]
    assert meta["boundary_policy"] == "incident.boundary.raw_labeled_start_end.v1"
    assert meta["activity_projection_policy"] == "incident.activity.omit_missing_retain_raw_gaps.v1"
    assert meta["path_adjacency"] == "mapped_sequence_with_disclosed_raw_gaps"
    return result["graph"]


def support(answer, field, ids, records):
    assert answer[field] == {"case_ids": ids, "case_count": len(ids), "record_count": records}


def nodes_by_label(graph):
    return {node["label"]: node for node in graph["nodes"]}


def edges_by_labels(graph):
    return {(edge["payload"]["source_activity"], edge["payload"]["target_activity"]): edge for edge in graph["edges"]}


def custom_population(client, workspace, raw, context=False):
    source = upload(client, workspace, raw)
    request = mapping_request(workspace, source, "B3")
    request["policies"]["time"] = policies()["time"]
    request["mapping"]["context_columns"] = [3] if context else []
    return population(client, workspace, prepare(client, request))


def test_b4_real_selection_chips_graph_and_complete_evidence_share_one_population(client, workspace):
    base = imported(client, workspace)
    selected = select(client, workspace, base, [contains("Recorded"), follows("Recorded", "Routed")])
    support(selected, "parent", ["T-01", "T-02"], 5)
    support(selected, "kept", ["T-01"], 4)
    support(selected, "removed", ["T-02"], 1)
    support(selected, "unevaluable", [], 0)
    for chip in selected["predicate_results"]:
        support(chip, "removed", ["T-02"], 1)
        support(chip, "unevaluable", [], 0)
    case = evidence(client, workspace, selected, "T-01")
    assert [record["source_position"] for record in case["records"]] == [1, 2, 3, 0]
    _, _, rows = read_input("B4")
    assert [record["original_cells"] for record in case["records"]] == [rows[index] for index in [1, 2, 3, 0]]
    assert case["coverage"] == {"raw_record_count": 4, "mapped_record_count": 3, "omitted_activity_record_count": 1}
    supplied = graph(client, workspace, selected)
    meta = supplied["meta"]
    assert (meta["selected_case_ids"], meta["selected_case_count"], meta["raw_record_count"], meta["mapped_record_count"], meta["omitted_activity_record_count"]) == (["T-01"], 1, 4, 3, 1)
    assert meta["node_case_denominator"] == meta["path_case_denominator"] == 1
    assert set(nodes_by_label(supplied)) == {"Recorded", "Routed", "Reviewed"}
    paths = edges_by_labels(supplied)
    assert set(paths) == {("Recorded", "Routed"), ("Routed", "Reviewed")}
    assert paths["Recorded", "Routed"]["metrics"] == {"count": 1, "cases": 1, "medianLagHours": 1, "usableLagCount": 1}
    bridge = paths["Routed", "Reviewed"]
    assert bridge["metrics"] == {"count": 1, "cases": 1, "medianLagHours": 0, "usableLagCount": 1}
    assert bridge["payload"]["case_ids"] == bridge["payload"]["gap_case_ids"] == ["T-01"]
    assert bridge["payload"]["omitted_row_ids"] == [case["records"][2]["row_id"]]
    assert bridge["payload"]["bridged_passage_count"] == 1
    assert bridge["tags"] == ["bridged_missing_activity"]


def test_b5_full_graph_counts_identified_raw_activity_and_exposes_unevaluable_sequences(client, workspace):
    base = imported(client, workspace, "B5")
    full = select(client, workspace, base)
    support(full, "kept", ["M-01", "M-02", "M-03"], 4)
    support(full, "removed", [], 0)
    support(full, "unevaluable", [], 0)
    supplied = graph(client, workspace, full)
    assert supplied["edges"] == []
    nodes = nodes_by_label(supplied)
    assert {label: (node["metrics"]["events"], node["metrics"]["cases"]) for label, node in nodes.items()} == {"Recorded": (2, 2), "Routed": (1, 1), "Observed": (1, 1)}
    assert nodes["Observed"]["metrics"]["starts"] == nodes["Observed"]["metrics"]["ends"] == 1
    assert nodes["Recorded"]["metrics"]["starts"] == nodes["Routed"]["metrics"]["ends"] == 0
    meta = supplied["meta"]
    assert meta["node_case_denominator"] == 3 and meta["path_case_denominator"] == 1
    assert meta["sequence_evaluable_case_ids"] == ["M-03"]
    assert meta["sequence_unevaluable_case_ids"] == ["M-01", "M-02"]
    assert meta["sequence_unevaluable_record_count"] == 3
    for case_id, count in [("M-01", 2), ("M-02", 1)]:
        result = evidence(client, workspace, full, case_id)
        assert len(result["records"]) == count and result["sequence_evaluable"] is False


@pytest.mark.parametrize("predicates, kept, removed, unknown, records", [
    ([follows("Recorded", "Routed")], [], ["M-03"], ["M-01", "M-02"], (0, 1, 3)),
    ([follows("Recorded", "Routed", True)], ["M-03"], [], ["M-01", "M-02"], (1, 0, 3)),
    ([follows("Recorded", "Routed"), contains("Z")], [], ["M-01", "M-02", "M-03"], [], (0, 4, 0)),
])
def test_sequence_unknown_is_preserved_by_negation_and_false_dominates_and(client, workspace, predicates, kept, removed, unknown, records):
    base = imported(client, workspace, "B5")
    selected = select(client, workspace, base, predicates)
    support(selected, "kept", kept, records[0])
    support(selected, "removed", removed, records[1])
    support(selected, "unevaluable", unknown, records[2])
    support(selected["predicate_results"][0], "unevaluable", ["M-01", "M-02"], 3)
    supplied = graph(client, workspace, selected)
    assert supplied["meta"]["selected_case_ids"] == kept
    assert supplied["meta"]["raw_record_count"] == records[0]
    if not kept:
        assert supplied["nodes"] == supplied["edges"] == []


def test_frozen_parent_is_explicit_and_does_not_expand_to_other_source_cases(client, workspace):
    base = imported(client, workspace)
    scoped = select(client, workspace, base, [contains("Observed")], parent=["T-01"])
    support(scoped, "parent", ["T-01"], 4)
    support(scoped, "kept", [], 0)
    support(scoped, "removed", ["T-01"], 4)
    subset = select(client, workspace, base, parent=["T-01"], revision=2)
    support(subset, "kept", ["T-01"], 4)
    assert graph(client, workspace, subset)["meta"]["selected_case_ids"] == ["T-01"]
    assert "T-02" not in subset["parent"]["case_ids"]


def test_named_criteria_repeat_and_undo_preserve_meaning_and_node_ids(client, workspace):
    base = imported(client, workspace)
    first = select(client, workspace, base, [contains("Recorded")], revision=2, request_id="first")
    repeat = select(client, workspace, base, [contains("Recorded")], revision=3, request_id="repeat")
    changed = select(client, workspace, base, [follows("Recorded", "Routed")], revision=4, request_id="change")
    undo = select(client, workspace, base, [contains("Recorded")], revision=5, request_id="undo")
    assert first["identity"] == repeat["identity"] == undo["identity"]
    assert changed["identity"]["population_id"] != first["identity"]["population_id"]
    assert changed["kept"] == first["kept"]
    full_graph, selected_graph, undo_graph = graph(client, workspace, base), graph(client, workspace, first), graph(client, workspace, undo)
    full_ids = {node["label"]: node["id"] for node in full_graph["nodes"]}
    assert all(node["id"] == full_ids[node["label"]] for node in selected_graph["nodes"])
    assert selected_graph == undo_graph
    restored = select(client, workspace, base, revision=6, request_id="back-to-all")
    support(restored, "kept", ["T-01", "T-02"], 5)
    assert graph(client, workspace, restored)["meta"]["raw_record_count"] == 5


def test_selected_complete_evidence_refuses_outside_and_mismatched_identities(client, workspace):
    base = imported(client, workspace)
    selected = select(client, workspace, base, [contains("Recorded")])
    request = evidence_request(workspace, selected, "T-02")
    refused_import(client.post("/api/investigations/case-evidence", json=request), "case_evidence", "case_not_found", request)
    request["case_id"] = "T-01"
    request["identity"]["representation_id"] = "representation.v1:sha256:" + "0" * 64
    refused_import(client.post("/api/investigations/case-evidence", json=request), "case_evidence", "identity_mismatch", request)
    current = select(client, workspace, base, [contains("Observed")], revision=2)
    assert evidence(client, workspace, current, "T-02")["coverage"]["raw_record_count"] == 1
    assert evidence(client, workspace, selected, "T-01")["coverage"]["raw_record_count"] == 4


def test_opening_missing_literal_unknown_and_unevaluable_are_distinct(client, workspace):
    raw = (b"Case;Activity;At;Group\r\nA;Start;2026-10-09T08:00:00Z;\r\nA;Next;2026-10-09T09:00:00Z;Desktop\r\n"
           b"B;Observed;2026-10-09T08:00:00Z;Unknown\r\nU;Observed;not-a-time;Unknown\r\n")
    base = custom_population(client, workspace, raw, context=True)
    for predicate, kept, removed, counts in [(opening(3, None), ["A"], ["B"], (2, 1)),
                                             (opening(3, "Unknown"), ["B"], ["A"], (1, 2)),
                                             (opening(3, None, True), ["B"], ["A"], (1, 2))]:
        selected = select(client, workspace, base, [predicate])
        support(selected, "kept", kept, counts[0])
        support(selected, "removed", removed, counts[1])
        support(selected, "unevaluable", ["U"], 1)


def test_graph_repeated_passages_and_zero_lag_are_not_case_support_or_missing(client, workspace):
    raw = (b"Case;Activity;At\r\nX;A;2026-10-09T00:00:00Z\r\nX;B;2026-10-09T01:00:00Z\r\n"
           b"X;A;2026-10-09T02:00:00Z\r\nX;B;2026-10-09T04:00:00Z\r\n"
           b"Y;A;2026-10-09T00:00:00Z\r\nY;B;2026-10-09T00:00:00Z\r\n")
    base = custom_population(client, workspace, raw)
    selected = select(client, workspace, base, [follows("A", "B")])
    support(selected, "kept", ["X", "Y"], 6)
    supplied = graph(client, workspace, selected)
    nodes = nodes_by_label(supplied)
    assert nodes["A"]["metrics"]["events"] == nodes["B"]["metrics"]["events"] == 3
    assert nodes["A"]["metrics"]["cases"] == nodes["B"]["metrics"]["cases"] == 2
    assert edges_by_labels(supplied)["A", "B"]["metrics"] == {"count": 3, "cases": 2, "medianLagHours": 1, "usableLagCount": 3}
    zero = select(client, workspace, base, parent=["Y"])
    assert edges_by_labels(graph(client, workspace, zero))["A", "B"]["metrics"] == {"count": 1, "cases": 1, "medianLagHours": 0, "usableLagCount": 1}


def test_missing_raw_boundaries_do_not_invent_start_or_end_labels(client, workspace):
    raw = (b"Case;Activity;At\r\nX;;2026-10-09T00:00:00Z\r\nX;A;2026-10-09T01:00:00Z\r\n"
           b"X;B;2026-10-09T02:00:00Z\r\nX;;2026-10-09T03:00:00Z\r\n")
    base = custom_population(client, workspace, raw)
    selected = select(client, workspace, base)
    supplied = graph(client, workspace, selected)
    assert len(supplied["edges"]) == 1
    assert all(node["metrics"]["starts"] == node["metrics"]["ends"] == 0 for node in supplied["nodes"])
    assert supplied["meta"]["raw_record_count"] == 4 and supplied["meta"]["omitted_activity_record_count"] == 2
    assert evidence(client, workspace, selected, "X")["coverage"]["raw_record_count"] == 4


def test_wall_clock_graph_does_not_claim_elapsed_utc_lag(client, workspace):
    literal, raw, _ = read_input("B1")
    source = upload(client, workspace, raw, literal["file"])
    base = population(client, workspace, prepare(client, mapping_request(workspace, source, "B1", wall=True)))
    selected = select(client, workspace, base)
    supplied = graph(client, workspace, selected)
    assert supplied["meta"]["timestamp_kind"] == "wall_clock"
    assert supplied["meta"]["lag_clock"] == "recorded_wall_clock_hours"
    assert supplied["meta"]["clock_limitation"]
    assert edges_by_labels(supplied)["Erfasst", "Prüfung"]["metrics"]["medianLagHours"] == 0.5


@pytest.mark.parametrize("mutation, codes", [
    ("schema", {"unsupported_schema"}), ("revision", {"invalid_request", "invalid_parameter"}),
    ("extra", {"invalid_request"}), ("kind", {"invalid_request", "invalid_predicate"}),
    ("policy", {"unsupported_policy", "invalid_request", "invalid_predicate"}),
    ("parent", {"unknown_case", "invalid_parent"}), ("duplicate_parent", {"invalid_request", "invalid_parent"}),
])
def test_invalid_selection_shape_policy_or_parent_refuses_instead_of_defaulting(client, workspace, mutation, codes):
    base = imported(client, workspace)
    request = selection_request(workspace, base, [contains("Recorded")])
    if mutation == "schema":
        request["schema_version"] = 2
    elif mutation == "revision":
        request["query_revision"] = True
    elif mutation == "extra":
        request["hidden_filter"] = "allowed"
    elif mutation == "kind":
        request["predicates"][0]["kind"] = "future_compare"
    elif mutation == "policy":
        request["predicates"] = [{**opening(4, None), "anchor_policy": "incident.context.first_record_in_declared_order.v2"}]
    elif mutation == "parent":
        request["parent_case_ids"] = ["not-in-dictionary"]
    else:
        request["parent_case_ids"] = ["T-01", "T-01"]
    refused_c(client.post(SELECT_ROUTE, json=request), "select_cases", codes, request)


def test_graph_unknown_population_and_mismatched_identity_are_explicit_refusals(client, workspace):
    base = imported(client, workspace)
    selected = select(client, workspace, base, [contains("Recorded")])
    request = graph_request(workspace, selected)
    request["identity"]["population_id"] = "population.v1:sha256:" + "0" * 64
    refused_c(client.post(GRAPH_ROUTE, json=request), "process_graph", {"population_unavailable", "identity_mismatch"}, request)
    request = graph_request(workspace, selected)
    request["identity"]["case_dictionary_id"] = "case-dictionary.v1:sha256:" + "0" * 64
    refused_c(client.post(GRAPH_ROUTE, json=request), "process_graph", "identity_mismatch", request)
    request = selection_request(workspace, selected, [contains("Recorded")])
    refused_c(client.post(SELECT_ROUTE, json=request), "select_cases", "identity_mismatch", request)


def test_selection_and_graph_registry_are_bound_to_the_workspace(client, workspace, tmp_path):
    base = imported(client, workspace)
    selected = select(client, workspace, base, [contains("Recorded")])
    request = selection_request(workspace, base)
    request["workspace_id"] = "workspace.v1:unknown123"
    refused_c(client.post(SELECT_ROUTE, json=request), "select_cases", "workspace_unavailable", request)
    other_path = tmp_path / "other external workspace"
    other_path.mkdir()
    open_request = envelope("open_workspace_request", path=str(other_path))
    other = checked_import(client.post("/api/workspaces/open", json=open_request), "workspace_answer", open_request)
    request = selection_request(other, base)
    refused_c(client.post(SELECT_ROUTE, json=request), "select_cases", {"preparation_unavailable", "source_unavailable", "identity_mismatch"}, request)
    request = graph_request(other, selected)
    refused_c(client.post(GRAPH_ROUTE, json=request), "process_graph", {"population_unavailable", "preparation_unavailable", "identity_mismatch"}, request)
