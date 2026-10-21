"""#19: a supporting and a contrary history, each read through its exact evidence handle.

Against the hand-written oracle of tests/fixtures/pinned. A step on the first recorded Desk keeps two incidents and
removes two; a supporting incident is read in the selection, a contrary one in the selection's parent. Every original
record comes back in the declared order with its row and source position, including a repeat, a changed context value,
a record without a label and a tie. A contrary incident asked under the selection's identity, an unknown incident, an
unknown population and a stale preparation are refused. The two handles are those a saved bookmark accepts.
"""

import json
from pathlib import Path

import pytest

from test_import_acceptance import envelope
from test_issue10_interval_tail import client, read, select  # noqa: F401  (client is a fixture)

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "tests/fixtures/pinned"
EXPECTED = json.loads((FIXTURES / "expected.json").read_text(encoding="utf-8"))
ANCHOR = "incident.context.first_record_in_declared_order.v1"
STEP = {"kind": "opening_attribute_in", "column_index": EXPECTED["step"]["column_index"], "values": [EXPECTED["step"]["value"]], "negate": False,
        "anchor_policy": ANCHOR}


@pytest.fixture
def selected(client, tmp_path):  # noqa: F811
    workspace, base = read(client, tmp_path, (FIXTURES / EXPECTED["file"]).read_bytes(), EXPECTED["file"], dict(EXPECTED["mapping"]), EXPECTED["cutoff_utc"])
    return workspace, base, select(client, workspace, base, [STEP])


def ask(client, workspace, identity, case_id):  # noqa: F811
    return client.post("/api/investigations/case-evidence", json=envelope("imported_case_evidence_request", "case-1", 3, workspace_id=workspace["workspace_id"],
                       identity=identity, case_id=case_id))


def test_the_step_keeps_removes_and_leaves_unevaluable_as_the_oracle(selected):
    _, _, answer = selected
    assert (answer["kept"]["case_ids"], answer["removed"]["case_ids"], answer["unevaluable"]["case_ids"]) == (
        EXPECTED["kept"], EXPECTED["removed"], EXPECTED["unevaluable"])


@pytest.mark.parametrize("side", ["supporting", "contrary"])
def test_each_side_reads_every_original_record_through_its_exact_handle(client, selected, side):  # noqa: F811
    workspace, _, answer = selected
    expected = EXPECTED[side]
    identity = answer["identity"] if side == "supporting" else answer["parent_identity"]
    response = ask(client, workspace, identity, expected["case"])
    assert response.status_code == 200, response.text
    history = response.json()
    assert history["identity"] == identity
    assert [record["source_position"] for record in history["records"]] == expected["source_positions"]
    assert [record["activity"] for record in history["records"]] == expected["activities"]
    rows = [record["row_id"] for record in history["records"]]
    assert len(set(rows)) == len(rows) == len(expected["source_positions"])


def test_the_context_changes_and_missing_values_are_read_as_recorded(client, selected):  # noqa: F811
    workspace, _, answer = selected
    supporting = ask(client, workspace, answer["identity"], EXPECTED["supporting"]["case"]).json()
    contrary = ask(client, workspace, answer["parent_identity"], EXPECTED["contrary"]["case"]).json()
    desk = EXPECTED["mapping"]["context_columns"][0]
    assert [next(value["value"] for value in record["context"] if value["column_index"] == desk) for record in supporting["records"]] == ["East", "East", "West", "West"]
    first = {value["column_index"]: value["value"] for value in contrary["records"][0]["context"]}
    assert [first[index] for index in EXPECTED["mapping"]["context_columns"]] == [row["contrary"] for row in EXPECTED["context_at_first"]]


def test_a_handle_outside_its_population_unknown_or_stale_is_refused(client, selected):  # noqa: F811
    workspace, base, answer = selected
    contrary = EXPECTED["contrary"]["case"]
    # A removed incident is never read as one of the kept: the comparator needs its own handle.
    relabelled = ask(client, workspace, answer["identity"], contrary)
    assert (relabelled.status_code, relabelled.json()["code"]) == (404, "case_not_found"), relabelled.text
    unknown_case = ask(client, workspace, answer["parent_identity"], "P-NONE")
    assert (unknown_case.status_code, unknown_case.json()["code"]) == (404, "case_not_found"), unknown_case.text
    tampered = {**answer["identity"], "population_id": "population.v1:sha256:" + "0" * 64}
    unknown_population = ask(client, workspace, tampered, EXPECTED["supporting"]["case"])
    assert unknown_population.status_code >= 400 and unknown_population.json()["field"].startswith("identity"), unknown_population.text
    stale = {**answer["identity"], "preparation_id": base["identity"]["preparation_id"][:-8] + "00000000"}
    stale_preparation = ask(client, workspace, stale, EXPECTED["supporting"]["case"])
    assert stale_preparation.status_code >= 400 and stale_preparation.json()["field"].startswith("identity"), stale_preparation.text


def test_the_two_handles_are_those_a_saved_bookmark_accepts(client, selected):  # noqa: F811
    workspace, base, answer = selected

    def save(bookmarks):
        return client.post("/api/investigations/save", json=envelope("save_investigation_request", workspace_id=workspace["workspace_id"], investigation_id=None,
            expected_revision_id=None, name="Invented pins", base_identity=base["identity"], selection_identity=answer["identity"],
            selection_recipe={"parent_case_ids": answer["parent"]["case_ids"], "predicates": [STEP]}, context_policy=ANCHOR, comparison=None, notes="",
            bookmarks=bookmarks))

    def bookmark(label, identity, side):
        case = EXPECTED[side]["case"]
        rows = [record["row_id"] for record in ask(client, workspace, identity, case).json()["records"]]
        return {"label": label, "identity": identity, "case_id": case, "row_ids": rows, "note": ""}

    supporting = bookmark("Supporting", answer["identity"], "supporting")
    contrary = bookmark("Contrary", answer["parent_identity"], "contrary")
    saved = save([supporting, contrary])
    assert saved.status_code == 200, saved.text
    relabelled = save([supporting, {**contrary, "identity": answer["identity"]}])
    assert (relabelled.status_code, relabelled.json()["code"]) == (422, "invalid_bookmark"), relabelled.text
