"""#55: every supplied path of the map, against a hand-written oracle, and steps from a path.

The process graph of tests/fixtures/variants supplies every pair of activities with its incidents, passages and
median lag, the paths that pass over records without a label, the flows from Start and to End, and the incidents of
unknown order on no path; a path keeps or removes whole incidents, and an incident of unknown order stays unevaluable.
The selection keeping only the incident without a labelled record has no path and no flow.
"""

import json
from pathlib import Path

from test_import_acceptance import envelope
from test_issue10_interval_tail import client, read, select  # noqa: F401  (client is a fixture)

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "tests/fixtures/variants"
VARIANTS = json.loads((FIXTURES / "expected.json").read_text(encoding="utf-8"))
EXPECTED = json.loads((FIXTURES / "paths.json").read_text(encoding="utf-8"))


def graph_of(client, workspace, identity):  # noqa: F811
    response = client.post("/api/investigations/process-graph", json=envelope("process_graph_request", workspace_id=workspace["workspace_id"], identity=identity))
    assert response.status_code == 200, response.text
    return response.json()["graph"]


def opened(client, tmp_path):  # noqa: F811
    workspace, base = read(client, tmp_path, (FIXTURES / VARIANTS["file"]).read_bytes(), VARIANTS["file"], dict(VARIANTS["mapping"]), VARIANTS["cutoff_utc"])
    return workspace, select(client, workspace, base, []), base


def test_every_path_carries_the_oracle_s_incidents_passages_and_lag(client, tmp_path):  # noqa: F811
    workspace, everyone, _ = opened(client, tmp_path)
    graph = graph_of(client, workspace, everyone["identity"])
    supplied = sorted(((edge["payload"]["source_activity"], edge["payload"]["target_activity"]), edge["metrics"]) for edge in graph["edges"])
    expected = sorted(((path["from"], path["to"]), path) for path in EXPECTED["paths"])
    assert [pair for pair, _ in supplied] == [pair for pair, _ in expected]
    for (pair, metrics), (_, path) in zip(supplied, expected):
        assert (metrics["cases"], metrics["count"], metrics["medianLagHours"]) == (path["incidents"], path["passages"], path["median_lag_hours"]), pair
    starts = {node["label"]: node["metrics"]["starts"] for node in graph["nodes"] if node["metrics"]["starts"] > 0}
    ends = {node["label"]: node["metrics"]["ends"] for node in graph["nodes"] if node["metrics"]["ends"] > 0}
    assert (starts, ends) == (EXPECTED["starts"], EXPECTED["ends"])
    assert graph["meta"]["sequence_unevaluable_case_count"] == EXPECTED["not_evaluable_for_paths"]


def test_a_path_keeps_or_removes_whole_incidents(client, tmp_path):  # noqa: F811
    workspace, everyone, base = opened(client, tmp_path)
    path = {"kind": "directly_follows", "source_activity": "Resolved", "target_activity": "Assigned"}
    for negate, name in ((False, "keep_resolved_to_assigned"), (True, "never_resolved_to_assigned")):
        selected = select(client, workspace, base, [{**path, "negate": negate}])
        assert (selected["kept"]["case_ids"], selected["unevaluable"]["case_ids"]) == (EXPECTED[name]["kept"], EXPECTED[name]["unevaluable"])


def test_a_selection_without_a_labelled_record_has_no_path_and_no_flow(client, tmp_path):  # noqa: F811
    workspace, _, base = opened(client, tmp_path)
    empty = next(variant for variant in VARIANTS["variants"] if variant["activities"] == [])
    selected = select(client, workspace, base, [{"kind": "variant_is", "variant": {"id": empty["id"], "activities": [],
                      "projection_policy": "incident.activity.omit_missing_retain_raw_gaps.v1"}, "negate": False}])
    assert selected["kept"]["case_ids"] == EXPECTED["empty_variant_members"]
    graph = graph_of(client, workspace, selected["identity"])
    assert graph["edges"] == [] and all(node["metrics"]["starts"] == 0 and node["metrics"]["ends"] == 0 for node in graph["nodes"])
