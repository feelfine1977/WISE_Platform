"""Supplied total-lag literals and boundary failures through the real HTTP routes."""
from copy import deepcopy

from jsonschema import Draft202012Validator
import pytest

from test_import_acceptance import client, workspace, upload, prepare, population, mapping_request, policies, evidence
from test_selection_acceptance import select, graph, graph_request, edges_by_labels, VALIDATOR


def prepared_literals(client, workspace, *, wall=False):
    # Invented histories: A→B has 1h and 98h; B→A 1h, a bridge 4h+1µs, a zero and unknown order.
    suffix = "" if wall else "Z"
    rows = [
        ("repeat", "A", "2001-01-01T00:00:00"), ("repeat", "B", "2001-01-01T01:00:00"),
        ("repeat", "A", "2001-01-01T02:00:00"), ("repeat", "B", "2001-01-05T04:00:00"),
        ("bridge", "G", "2001-01-01T00:00:00"), ("bridge", "", "2001-01-01T02:00:00"),
        ("bridge", "H", "2001-01-01T04:00:00.000001"),
        ("zero", "I", "2001-01-01T00:00:00"), ("zero", "I", "2001-01-01T00:00:00"),
        ("unknown", "A", "2001-01-01T00:00:00"), ("unknown", "B", ""),
    ]
    raw = ("case;activity;timestamp\n" + "\n".join(f"{case};{activity};{stamp + suffix if stamp else ''}" for case, activity, stamp in rows) + "\n").encode()
    source = upload(client, workspace, raw)
    request = mapping_request(workspace, source, "B3", wall=wall)
    request["policies"] = policies(wall=wall)
    time = request["policies"]["time"]["parameters"]
    time["snapshot_cutoff_local" if wall else "snapshot_cutoff_utc"] = "2002-01-01T00:00:00" + suffix
    request["mapping"]["context_columns"] = []
    request["mapping"]["sequence_column"] = None
    return population(client, workspace, prepare(client, request))


@pytest.mark.parametrize("wall", [False, True])
def test_totals_and_shares_cover_repeated_bridge_zero_parent_and_unknown_histories(client, workspace, wall):
    base = prepared_literals(client, workspace, wall=wall)
    selected = select(client, workspace, base)
    supplied = graph(client, workspace, selected)
    paths = edges_by_labels(supplied)
    total = 374400000001  # 104h + 1µs, computed from the literals above.
    assert supplied["meta"]["path_lag_totals"] == {
        "total_hours": total / 3600000000, "total_microseconds": str(total),
        "usable_passage_count": 5, "usable_path_count": 4,
        "top_five_path_ids": [paths[pair]["id"] for pair in [("A", "B"), ("G", "H"), ("B", "A"), ("I", "I")]],
        "top_five_total_hours": total / 3600000000, "top_five_total_microseconds": str(total), "top_five_share": 1,
    }
    assert paths["A", "B"]["metrics"] == {
        "count": 2, "cases": 1, "medianLagHours": 49.5, "usableLagCount": 2,
        "totalLagHours": 99, "totalLagMicroseconds": "356400000000", "shareOfTotalLag": 356400000000 / total,
    }
    assert paths["G", "H"]["metrics"]["totalLagMicroseconds"] == "14400000001"
    assert len(paths["G", "H"]["payload"]["omitted_row_ids"]) == 1
    assert paths["I", "I"]["metrics"]["totalLagHours"] == 0
    assert paths["I", "I"]["metrics"]["shareOfTotalLag"] == 0
    assert supplied["meta"]["sequence_unevaluable_case_ids"] == ["unknown"]
    assert len(evidence(client, workspace, selected, "bridge")["records"]) == 3
    repeat = graph(client, workspace, select(client, workspace, base, parent=["repeat"]))
    assert repeat["meta"]["path_lag_totals"]["total_hours"] == 100
    assert edges_by_labels(repeat)["A", "B"]["metrics"]["shareOfTotalLag"] == 0.99
    zero = graph(client, workspace, select(client, workspace, base, parent=["zero"]))
    assert zero["edges"][0]["metrics"]["shareOfTotalLag"] is None
    assert zero["meta"]["path_lag_totals"]["top_five_share"] is None


MUTATIONS = [
    ("missing-exact", lambda g: g["edges"][0]["metrics"].pop("totalLagMicroseconds")),
    ("noncanonical", lambda g: g["edges"][0]["metrics"].update(totalLagMicroseconds="1\n")),
    ("coerced-support", lambda g: g["edges"][0]["metrics"].update(usableLagCount=True)),
    ("wrong-hours", lambda g: g["edges"][0]["metrics"].update(totalLagHours=12345)),
    ("wrong-share", lambda g: g["edges"][0]["metrics"].update(shareOfTotalLag=0.5)),
    ("wrong-global", lambda g: g["meta"]["path_lag_totals"].update(total_microseconds="1")),
    ("wrong-support", lambda g: g["meta"]["path_lag_totals"].update(usable_passage_count=100)),
    ("wrong-rank", lambda g: g["meta"]["path_lag_totals"]["top_five_path_ids"].reverse()),
    ("duplicate-path", lambda g: g["edges"].append(deepcopy(g["edges"][0]))),
]


@pytest.mark.parametrize("name,mutate", MUTATIONS, ids=[name for name, _ in MUTATIONS])
def test_corrupt_new_total_coordinates_are_refused_before_http_answer(client, workspace, monkeypatch, name, mutate):
    from wise_platform_api import selections
    base = prepared_literals(client, workspace)
    selected = select(client, workspace, base)
    original = graph(client, workspace, selected)
    corrupted = deepcopy(original)
    mutate(corrupted)
    with monkeypatch.context() as patch:
        patch.setattr(selections, "build_process_graph", lambda *_: corrupted)
        reply = client.post("/api/investigations/process-graph", json=graph_request(workspace, selected))
    assert reply.status_code == 500, reply.text
    answer = reply.json()
    VALIDATOR.validate(answer)
    assert answer["code"] == "computation_failed"
    assert graph(client, workspace, selected) == original


def test_exact_coordinate_schema_refuses_final_newline_without_generator_specific_regex():
    primitive = VALIDATOR.schema["$defs"]["LagMicroseconds"]
    validator = Draft202012Validator(primitive)
    for canonical in ("0", "1", "9" * 64):
        validator.validate(canonical)
    for bad in ("0\n", "1\n", "01", "-1", "1.0", "1e1", "1\x00", 1, True, None, "9" * 65):
        assert list(validator.iter_errors(bad)), repr(bad)
