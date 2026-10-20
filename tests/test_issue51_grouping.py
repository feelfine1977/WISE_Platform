"""#51: grouping whole incidents by a context column with an explicit reading of its values.

The supported grouping operation is named: whole incidents grouped by a stated rule, here a context column read at the
first record, at the latest record with a value, or on any record. Against the invented tests/fixtures/grouping file and
its hand-written oracle: the first and latest readings put each evaluable incident in exactly one group and leave an
incident of unknown order unevaluable; any record lets groups overlap and says so; a recorded "Unknown" is a value like
any other, apart from an empty cell, which is "Not recorded"; a value too rare in the parent forms no group and its
incident is said to be in none. Keeping a group is a fixed-identifier step; asking for groups takes none.
"""

import json

import pytest

from test_import_acceptance import envelope
from test_issue10_interval_tail import ROOT, client, read, select  # noqa: F401  (client is a fixture)

FIXTURES = ROOT / "tests/fixtures/grouping"
EXPECTED = json.loads((FIXTURES / "expected.json").read_text(encoding="utf-8"))
RAW = (FIXTURES / EXPECTED["file"]).read_bytes()


@pytest.fixture
def opened(client, tmp_path):  # noqa: F811
    return read(client, tmp_path, RAW, EXPECTED["file"], dict(EXPECTED["mapping"]), EXPECTED["cutoff_utc"])


def rule(policy):
    return {"kind": "shared_reference", "column_index": EXPECTED["column"], "minimum_parent_case_count": 2, **({} if policy == "any_record" else {"policy": policy})}


def groups(client, workspace, identity, policy):  # noqa: F811
    response = client.post("/api/investigations/rule-groups", json=envelope("rule_groups_request", "groups-51", 4, workspace_id=workspace["workspace_id"],
                           identity=identity, query={"rule": rule(policy), "distribution_edges_hours": [0, 1, 24], "offset": 0, "limit": 50}))
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.parametrize("policy", ["first_record", "latest_record", "any_record"])
def test_each_reading_groups_the_incidents_as_the_oracle(client, opened, policy):  # noqa: F811
    workspace, base = opened
    wanted = EXPECTED["groups"][policy]
    answer = groups(client, workspace, base["identity"], policy)
    # Asked of every incident, the kept incidents of a group are the parent's.
    got = [[group["key"].get("value"), group["population"]["cases"]["case_ids"]] for group in answer["groups"]]
    assert got == wanted["groups"]
    assert answer["group_membership_overlaps"] is wanted["overlaps"]
    assert answer["parent_coverage"]["unevaluable"]["case_ids"] == wanted["unevaluable"]
    assert answer["parent_coverage"]["unassigned"]["case_ids"] == wanted["in_no_group"]
    # A recorded "Unknown" is a value; only an empty cell makes "Not recorded".
    kinds = {group["key"]["kind"] for group in answer["groups"] if group["key"].get("value") == "Unknown"}
    assert kinds <= {"reference_value"}


def test_an_unknown_reading_is_refused_with_its_field(client, opened):  # noqa: F811
    workspace, base = opened
    response = client.post("/api/investigations/rule-groups", json=envelope("rule_groups_request", "groups-51", 4, workspace_id=workspace["workspace_id"],
                           identity=base["identity"], query={"rule": {**rule("first_record"), "policy": "ever"}, "distribution_edges_hours": [0, 1], "offset": 0, "limit": 50}))
    assert response.status_code == 400
    assert response.json()["field"] == "query.rule.policy"


def test_keeping_a_group_is_a_fixed_identifier_step_and_asking_takes_none(client, opened):  # noqa: F811
    workspace, base = opened
    before = select(client, workspace, base, [])
    groups(client, workspace, base["identity"], "first_record")
    assert select(client, workspace, base, [])["identity"] == before["identity"]
    target = EXPECTED["compare"]["target"]
    kept = select(client, workspace, base, [{"kind": "case_id_in", "case_ids": target, "negate": False}])
    assert kept["kept"]["case_ids"] == target and kept["parent"]["case_ids"] == before["kept"]["case_ids"]
