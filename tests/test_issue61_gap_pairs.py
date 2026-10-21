"""#61: the longest recorded gaps by the pair of activities around them, kept against the fixed parent.

Against tests/fixtures/gap-pairs: for each pair the incident support and its share of the incidents whose order is
known, the passages, the median and the 90th percentile in hours for the kept incidents and the parent, under the stated
weighting (each passage once) and quantile policy (midpoint median, nearest-rank 90th percentile); a record without an
activity label is an endpoint of its own between adjacent raw records and passed over along the map's paths; incidents
of unknown order are counted apart; passages longer than a threshold are counted; a chosen pair orders the kept
incidents by their longest passage of it and selects nothing.
"""

import json
from datetime import datetime, timedelta, timezone

import pytest

from test_import_acceptance import envelope
from test_issue10_interval_tail import ROOT, client, read, select  # noqa: F401  (client is a fixture)
from wise_platform_analytics.gap_pairs import p90

EXPECTED = json.loads((ROOT / "tests/fixtures/gap-pairs/expected.json").read_text(encoding="utf-8"))
RAW = (ROOT / "tests/fixtures/gap-pairs" / EXPECTED["file"]).read_bytes()


@pytest.fixture
def kept(client, tmp_path):  # noqa: F811
    workspace, base = read(client, tmp_path, RAW, EXPECTED["file"], dict(EXPECTED["mapping"]), EXPECTED["cutoff_utc"])
    selection = select(client, workspace, base, [EXPECTED["kept_step"]])
    return workspace, base, selection


def gaps(client, workspace, identity, relation="raw_adjacent", chosen=None, limit=50):  # noqa: F811
    response = client.post("/api/investigations/gap-pairs", json=envelope("gap_pairs_request", "gaps-61", 7, workspace_id=workspace["workspace_id"], identity=identity,
                           relation=relation, threshold_hours=EXPECTED["threshold_hours"], limit=limit, chosen=chosen, case_limit=200))
    assert response.status_code == 200, response.text
    return response.json()


def name(pair):
    return f"{pair['from_activity'] or '(no label)'}>{pair['to_activity'] or '(no label)'}"


def test_each_pair_gives_its_support_passages_median_and_90th_percentile_for_kept_and_parent(client, kept):  # noqa: F811
    workspace, _, selection = kept
    answer = gaps(client, workspace, selection["identity"])
    assert (answer["weighting_policy"], answer["quantile_policy"]) == ("incident.gap.weighting.each_passage_once.v1", "incident.gap.quantiles.median_midpoint_p90_nearest_rank.v1")
    assert (answer["kept"], answer["parent"]) == (EXPECTED["groups"]["kept"], EXPECTED["groups"]["parent"])
    pairs = {name(pair): pair for pair in answer["pairs"]}
    for pair, wanted in EXPECTED["raw_adjacent"]["pairs"].items():
        for side, figures in wanted.items():
            assert {key: pairs[pair][side][key] for key in figures} == figures, (pair, side)
    for pair, shares in EXPECTED["raw_adjacent"]["shares"].items():
        assert {side: pairs[pair][side]["incident_share"] for side in shares} == pytest.approx(shares)
    # The longest 90th percentile among the kept first; a pair no kept incident passes last.
    assert [[pair["from_activity"], pair["to_activity"]] for pair in answer["pairs"]] == EXPECTED["raw_adjacent"]["order"]


def test_an_unlabelled_record_is_an_endpoint_of_its_own_between_raw_records_and_passed_over_along_the_maps_paths(client, kept):  # noqa: F811
    workspace, _, selection = kept
    raw = {name(pair) for pair in gaps(client, workspace, selection["identity"])["pairs"]}
    assert {"Assign>(no label)", "(no label)>Resolve"} <= raw
    mapped = {name(pair): pair for pair in gaps(client, workspace, selection["identity"], "mapped_path")["pairs"]}
    assert not any("(no label)" in pair for pair in mapped)
    for pair, wanted in EXPECTED["mapped_path"]["pairs"].items():
        assert {key: mapped[pair]["kept"][key] for key in wanted["kept"]} == wanted["kept"]


def test_the_map_paths_relation_gives_the_maps_median_lag(client, kept):  # noqa: F811
    workspace, base, _ = kept
    graph = client.post("/api/investigations/process-graph", json=envelope("process_graph_request", workspace_id=workspace["workspace_id"], identity=base["identity"])).json()["graph"]
    mapped = {name(pair): pair["parent"] for pair in gaps(client, workspace, base["identity"], "mapped_path")["pairs"]}
    for edge in graph["edges"]:
        pair = f"{edge['payload']['source_activity']}>{edge['payload']['target_activity']}"
        assert (mapped[pair]["passage_count"], mapped[pair]["median_hours"]) == (edge["metrics"]["usableLagCount"], pytest.approx(edge["metrics"]["medianLagHours"])), pair


def test_a_chosen_pair_orders_the_kept_incidents_by_their_longest_passage_and_selects_nothing(client, kept):  # noqa: F811
    workspace, base, selection = kept
    chosen = EXPECTED["chosen"]
    answer = gaps(client, workspace, selection["identity"], chosen={"from_activity": chosen["pair"][0], "to_activity": chosen["pair"][1]})
    assert [[case["case_id"], case["longest_hours"]] for case in answer["chosen"]["cases"]] == chosen["cases"]
    assert answer["identity"] == selection["identity"]
    assert select(client, workspace, base, [EXPECTED["kept_step"]])["identity"] == selection["identity"]


def test_the_quantile_policy_is_the_nearest_rank_and_each_passage_counts_once():
    assert [p90(values) for values in ([1], [1, 2], [1, 1, 1, 2, 3, 4, 10], list(range(1, 11)), list(range(1, 12)))] == [1, 2, 10, 9, 10]


@pytest.mark.parametrize(("change", "field"), [({"relation": "raw"}, "relation"), ({"threshold_hours": -1}, "threshold_hours"), ({"limit": 0}, "limit"),
    ({"case_offset": None}, "case_offset"), ({"case_offset": True}, "case_offset"), ({"case_offset": 1.5}, "case_offset"), ({"case_offset": -1}, "case_offset")])
def test_what_is_no_question_of_gaps_is_refused(client, kept, change, field):  # noqa: F811
    workspace, _, selection = kept
    body = envelope("gap_pairs_request", "gaps-61", 7, workspace_id=workspace["workspace_id"], identity=selection["identity"], relation="raw_adjacent",
                    threshold_hours=24, limit=10, chosen=None, case_limit=10)
    response = client.post("/api/investigations/gap-pairs", json={**body, **change})
    assert response.status_code == 400 and response.json()["field"].startswith(field), response.text


def test_all_1001_members_can_be_read_and_kept_or_removed_without_a_page_cap(client, tmp_path):
    ids = [f"G-{i:04d}" for i in range(1001)]
    rows = ["case,activity,time"]
    for case in ids:
        rows.extend([f"{case},Assign,2026-01-01T00:00:00Z", f"{case},Resolve,2026-01-01T01:00:00Z"])
    rows.extend(["Other,Open,2026-01-01T00:00:00Z", "Other,Close,2026-01-01T01:00:00Z"])
    workspace, base = read(client, tmp_path, ("\n".join(rows) + "\n").encode(), "many-gaps.csv", dict(EXPECTED["mapping"]), EXPECTED["cutoff_utc"])
    body = envelope("gap_pairs_request", "pages", 1, workspace_id=workspace["workspace_id"], identity=base["identity"],
                    relation="raw_adjacent", threshold_hours=24, limit=1, chosen={"from_activity": "Assign", "to_activity": "Resolve"}, case_limit=1000)
    pages = []
    for offset in (0, 1000):
        response = client.post("/api/investigations/gap-pairs", json={**body, "case_offset": offset})
        assert response.status_code == 200, response.text
        page = response.json()["chosen"]
        assert (page["case_count"], page["case_offset"], page["cases_truncated"]) == (1001, offset, offset == 0)
        pages.extend(item["case_id"] for item in page["cases"])
    assert pages == ids
    for negate, wanted in ((False, ids), (True, ["Other"])):
        selected = select(client, workspace, base, [{"kind": "case_id_in", "case_ids": pages, "negate": negate}])
        assert selected["kept"]["case_ids"] == wanted


def test_a_chosen_path_outside_the_top_200_has_its_exact_figures(client, tmp_path):
    start = datetime(2026, 1, 1, tzinfo=timezone.utc)
    rows = ["case,activity,time"]
    for i in range(201):
        rows.extend([f"G-{i:03d},A{i:03d},{start.isoformat()}", f"G-{i:03d},B{i:03d},{(start + timedelta(hours=i + 1)).isoformat()}"])
    workspace, base = read(client, tmp_path, ("\n".join(rows) + "\n").encode(), "many-paths.csv", dict(EXPECTED["mapping"]), EXPECTED["cutoff_utc"])
    answer = gaps(client, workspace, base["identity"], relation="mapped_path", chosen={"from_activity": "A000", "to_activity": "B000"}, limit=200)
    assert answer["pair_count"] == 201 and answer["pairs_truncated"]
    assert not any(pair["from_activity"] == "A000" for pair in answer["pairs"])
    chosen = answer["chosen"]
    assert (chosen["kept"]["incident_count"], chosen["kept"]["passage_count"], chosen["kept"]["p90_hours"]) == (1, 1, 1)
    assert chosen["parent"] == chosen["kept"]
