"""The records of a bounded page of kept incidents as marks on one elapsed-time axis, aligned at each first record."""
from __future__ import annotations

from dataclasses import dataclass
import logging

from wise_platform_analytics.record_marks import marks

from .boundary import SCHEMA_VERSION, read_object
from .generated import record_marks as generated
from .generated.record_marks import RecordMarksAnswer, RecordMarksRefusal, RecordMarksRequest
from .import_boundary import import_echo
from .imports import Imports
from .population_views import resolve_population
from .strict_reading import alternatives_of, read_strictly, version_failures
from .workspace import Problem

logger = logging.getLogger(__name__)

STATUS = {"invalid_request": 400, "unsupported_schema": 400, "invalid_parameter": 400,
          "workspace_unavailable": 404, "workspace_not_writable": 403, "workspace_incompatible": 409,
          "source_unavailable": 404, "memory_unavailable": 503, "preparation_unavailable": 404, "identity_mismatch": 409,
          "population_unavailable": 404, "case_not_in_population": 422, "computation_failed": 500}
RETRYABLE = frozenset({"workspace_unavailable", "workspace_not_writable", "source_unavailable", "memory_unavailable",
                       "preparation_unavailable", "population_unavailable", "computation_failed"})


@dataclass(frozen=True)
class MarksReply:
    status: int
    body: dict


def refused(code: str, message: str, given: dict, field: str | None = None) -> MarksReply:
    if code not in STATUS:
        code, message, field = "computation_failed", "The records of these incidents could not be read from this preparation.", None
    body = RecordMarksRefusal(schema_version=SCHEMA_VERSION, message_type="record_marks_refusal", **import_echo(given),
        operation="record_marks", code=code, message=message, field=field, retryable=code in RETRYABLE).model_dump(mode="json")
    return MarksReply(STATUS[code], body)


def parse(body: bytes) -> dict | MarksReply:
    given = read_object(body)
    if isinstance(given, str):
        return refused("invalid_request", given, {})
    version = given.get("schema_version")
    if type(version) is int and version != SCHEMA_VERSION:
        return refused("unsupported_schema", "This application reads schema version one.", given, "schema_version")
    checked = read_strictly(given, RecordMarksRequest, alternatives_of(generated))
    if isinstance(checked, list):
        failure = checked[0]
        return refused("invalid_request", "The request is not valid at " + (failure.field or "the request") + ": " + failure.reason + ".", given, failure.field)
    failures = version_failures(given, (("identity", "implementation_version"),))
    if failures:
        return refused("invalid_request", failures[0].reason + ".", given, failures[0].field)
    return given


class RecordMarks:
    def __init__(self, imports: Imports) -> None:
        self._imports = imports

    def record_marks(self, body: bytes) -> MarksReply:
        given = parse(body)
        if isinstance(given, MarksReply):
            return given
        try:
            resolved = resolve_population(self._imports, given)
            if isinstance(resolved, Problem):
                return refused(resolved.code, resolved.message, given, resolved.field)
            prepared, population = resolved
            kept = set(population.case_ids)
            outside = [case_id for case_id in given["case_ids"] if case_id not in kept]
            if outside:
                return refused("case_not_in_population", f"“{outside[0]}” is not one of the incidents shown.", given, "case_ids")
            answer = {"schema_version": SCHEMA_VERSION, "message_type": "record_marks_answer", "request_id": given["request_id"],
                      "query_revision": given["query_revision"], "workspace_id": given["workspace_id"], "identity": population.identity,
                      **marks(prepared, given["case_ids"])}
            checked = read_strictly(answer, RecordMarksAnswer, alternatives_of(generated))
            if isinstance(checked, list):
                raise ValueError("The record marks are outside their contract at " + str(checked[0].field))
            return MarksReply(200, answer)
        except Exception:
            logger.exception("The record marks failed unexpectedly")
            return refused("computation_failed", "The records of these incidents could not be read. Retry; if it fails again, the application needs repair.", given)
