"""#54: the answers the one-screen investigation shows, over the invented tests/fixtures/one-screen file.

The browser qualification (tools/qualify_one_screen.py) reads these answers through the screen; here the local service is
checked against the same hand-written expected.json: the incidents and records of a long-named reading, its variants as
the Variants view lists them, a step's kept incidents, and three steps each counted on its own against the one frozen
parent while the trail says what is kept after each step.
"""

import json

import pytest

from test_import_acceptance import envelope
from test_issue10_interval_tail import ROOT, client, read, select  # noqa: F401  (client is a fixture)

FIXTURES = ROOT / "tests/fixtures/one-screen"
EXPECTED = json.loads((FIXTURES / "expected.json").read_text(encoding="utf-8"))
RAW = (FIXTURES / EXPECTED["file"]).read_bytes()
NAME = EXPECTED["activities"]


@pytest.fixture
def opened(client, tmp_path):  # noqa: F811
    return read(client, tmp_path, RAW, EXPECTED["file"], dict(EXPECTED["mapping"]), EXPECTED["cutoff_utc"])


def step(entry):
    return {"kind": entry["kind"], "activity": NAME[entry["activity"]], "negate": False}


def test_every_incident_and_record_of_the_reading(client, opened):  # noqa: F811
    workspace, base = opened
    answer = select(client, workspace, base, [])
    assert answer["kept"]["case_ids"] == EXPECTED["incidents"]
    assert answer["kept"]["record_count"] == EXPECTED["record_count"] == sum(EXPECTED["records"].values())


def test_the_variants_the_view_lists(client, opened):  # noqa: F811
    workspace, base = opened
    answer = client.post("/api/investigations/variants", json=envelope("variants_request", "variants-54", 1, workspace_id=workspace["workspace_id"],
                         identity=base["identity"])).json()["variants"]
    assert answer["variant_count"] == EXPECTED["variants"]["count"]
    assert [variant["case_count"] for variant in answer["variants"]] == EXPECTED["variants"]["case_counts"]
    for rank, key in enumerate(("first", "second")):
        wanted = EXPECTED["variants"][key]
        assert answer["variants"][rank]["activities"] == [NAME[letter] for letter in wanted["activities"]]
        assert answer["variants"][rank]["case_ids"] == wanted["case_ids"]


def test_a_step_keeps_the_incidents_of_the_oracle(client, opened):  # noqa: F811
    workspace, base = opened
    answer = select(client, workspace, base, [{"kind": "contains_activity", "activity": NAME["C"], "negate": False}])
    assert answer["kept"]["case_ids"] == EXPECTED["contains_C"]["kept"]
    assert answer["kept"]["record_count"] == EXPECTED["contains_C"]["record_count"]


def test_each_step_is_counted_on_its_own_against_the_frozen_parent(client, opened):  # noqa: F811
    workspace, base = opened
    steps = EXPECTED["three_steps"]["steps"]
    answer = select(client, workspace, base, [step(entry) for entry in steps])
    assert answer["kept"]["case_ids"] == EXPECTED["three_steps"]["kept"]
    assert answer["parent"]["case_count"] == len(EXPECTED["incidents"])
    # Each step's own counts are of the whole parent, whatever comes before it; the trail says what is kept after each.
    assert [result["kept"]["case_count"] for result in answer["predicate_results"]] == [entry["kept_of_parent"] for entry in steps]
    assert [result["kept_after_step"]["case_count"] for result in answer["predicate_results"]] == [entry["kept_after_step"] for entry in steps]
    # In another order the same steps keep the same incidents, and each still counts the same over the parent.
    backward = select(client, workspace, base, [step(entry) for entry in reversed(steps)])
    assert backward["identity"] == answer["identity"]
    assert [result["kept"]["case_count"] for result in backward["predicate_results"]] == [entry["kept_of_parent"] for entry in reversed(steps)]
