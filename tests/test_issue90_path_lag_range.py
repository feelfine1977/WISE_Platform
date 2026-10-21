"""#90: keep the incidents that pass a path with a lag in a range, against tests/fixtures/path-lag.

The condition reads the same passages as the map's path and its lag: adjacent records of the activity sequence, a record
without an activity label passed over. Each bound is included or excluded as stated; one passage in the range suffices,
or, with the owner's switch, every passage must be in it. An incident of unknown order is not evaluable; one that never
passes the path is outside. Negation keeps the rest and leaves the unevaluable as they are.
"""

import json

import pytest

from test_import_acceptance import envelope
from test_issue10_interval_tail import ROOT, client, read, select  # noqa: F401  (client is a fixture)

EXPECTED = json.loads((ROOT / "tests/fixtures/path-lag/expected.json").read_text(encoding="utf-8"))
RAW = (ROOT / "tests/fixtures/path-lag" / EXPECTED["file"]).read_bytes()


@pytest.fixture
def lagged(client, tmp_path):  # noqa: F811
    return read(client, tmp_path, RAW, EXPECTED["file"], dict(EXPECTED["mapping"]), EXPECTED["cutoff_utc"])


def step(oracle):
    return {"kind": "path_lag_in_range", "source_activity": EXPECTED["source"], "target_activity": EXPECTED["target"],
            **{name: oracle[name] for name in ("minimum_hours", "minimum_inclusive", "maximum_hours", "maximum_inclusive", "passages", "negate")}}


def partition(answer):
    return answer["kept"]["case_ids"], answer["removed"]["case_ids"], answer["unevaluable"]["case_ids"]


@pytest.mark.parametrize("oracle", EXPECTED["ranges"], ids=[oracle["name"] for oracle in EXPECTED["ranges"]])
def test_a_lag_range_keeps_the_incidents_of_the_oracle(client, lagged, oracle):  # noqa: F811
    workspace, base = lagged
    answer = select(client, workspace, base, [step(oracle)])
    assert partition(answer) == (oracle["kept"], oracle["removed"], oracle["unevaluable"])
    assert [result["predicate"] for result in answer["predicate_results"]] == [step(oracle)]


def test_the_condition_reads_the_passages_of_the_maps_path(client, lagged):  # noqa: F811
    workspace, base = lagged
    response = client.post("/api/investigations/process-graph", json=envelope("process_graph_request", workspace_id=workspace["workspace_id"], identity=base["identity"]))
    assert response.status_code == 200, response.text
    edge = next(edge for edge in response.json()["graph"]["edges"] if (edge["payload"]["source_activity"], edge["payload"]["target_activity"]) == (EXPECTED["source"], EXPECTED["target"]))
    path = EXPECTED["path"]
    assert (edge["metrics"]["count"], edge["payload"]["case_ids"], edge["metrics"]["medianLagHours"]) == (path["passages"], path["incidents"], path["median_lag_hours"])
    # Any lag at all: exactly the incidents of the path, as the directly-follows step keeps them.
    any_lag = select(client, workspace, base, [step({"minimum_hours": 0, "minimum_inclusive": True, "maximum_hours": None, "maximum_inclusive": False,
                                                    "passages": "at_least_one", "negate": False})])
    follows = select(client, workspace, base, [{"kind": "directly_follows", "source_activity": EXPECTED["source"], "target_activity": EXPECTED["target"], "negate": False}])
    assert any_lag["kept"]["case_ids"] == path["incidents"] == follows["kept"]["case_ids"]
    assert any_lag["unevaluable"]["case_ids"] == follows["unevaluable"]["case_ids"]


@pytest.mark.parametrize("change", [
    {"minimum_hours": None, "maximum_hours": None},
    {"minimum_hours": 10, "maximum_hours": 5},
    {"minimum_hours": 5, "maximum_hours": 5, "maximum_inclusive": False},
    {"minimum_hours": -1},
    {"passages": "some"},
    {"source_activity": ""},
])
def test_what_is_not_a_range_of_lags_is_refused_with_its_place(client, lagged, change):  # noqa: F811
    workspace, base = lagged
    given = {**step({"minimum_hours": 1, "minimum_inclusive": True, "maximum_hours": 10, "maximum_inclusive": True, "passages": "at_least_one", "negate": False}), **change}
    response = client.post("/api/investigations/select-cases", json=envelope("select_cases_request", "select-90", 2, workspace_id=workspace["workspace_id"],
                           identity=base["identity"], parent_case_ids=None, predicates=[given]))
    assert response.status_code in (400, 422) and response.json()["field"].startswith("predicates.0"), response.text


def test_a_missing_bound_included_or_not_is_the_same_step(client, lagged):  # noqa: F811
    workspace, base = lagged
    oracle = EXPECTED["ranges"][0]
    one = select(client, workspace, base, [step(oracle)])
    other = select(client, workspace, base, [step({**oracle, "maximum_inclusive": True, "minimum_hours": 720.0})])
    assert one["identity"] == other["identity"]


def test_a_saved_lag_range_reopens_with_its_definition(client, lagged):  # noqa: F811
    workspace, base = lagged
    steps = [step(EXPECTED["ranges"][2])]
    selected = select(client, workspace, base, steps)
    saved = client.post("/api/investigations/save", json=envelope("save_investigation_request", workspace_id=workspace["workspace_id"], investigation_id=None,
        expected_revision_id=None, name="Invented slow path", base_identity=base["identity"], selection_identity=selected["identity"],
        selection_recipe={"parent_case_ids": selected["parent"]["case_ids"], "predicates": steps},
        context_policy="incident.context.first_record_in_declared_order.v1", comparison=None, notes="", bookmarks=[]))
    assert saved.status_code == 200, saved.text
    reopened = client.post("/api/investigations/reopen", json=envelope("reopen_investigation_request", workspace_id=workspace["workspace_id"],
                           saved_revision_id=saved.json()["revision"]["saved_revision_id"])).json()
    assert reopened["restored_selection"]["identity"] == selected["identity"]
    assert reopened["revision"]["content"]["selection_recipe"]["predicates"] == steps
    assert reopened["restored_selection"]["kept"]["case_ids"] == EXPECTED["ranges"][2]["kept"]
