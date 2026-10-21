"""#15: paired category shares and the oriented concentration ratio on the synthetic S0 profile, with its edge states.

Within the parent of the incidents first recorded at service S (INC01–INC12), the clause "contains Resolved" splits the
recorded resolutions (INC01–INC07) from the incidents with no recorded resolution (INC08–INC12). With the latter as the
target, App is 2/5 against 2/7: a ratio of 1.4, a difference of 80/7 points. Network, absent from the target, is an exact
zero; Email, absent from the reference, has no reference support and no ratio. Exchanging the roles turns the ratio and
the edge states over; the memberships stay. Expectations come from tests/fixtures/incidents/expected.json.
"""

import json
from fractions import Fraction
from pathlib import Path

import pytest

from test_import_acceptance import envelope
from test_issue10_interval_tail import client, read, select  # noqa: F401  (client is a fixture)

ROOT = Path(__file__).resolve().parents[1]
S0 = json.loads((ROOT / "tests/fixtures/incidents/expected.json").read_text(encoding="utf-8"))["fixtures"]["S0"]
MAPPING = {"case_column": 0, "activity_column": 3, "timestamp_column": 4, "sequence_column": 2, "context_columns": [5, 6]}
POLICY = "incident.context.first_record_in_declared_order.v1"
SERVICE = {"kind": "opening_attribute_in", "column_index": 5, "values": [S0["fixed_parent_service"]], "negate": False, "anchor_policy": POLICY}
RESOLVED = {"kind": "contains_activity", "activity": "Resolved", "negate": False}


@pytest.fixture
def compared(client, tmp_path):  # noqa: F811
    workspace, base = read(client, tmp_path, (ROOT / "tests/fixtures/incidents/S0.csv").read_bytes(), "S0.csv", MAPPING, "2026-10-02T00:00:00Z")
    parent = select(client, workspace, base, [SERVICE])["kept"]["case_ids"]
    assert parent == S0["parent_ids"]

    def compare(target_side):
        response = client.post("/api/investigations/compare-groups", json=envelope("compare_groups_request", workspace_id=workspace["workspace_id"], identity=base["identity"],
            parent_case_ids=parent, context_column_index=6, context_policy=POLICY,
            definition={"mode": "selection_partition", "target_name": "Target", "reference_name": "Reference", "predicates": [RESOLVED], "target_side": target_side}))
        assert response.status_code == 200, response.text
        answer = response.json()
        return answer, {category["value"]: category for category in answer["context_profile"]["categories"]}

    return compare


def share(support):
    return Fraction(support["case_count"], support["denominator"])


def test_the_app_profile_is_two_fifths_against_two_sevenths_with_ratio_one_point_four(compared):
    answer, categories = compared("removed")
    assert (answer["target"]["included"]["case_ids"], answer["reference"]["included"]["case_ids"]) == (S0["B_ids"], S0["A_ids"])
    app = categories["App"]
    profile = S0["opening_profile"]["value:App"]
    assert (share(app["target"]), share(app["reference"])) == (Fraction(profile["share_B"]), Fraction(profile["share_A"])) == (Fraction(2, 5), Fraction(2, 7))
    assert app["concentration_ratio"] == {"status": "available", "value": pytest.approx(float(Fraction(profile["composition_B_A"])))}
    assert app["concentration_ratio"]["value"] == pytest.approx(1.4)
    assert app["difference_percentage_points"]["value"] == pytest.approx(float(Fraction(profile["delta_B_A_pp"])))
    # Every value's support is exact, missing included, and the shares of a side add up.
    for key, expected in S0["opening_profile"].items():
        value = None if key.startswith("missing:") else key.split(":", 1)[1]
        assert (categories[value]["target"]["case_count"], categories[value]["reference"]["case_count"]) == (len(expected["B_ids"]), len(expected["A_ids"])), key
    assert sum(category["target"]["case_count"] for category in categories.values()) == len(S0["B_ids"])


def test_zero_support_states_are_named_and_turn_over_with_the_roles(compared):
    _, categories = compared("removed")
    # Absent from the target: an exact zero for this snapshot. Absent from the reference: no reference support, no ratio.
    assert categories["Network"]["concentration_ratio"] == {"status": "available", "value": 0}
    assert categories["Email"]["concentration_ratio"] == {"status": "unavailable", "reason": "zero_reference_share"}
    reversed_answer, reversed_categories = compared("kept")
    assert (reversed_answer["target"]["included"]["case_ids"], reversed_answer["reference"]["included"]["case_ids"]) == (S0["A_ids"], S0["B_ids"])
    assert reversed_categories["App"]["concentration_ratio"]["value"] == pytest.approx(5 / 7)
    assert reversed_categories["App"]["difference_percentage_points"]["value"] == pytest.approx(-80 / 7)
    assert reversed_categories["Network"]["concentration_ratio"] == {"status": "unavailable", "reason": "zero_reference_share"}
    assert reversed_categories["Email"]["concentration_ratio"] == {"status": "available", "value": 0}
