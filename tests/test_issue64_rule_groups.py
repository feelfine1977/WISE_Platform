"""#64: groups by a stated rule, against the hand-written oracle of tests/fixtures/rule-groups.

Six rules: first and last activity, record-count bands, an activity present, a shared value of a context column chosen
as reference, and the exact sequence. Each group carries its rule as its key, its support in the parent and among the
kept incidents, its span and longest-gap distributions against the parent, and its shortest and longest kept incident.
Unknown order makes an incident unevaluable for the rules that read the order and for no other; a missing activity or
reference value is a group of its own and is counted; a value too rare in the parent forms no group, and its incidents
are said to be in none. Keeping a group's incidents is a fixed-identifier step inside the existing parent; asking for
groups takes no step.
"""

import json

import pytest

from test_import_acceptance import envelope
from test_issue10_interval_tail import ROOT, client, read, select  # noqa: F401  (client is a fixture)

EXPECTED = json.loads((ROOT / "tests/fixtures/rule-groups/expected.json").read_text(encoding="utf-8"))
RAW = (ROOT / "tests/fixtures/rule-groups" / EXPECTED["file"]).read_bytes()
RULES = {
    "first_raw_activity": {"kind": "first_raw_activity"},
    "last_raw_activity": {"kind": "last_raw_activity"},
    "exact_mapped_sequence": {"kind": "exact_mapped_sequence"},
    "raw_record_count_bands": {"kind": "raw_record_count_bands", "edges": [0, 1, 2, 5]},
    "activity_presence": {"kind": "activity_presence", "activity": EXPECTED["parent"]["activity_presence"]["activity"]},
    "shared_reference": {"kind": "shared_reference", "column_index": EXPECTED["reference_column"], "minimum_parent_case_count": 2},
}


@pytest.fixture
def grouped(client, tmp_path):  # noqa: F811
    return read(client, tmp_path, RAW, EXPECTED["file"], dict(EXPECTED["mapping"]), EXPECTED["cutoff_utc"])


def groups(client, workspace, identity, rule, revision=6):  # noqa: F811
    response = client.post("/api/investigations/rule-groups", json=envelope("rule_groups_request", "groups-64", revision, workspace_id=workspace["workspace_id"],
                           identity=identity, query={"rule": rule, "distribution_edges_hours": EXPECTED["edges_hours"], "offset": 0, "limit": 50}))
    assert response.status_code == 200, response.text
    return response.json()


def shape(group):
    """A group as the oracle writes it: its kind, its value, and the parent's incidents in it."""
    key = group["key"]
    value = {"activity": key.get("activity"), "missing_activity": None, "exact_sequence": key.get("activities"), "activity_presence": key.get("present"),
             "reference_value": key.get("value"), "missing_reference": None,
             "raw_record_count_band": [key.get("start_inclusive"), key.get("end_exclusive")]}[key["kind"]]
    return [key["kind"], value, group["population"]["cases"]["case_ids"]]


@pytest.mark.parametrize("name", sorted(RULES))
def test_each_rule_groups_the_parent_as_the_oracle_and_discloses_whom_it_cannot_place(client, grouped, name):  # noqa: F811
    workspace, base = grouped
    answer = groups(client, workspace, base["identity"], RULES[name])
    oracle = EXPECTED["parent"][name]
    # Empty bands of numbers of records are listed too, with no incident (the screen hides only the band below one record);
    # the oracle names only the bands with incidents.
    assert [shape(group) for group in answer["groups"] if group["population"]["cases"]["case_count"] > 0] == oracle["groups"]
    coverage = answer["parent_coverage"]
    assert coverage["unevaluable"]["case_ids"] == oracle["unevaluable"]
    assert coverage["unassigned"]["case_ids"] == oracle["unassigned"]
    assert coverage["eligible"]["case_count"] == coverage["total"]["case_count"] - len(oracle["unevaluable"])
    # The rule is said as stated, the catalogue is the parent's, and only the shared reference may place an incident twice.
    assert (answer["query"]["rule"], answer["catalogue_scope"], answer["group_membership_overlaps"]) == (RULES[name], "frozen_parent", name == "shared_reference")
    if name == "shared_reference":
        assert {field: answer["shared_reference_coverage"][field] for field in oracle["coverage"]} == oracle["coverage"]
        assert answer["shared_reference_coverage"]["column_index"] == EXPECTED["reference_column"]
    else:
        assert answer["shared_reference_coverage"] is None


def test_a_group_states_its_support_distributions_against_the_parent_and_its_kept_exemplars(client, grouped):  # noqa: F811
    workspace, base = grouped
    selection = select(client, workspace, base, [EXPECTED["kept_step"]])
    assert selection["kept"]["case_ids"] == EXPECTED["kept"]
    answer = groups(client, workspace, selection["identity"], RULES["first_raw_activity"])
    oracle = EXPECTED["kept_first_activity"]
    assert (answer["population_coverage"]["eligible"]["case_count"], answer["parent_coverage"]["eligible"]["case_count"]) == (oracle["eligible"], oracle["parent_eligible"])
    by_kind = {group["key"]["activity"] if group["key"]["kind"] == "activity" else "missing_activity": group for group in answer["groups"]}
    for name in ("Opened", "missing_activity"):
        group, wanted = by_kind[name], oracle[name]
        assert group["population"]["cases"]["case_ids"] == wanted["kept"], name
        assert group["population"]["share"] == pytest.approx(wanted["kept_share"]) and group["population"]["denominator"] == oracle["eligible"], name
        assert (group["parent"]["cases"]["case_count"], group["parent"]["share"], group["parent"]["denominator"]) == (wanted["parent_count"], pytest.approx(wanted["parent_share"]), oracle["parent_eligible"]), name
        exemplars = group["exemplars"]
        assert [exemplars["shortest"]["case_id"], exemplars["shortest"]["observed_span_hours"]] == wanted["shortest"], name
        assert [exemplars["longest"]["case_id"], exemplars["longest"]["observed_span_hours"]] == wanted["longest"], name
    # A group's distributions are read against the whole parent: the parent's columns are every incident of it, the kept
    # columns the group's kept incidents.
    opened = by_kind["Opened"]
    for measure, distribution in (("span", opened["span_distribution"]), ("gap", opened["gap_distribution"])):
        assert distribution["edges_hours"] == EXPECTED["edges_hours"]
        assert [item["parent_case_count"] for item in distribution["bins"]] == oracle["Opened"][f"{measure}_whole_parent"], measure
        assert [item["kept_case_count"] for item in distribution["bins"]] == oracle["Opened"][f"{measure}_kept"], measure
    unavailable = opened["gap_distribution"]["unavailable"]
    assert {name: unavailable["parent_" + name] for name in oracle["Opened"]["gap_whole_parent_unavailable"]} == oracle["Opened"]["gap_whole_parent_unavailable"]


def test_among_the_kept_the_parent_still_decides_which_reference_values_form_groups(client, grouped):  # noqa: F811
    workspace, base = grouped
    selection = select(client, workspace, base, [EXPECTED["kept_step"]])
    answer = groups(client, workspace, selection["identity"], RULES["shared_reference"])
    oracle = EXPECTED["kept_shared_reference"]
    assert answer["population_coverage"]["unassigned"]["case_ids"] == oracle["unassigned_kept"]
    assert answer["parent_coverage"]["unassigned"]["case_ids"] == oracle["unassigned_parent"]
    assert answer["shared_reference_coverage"]["population_missing_reference_record_count"] == oracle["population_missing_reference_record_count"]
    r1 = next(group for group in answer["groups"] if group["key"].get("value") == "R1")
    assert r1["population"]["cases"]["case_ids"] == oracle["R1_kept"]


def test_keeping_a_group_is_a_fixed_identifier_step_inside_the_parent_and_asking_takes_no_step(client, grouped):  # noqa: F811
    workspace, base = grouped
    selection = select(client, workspace, base, [EXPECTED["kept_step"]])
    opened = next(group for group in groups(client, workspace, selection["identity"], RULES["first_raw_activity"])["groups"] if group["key"].get("activity") == "Opened")
    # Asking for groups registers nothing: the same steps give the same selection.
    assert select(client, workspace, base, [EXPECTED["kept_step"]])["identity"] == selection["identity"]
    kept = select(client, workspace, base, [EXPECTED["kept_step"], {"kind": "case_id_in", "case_ids": opened["population"]["cases"]["case_ids"], "negate": False}])
    assert kept["kept"]["case_ids"] == EXPECTED["keep_opened_from_kept"]
    assert kept["parent"]["case_count"] == selection["parent"]["case_count"]


def test_the_answer_binds_its_identity_and_refuses_another_preparations(client, grouped, tmp_path):  # noqa: F811
    workspace, base = grouped
    answer = groups(client, workspace, base["identity"], RULES["first_raw_activity"], revision=11)
    assert (answer["request_id"], answer["query_revision"], answer["identity"]) == ("groups-64", 11, base["identity"])
    stale = client.post("/api/investigations/rule-groups", json=envelope("rule_groups_request", "groups-64", 11, workspace_id=workspace["workspace_id"],
                        identity={**base["identity"], "population_id": base["identity"]["population_id"][:-8] + "00000000"},
                        query={"rule": RULES["first_raw_activity"], "distribution_edges_hours": EXPECTED["edges_hours"], "offset": 0, "limit": 50}))
    assert stale.status_code >= 400 and stale.json()["field"].startswith("identity."), stale.text
