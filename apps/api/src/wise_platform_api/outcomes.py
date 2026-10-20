"""A separately named outcome over a checked parent: its known subset and its rate by opening value, beside the parent's."""
from __future__ import annotations

from dataclasses import dataclass
import logging

from wise_platform_analytics.mapping import ImportRefusal as PackageRefusal
from wise_platform_analytics.outcomes import outcome_rates

from .boundary import SCHEMA_VERSION, read_object
from .generated import outcome as generated
from .generated.outcome import OutcomeRatesAnswer, OutcomeRatesRefusal, OutcomeRatesRequest
from .import_boundary import import_echo
from .imports import Imports
from .population_views import resolve_population
from .strict_reading import alternatives_of, read_strictly, version_failures
from .workspace import Problem

logger = logging.getLogger(__name__)

STATUS = {"invalid_request": 400, "unsupported_schema": 400, "invalid_parameter": 400,
          "workspace_unavailable": 404, "workspace_not_writable": 403, "workspace_incompatible": 409,
          "source_unavailable": 404, "memory_unavailable": 503, "preparation_unavailable": 404, "identity_mismatch": 409,
          "population_unavailable": 404, "unmapped_context_column": 400, "computation_failed": 500}
RETRYABLE = frozenset({"workspace_unavailable", "workspace_not_writable", "source_unavailable", "memory_unavailable",
                       "preparation_unavailable", "population_unavailable", "computation_failed"})


@dataclass(frozen=True)
class OutcomeReply:
    status: int
    body: dict


def refused(code: str, message: str, given: dict, field: str | None = None) -> OutcomeReply:
    if code not in STATUS:
        code, message, field = "computation_failed", "The outcome could not be computed from this preparation.", None
    body = OutcomeRatesRefusal(schema_version=SCHEMA_VERSION, message_type="outcome_rates_refusal", **import_echo(given),
        operation="outcome_rates", code=code, message=message, field=field, retryable=code in RETRYABLE).model_dump(mode="json")
    return OutcomeReply(STATUS[code], body)


def parse(body: bytes) -> dict | OutcomeReply:
    given = read_object(body)
    if isinstance(given, str):
        return refused("invalid_request", given, {})
    version = given.get("schema_version")
    if type(version) is int and version != SCHEMA_VERSION:
        return refused("unsupported_schema", "This application reads schema version one.", given, "schema_version")
    checked = read_strictly(given, OutcomeRatesRequest, alternatives_of(generated))
    if isinstance(checked, list):
        failure = checked[0]
        return refused("invalid_request", "The request is not valid at " + (failure.field or "the request") + ": " + failure.reason + ".", given, failure.field)
    failures = version_failures(given, (("identity", "implementation_version"),))
    if failures:
        return refused("invalid_request", failures[0].reason + ".", given, failures[0].field)
    return given


class Outcomes:
    def __init__(self, imports: Imports) -> None:
        self._imports = imports

    def outcome_rates(self, body: bytes) -> OutcomeReply:
        given = parse(body)
        if isinstance(given, OutcomeReply):
            return given
        try:
            resolved = resolve_population(self._imports, given)
            if isinstance(resolved, Problem):
                return refused(resolved.code, resolved.message, given, resolved.field)
            prepared, population = resolved
            asked = given["outcome"]
            result = outcome_rates(prepared, population.case_ids, given["context_column_index"], asked["activity"], asked["counted"])
            if isinstance(result, PackageRefusal):
                return refused(result.code, result.message, given, result.field)
            time = prepared.policies["time"]
            wall = time["id"] == "incident.time.wall_clock_as_recorded.v1"
            answer = {"schema_version": SCHEMA_VERSION, "message_type": "outcome_rates_answer", "request_id": given["request_id"],
                      "query_revision": given["query_revision"], "workspace_id": given["workspace_id"], "identity": population.identity,
                      "context_column_index": given["context_column_index"], "context_policy": given["context_policy"], "outcome": asked,
                      "snapshot_cutoff": time["parameters"]["snapshot_cutoff_local" if wall else "snapshot_cutoff_utc"], **result}
            checked = read_strictly(answer, OutcomeRatesAnswer, alternatives_of(generated))
            if isinstance(checked, list):
                raise ValueError("The computed outcome is outside its contract at " + str(checked[0].field))
            return OutcomeReply(200, answer)
        except Exception:
            logger.exception("The outcome failed unexpectedly")
            return refused("computation_failed", "The outcome could not be computed. Retry; if it fails again, the application needs repair.", given)
