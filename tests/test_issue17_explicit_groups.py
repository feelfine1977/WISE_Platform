"""#17: two explicitly defined groups, overlapping or disjoint, compared in the whole parent and within one stratum.

The overlapping explicit groups of tests/fixtures/comparisons/expected.json keep their literal memberships: the reference
is never the rest of the parent. Within the stratum Priority High (a frozen parent of the incidents first recorded with
it), two disjoint condition groups of unequal size compare their Service at the first record, the missing value
included, as tests/fixtures/comparisons/strata.json says; the same groups over every incident are larger.
"""

import json
from pathlib import Path

from test_comparison_acceptance import client, explicit_groups, source_population, workspace  # noqa: F401  (fixtures)
from test_import_acceptance import envelope
from test_issue10_interval_tail import select

ROOT = Path(__file__).resolve().parents[1]
EXPECTED = json.loads((ROOT / "tests/fixtures/comparisons/expected.json").read_text(encoding="utf-8"))
STRATA = json.loads((ROOT / "tests/fixtures/comparisons/strata.json").read_text(encoding="utf-8"))
POLICY = "incident.context.first_record_in_declared_order.v1"


def compare(client, workspace, base, definition, parent=None, column=4):  # noqa: F811
    response = client.post("/api/investigations/compare-groups", json=envelope("compare_groups_request", workspace_id=workspace["workspace_id"], identity=base["identity"],
                           parent_case_ids=parent, context_column_index=column, context_policy=POLICY, definition=definition))
    assert response.status_code == 200, response.text
    return response.json()


def team(name, value):
    return {"name": name, "definition": {"kind": "predicates", "predicates": [{"kind": "opening_attribute_equals", "column_index": STRATA["team_groups"]["column_index"],
            "value": value, "negate": False, "anchor_policy": POLICY}]}}


def test_overlapping_explicit_groups_keep_their_literal_memberships(client, workspace):  # noqa: F811
    base = source_population(client, workspace)
    answer = compare(client, workspace, base, explicit_groups())
    groups = EXPECTED["explicit_groups"]
    assert (answer["target"]["included"]["case_ids"], answer["reference"]["included"]["case_ids"]) == (groups["target"]["case_ids"], groups["reference"]["case_ids"])
    assert answer["pair_support"]["overlap"]["case_ids"] == groups["overlap_case_ids"]
    assert answer["pair_support"]["neither"]["case_ids"] == groups["neither_case_ids"]


def test_disjoint_groups_of_unequal_size_within_a_stratum(client, workspace):  # noqa: F811
    base = source_population(client, workspace)
    stratum = STRATA["stratum"]
    kept = select(client, workspace, base, [{"kind": "opening_attribute_equals", "column_index": stratum["column_index"], "value": stratum["value"], "negate": False,
                                             "anchor_policy": POLICY}])["kept"]["case_ids"]
    assert kept == stratum["case_ids"]
    groups = STRATA["team_groups"]
    definition = {"mode": "two_named_groups", "target": team(groups["target"]["name"], groups["target"]["value"]),
                  "reference": team(groups["reference"]["name"], groups["reference"]["value"])}
    within = compare(client, workspace, base, definition, parent=kept)
    expected = STRATA["within_high"]
    assert (within["target"]["included"]["case_ids"], within["reference"]["included"]["case_ids"]) == (expected["target"], expected["reference"])
    assert (within["pair_support"]["overlap"]["case_count"], within["pair_support"]["neither"]["case_ids"]) == (0, expected["neither"])
    service = {category["value"] if category["value"] is not None else "not recorded": [category["target"]["case_count"], category["reference"]["case_count"]]
               for category in within["context_profile"]["categories"]}
    assert {value: counts for value, counts in service.items() if counts != [0, 0]} == expected["service"]
    whole = compare(client, workspace, base, definition)
    assert (whole["target"]["included"]["case_ids"], whole["reference"]["included"]["case_ids"]) == (STRATA["whole"]["target"], STRATA["whole"]["reference"])
