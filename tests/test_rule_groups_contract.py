"""Source schema, generated structure and coupled rule-group answer fields."""

from copy import deepcopy
import json
from pathlib import Path

from jsonschema import Draft202012Validator
import pytest

from wise_platform_api.generated.rule_groups import RuleGroupsMessage
from wise_platform_api.rule_groups_boundary import checked_answer

ROOT = Path(__file__).resolve().parents[1]
SCHEMA = json.loads(
    (ROOT / "contracts/rule-groups.schema.json").read_text(encoding="utf-8")
)
VALIDATOR = Draft202012Validator(SCHEMA)
IDENTITY = {
    name: prefix + ".v1:sha256:" + "1" * 64
    for name, prefix in [
        ("source_id", "source"),
        ("preparation_id", "preparation"),
        ("representation_id", "representation"),
        ("case_dictionary_id", "case-dictionary"),
        ("population_id", "population"),
    ]
}
IDENTITY["implementation_version"] = "0.1.0"
REQUEST = {
    "schema_version": 1,
    "message_type": "rule_groups_request",
    "request_id": "rule-read",
    "query_revision": 1,
    "workspace_id": "workspace.v1:synthetic-workspace",
    "identity": IDENTITY,
    "query": {
        "rule": {"kind": "first_raw_activity"},
        "distribution_edges_hours": [0],
        "offset": 0,
        "limit": 50,
    },
}


def answer():
    support = {"case_count": 1, "record_count": 1, "omitted_activity_record_count": 1}
    zero = {"case_count": 0, "record_count": 0, "omitted_activity_record_count": 0}
    fixed = {"case_ids": ["F"], **support}
    coverage = {
        "total": support,
        "eligible": support,
        "unevaluable": {"case_ids": [], **zero},
        "assigned": support,
        "unassigned": {"case_ids": [], **zero},
        "membership_incidence": support,
    }
    exemplar = {"case_id": "F", "record_count": 1, "observed_span_hours": 0}

    def distribution(gap):
        return {
            "policy_id": "incident.case_distribution.explicit_hours_half_open.v1",
            "measure": (
                "maximum_adjacent_raw_gap_hours" if gap else "observed_span_hours"
            ),
            "timestamp_kind": "utc_instant",
            "edges_hours": [0],
            "parent_case_count": 1,
            "kept_case_count": 1,
            "parent_available_case_count": 0 if gap else 1,
            "kept_available_case_count": 0 if gap else 1,
            "bins": [
                {
                    "start_inclusive_hours": 0,
                    "end_exclusive_hours": None,
                    "parent_case_count": 0 if gap else 1,
                    "kept_case_count": 0 if gap else 1,
                }
            ],
            "unavailable": {
                prefix
                + suffix: (
                    int(gap)
                    if suffix in ("case_count", "fewer_than_two_records_case_count")
                    else 0
                )
                for prefix in ("parent_", "kept_")
                for suffix in (
                    "case_count",
                    "order_unknown_case_count",
                    "fewer_than_two_records_case_count",
                )
            },
        }

    return {
        **deepcopy(REQUEST),
        "message_type": "rule_groups_answer",
        "parent_identity": deepcopy(IDENTITY),
        "rule_policy_id": "incident.rule_groups.stated_rules.v1",
        "activity_projection_policy": "incident.activity.omit_missing_retain_raw_gaps.v1",
        "catalogue_scope": "frozen_parent",
        "timestamp_kind": "utc_instant",
        "group_membership_overlaps": False,
        "population_coverage": deepcopy(coverage),
        "parent_coverage": deepcopy(coverage),
        "shared_reference_coverage": None,
        "group_count": 1,
        "next_offset": None,
        "groups": [
            {
                "id": "rule-group.v1:sha256:" + "2" * 64,
                "key": {"kind": "missing_activity", "activity": None},
                "population": {"cases": fixed, "share": 1, "denominator": 1},
                "parent": {"cases": support, "share": 1, "denominator": 1},
                "span_distribution": distribution(False),
                "gap_distribution": distribution(True),
                "exemplars": {
                    "status": "available",
                    "shortest": deepcopy(exemplar),
                    "longest": deepcopy(exemplar),
                },
            }
        ],
    }


def test_source_and_generated_messages_preserve_the_full_closed_wire_shape():
    Draft202012Validator.check_schema(SCHEMA)
    for value in [REQUEST, answer()]:
        VALIDATOR.validate(value)
        parsed = RuleGroupsMessage.model_validate_json(json.dumps(value), strict=True)
        assert parsed.model_dump(mode="json") == value
    assert checked_answer(answer()).body == answer()


def test_generated_number_fields_preserve_finite_integer_hour_edges():
    edge = 9007199254740993
    request = deepcopy(REQUEST)
    response = answer()
    for value in (request, response):
        value["query"]["distribution_edges_hours"] = [0, edge]
    for name in ("span_distribution", "gap_distribution"):
        distribution = response["groups"][0][name]
        distribution["edges_hours"] = [0, edge]
        distribution["bins"][0]["end_exclusive_hours"] = edge
        distribution["bins"].append({
            "start_inclusive_hours": edge,
            "end_exclusive_hours": None,
            "parent_case_count": 0,
            "kept_case_count": 0,
        })
    for value in (request, response):
        VALIDATOR.validate(value)
        parsed = RuleGroupsMessage.model_validate_json(json.dumps(value), strict=True)
        assert parsed.model_dump(mode="json") == value
    assert checked_answer(response).body == response


@pytest.mark.parametrize(
    "change",
    [
        "wrong-key",
        "span-measure",
        "gap-measure",
        "span-clock",
        "gap-clock",
        "overlap",
        "reference-coverage",
        "missing-group",
        "duplicate-members",
        "extra-condition",
        "unsafe-count",
        "wrong-missing",
    ],
)
def test_source_and_producer_refuse_structural_and_conditional_counterexamples(change):
    value = answer()
    group = value["groups"][0]
    if change == "wrong-key":
        group["key"] = {
            "kind": "raw_record_count_band",
            "start_inclusive": 0,
            "end_exclusive": None,
        }
    elif change == "span-measure":
        group["span_distribution"]["measure"] = "maximum_adjacent_raw_gap_hours"
    elif change == "gap-measure":
        group["gap_distribution"]["measure"] = "observed_span_hours"
    elif change == "span-clock":
        group["span_distribution"]["timestamp_kind"] = "wall_clock"
    elif change == "gap-clock":
        group["gap_distribution"]["timestamp_kind"] = "wall_clock"
    elif change == "overlap":
        value["group_membership_overlaps"] = True
    elif change == "reference-coverage":
        value["query"]["rule"] = {
            "kind": "shared_reference",
            "column_index": 4,
            "minimum_parent_case_count": 2,
        }
    elif change == "missing-group":
        del value["groups"]
    elif change == "duplicate-members":
        group["population"]["cases"]["case_ids"] = ["F", "F"]
    elif change == "extra-condition":
        group["condition"] = {"kind": "contains_activity", "activity": "Start"}
    elif change == "unsafe-count":
        group["parent"]["cases"]["case_count"] = 9007199254740992
    else:
        group["key"]["activity"] = "Unknown"
    assert not VALIDATOR.is_valid(value)
    with pytest.raises(ValueError):
        checked_answer(value)


def test_common_identity_and_distribution_definitions_match_the_existing_contracts():
    case_list = json.loads(
        (ROOT / "contracts/case-list.schema.json").read_text(encoding="utf-8")
    )
    for name in (
        "AnswerIdentity",
        "RequestId",
        "QueryRevision",
        "WorkspaceId",
        "CaseId",
        "SourceId",
        "PreparationId",
        "RepresentationId",
        "CaseDictionaryId",
        "PopulationId",
        "ImplementationVersion",
        "CaseDistribution",
        "DistributionBin",
        "UnavailableDistributionSupport",
    ):
        assert SCHEMA["$defs"][name] == case_list["$defs"][name]
