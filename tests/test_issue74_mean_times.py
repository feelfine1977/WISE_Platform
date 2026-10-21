"""#74: the mean beside every supplied median of the times between records, against tests/fixtures/mean-times.

Each activity carries the mean hours from the previous and to the next labelled record, absent exactly when the median
is; each path carries its mean lag. Mean and median rest on the same passages, the same clock and the same treatment
of records without label and of repeats: a long tail parts them, an activity that only begins incidents has neither
before it, a repeat and a bridged unlabelled record count as passages, and an incident whose order is not known adds
none. The wall clock reads the same hours here, where no clock change lies between the records.
"""

import json
import re

import pytest

from test_import_acceptance import envelope, policies, population, prepare, upload
from test_issue10_interval_tail import ROOT, client, read  # noqa: F401  (client is a fixture)

EXPECTED = json.loads((ROOT / "tests/fixtures/mean-times/expected.json").read_text(encoding="utf-8"))
RAW = (ROOT / "tests/fixtures/mean-times" / EXPECTED["file"]).read_bytes()
TIME_KEYS = ("medianPreviousHours", "meanPreviousHours", "usablePreviousCount", "medianNextHours", "meanNextHours", "usableNextCount")


def graph_of(client, workspace, identity):  # noqa: F811
    response = client.post("/api/investigations/process-graph", json=envelope("process_graph_request", workspace_id=workspace["workspace_id"], identity=identity))
    assert response.status_code == 200, response.text
    return response.json()["graph"]


def utc(client, tmp_path):  # noqa: F811
    return read(client, tmp_path, RAW, EXPECTED["file"], dict(EXPECTED["mapping"]), EXPECTED["cutoff_utc"])


def wall(client, tmp_path):  # noqa: F811
    folder = tmp_path / "wall"
    folder.mkdir()
    workspace = client.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(folder))).json()
    # The same times without their zone, whichever line ending the checkout gave the file.
    source = upload(client, workspace, re.sub(rb"Z(\r?\n)", rb"\1", RAW), EXPECTED["file"])
    request = envelope("confirm_mapping_request", workspace_id=workspace["workspace_id"], source_id=source["source_id"],
                       dialect={"encoding": "utf-8", "delimiter": ",", "quotechar": '"', "header": "first_record"},
                       mapping=EXPECTED["mapping"], policies=policies(wall=True), accept_report_issues=True)
    return workspace, population(client, workspace, prepare(client, request))


@pytest.mark.parametrize("clock", [utc, wall], ids=["utc", "wall_clock"])
def test_each_activity_and_path_carries_its_mean_beside_its_median_over_the_same_passages(client, tmp_path, clock):  # noqa: F811
    workspace, base = clock(client, tmp_path)
    graph = graph_of(client, workspace, base["identity"])
    nodes = {node["label"]: {key: node["metrics"][key] for key in TIME_KEYS if key in node["metrics"]} for node in graph["nodes"]}
    assert nodes == {label: pytest.approx(times) for label, times in EXPECTED["activities"].items()}
    edges = {f"{edge['payload']['source_activity']}>{edge['payload']['target_activity']}": edge["metrics"] for edge in graph["edges"]}
    for name, wanted in EXPECTED["paths"].items():
        assert {key: edges[name][key] for key in wanted} == pytest.approx(wanted), name
    # The long tail parts the mean from the median; where one passage is all, they are the same.
    assert nodes["Open"]["meanNextHours"] > nodes["Open"]["medianNextHours"]
    # The same passages: an activity's mean from the previous record is the passage-weighted mean of the paths into it.
    for label, metrics in nodes.items():
        into = [edge for name, edge in edges.items() if name.endswith(">" + label)]
        if metrics["usablePreviousCount"]:
            assert metrics["usablePreviousCount"] == sum(edge["usableLagCount"] for edge in into)
            assert metrics["meanPreviousHours"] == pytest.approx(sum(edge["meanLagHours"] * edge["usableLagCount"] for edge in into) / metrics["usablePreviousCount"])
        else:
            assert "meanPreviousHours" not in metrics and "medianPreviousHours" not in metrics
