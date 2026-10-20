"""#12: the transition matrix against a hand-written oracle, its witnesses, parity with the map, and steps from a cell.

tests/fixtures/matrix holds a repeated pair (passages without another incident), a bridge over a record without a
label, a tie ordered by Seq, an activity no pair leaves (an empty denominator) and an incident of unknown order. The
cohort share of a pair (its incidents of those whose order is known) differs from its outgoing share (its passages of
its row's). The map's paths, answered under the same representation and relation, carry the same incidents, passages
and median lag. A cell keeps or removes whole incidents.
"""

import json
from pathlib import Path

import pytest

from test_import_acceptance import envelope, evidence
from test_issue10_interval_tail import client, read, select  # noqa: F401  (client is a fixture)

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "tests/fixtures/matrix"
EXPECTED = json.loads((FIXTURES / "expected.json").read_text(encoding="utf-8"))


@pytest.fixture
def opened(client, tmp_path):  # noqa: F811
    workspace, base = read(client, tmp_path, (FIXTURES / EXPECTED["file"]).read_bytes(), EXPECTED["file"], dict(EXPECTED["mapping"]), EXPECTED["cutoff_utc"])
    return workspace, base


def matrix(client, workspace, identity, limit=50, request_id="matrix-1"):  # noqa: F811
    return client.post("/api/investigations/transition-matrix", json=envelope("transition_matrix_request", request_id, 2, workspace_id=workspace["workspace_id"],
                       identity=identity, witness_limit=limit))


def test_every_cell_carries_separate_typed_measures_as_the_oracle(client, opened):  # noqa: F811
    workspace, base = opened
    response = matrix(client, workspace, base["identity"])
    assert response.status_code == 200, response.text
    answer = response.json()
    assert answer["relation"]["policy"] == "incident.relation.direct_succession_in_activity_sequence.v1"
    assert answer["relation"]["adjacency"] == "mapped_sequence_with_disclosed_raw_gaps"
    assert (answer["case_count"], answer["case_denominator"], answer["unevaluable_case_count"]) == (EXPECTED["incidents"], EXPECTED["case_denominator"], EXPECTED["unevaluable"])
    assert answer["activities"] == EXPECTED["activities"]
    assert {row["activity"]: row["outgoing_passage_count"] for row in answer["rows"]} == EXPECTED["rows"]
    assert [(cell["source_activity"], cell["target_activity"]) for cell in answer["cells"]] == [(cell["from"], cell["to"]) for cell in EXPECTED["cells"]]
    for cell, expected in zip(answer["cells"], EXPECTED["cells"]):
        assert cell["case_ids"] == expected["cases"] and cell["case_count"] == len(expected["cases"])
        assert cell["passage_count"] == expected["passages"]
        assert cell["outgoing_share"] == pytest.approx(expected["outgoing_share"])
        # The cohort share of the incidents whose order is known differs from the outgoing share of the row's passages.
        assert cell["case_share"] == pytest.approx(expected["cohort_share"])
        lag = cell["lag"]
        assert (lag["usable_count"], lag["zero_count"]) == (expected["lag"]["usable"], expected["lag"]["zeros"])
        assert (lag["mean_hours"], lag["median_hours"]) == (pytest.approx(expected["lag"]["mean"]), pytest.approx(expected["lag"]["median"]))
        assert (cell["bridged_passage_count"], cell["tied_passage_count"]) == (expected["bridged"], expected["tied"])
    # A repeat adds passages, never an incident.
    repeated = next(cell for cell in answer["cells"] if cell["source_activity"] == "Opened" and cell["target_activity"] == "Assigned")
    assert repeated["passage_count"] > repeated["case_count"]


def test_bridge_and_tie_witnesses_name_their_original_rows(client, opened):  # noqa: F811
    workspace, base = opened
    answer = matrix(client, workspace, base["identity"]).json()
    positions = {}
    for case in ("bridge_witness", "tie_witness"):
        witness = EXPECTED[case]
        positions.update({record["row_id"]: record["source_position"] for record in evidence(client, workspace, base, witness["case"])["records"]})
    bridge = next(witness for cell in answer["cells"] for witness in cell["witnesses"] if witness["case_id"] == EXPECTED["bridge_witness"]["case"])
    assert (positions[bridge["source_row_id"]], positions[bridge["target_row_id"]], [positions[row] for row in bridge["omitted_row_ids"]]) == (
        EXPECTED["bridge_witness"]["source_position"], EXPECTED["bridge_witness"]["target_position"], EXPECTED["bridge_witness"]["omitted_positions"])
    tie = next(witness for cell in answer["cells"] for witness in cell["witnesses"] if witness["case_id"] == EXPECTED["tie_witness"]["case"] and witness["tied"])
    assert (positions[tie["source_row_id"]], positions[tie["target_row_id"]], tie["hours"]) == (EXPECTED["tie_witness"]["source_position"], EXPECTED["tie_witness"]["target_position"], 0)
    # Witnesses are limited on request and say so.
    limited = matrix(client, workspace, base["identity"], limit=1).json()
    assert all(len(cell["witnesses"]) == 1 and cell["witnesses_truncated"] == (cell["passage_count"] > 1) for cell in limited["cells"])


def test_the_map_carries_the_same_numbers_under_the_same_relation(client, opened):  # noqa: F811
    workspace, base = opened
    answer = matrix(client, workspace, base["identity"]).json()
    graph = client.post("/api/investigations/process-graph", json=envelope("process_graph_request", workspace_id=workspace["workspace_id"], identity=base["identity"])).json()["graph"]
    # Parity is asserted only because both name the same projection and adjacency, over the same incidents.
    assert (graph["meta"]["activity_projection_policy"], graph["meta"]["path_adjacency"]) == (answer["relation"]["activity_projection_policy"], answer["relation"]["adjacency"])
    assert graph["meta"]["path_case_denominator"] == answer["case_denominator"]
    paths = {(edge["payload"]["source_activity"], edge["payload"]["target_activity"]): edge["metrics"] for edge in graph["edges"]}
    assert {(cell["source_activity"], cell["target_activity"]): (cell["case_count"], cell["passage_count"], cell["lag"]["median_hours"]) for cell in answer["cells"]} == {
        pair: (metrics["cases"], metrics["count"], metrics["medianLagHours"]) for pair, metrics in paths.items()}


def test_a_cell_keeps_or_removes_whole_incidents(client, opened):  # noqa: F811
    workspace, base = opened
    pair = {"kind": "directly_follows", "source_activity": "Opened", "target_activity": "Assigned"}
    for negate, name in ((False, "keep_opened_assigned"), (True, "never_opened_assigned")):
        selected = select(client, workspace, base, [{**pair, "negate": negate}])
        assert (selected["kept"]["case_ids"], selected["unevaluable"]["case_ids"]) == (EXPECTED[name]["kept"], EXPECTED[name]["unevaluable"])
        # The matrix of the kept incidents is of exactly them.
        kept = matrix(client, workspace, selected["identity"]).json()
        assert kept["identity"] == selected["identity"] and kept["case_count"] == len(EXPECTED[name]["kept"])


def test_an_empty_denominator_and_refusals(client, opened):  # noqa: F811
    workspace, base = opened
    only_closed = select(client, workspace, base, [{"kind": "case_id_in", "case_ids": ["M-Z1"], "negate": False}])
    empty = matrix(client, workspace, only_closed["identity"]).json()
    assert (empty["cells"], empty["rows"], empty["case_denominator"]) == ([], [{"activity": "Closed", "outgoing_passage_count": 0}], 1)
    bad = matrix(client, workspace, base["identity"], limit=0)
    assert (bad.status_code, bad.json()["code"], bad.json()["field"]) == (400, "invalid_request", "witness_limit")
    unknown = matrix(client, workspace, {**base["identity"], "population_id": "population.v1:sha256:" + "0" * 64})
    assert unknown.status_code == 404 and unknown.json()["code"] == "population_unavailable"
