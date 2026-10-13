"""Strict generated-model boundary for the case-list read operation."""
from __future__ import annotations

from dataclasses import dataclass

from wise_platform_analytics.case_profiles import validate_case_list_query

from .boundary import SCHEMA_VERSION, read_object
from .generated import case_list as generated
from .generated.case_list import CaseListAnswer, CaseListRefusal, CaseListRequest
from .import_boundary import import_echo
from .strict_reading import alternatives_of, read_strictly, version_failures

STATUS = {"invalid_request": 400, "unsupported_schema": 400, "unsupported_policy": 400, "invalid_parameter": 400,
          "workspace_unavailable": 404, "workspace_not_writable": 403, "workspace_incompatible": 409,
          "source_unavailable": 404, "preparation_unavailable": 404, "identity_mismatch": 409,
          "population_unavailable": 404, "invalid_parent": 422, "unknown_case": 422,
          "inconsistent_sequence": 422, "inconsistent_time_kind": 422, "computation_failed": 500}
RETRYABLE = frozenset({"workspace_unavailable", "workspace_not_writable", "source_unavailable", "preparation_unavailable", "population_unavailable", "computation_failed"})


@dataclass(frozen=True)
class CaseListReply:
    status: int
    body: dict


def refused(code: str, message: str, given: dict, field: str | None = None) -> CaseListReply:
    if code not in STATUS:
        code, message, field = "computation_failed", "The list could not be computed from this preparation.", None
    body = CaseListRefusal(schema_version=SCHEMA_VERSION, message_type="case_list_refusal", **import_echo(given),
        operation="case_list", code=code, message=message, field=field, retryable=code in RETRYABLE).model_dump(mode="json")
    return CaseListReply(STATUS[code], body)


def parse_case_list(body: bytes) -> dict | CaseListReply:
    given = read_object(body)
    if isinstance(given, str):
        return refused("invalid_request", given, {})
    version = given.get("schema_version")
    if type(version) is int and version != SCHEMA_VERSION:
        return refused("unsupported_schema", "This application reads schema version one.", given, "schema_version")
    checked = read_strictly(given, CaseListRequest, alternatives_of(generated))
    if isinstance(checked, list):
        failure = checked[0]
        return refused("invalid_request", "The request is not valid at " + (failure.field or "the request") + ": " + failure.reason + ".", given, failure.field)
    failures = version_failures(given, (("identity", "implementation_version"),))
    if failures:
        return refused("invalid_request", failures[0].reason + ".", given, failures[0].field)
    problem = validate_case_list_query(given["query"])
    if problem is not None:
        return refused(problem.code, problem.message, given, problem.field)
    return given


def checked_answer(body: dict) -> CaseListReply:
    # Generated types plus unchanged JSON values are mandatory at the producer.
    # The core supplies the cross-field policy/witness/count invariants.
    checked = read_strictly(body, CaseListAnswer, alternatives_of(generated))
    if isinstance(checked, list):
        raise ValueError("The computed case-list answer is outside its contract at " + checked[0].field)
    failures = version_failures(body, (("identity", "implementation_version"), ("parent_identity", "implementation_version")))
    if failures:
        raise ValueError("The computed case-list answer has an invalid version.")
    return CaseListReply(200, body)
