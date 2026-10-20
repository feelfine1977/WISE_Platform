"""Strict generated boundary and conditional guards for stated-rule catalogues."""

from __future__ import annotations

from dataclasses import dataclass

from wise_platform_analytics.rule_groups import validate_rule_groups_query

from .boundary import SCHEMA_VERSION, read_object
from .generated import rule_groups as generated
from .generated.rule_groups import (
    RuleGroupsAnswer,
    RuleGroupsRefusal,
    RuleGroupsRequest,
)
from .import_boundary import import_echo
from .strict_reading import (
    alternatives_of,
    read_strictly,
    repeated_failures,
    version_failures,
)

STATUS = {
    "invalid_request": 400,
    "unsupported_schema": 400,
    "unsupported_policy": 400,
    "invalid_parameter": 400,
    "workspace_unavailable": 404,
    "workspace_not_writable": 403,
    "workspace_incompatible": 409,
    "source_unavailable": 404,
    "memory_unavailable": 503,
    "preparation_unavailable": 404,
    "identity_mismatch": 409,
    "population_unavailable": 404,
    "invalid_parent": 422,
    "unknown_case": 422,
    "inconsistent_sequence": 422,
    "inconsistent_time_kind": 422,
    "computation_failed": 500,
    "unmapped_context_column": 422,
}
RETRYABLE = frozenset(
    {
        "workspace_unavailable",
        "workspace_not_writable",
        "source_unavailable",
        "memory_unavailable",
        "preparation_unavailable",
        "population_unavailable",
        "computation_failed",
    }
)
_KEY_KINDS = {
    "first_raw_activity": {"activity", "missing_activity"},
    "last_raw_activity": {"activity", "missing_activity"},
    "raw_record_count_bands": {"raw_record_count_band"},
    "activity_presence": {"activity_presence"},
    "shared_reference": {"reference_value", "missing_reference"},
    "exact_mapped_sequence": {"exact_sequence"},
}


@dataclass(frozen=True)
class RuleGroupsReply:
    status: int
    body: dict


def refused(
    code: str, message: str, given: dict, field: str | None = None
) -> RuleGroupsReply:
    if code not in STATUS:
        code, message, field = (
            "computation_failed",
            "The groups could not be computed from this preparation.",
            None,
        )
    body = RuleGroupsRefusal(
        schema_version=SCHEMA_VERSION,
        message_type="rule_groups_refusal",
        **import_echo(given),
        operation="rule_groups",
        code=code,
        message=message,
        field=field,
        retryable=code in RETRYABLE,
    ).model_dump(mode="json")
    return RuleGroupsReply(STATUS[code], body)


def parse_rule_groups(body: bytes) -> dict | RuleGroupsReply:
    given = read_object(body)
    if isinstance(given, str):
        return refused("invalid_request", given, {})
    version = given.get("schema_version")
    if type(version) is int and version != SCHEMA_VERSION:
        return refused(
            "unsupported_schema",
            "This application reads schema version one.",
            given,
            "schema_version",
        )
    checked = read_strictly(given, RuleGroupsRequest, alternatives_of(generated))
    if isinstance(checked, list):
        failure = checked[0]
        return refused(
            "invalid_request",
            "The request is not valid at "
            + (failure.field or "the request")
            + ": "
            + failure.reason
            + ".",
            given,
            failure.field,
        )
    failures = version_failures(given, (("identity", "implementation_version"),))
    if failures:
        return refused(
            "invalid_request", failures[0].reason + ".", given, failures[0].field
        )
    problem = validate_rule_groups_query(given["query"])
    if problem is not None:
        return refused(problem.code, problem.message, given, problem.field)
    return given


def checked_answer(body: dict) -> RuleGroupsReply:
    """Check structure, uniqueness and the source schema's conditional fields.

    Conditional refinements couple each key to the rule and each distribution
    to the same clock. They are checked here in addition to the generated
    structural types, which do not express those refinements.
    """
    checked = read_strictly(body, RuleGroupsAnswer, alternatives_of(generated))
    if isinstance(checked, list):
        raise ValueError(
            "The computed rule-groups answer is outside its contract at "
            + checked[0].field
        )
    failures = version_failures(
        body,
        (
            ("identity", "implementation_version"),
            ("parent_identity", "implementation_version"),
        ),
    )
    failures += repeated_failures(
        body,
        (
            ("groups", "*", "population", "cases", "case_ids"),
            ("population_coverage", "unevaluable", "case_ids"),
            ("population_coverage", "unassigned", "case_ids"),
            ("parent_coverage", "unevaluable", "case_ids"),
            ("parent_coverage", "unassigned", "case_ids"),
        ),
    )
    if failures:
        raise ValueError(
            "The computed rule-groups answer is outside its contract at "
            + failures[0].field
        )
    problem = validate_rule_groups_query(body["query"])
    if problem is not None:
        raise ValueError(
            "The computed rule-groups query is outside its contract at " + problem.field
        )
    rule_kind = body["query"]["rule"]["kind"]
    shared = rule_kind == "shared_reference"
    # Only a shared reference read on any record lets an incident be in several groups (#51).
    overlaps = shared and body["query"]["rule"].get("policy", "any_record") == "any_record"
    if (
        body["group_membership_overlaps"] != overlaps
        or (body["shared_reference_coverage"] is not None) != shared
    ):
        raise ValueError("Reference coverage and overlap must match the stated rule.")
    for group in body["groups"]:
        if group["key"]["kind"] not in _KEY_KINDS[rule_kind]:
            raise ValueError("The group key must match the stated rule.")
        for name, measure in (
            ("span_distribution", "observed_span_hours"),
            ("gap_distribution", "maximum_adjacent_raw_gap_hours"),
        ):
            distribution = group[name]
            if (
                distribution["measure"] != measure
                or distribution["timestamp_kind"] != body["timestamp_kind"]
            ):
                raise ValueError(
                    "The group distributions must use their declared measure and the answer clock."
                )
            if distribution["edges_hours"] != body["query"]["distribution_edges_hours"]:
                raise ValueError(
                    "The group distributions must use the submitted hour edges."
                )
    return RuleGroupsReply(200, body)
