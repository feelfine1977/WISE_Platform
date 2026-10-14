"""Closed descriptive intents and explicit graph clock domains."""
from copy import deepcopy
import json
from pathlib import Path

from jsonschema import Draft202012Validator
import pytest

from wise_platform_api.generated.selection import NodeMetrics, SelectCasesRequest


ROOT = Path(__file__).resolve().parents[1]
SCHEMA = json.loads((ROOT / "contracts/selection.schema.json").read_text())
IDENTITY = {field: prefix + ".v1:sha256:" + "a" * 64 for field, prefix in [
    ("source_id", "source"), ("preparation_id", "preparation"),
    ("representation_id", "representation"), ("case_dictionary_id", "case-dictionary"),
    ("population_id", "population")
]}
IDENTITY["implementation_version"] = "0.1.0"
VALID = {"schema_version": 1, "message_type": "select_cases_request", "request_id": "select-1",
         "query_revision": 1, "workspace_id": "workspace.v1:fixture123", "identity": IDENTITY,
         "parent_case_ids": None, "predicates": [{"kind": "contains_activity", "activity": "Recorded", "negate": False}]}


def test_selection_schema_and_generated_request_agree():
    Draft202012Validator.check_schema(SCHEMA)
    Draft202012Validator(SCHEMA).validate(VALID)
    assert SelectCasesRequest.model_validate(VALID).model_dump(mode="json", exclude_unset=True) == VALID


@pytest.mark.parametrize("mutation", ["boolean-revision", "unsafe-revision", "text-negation", "duplicate-parent", "extra-score", "unsupported-anchor"])
def test_selection_boundary_rejects_ambiguous_or_unbound_intents(mutation):
    value = deepcopy(VALID)
    if mutation == "boolean-revision":
        value["query_revision"] = True
    elif mutation == "unsafe-revision":
        value["query_revision"] = 9007199254740992
    elif mutation == "text-negation":
        value["predicates"][0]["negate"] = "false"
    elif mutation == "duplicate-parent":
        value["parent_case_ids"] = ["A", "A"]
    elif mutation == "extra-score":
        value["norm_id"] = "unexpected"
    else:
        value["predicates"] = [{"kind": "opening_attribute_equals", "column_index": 4,
            "value": None, "negate": False, "anchor_policy": "first-nonmissing"}]
    assert list(Draft202012Validator(SCHEMA).iter_errors(value))


STEP_DEFINITIONS = ["SelectionPredicate", "ContainsActivity", "DirectlyFollows", "OpeningAttributeEquals",
                    "StartsWithActivity", "EndsWithActivity", "CaseIdIn", "CaseStartInWindow",
                    "OpeningAttributeIn", "RecordAttributeIn", "ObservedSpanAtLeast", "MaxRawGapAtLeast",
                    "RawRecordCountBetween", "ObservedSpanBetween", "MaxRawGapBetween", "DirectlyFollowsLagBetween"]


@pytest.mark.parametrize("kind", ["starts_with_activity", "ends_with_activity"])
def test_a_step_by_how_incidents_begin_or_end_is_a_closed_intent_of_three_fields(kind):
    value = deepcopy(VALID)
    value["predicates"] = [{"kind": kind, "activity": "Recorded", "negate": False},
                           {"kind": kind, "activity": "Recorded", "negate": True}]
    Draft202012Validator(SCHEMA).validate(value)
    assert SelectCasesRequest.model_validate(value).model_dump(mode="json", exclude_unset=True) == value
    for change in (lambda step: step.pop("activity"), lambda step: step.pop("negate"),
                   lambda step: step.update(activity=""), lambda step: step.update(negate="false"),
                   lambda step: step.update(target_activity="Closed"),
                   lambda step: step.update(anchor_policy="incident.context.first_record_in_declared_order.v1")):
        refused = deepcopy(value)
        change(refused["predicates"][0])
        assert list(Draft202012Validator(SCHEMA).iter_errors(refused))


def test_every_contract_that_carries_selection_steps_defines_the_same_steps():
    contracts = {path.name: json.loads(path.read_text(encoding="utf-8")).get("$defs", {})
                 for path in sorted((ROOT / "contracts").glob("*.schema.json"))}
    carrying = {name: definitions for name, definitions in contracts.items() if "SelectionPredicate" in definitions}
    assert sorted(carrying) == ["comparison.schema.json", "saving.schema.json", "selection.schema.json"]
    kinds = [member["$ref"].rsplit("/", 1)[1] for member in SCHEMA["$defs"]["SelectionPredicate"]["oneOf"]]
    assert kinds == STEP_DEFINITIONS[1:]
    for name, definitions in carrying.items():
        for definition in STEP_DEFINITIONS:
            assert definitions[definition] == SCHEMA["$defs"][definition], (name, definition)


NODE_COUNTS = {"count": 3, "events": 3, "cases": 2, "starts": 1, "ends": 0}


def test_an_activity_carries_its_counts_and_for_each_time_the_passages_it_rests_on():
    definition = SCHEMA["$defs"]["NodeMetrics"]
    assert list(definition["properties"]) == ["count", "events", "cases", "starts", "ends", "medianPreviousHours",
                                              "usablePreviousCount", "medianNextHours", "usableNextCount"]
    assert definition["required"] == ["count", "events", "cases", "starts", "ends",
                                      "usablePreviousCount", "usableNextCount"]
    assert definition["additionalProperties"] is False
    # Hours and their supports are named as those of a path are.
    assert list(SCHEMA["$defs"]["PathMetrics"]["properties"]) == ["count", "cases", "medianLagHours", "usableLagCount", "totalLagHours", "shareOfTotalLag", "totalLagMicroseconds"]


def test_an_activity_gives_a_time_exactly_where_it_names_passages_for_it():
    validator = Draft202012Validator({"$ref": "#/$defs/NodeMetrics", "$defs": SCHEMA["$defs"]})
    for metrics in [
        {**NODE_COUNTS, "usablePreviousCount": 0, "usableNextCount": 0},
        {**NODE_COUNTS, "medianPreviousHours": 0, "usablePreviousCount": 2, "usableNextCount": 0},
        {**NODE_COUNTS, "usablePreviousCount": 0, "medianNextHours": 1.5, "usableNextCount": 1},
        {**NODE_COUNTS, "medianPreviousHours": 2.25, "usablePreviousCount": 4, "medianNextHours": 0.5, "usableNextCount": 3},
    ]:
        validator.validate(metrics)
        assert NodeMetrics.model_validate(metrics).model_dump(mode="json", exclude_unset=True) == metrics
    for metrics in [
        # Without the passages its times rest on.
        NODE_COUNTS,
        {**NODE_COUNTS, "usablePreviousCount": 0},
        # Passages without their time.
        {**NODE_COUNTS, "usablePreviousCount": 2, "usableNextCount": 0},
        {**NODE_COUNTS, "usablePreviousCount": 0, "usableNextCount": 1},
        # A time without a passage.
        {**NODE_COUNTS, "medianPreviousHours": 1, "usablePreviousCount": 0, "usableNextCount": 0},
        {**NODE_COUNTS, "usablePreviousCount": 0, "medianNextHours": 0, "usableNextCount": 0},
        # A time that is not there is left out; it is not null, and never negative.
        {**NODE_COUNTS, "medianPreviousHours": None, "usablePreviousCount": 0, "usableNextCount": 0},
        {**NODE_COUNTS, "usablePreviousCount": 0, "medianNextHours": None, "usableNextCount": 1},
        {**NODE_COUNTS, "medianPreviousHours": -0.5, "usablePreviousCount": 1, "usableNextCount": 0},
        {**NODE_COUNTS, "medianPreviousHours": 1, "usablePreviousCount": 1.5, "usableNextCount": 0},
        {**NODE_COUNTS, "usablePreviousCount": 0, "usableNextCount": 0, "p90NextHours": 3},
    ]:
        assert list(validator.iter_errors(metrics)), metrics


def test_graph_clock_domain_cannot_silently_change_physical_meaning():
    validator = Draft202012Validator({"oneOf": SCHEMA["$defs"]["GraphCoverage"]["oneOf"]})
    validator.validate({"timestamp_kind": "utc_instant", "lag_clock": "elapsed_utc_hours", "clock_limitation": None})
    validator.validate({"timestamp_kind": "wall_clock", "lag_clock": "recorded_wall_clock_hours", "clock_limitation": "Clock changes can affect differences."})
    for value in [
        {"timestamp_kind": "wall_clock", "lag_clock": "elapsed_utc_hours", "clock_limitation": None},
        {"timestamp_kind": "wall_clock", "lag_clock": "recorded_wall_clock_hours", "clock_limitation": ""},
        {"timestamp_kind": "utc_instant", "lag_clock": "recorded_wall_clock_hours", "clock_limitation": None},
    ]:
        assert list(validator.iter_errors(value))
