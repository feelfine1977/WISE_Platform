"""#89: keep or remove incidents by a range of records, recorded span or longest gap, as one step.

Against the hand-written ranges of tests/fixtures/span-gap/ranges.json over span-gap.csv. Both bounds are included and a
missing maximum has no upper bound. The number of raw records counts records without an activity label and is evaluable
for every incident, also of unknown order; span and longest gap are those of the incident list, so an incident without
them is unevaluable, also when the range is negated. A range is one step, refused when it is not a range; it agrees
with the "at least" steps, and a saved range reopens with its definition.
"""

import json

import pytest

from test_import_acceptance import envelope
from test_issue10_interval_tail import ROOT, client, read, select  # noqa: F401  (client is a fixture)

EXPECTED = json.loads((ROOT / "tests/fixtures/span-gap/expected.json").read_text(encoding="utf-8"))
RANGES = json.loads((ROOT / "tests/fixtures/span-gap/ranges.json").read_text(encoding="utf-8"))["ranges"]
RAW = (ROOT / "tests/fixtures/span-gap" / EXPECTED["file"]).read_bytes()


@pytest.fixture
def listed(client, tmp_path):  # noqa: F811
    return read(client, tmp_path, RAW, EXPECTED["file"], dict(EXPECTED["mapping"]), EXPECTED["cutoff_utc"])


def ranged(oracle):
    return {"kind": "measure_between", "measure": oracle["measure"], "minimum": oracle["minimum"], "maximum": oracle["maximum"], "negate": oracle["negate"]}


def partition(answer):
    return answer["kept"]["case_ids"], answer["removed"]["case_ids"], answer["unevaluable"]["case_ids"]


@pytest.mark.parametrize("oracle", RANGES, ids=[oracle["name"] for oracle in RANGES])
def test_a_range_keeps_removes_and_leaves_unevaluable_the_incidents_of_the_oracle(client, listed, oracle):  # noqa: F811
    workspace, base = listed
    answer = select(client, workspace, base, [ranged(oracle)])
    assert partition(answer) == (oracle["kept"], oracle["removed"], oracle["unevaluable"])
    # One step, said back as given, with its own supports.
    assert [result["predicate"] for result in answer["predicate_results"]] == [ranged(oracle)]
    result = answer["predicate_results"][0]
    assert (result["kept"]["case_count"], result["unevaluable"]["case_count"]) == (len(oracle["kept"]), len(oracle["unevaluable"]))


def test_the_number_of_records_is_evaluable_for_an_incident_of_unknown_order(client, listed):  # noqa: F811
    workspace, base = listed
    answer = select(client, workspace, base, [{"kind": "measure_between", "measure": "raw_record_count", "minimum": 2, "maximum": 2, "negate": False}])
    assert "S-UNK" in answer["kept"]["case_ids"] and answer["unevaluable"]["case_count"] == 0


@pytest.mark.parametrize(("measure", "at_least"), [("observed_span_hours", "observed_span_at_least"), ("maximum_adjacent_raw_gap_hours", "max_raw_gap_at_least")])
@pytest.mark.parametrize("hours", [0, 2, 6, 10, 48])
def test_a_range_without_an_upper_bound_agrees_with_the_at_least_step(client, listed, measure, at_least, hours):  # noqa: F811
    workspace, base = listed
    open_range = select(client, workspace, base, [{"kind": "measure_between", "measure": measure, "minimum": hours, "maximum": None, "negate": False}])
    threshold = select(client, workspace, base, [{"kind": at_least, "hours": hours, "negate": False}])
    assert partition(open_range) == partition(threshold)


@pytest.mark.parametrize(("change", "field"), [
    ({"minimum": 5, "maximum": 2}, "predicates.0"),
    ({"measure": "raw_record_count", "minimum": 2.5}, "predicates.0"),
    ({"minimum": -1}, "predicates.0"),
    ({"measure": "records"}, "predicates.0"),
    ({"maximum": "ten"}, "predicates.0"),
])
def test_what_is_not_a_range_is_refused_with_its_place(client, listed, change, field):  # noqa: F811
    workspace, base = listed
    step = {"kind": "measure_between", "measure": "observed_span_hours", "minimum": 1, "maximum": 4, "negate": False, **change}
    response = client.post("/api/investigations/select-cases", json=envelope("select_cases_request", "select-89", 2, workspace_id=workspace["workspace_id"],
                           identity=base["identity"], parent_case_ids=None, predicates=[step]))
    assert response.status_code in (400, 422) and response.json()["field"].startswith(field), response.text


def test_equal_bounds_written_as_whole_or_decimal_hours_are_the_same_step(client, listed):  # noqa: F811
    workspace, base = listed
    whole = select(client, workspace, base, [{"kind": "measure_between", "measure": "observed_span_hours", "minimum": 2, "maximum": 10, "negate": False}])
    decimal = select(client, workspace, base, [{"kind": "measure_between", "measure": "observed_span_hours", "minimum": 2.0, "maximum": 10.0, "negate": False}])
    assert whole["identity"] == decimal["identity"]


def test_a_range_after_another_step_is_inside_the_same_parent_and_undoing_it_gives_the_selection_back(client, listed):  # noqa: F811
    workspace, base = listed
    first = select(client, workspace, base, [{"kind": "measure_between", "measure": "raw_record_count", "minimum": 2, "maximum": 3, "negate": False}])
    both = select(client, workspace, base, [first["predicate_results"][0]["predicate"], ranged(RANGES[4])])
    assert both["kept"]["case_ids"] == sorted(set(first["kept"]["case_ids"]) & set(RANGES[4]["kept"]))
    assert both["parent"]["case_ids"] == first["parent"]["case_ids"]
    assert select(client, workspace, base, [first["predicate_results"][0]["predicate"]])["identity"] == first["identity"]


def test_a_saved_range_reopens_with_its_definition(client, listed):  # noqa: F811
    workspace, base = listed
    steps = [ranged(RANGES[7])]
    selected = select(client, workspace, base, steps)
    saved = client.post("/api/investigations/save", json=envelope("save_investigation_request", workspace_id=workspace["workspace_id"], investigation_id=None,
        expected_revision_id=None, name="Invented gap range", base_identity=base["identity"], selection_identity=selected["identity"],
        selection_recipe={"parent_case_ids": selected["parent"]["case_ids"], "predicates": steps},
        context_policy="incident.context.first_record_in_declared_order.v1", comparison=None, notes="", bookmarks=[]))
    assert saved.status_code == 200, saved.text
    reopened = client.post("/api/investigations/reopen", json=envelope("reopen_investigation_request", workspace_id=workspace["workspace_id"],
                           saved_revision_id=saved.json()["revision"]["saved_revision_id"])).json()
    assert reopened["restored_selection"]["identity"] == selected["identity"]
    assert reopened["revision"]["content"]["selection_recipe"]["predicates"] == steps
    assert reopened["restored_selection"]["kept"]["case_ids"] == RANGES[7]["kept"]
