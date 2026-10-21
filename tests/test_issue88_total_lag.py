"""#88: the total time spent on each path, supplied by the local service, against tests/fixtures/total-lag and mean-times.

Each path carries the sum of the lags of all its usable passages, over the same passages, clock and treatment of
unlabelled records and repeats as its median and mean; a graph without it is still read.
"""

import json

import pytest

from test_issue10_interval_tail import ROOT, client, read  # noqa: F401  (client is a fixture)
from test_issue74_mean_times import graph_of

EXPECTED = json.loads((ROOT / "tests/fixtures/total-lag/expected.json").read_text(encoding="utf-8"))
MEANS = json.loads((ROOT / "tests/fixtures/mean-times/expected.json").read_text(encoding="utf-8"))


def edges(client, tmp_path, fixture, expected):  # noqa: F811
    raw = (ROOT / f"tests/fixtures/{fixture}" / expected["file"]).read_bytes()
    workspace, base = read(client, tmp_path, raw, expected["file"], dict(expected["mapping"]), expected["cutoff_utc"])
    return {f"{edge['payload']['source_activity']}>{edge['payload']['target_activity']}": edge["metrics"] for edge in graph_of(client, workspace, base["identity"])["edges"]}


def test_each_path_carries_the_total_time_spent_on_it(client, tmp_path):  # noqa: F811
    paths = edges(client, tmp_path, "total-lag", EXPECTED)
    assert {name: metrics["totalLagHours"] for name, metrics in paths.items()} == pytest.approx(EXPECTED["totals_hours"])
    assert sorted(paths, key=lambda name: (-paths[name]["totalLagHours"], -paths[name]["cases"])) == EXPECTED["order_by_total"]
    assert sum(metrics["totalLagHours"] for metrics in paths.values()) == pytest.approx(EXPECTED["all_paths_hours"])
    # The rare long path stays first in the order by median lag.
    assert max(paths, key=lambda name: paths[name]["medianLagHours"]) == EXPECTED["order_by_median_first"]


def test_the_total_rests_on_the_passages_of_the_median_and_the_mean(client, tmp_path):  # noqa: F811
    paths = edges(client, tmp_path, "mean-times", MEANS)
    for name, metrics in paths.items():
        assert metrics["totalLagHours"] == pytest.approx(metrics["meanLagHours"] * metrics["usableLagCount"]), name
    # The repeat and the bridged unlabelled record are passages of the total too; the incident of unknown order adds none.
    assert paths["Assign>Assign"]["totalLagHours"] == 7
    assert paths["Open>Close"]["totalLagHours"] == pytest.approx(240.5)
