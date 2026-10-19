"""The distribution of one supported interval over a checked selection and its frozen parent."""
from __future__ import annotations

from dataclasses import dataclass
import logging

from wise_platform_analytics.intervals import Interval, distribution

from .boundary import SCHEMA_VERSION, read_object
from .generated import interval_tail as generated
from .generated.interval_tail import IntervalDistributionAnswer, IntervalDistributionRefusal, IntervalDistributionRequest
from .import_boundary import import_echo
from .imports import Imports
from .population_views import resolve_population
from .strict_reading import alternatives_of, read_strictly, version_failures
from .workspace import Problem

logger = logging.getLogger(__name__)

STATUS = {"invalid_request": 400, "unsupported_schema": 400, "unsupported_policy": 400, "invalid_parameter": 400,
          "workspace_unavailable": 404, "workspace_not_writable": 403, "workspace_incompatible": 409,
          "source_unavailable": 404, "memory_unavailable": 503, "preparation_unavailable": 404, "identity_mismatch": 409,
          "population_unavailable": 404, "computation_failed": 500}
RETRYABLE = frozenset({"workspace_unavailable", "workspace_not_writable", "source_unavailable", "memory_unavailable",
                       "preparation_unavailable", "population_unavailable", "computation_failed"})


@dataclass(frozen=True)
class IntervalReply:
    status: int
    body: dict


def refused(code: str, message: str, given: dict, field: str | None = None) -> IntervalReply:
    if code not in STATUS:
        code, message, field = "computation_failed", "The interval could not be measured from this preparation.", None
    body = IntervalDistributionRefusal(schema_version=SCHEMA_VERSION, message_type="interval_distribution_refusal", **import_echo(given),
        operation="interval_distribution", code=code, message=message, field=field, retryable=code in RETRYABLE).model_dump(mode="json")
    return IntervalReply(STATUS[code], body)


def parse(body: bytes) -> dict | IntervalReply:
    given = read_object(body)
    if isinstance(given, str):
        return refused("invalid_request", given, {})
    version = given.get("schema_version")
    if type(version) is int and version != SCHEMA_VERSION:
        return refused("unsupported_schema", "This application reads schema version one.", given, "schema_version")
    checked = read_strictly(given, IntervalDistributionRequest, alternatives_of(generated))
    if isinstance(checked, list):
        failure = checked[0]
        code = "unsupported_policy" if failure.field == "interval.policy" else "invalid_request"
        return refused(code, "The request is not valid at " + (failure.field or "the request") + ": " + failure.reason + ".", given, failure.field)
    failures = version_failures(given, (("identity", "implementation_version"),))
    if failures:
        return refused("invalid_request", failures[0].reason + ".", given, failures[0].field)
    edges = given["edges_hours"]
    if edges[0] != 0 or any(later <= earlier for earlier, later in zip(edges, edges[1:])):
        return refused("invalid_parameter", "The bin edges start at zero hours and rise strictly.", given, "edges_hours")
    return given


class IntervalTails:
    def __init__(self, imports: Imports) -> None:
        self._imports = imports

    def interval_distribution(self, body: bytes) -> IntervalReply:
        given = parse(body)
        if isinstance(given, IntervalReply):
            return given
        try:
            resolved = resolve_population(self._imports, given)
            if isinstance(resolved, Problem):
                return refused(resolved.code, resolved.message, given, resolved.field)
            prepared, population = resolved
            asked = given["interval"]
            result = distribution(prepared, population.case_ids, population.parent_ids, Interval(asked["start_activity"], asked["response_activity"]),
                                  given["edges_hours"], given["case_limit"])
            time = prepared.policies["time"]
            wall = time["id"] == "incident.time.wall_clock_as_recorded.v1"
            clock = {"timestamp_kind": "wall_clock" if wall else "utc_instant", "duration_basis": "recorded_wall_clock" if wall else "elapsed_utc",
                     "snapshot_cutoff": time["parameters"]["snapshot_cutoff_local" if wall else "snapshot_cutoff_utc"]}
            answer = {"schema_version": SCHEMA_VERSION, "message_type": "interval_distribution_answer", "request_id": given["request_id"],
                      "query_revision": given["query_revision"], "workspace_id": given["workspace_id"], "identity": population.identity,
                      "parent_identity": population.parent_identity, "clock": clock, **result}
            checked = read_strictly(answer, IntervalDistributionAnswer, alternatives_of(generated))
            if isinstance(checked, list):
                raise ValueError("The computed interval answer is outside its contract at " + str(checked[0].field))
            return IntervalReply(200, answer)
        except Exception:
            logger.exception("The interval operation failed unexpectedly")
            return refused("computation_failed", "The interval could not be measured. Retry; if it fails again, the application needs repair.", given)
