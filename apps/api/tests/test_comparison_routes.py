"""Comparing two groups and two periods of a preparation, through their routes.

The literal log below has five incidents; its snapshot cutoff is 2026-10-06 00:00 UTC. Every
expected membership, count, share and hour was worked out by hand from it:

    A  Opened Oct 1 08:00, Resolved Oct 1 10:00     2 records  opens at East
    B  Opened Oct 2 08:00, Assigned Oct 2 09:00     2 records  opens with Desk missing (West later)
    C  Opened Oct 5 08:00, Resolved Oct 5 09:00     2 records  opens at West
    D  Opened (unreadable time), Resolved Oct 5     2 records  order not known, so no opening and no start
    E  Opened Oct 5 20:00                           1 record   opens at the literal text "Unknown"

The parent is 5 incidents with 9 records; the opening of 4 of them (A, B, C, E) can be read.
"""

import hashlib
import json
from copy import deepcopy
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from import_requests import envelope, policies
from jsonschema import Draft202012Validator, FormatChecker

from wise_platform_analytics.mapping import ImportRefusal
from wise_platform_api import comparisons as comparisons_module
from wise_platform_api.app import create_app
from wise_platform_api.comparison_boundary import STATUS

ROOT = Path(__file__).resolve().parents[3]
SCHEMA = json.loads((ROOT / "contracts" / "comparison.schema.json").read_text(encoding="utf-8"))
VALIDATOR = Draft202012Validator(SCHEMA, format_checker=FormatChecker())
GROUPS = "/api/investigations/compare-groups"
PERIODS = "/api/investigations/compare-periods"
EVIDENCE = "/api/investigations/case-evidence"
GRAPH = "/api/investigations/process-graph"
POLICY = "incident.context.first_record_in_declared_order.v1"
CUTOFF = "2026-10-06T00:00:00Z"

LOG = (
    "Ticket,Activity,At,Desk\r\n"
    "A,Opened,2026-10-01T08:00:00Z,East\r\n"
    "A,Resolved,2026-10-01T10:00:00Z,East\r\n"
    "B,Opened,2026-10-02T08:00:00Z,\r\n"
    "B,Assigned,2026-10-02T09:00:00Z,West\r\n"
    "C,Opened,2026-10-05T08:00:00Z,West\r\n"
    "C,Resolved,2026-10-05T09:00:00Z,West\r\n"
    "D,Opened,not-a-time,East\r\n"
    "D,Resolved,2026-10-05T10:00:00Z,East\r\n"
    "E,Opened,2026-10-05T20:00:00Z,Unknown\r\n"
).encode("utf-8")
LOG_ID = "source.v1:sha256:" + hashlib.sha256(LOG).hexdigest()


def support(*ids, records):
    return {"case_ids": list(ids), "case_count": len(ids), "record_count": records}


NONE = support(records=0)


def share(value):
    return {"status": "available", "value": value}


def unavailable(reason):
    return {"status": "unavailable", "reason": reason}


def opening(column, value, negate=False, anchor=POLICY):
    return {"kind": "opening_attribute_equals", "column_index": column, "value": value, "negate": negate,
            "anchor_policy": anchor}


def follows(source, target, negate=False):
    return {"kind": "directly_follows", "source_activity": source, "target_activity": target, "negate": negate}


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(static_dir=tmp_path / "unbuilt")) as active:
        yield active


@pytest.fixture
def workspace_id(client, tmp_path):
    folder = tmp_path / "Vergleich Ablage"
    folder.mkdir()
    response = client.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(folder)))
    assert response.status_code == 200, response.text
    return response.json()["workspace_id"]


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
        policies=policies("iso8601", None, cutoff=CUTOFF), accept_report_issues=True)
    prepared = client.post("/api/preparations", json=confirmation).json()
    assert prepared["state"] == "ready", prepared
    request = envelope("open_population_request", "population-1", workspace_id=workspace_id,
                       preparation_id=prepared["preparation"]["preparation_id"])
    response = client.post("/api/investigations/open-population", json=request)
    assert response.status_code == 200, response.text
    return response.json()


def explicit(target, reference, names=("Group A", "Group B")):
    return {"mode": "two_named_groups",
            "target": {"name": names[0], "definition": {"kind": "explicit_case_ids", "case_ids": list(target)}},
            "reference": {"name": names[1], "definition": {"kind": "explicit_case_ids", "case_ids": list(reference)}}}


def partition(predicates, side="kept"):
    return {"mode": "selection_partition", "target_name": "Kept", "reference_name": "Removed",
            "predicates": list(predicates), "target_side": side}


def window(start, end, kind="utc_instant"):
    return {"timestamp_kind": kind, "start_inclusive": start, "end_exclusive": end}


def periods(minimum=4, endpoint="Resolved"):
    return {"target": {"name": "First days", "window": window("2026-10-01T00:00:00Z", "2026-10-03T00:00:00Z")},
            "reference": {"name": "Last days", "window": window("2026-10-05T00:00:00Z", "2026-10-06T00:00:00Z")},
            "minimum_followup_hours": minimum, "endpoint_activity": endpoint}


def comparison(workspace_id, base, definition, kind="compare_groups_request", parent=None, column=3, revision=2):
    return envelope(kind, f"compare-{revision}", revision, workspace_id=workspace_id,
                    identity=deepcopy(base["identity"]), parent_case_ids=parent, context_column_index=column,
                    context_policy=POLICY, definition=definition)


def period_request(workspace_id, base, definition=None, **fields):
    return comparison(workspace_id, base, periods() if definition is None else definition,
                      "compare_periods_request", **fields)


def answered(response, request, message_type):
    assert response.status_code == 200, response.text
    answer = response.json()
    VALIDATOR.validate(answer)
    assert answer["message_type"] == message_type
    assert (answer["request_id"], answer["query_revision"], answer["workspace_id"]) == (
        request["request_id"], request["query_revision"], request["workspace_id"])
    assert answer["identity"] == request["identity"]
    return answer


def refused(response, operation, code, field=None):
    body = response.json()
    VALIDATOR.validate(body)
    assert body["message_type"] == "comparison_refusal", body
    assert (body["operation"], body["code"]) == (operation, code), body
    assert response.status_code == STATUS[code]
    assert body["message"].strip()
    if field is not None:
        assert body["field"] == field, body
    return body


# Two named groups ------------------------------------------------------------------------------


def test_explicit_groups_carry_supports_shares_with_denominators_differences_and_ratios(client, workspace_id, base):
    request = comparison(workspace_id, base, explicit(["A", "B", "E"], ["C", "D"]))
    answer = answered(client.post(GROUPS, json=request), request, "group_comparison_answer")
    assert answer["parent"] == support("A", "B", "C", "D", "E", records=9)
    assert answer["target"]["name"] == "Group A" and answer["reference"]["name"] == "Group B"
    assert answer["target"]["included"] == support("A", "B", "E", records=5)
    assert answer["target"]["excluded"] == support("C", "D", records=4)
    assert answer["reference"]["included"] == support("C", "D", records=4)
    # A literal list is known for every incident, also for D whose order is not known.
    assert answer["target"]["unevaluable"] == answer["reference"]["unevaluable"] == NONE
    assert answer["pair_support"] == {"overlap": NONE, "target_only": support("A", "B", "E", records=5),
                                      "reference_only": support("C", "D", records=4), "neither": NONE,
                                      "unevaluable": NONE}
    profile = answer["context_profile"]
    assert profile["denominator_basis"] == "context_evaluable_cases"
    assert profile["parent_evaluable"] == support("A", "B", "C", "E", records=7)
    assert profile["parent_unevaluable"] == support("D", records=2)
    assert profile["reference_evaluable"] == support("C", records=2)
    assert profile["reference_unevaluable"] == support("D", records=2)
    assert profile["parent_fixed"] == {"status": "unavailable", "value": None, "reason": "unevaluable_context"}
    categories = {item["value"]: item for item in profile["categories"]}
    assert list(categories) == [None, "East", "Unknown", "West"]
    east = categories["East"]
    assert east["parent"] == {"case_count": 1, "denominator": 4, "share": share(0.25)}
    assert east["target"]["case_count"] == 1 and east["target"]["denominator"] == 3
    assert east["target"]["share"]["value"] == pytest.approx(1 / 3)
    assert east["reference"] == {"case_count": 0, "denominator": 1, "share": share(0)}
    assert east["difference_percentage_points"]["value"] == pytest.approx(100 / 3)
    assert east["concentration_ratio"] == unavailable("zero_reference_share")
    west = categories["West"]
    assert west["reference"] == {"case_count": 1, "denominator": 1, "share": share(1)}
    assert west["difference_percentage_points"] == share(-100)
    assert west["concentration_ratio"] == share(0)
    # Missing at the opening and the literal text "Unknown" are two categories.
    assert categories[None]["target"]["case_count"] == categories["Unknown"]["target"]["case_count"] == 1


def test_names_and_request_do_not_change_the_comparison_id_but_membership_does(client, workspace_id, base):
    first = comparison(workspace_id, base, explicit(["A", "B"], ["C"]))
    renamed = comparison(workspace_id, base, explicit(["B", "A"], ["C"], ("Early desk", "Late desk")), revision=3)
    other = comparison(workspace_id, base, explicit(["A"], ["C"]), revision=4)
    ids = [answered(client.post(GROUPS, json=r), r, "group_comparison_answer")["comparison_id"]
           for r in (first, renamed, other)]
    assert ids[0] == ids[1] != ids[2]


def test_kept_against_removed_keeps_unevaluable_incidents_apart_and_reverses_with_the_side(
        client, workspace_id, base):
    # Resolved directly follows Opened in A and C, not in B and E; D's order is not known.
    request = comparison(workspace_id, base, partition([follows("Opened", "Resolved")]))
    answer = answered(client.post(GROUPS, json=request), request, "group_comparison_answer")
    assert (answer["target"]["name"], answer["reference"]["name"]) == ("Kept", "Removed")
    assert answer["target"]["included"] == support("A", "C", records=4)
    assert answer["reference"]["included"] == support("B", "E", records=3)
    assert answer["target"]["unevaluable"] == answer["reference"]["unevaluable"] == support("D", records=2)
    assert answer["pair_support"]["unevaluable"] == support("D", records=2)
    assert answer["pair_support"]["overlap"] == answer["pair_support"]["neither"] == NONE
    opposite = comparison(workspace_id, base, partition([follows("Opened", "Resolved")], "removed"), revision=3)
    reversed_answer = answered(client.post(GROUPS, json=opposite), opposite, "group_comparison_answer")
    assert reversed_answer["target"]["included"] == answer["reference"]["included"]
    assert reversed_answer["reference"]["included"] == answer["target"]["included"]
    assert reversed_answer["comparison_id"] != answer["comparison_id"]


def test_predicate_groups_overlap_within_a_listed_parent(client, workspace_id, base):
    # Within A, B, C: opening East is A; opening not West is A and B (B opens with Desk missing).
    definition = {"mode": "two_named_groups",
                  "target": {"name": "East", "definition": {"kind": "predicates", "predicates": [opening(3, "East")]}},
                  "reference": {"name": "Not West",
                                "definition": {"kind": "predicates", "predicates": [opening(3, "West", True)]}}}
    request = comparison(workspace_id, base, definition, parent=["C", "B", "A"])
    answer = answered(client.post(GROUPS, json=request), request, "group_comparison_answer")
    assert answer["parent"] == support("A", "B", "C", records=6)
    assert answer["target"]["included"] == support("A", records=2)
    assert answer["reference"]["included"] == support("A", "B", records=4)
    assert answer["pair_support"]["overlap"] == support("A", records=2)
    assert answer["pair_support"]["reference_only"] == support("B", records=2)
    assert answer["pair_support"]["neither"] == support("C", records=2)


def test_an_empty_group_is_answered_as_empty_and_an_empty_parent_as_no_incident(client, workspace_id, base):
    request = comparison(workspace_id, base, explicit(["A"], []))
    answer = answered(client.post(GROUPS, json=request), request, "group_comparison_answer")
    assert answer["reference"]["included"] == NONE
    for category in answer["context_profile"]["categories"]:
        assert category["reference"] == {"case_count": 0, "denominator": 0,
                                         "share": unavailable("empty_profile_denominator")}
        assert category["concentration_ratio"] == unavailable("empty_reference_profile")
    empty = comparison(workspace_id, base, explicit([], []), parent=[], revision=3)
    nothing = answered(client.post(GROUPS, json=empty), empty, "group_comparison_answer")
    assert nothing["parent"] == NONE
    assert nothing["context_profile"]["categories"] == []


# Two periods -----------------------------------------------------------------------------------


def test_periods_take_incident_starts_and_report_followup_to_the_stored_cutoff(client, workspace_id, base):
    request = period_request(workspace_id, base)
    answer = answered(client.post(PERIODS, json=request), request, "period_comparison_answer")
    assert answer["target"]["included"] == support("A", "B", records=4)
    assert answer["reference"]["included"] == support("C", "E", records=3)
    assert answer["target"]["unevaluable"] == answer["reference"]["unevaluable"] == support("D", records=2)
    assert answer["pair_support"]["unevaluable"] == support("D", records=2)
    assert answer["followup_clock"] == {
        "timestamp_kind": "utc_instant", "duration_clock": "elapsed_utc_hours", "clock_limitation": None,
        "snapshot_cutoff": {"timestamp_kind": "utc_instant", "utc_instant": CUTOFF, "local_timestamp": None}}
    hours = {item["case_id"]: (item["followup_hours"], item["status"])
             for role in ("target", "reference") for item in answer[role]["exposure"]["cases"]}
    # A: Oct 1 08:00 to Oct 6 00:00 is 4 days and 16 hours; E starts exactly 4 hours before the cutoff.
    assert hours == {"A": (112, "adequate"), "B": (88, "adequate"), "C": (16, "adequate"), "E": (4, "adequate")}
    assert answer["reference"]["endpoint_coverage"] == {
        "activity": "Resolved", "basis": "recorded_activity_presence_in_complete_history",
        "recorded": support("C", records=2), "not_recorded": support("E", records=1)}
    assert answer["target"]["endpoint_coverage"]["recorded"] == support("A", records=2)


def test_a_whole_number_and_the_same_number_with_a_fraction_are_one_minimum(client, workspace_id, base):
    whole = period_request(workspace_id, base)
    fraction = period_request(workspace_id, base, periods(minimum=4.0), revision=3)
    body = json.dumps(fraction).encode("utf-8")
    assert b'"minimum_followup_hours": 4.0' in body
    one = answered(client.post(PERIODS, json=whole), whole, "period_comparison_answer")
    response = client.post(PERIODS, content=body, headers={"Content-Type": "application/json"})
    other = answered(response, fraction, "period_comparison_answer")
    assert one["comparison_id"] == other["comparison_id"]
    stricter = period_request(workspace_id, base, periods(minimum=4.5), revision=4)
    later = answered(client.post(PERIODS, json=stricter), stricter, "period_comparison_answer")
    assert later["reference"]["exposure"]["inadequate"] == support("E", records=1)
    assert later["comparison_id"] != one["comparison_id"]


def test_without_an_endpoint_no_coverage_is_reported(client, workspace_id, base):
    request = period_request(workspace_id, base, periods(endpoint=None))
    answer = answered(client.post(PERIODS, json=request), request, "period_comparison_answer")
    assert answer["target"]["endpoint_coverage"] is None and answer["reference"]["endpoint_coverage"] is None


# The compared populations, through the other routes --------------------------------------------


def test_the_parent_and_both_groups_can_be_opened_without_selecting_them_first(client, workspace_id, base):
    request = comparison(workspace_id, base, explicit(["A", "B", "E"], ["C", "D"]), parent=["A", "B", "C", "D", "E"])
    answer = answered(client.post(GROUPS, json=request), request, "group_comparison_answer")

    def evidence(identity, case_id):
        message = envelope("imported_case_evidence_request", "case-1", 2, workspace_id=workspace_id,
                           identity=identity, case_id=case_id)
        return client.post(EVIDENCE, json=message)

    history = evidence(answer["reference"]["identity"], "D")
    assert history.status_code == 200, history.text
    # Both records; the one whose time cannot be read is listed after the others.
    assert [record["activity"] for record in history.json()["records"]] == ["Resolved", "Opened"]
    outside = evidence(answer["reference"]["identity"], "A")
    assert (outside.status_code, outside.json()["code"]) == (404, "case_not_found")
    graph = client.post(GRAPH, json=envelope("process_graph_request", "graph-1", 2, workspace_id=workspace_id,
                                             identity=answer["target"]["identity"]))
    assert graph.status_code == 200, graph.text
    assert graph.json()["graph"]["meta"]["selected_case_ids"] == ["A", "B", "E"]
    parent = evidence(answer["parent_identity"], "E")
    assert parent.status_code == 200, parent.text


# Refusals --------------------------------------------------------------------------------------


@pytest.mark.parametrize(("change", "code", "field"), [
    (lambda r: r.update(parent_case_ids=["A", "Z"]), "unknown_case", None),
    (lambda r: r.update(parent_case_ids=["A", "A"]), "invalid_parent", "parent_case_ids"),
    (lambda r: r.update(parent_case_ids=["A", "B"]), "case_outside_parent", "definition.reference.definition.case_ids"),
    (lambda r: r["definition"]["target"]["definition"].update(case_ids=["A", "A"]), "invalid_parameter",
     "definition.target.definition.case_ids"),
    (lambda r: r["definition"]["target"]["definition"].update(case_ids=["Z"]), "unknown_case", None),
    (lambda r: r["definition"]["target"].update(name=" "), "invalid_parameter", "definition.target.name"),
    (lambda r: r["definition"].update(mode="three_groups"), "invalid_parameter", "definition.mode"),
    (lambda r: r["definition"]["target"].update(definition={"kind": "predicates", "predicates": [
        {"kind": "starts_with", "activity": "Opened", "negate": False}]}), "invalid_predicate",
     "definition.target.definition.predicates.0.kind"),
    (lambda r: r["definition"]["target"].update(definition={"kind": "predicates", "predicates": [
        follows("Opened", "")]}), "invalid_predicate", "definition.target.definition.predicates.0.target_activity"),
    (lambda r: r["definition"]["target"].update(definition={"kind": "predicates", "predicates": [
        opening(3, "East", anchor="first_nonmissing")]}), "unsupported_policy",
     "definition.target.definition.predicates.0.anchor_policy"),
    (lambda r: r.update(context_policy="first_nonmissing"), "unsupported_policy", "context_policy"),
    (lambda r: r.update(context_column_index=2), "unmapped_context_column", "context_column_index"),
    (lambda r: r.update(context_column_index=True), "invalid_request", "context_column_index"),
    (lambda r: r.update(query_revision=2.0), "invalid_request", "query_revision"),
    (lambda r: r.update(schema_version=2), "unsupported_schema", "schema_version"),
    (lambda r: r.update(norm_id="unasked"), "invalid_request", "norm_id"),
    (lambda r: r["identity"].update(case_dictionary_id="case-dictionary.v1:sha256:" + "0" * 64),
     "identity_mismatch", "identity"),
    (lambda r: r.update(workspace_id="workspace.v1:unopened-1"), "workspace_unavailable", "workspace_id"),
])
def test_group_comparisons_refuse_what_cannot_be_evaluated(client, workspace_id, base, change, code, field):
    request = comparison(workspace_id, base, explicit(["A"], ["C"]), parent=["A", "C"])
    change(request)
    body = refused(client.post(GROUPS, json=request), "compare_groups", code, field)
    if code != "invalid_request" or field != "query_revision":
        assert (body["request_id"], body["query_revision"]) == ("compare-2", 2)


def test_a_selected_identity_is_not_a_base_for_a_comparison(client, workspace_id, base):
    request = comparison(workspace_id, base, explicit(["A"], ["C"]))
    first = answered(client.post(GROUPS, json=request), request, "group_comparison_answer")
    request["identity"] = first["target"]["identity"]
    refused(client.post(GROUPS, json=request), "compare_groups", "identity_mismatch", "identity")


def utc_to_wall(r, roles=("target", "reference")):
    for role in roles:
        w = r["definition"][role]["window"]
        w.update(timestamp_kind="wall_clock", start_inclusive=w["start_inclusive"][:-1],
                 end_exclusive=w["end_exclusive"][:-1])


@pytest.mark.parametrize(("change", "code", "field"), [
    (lambda r: r["definition"]["target"]["window"].update(end_exclusive="2026-10-01T00:00:00Z"), "invalid_window",
     "definition.target.window"),
    (lambda r: r["definition"]["target"]["window"].update(end_exclusive="2026-09-30T00:00:00Z"), "invalid_window",
     "definition.target.window"),
    (lambda r: r["definition"]["target"]["window"].update(start_inclusive="2026-02-30T00:00:00Z"), "invalid_window",
     "definition.target.window.start_inclusive"),
    (lambda r: r["definition"]["target"]["window"].update(start_inclusive="2026-10-01T00:00:00+00:00"),
     "invalid_window", "definition.target.window.start_inclusive"),
    (utc_to_wall, "clock_mismatch", "definition.target.window.timestamp_kind"),
    (lambda r: utc_to_wall(r, ("reference",)), "clock_mismatch", "definition.reference.window.timestamp_kind"),
    (lambda r: r["definition"].update(minimum_followup_hours=-1), "invalid_parameter",
     "definition.minimum_followup_hours"),
    (lambda r: r["definition"].update(minimum_followup_hours=True), "invalid_parameter",
     "definition.minimum_followup_hours"),
    (lambda r: r["definition"].update(minimum_followup_hours="4"), "invalid_parameter",
     "definition.minimum_followup_hours"),
    (lambda r: r["definition"].update(minimum_followup_hours=10 ** 30), "invalid_parameter",
     "definition.minimum_followup_hours"),
    (lambda r: r["definition"].update(endpoint_activity=""), "invalid_parameter", "definition.endpoint_activity"),
    (lambda r: r["definition"].pop("endpoint_activity"), "invalid_parameter", "definition.endpoint_activity"),
    (lambda r: r["definition"].update(snapshot_cutoff_utc="2027-01-01T00:00:00Z"), "invalid_parameter",
     "definition.snapshot_cutoff_utc"),
])
def test_period_comparisons_refuse_windows_clocks_and_minimums_they_cannot_use(
        client, workspace_id, base, change, code, field):
    request = period_request(workspace_id, base)
    change(request)
    refused(client.post(PERIODS, json=request), "compare_periods", code, field)


@pytest.mark.parametrize("number", [b"NaN", b"Infinity", b"-Infinity", b"1e400"])
def test_numbers_json_does_not_have_are_refused_before_anything_is_read(client, workspace_id, base, number):
    body = json.dumps(period_request(workspace_id, base)).encode("utf-8").replace(
        b'"minimum_followup_hours": 4', b'"minimum_followup_hours": ' + number)
    assert number in body
    body = refused(client.post(PERIODS, content=body, headers={"Content-Type": "application/json"}),
                   "compare_periods", "invalid_request")
    assert body["request_id"] is None and body["field"] is None


def test_a_refusal_the_contract_does_not_name_and_an_unexpected_failure_are_computation_failures(
        client, workspace_id, base, monkeypatch):
    request = comparison(workspace_id, base, explicit(["A"], ["C"]))
    monkeypatch.setattr(comparisons_module, "compare_groups",
                        lambda *arguments: ImportRefusal("mixed_time_kinds", "Not one clock.", None))
    body = refused(client.post(GROUPS, json=request), "compare_groups", "computation_failed")
    assert body["retryable"] is True

    def broken(*arguments):
        raise RuntimeError("unexpected")

    monkeypatch.setattr(comparisons_module, "compare_groups", broken)
    refused(client.post(GROUPS, json=request), "compare_groups", "computation_failed")


def test_every_code_of_the_contract_has_a_status():
    codes = SCHEMA["$defs"]["ComparisonRefusal"]["properties"]["code"]["enum"]
    assert sorted(STATUS) == sorted(codes)
    assert all(400 <= status < 600 for status in STATUS.values())
