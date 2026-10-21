"""#16: a separately named outcome over the frozen parent, its known subset, its rate by opening value and its lift.

On the synthetic S0 file, within the parent of the incidents first recorded at service S, outcome O is "no recorded
Resolved" at the snapshot. Every incident's presence is known, so K is the whole parent; the parent's rate is 5/12; App's
is 2/4, a lift of 1.2, apart from the profile ratio 1.4. Every value's rate and lift is the oracle's
(tests/fixtures/incidents/expected.json). An activity no record carries names no outcome: unavailable, not zero.
Witnesses and counterexamples are the exact incidents of each value with and without O, and open in the parent.
"""

import json
from fractions import Fraction
from pathlib import Path

import pytest

from test_import_acceptance import envelope, evidence
from test_issue10_interval_tail import client, read, select  # noqa: F401  (client is a fixture)

ROOT = Path(__file__).resolve().parents[1]
S0 = json.loads((ROOT / "tests/fixtures/incidents/expected.json").read_text(encoding="utf-8"))["fixtures"]["S0"]
MAPPING = {"case_column": 0, "activity_column": 3, "timestamp_column": 4, "sequence_column": 2, "context_columns": [5, 6]}
POLICY = "incident.context.first_record_in_declared_order.v1"
SERVICE = {"kind": "opening_attribute_in", "column_index": 5, "values": [S0["fixed_parent_service"]], "negate": False, "anchor_policy": POLICY}
OUTCOME = {"policy": "incident.outcome.recorded_activity_presence_at_snapshot.v1", "activity": "Resolved", "counted": "absence"}


@pytest.fixture
def parent(client, tmp_path):  # noqa: F811
    workspace, base = read(client, tmp_path, (ROOT / "tests/fixtures/incidents/S0.csv").read_bytes(), "S0.csv", MAPPING, "2026-10-02T00:00:00Z")
    selected = select(client, workspace, base, [SERVICE])
    assert selected["kept"]["case_ids"] == S0["parent_ids"]
    return workspace, {**selected, "base_identity": base["identity"]}


def rates(client, workspace, identity, outcome=OUTCOME, column=6):  # noqa: F811
    return client.post("/api/investigations/outcome-rates", json=envelope("outcome_rates_request", "outcome-1", 3, workspace_id=workspace["workspace_id"],
                       identity=identity, context_column_index=column, context_policy=POLICY, outcome=outcome))


def test_the_named_outcome_has_its_known_subset_and_the_app_lift_of_one_point_two(client, parent):  # noqa: F811
    workspace, selected = parent
    response = rates(client, workspace, selected["identity"])
    assert response.status_code == 200, response.text
    answer = response.json()
    assert (answer["status"], answer["outcome"], answer["snapshot_cutoff"]) == ("available", OUTCOME, "2026-10-02T00:00:00Z")
    # K is the whole parent: whether a record of Resolved is in a history is always known.
    assert (answer["parent_case_count"], answer["known_case_count"], answer["unknown_case_count"]) == (12, 12, 0)
    assert Fraction(answer["counted_case_count"], answer["known_case_count"]) == Fraction(5, 12)
    by_value = {category["value"]: category for category in answer["categories"]}
    app = by_value["App"]
    assert (len(app["counted_case_ids"]), app["known_case_count"]) == (2, 4)
    assert app["lift"] == {"status": "available", "value": pytest.approx(1.2)}
    for key, expected in S0["opening_profile"].items():
        value = None if key.startswith("missing:") else key.split(":", 1)[1]
        category = by_value[value]
        assert Fraction(len(category["counted_case_ids"]), category["known_case_count"]) == Fraction(expected["outcome_no_resolution_rate"]), key
        assert category["lift"]["value"] == pytest.approx(float(Fraction(expected["outcome_lift"]))), key
        # The witnesses are the incidents with O, the counterexamples those without, exactly.
        assert sorted(category["counted_case_ids"] + category["other_case_ids"]) == sorted(expected["A_ids"] + expected["B_ids"]), key
        assert set(category["counted_case_ids"]) == set(expected["B_ids"]), key


def test_presence_counts_the_other_way_and_an_unrecorded_activity_names_no_outcome(client, parent):  # noqa: F811
    workspace, selected = parent
    presence = rates(client, workspace, selected["identity"], {**OUTCOME, "counted": "presence"}).json()
    assert Fraction(presence["counted_case_count"], presence["known_case_count"]) == Fraction(7, 12)
    never = rates(client, workspace, selected["identity"], {**OUTCOME, "activity": "Closed"}).json()
    assert (never["status"], never["reason"], never["known_case_count"], never["unknown_case_count"], never["rate"]) == ("unavailable", "activity_never_recorded", 0, 12, None)
    assert all(category["lift"] == {"status": "unavailable", "reason": "outcome_unavailable"} for category in never["categories"])


def test_witnesses_open_in_the_parent_and_refusals_are_named(client, parent):  # noqa: F811
    workspace, selected = parent
    answer = rates(client, workspace, selected["identity"]).json()
    witness = next(category for category in answer["categories"] if category["value"] == "App")["counted_case_ids"][0]
    assert evidence(client, workspace, selected, witness)["case_id"] == witness
    unmapped = rates(client, workspace, selected["identity"], column=3)
    assert (unmapped.status_code, unmapped.json()["code"]) == (400, "unmapped_context_column")
    other = rates(client, workspace, selected["identity"], {**OUTCOME, "policy": "incident.outcome.duration.v1"})
    assert other.status_code == 400 and other.json()["field"].startswith("outcome")


def test_reversed_roles_and_an_inverted_clause_are_kept_apart_by_a_saved_answer(client, parent):  # noqa: F811
    workspace, selected = parent

    def compare(predicate, target_side):
        response = client.post("/api/investigations/compare-groups", json=envelope("compare_groups_request", workspace_id=workspace["workspace_id"],
            identity=selected["base_identity"], parent_case_ids=S0["parent_ids"], context_column_index=6, context_policy=POLICY,
            definition={"mode": "selection_partition", "target_name": "Target", "reference_name": "Reference", "predicates": [predicate], "target_side": target_side}))
        assert response.status_code == 200, response.text
        return response.json()

    resolved = {"kind": "contains_activity", "activity": "Resolved", "negate": False}
    reversed_roles = compare(resolved, "removed")
    inverted = compare({**resolved, "negate": True}, "kept")
    # Both put the incidents with no recorded resolution in the target, by different definitions with different identities.
    assert reversed_roles["target"]["included"]["case_ids"] == inverted["target"]["included"]["case_ids"] == S0["B_ids"]
    assert reversed_roles["comparison_id"] != inverted["comparison_id"]
    # Inverting the clause turns the unknown and the membership over within the predicate; reversing the roles only exchanges the sides.
    for answer, predicate, side in ((reversed_roles, resolved, "removed"), (inverted, {**resolved, "negate": True}, "kept")):
        saved_comparison = {"kind": "group", "comparison_id": answer["comparison_id"], "parent_case_ids": S0["parent_ids"], "context_column_index": 6,
                            "context_policy": POLICY, "definition": {"mode": "selection_partition", "target_name": "Target", "reference_name": "Reference",
                                                                     "predicates": [predicate], "target_side": side}}
        saved = client.post("/api/investigations/save", json=envelope("save_investigation_request", workspace_id=workspace["workspace_id"], investigation_id=None,
            expected_revision_id=None, name=f"Roles {side}", base_identity=selected["base_identity"], selection_identity=selected["identity"],
            selection_recipe={"parent_case_ids": selected["parent"]["case_ids"], "predicates": [SERVICE]}, context_policy=POLICY, comparison=saved_comparison, notes="", bookmarks=[]))
        assert saved.status_code == 200, saved.text
        reopened = client.post("/api/investigations/reopen", json=envelope("reopen_investigation_request", workspace_id=workspace["workspace_id"],
                               saved_revision_id=saved.json()["revision"]["saved_revision_id"])).json()
        kept = reopened["revision"]["content"]["comparison"]
        assert (kept["definition"]["target_side"], kept["definition"]["predicates"], kept["comparison_id"]) == (side, [predicate], answer["comparison_id"])
