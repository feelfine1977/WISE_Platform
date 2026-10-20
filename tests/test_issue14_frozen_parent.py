"""#14: compare the sides of one clause within a parent frozen after the retained steps, against a hand oracle.

The parent is the incidents a retained eligibility step keeps, never the whole log: an incident that step removes is in
neither side, and one whose eligibility is unknown is outside the parent. The clause's sides are A (included) and B
(excluded); a nullable clause leaves its unknowns in neither. The opening context reconciles with missing values, a
field constant in the parent is fixed, both sides' histories are read through their own identities, and an empty side
keeps its denominator unavailable.
"""

import json
from pathlib import Path

import pytest

from test_import_acceptance import envelope, evidence
from test_issue10_interval_tail import client, read, select  # noqa: F401  (client is a fixture)

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "tests/fixtures/frozen-parent"
EXPECTED = json.loads((FIXTURES / "expected.json").read_text(encoding="utf-8"))
POLICY = "incident.context.first_record_in_declared_order.v1"


@pytest.fixture
def opened(client, tmp_path):  # noqa: F811
    return read(client, tmp_path, (FIXTURES / EXPECTED["file"]).read_bytes(), EXPECTED["file"], dict(EXPECTED["mapping"]), EXPECTED["cutoff_utc"])


def compare(client, workspace, base, parent, predicates, column, names=("A", "B")):  # noqa: F811
    response = client.post("/api/investigations/compare-groups", json=envelope("compare_groups_request", workspace_id=workspace["workspace_id"], identity=base["identity"],
        parent_case_ids=parent, context_column_index=column, context_policy=POLICY,
        definition={"mode": "selection_partition", "target_name": names[0], "reference_name": names[1], "predicates": predicates, "target_side": "kept"}))
    assert response.status_code == 200, response.text
    return response.json()


def frozen(client, workspace, base):  # noqa: F811
    retained = select(client, workspace, base, [EXPECTED["retained"]])
    assert (retained["kept"]["case_ids"], retained["removed"]["case_ids"], retained["unevaluable"]["case_ids"]) == (
        EXPECTED["parent"]["case_ids"], EXPECTED["parent"]["outside"], EXPECTED["parent"]["eligibility_unknown"])
    return retained["kept"]["case_ids"]


def test_the_clause_splits_the_frozen_parent_not_the_whole_log(client, opened):  # noqa: F811
    workspace, base = opened
    parent = frozen(client, workspace, base)
    case = EXPECTED["resolution"]
    answer = compare(client, workspace, base, parent, [case["clause"]], EXPECTED["team_column_index"], (case["target_name"], case["reference_name"]))
    assert answer["parent"]["case_ids"] == EXPECTED["parent"]["case_ids"]
    assert (answer["target"]["name"], answer["reference"]["name"]) == (case["target_name"], case["reference_name"])
    assert (answer["target"]["included"]["case_ids"], answer["reference"]["included"]["case_ids"], answer["target"]["unevaluable"]["case_ids"]) == (
        case["target"], case["reference"], case["unevaluable"])
    # Without a frozen parent, the removed side of both steps holds the incident the retained step removed.
    whole = compare(client, workspace, base, None, [EXPECTED["retained"], case["clause"]], EXPECTED["team_column_index"])
    assert whole["reference"]["included"]["case_ids"] == case["whole_log_removed_with_both_steps"]
    # The opening context reconciles over the parent, missing values included.
    rows = {category["value"] if category["value"] is not None else "not recorded": category for category in answer["context_profile"]["categories"]}
    for value, counts in case["team"].items():
        assert (rows[value]["parent"]["case_count"], rows[value]["target"]["case_count"], rows[value]["reference"]["case_count"]) == (
            counts["parent"], counts["target"], counts["reference"]), value


def test_a_nullable_clause_leaves_its_unknowns_in_neither_side(client, opened):  # noqa: F811
    workspace, base = opened
    case = EXPECTED["long_interval"]
    answer = compare(client, workspace, base, frozen(client, workspace, base), [case["clause"]], EXPECTED["team_column_index"])
    assert (answer["target"]["included"]["case_ids"], answer["reference"]["included"]["case_ids"]) == (case["target"], case["reference"])
    assert answer["target"]["unevaluable"]["case_ids"] == answer["reference"]["unevaluable"]["case_ids"] == case["unevaluable"]
    assert answer["pair_support"]["unevaluable"]["case_ids"] == case["unevaluable"]


def test_a_field_constant_in_the_parent_is_fixed_and_both_sides_open_their_histories(client, opened):  # noqa: F811
    workspace, base = opened
    case = EXPECTED["resolution"]
    answer = compare(client, workspace, base, frozen(client, workspace, base), [case["clause"]], EXPECTED["region"]["column_index"])
    assert answer["context_profile"]["parent_fixed"] == {"status": "fixed", "value": EXPECTED["region"]["fixed"], "reason": None}
    for side, cases in (("target", case["target"]), ("reference", case["reference"])):
        records = evidence(client, workspace, {"identity": answer[side]["identity"], "query_revision": 3}, cases[0])["records"]
        assert records and all(record["row_id"] for record in records)
    # An incident of the other side is not read through this side's identity.
    refused = client.post("/api/investigations/case-evidence", json=envelope("imported_case_evidence_request", "case-x", 3, workspace_id=workspace["workspace_id"],
                          identity=answer["target"]["identity"], case_id=case["reference"][0]))
    assert refused.status_code == 404


def test_an_empty_side_keeps_its_denominator_unavailable(client, opened):  # noqa: F811
    workspace, base = opened
    answer = compare(client, workspace, base, frozen(client, workspace, base), [{"kind": "contains_activity", "activity": "Closed", "negate": False}], EXPECTED["team_column_index"])
    assert answer["target"]["included"]["case_count"] == 0 and answer["reference"]["included"]["case_ids"] == EXPECTED["parent"]["case_ids"]
    assert all(category["target"]["denominator"] == 0 and category["difference_percentage_points"]["status"] == "unavailable"
               for category in answer["context_profile"]["categories"])
