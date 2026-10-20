"""#68: incidents with a similar sequence, as suggestions with their measure, threshold, eligibility and support.

Against the long-named tests/fixtures/one-screen file and the hand-written similar.json: the families of the frozen parent
within one or two edits of a chosen sequence, nearest first, with their distance and support; the same suggestions
whatever the kept incidents are, only the kept counts following them; nothing applied by asking; a suggestion kept as a
fixed-identifier step in the existing parent.
"""

import json

import pytest

from test_import_acceptance import envelope
from test_issue10_interval_tail import ROOT, client, read, select  # noqa: F401  (client is a fixture)

FIXTURES = ROOT / "tests/fixtures/one-screen"
EXPECTED = json.loads((FIXTURES / "expected.json").read_text(encoding="utf-8"))
SIMILAR = json.loads((FIXTURES / "similar.json").read_text(encoding="utf-8"))
RAW = (FIXTURES / EXPECTED["file"]).read_bytes()
NAME = EXPECTED["activities"]


def named(letters):
    return [NAME[letter] for letter in letters]


@pytest.fixture
def opened(client, tmp_path):  # noqa: F811
    return read(client, tmp_path, RAW, EXPECTED["file"], dict(EXPECTED["mapping"]), EXPECTED["cutoff_utc"])


def ask(client, workspace, identity, edits):  # noqa: F811
    response = client.post("/api/investigations/similar-sequences", json=envelope("similar_sequences_request", "similar-68", 6, workspace_id=workspace["workspace_id"],
                           identity=identity, anchor=named(SIMILAR["anchor"]), maximum_edits=edits))
    assert response.status_code == 200, response.text
    return response.json()


def families(answer):
    return [{"activities": item["activities"], "distance": item["distance"], "cases": item["kept_case_ids"]} for item in answer["families"]]


def test_the_families_within_one_and_two_edits_as_the_oracle(client, opened):  # noqa: F811
    workspace, base = opened
    one = ask(client, workspace, base["identity"], 1)
    assert one["policy"] == "incident.sequence.similar.edit_distance.v1" and one["maximum_edits"] == 1 and one["anchor"] == named(SIMILAR["anchor"])
    wanted = [{**item, "activities": named(item["activities"])} for item in SIMILAR["one_edit"]["families"]]
    assert families(one) == wanted
    assert one["parent"] == {"case_count": 10, "eligible_case_count": 10, "unevaluable_case_count": 0}
    assert one["suggested_parent_case_count"] == one["suggested_kept_case_count"] == SIMILAR["one_edit"]["suggested"]
    assert all(item["exemplars"] == [item["kept_case_ids"][0]] for item in one["families"])
    two = ask(client, workspace, base["identity"], 2)
    assert families(two) == wanted + [{**item, "activities": named(item["activities"])} for item in SIMILAR["two_edits"]["added"]]
    assert two["suggested_parent_case_count"] == SIMILAR["two_edits"]["suggested"]


def test_the_method_is_fixed_on_the_parent_whatever_the_kept_incidents_are_and_asking_applies_nothing(client, opened):  # noqa: F811
    workspace, base = opened
    before = select(client, workspace, base, [])
    kept = select(client, workspace, base, [{"kind": "contains_activity", "activity": NAME["C"], "negate": False}])
    answer = ask(client, workspace, kept["identity"], 1)
    # The same families of the parent; among the kept only those with C.
    assert [item["activities"] for item in answer["families"]] == [named(item["activities"]) for item in SIMILAR["one_edit"]["families"]]
    assert [item["parent_case_count"] for item in answer["families"]] == [len(item["cases"]) for item in SIMILAR["one_edit"]["families"]]
    assert answer["suggested_kept_case_count"] == 2 and answer["parent_identity"] == kept["parent_identity"]
    assert select(client, workspace, base, [])["identity"] == before["identity"]


def test_a_suggestion_kept_is_a_fixed_identifier_step_in_the_existing_parent(client, opened):  # noqa: F811
    workspace, base = opened
    suggestion = [case for item in SIMILAR["one_edit"]["families"] for case in item["cases"]]
    kept = select(client, workspace, base, [{"kind": "case_id_in", "case_ids": suggestion, "negate": False}])
    assert kept["kept"]["case_ids"] == sorted(suggestion) and kept["parent"]["case_ids"] == EXPECTED["incidents"]
