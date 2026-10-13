"""Strict generated-model boundary for a read-only incident-start trend."""
from __future__ import annotations

from dataclasses import dataclass

from wise_platform_analytics.start_trend import validate_start_trend_answer, validate_start_trend_definition

from .boundary import SCHEMA_VERSION, read_object
from .generated import start_trend as generated
from .generated.start_trend import StartTrendAnswer, StartTrendRefusal, StartTrendRequest
from .import_boundary import import_echo
from .strict_reading import alternatives_of, read_strictly, repeated_failures, version_failures

STATUS = {"invalid_request": 400, "unsupported_schema": 400, "unsupported_policy": 400, "invalid_parameter": 400,
    "workspace_unavailable": 404, "workspace_not_writable": 403, "workspace_incompatible": 409,
    "source_unavailable": 404, "preparation_unavailable": 404, "identity_mismatch": 409,
    "population_unavailable": 404, "invalid_parent": 422, "unknown_case": 422,
    "inconsistent_sequence": 422, "inconsistent_time_kind": 422, "computation_failed": 500}
RETRYABLE = frozenset({"workspace_unavailable", "workspace_not_writable", "source_unavailable", "preparation_unavailable", "population_unavailable", "computation_failed"})
_PAIRS = (("available",), ("unevaluable",), ("before_range",), ("after_range",), ("bins", "*"),
    ("unevaluable", "reason_supports", "order_unknown"), ("unevaluable", "reason_supports", "first_raw_timestamp_missing"))
_UNIQUE = (("parent_support", "case_ids"), ("kept_support", "case_ids"), ("edges",)) + tuple(
    (*path, role, "case_ids") for path in _PAIRS for role in ("parent_support", "kept_support"))


@dataclass(frozen=True)
class StartTrendReply:
    status: int
    body: dict


def refused(code: str, message: str, given: dict, field: str | None = None) -> StartTrendReply:
    if code not in STATUS:
        code, message, field = "computation_failed", "The trend could not be computed from this preparation.", None
    body = StartTrendRefusal(schema_version=SCHEMA_VERSION, message_type="start_trend_refusal", **import_echo(given),
        operation="start_trend", code=code, message=message, field=field, retryable=code in RETRYABLE).model_dump(mode="json")
    return StartTrendReply(STATUS[code], body)


def parse_start_trend(body: bytes) -> dict | StartTrendReply:
    given = read_object(body)
    if isinstance(given, str):
        return refused("invalid_request", given, {})
    if type(given.get("schema_version")) is int and given["schema_version"] != SCHEMA_VERSION:
        return refused("unsupported_schema", "This application reads schema version one.", given, "schema_version")
    checked = read_strictly(given, StartTrendRequest, alternatives_of(generated))
    if isinstance(checked, list):
        failure = checked[0]
        return refused("invalid_request", "The request is not valid at " + (failure.field or "the request") + ": " + failure.reason + ".", given, failure.field)
    failures = version_failures(given, (("identity", "implementation_version"),))
    if failures:
        return refused("invalid_request", failures[0].reason + ".", given, failures[0].field)
    problem = validate_start_trend_definition(given["definition"])
    if problem is not None:
        return refused(problem.code, problem.message, given, problem.field)
    return given


def checked_answer(body: dict) -> StartTrendReply:
    checked = read_strictly(body, StartTrendAnswer, alternatives_of(generated))
    if isinstance(checked, list):
        raise ValueError("The computed start-trend answer is outside its contract at " + checked[0].field)
    failures = repeated_failures(body, _UNIQUE) + version_failures(body, (("identity", "implementation_version"), ("parent_identity", "implementation_version")))
    if failures:
        raise ValueError("The computed start-trend answer is outside its contract at " + failures[0].field)
    validate_start_trend_answer(body)
    return StartTrendReply(200, body)
