"""The kept incidents whose last request, by the analyst's definition, has no later answer in the recorded history."""
from __future__ import annotations

from dataclasses import dataclass
import logging

from wise_platform_analytics.unanswered_requests import unanswered

from .boundary import SCHEMA_VERSION, read_object
from .generated import unanswered_requests as generated
from .generated.unanswered_requests import UnansweredRequestsAnswer, UnansweredRequestsRefusal, UnansweredRequestsRequest
from .import_boundary import import_echo
from .imports import Imports
from .population_views import resolve_population
from .strict_reading import alternatives_of, read_strictly, version_failures
from .workspace import Problem

logger = logging.getLogger(__name__)

STATUS = {"invalid_request": 400, "unsupported_schema": 400, "invalid_parameter": 400,
          "workspace_unavailable": 404, "workspace_not_writable": 403, "workspace_incompatible": 409,
          "source_unavailable": 404, "memory_unavailable": 503, "preparation_unavailable": 404, "identity_mismatch": 409,
          "population_unavailable": 404, "column_not_context": 422, "activity_unknown": 422, "definition_invalid": 400, "computation_failed": 500}
RETRYABLE = frozenset({"workspace_unavailable", "workspace_not_writable", "source_unavailable", "memory_unavailable",
                       "preparation_unavailable", "population_unavailable", "computation_failed"})


@dataclass(frozen=True)
class RequestsReply:
    status: int
    body: dict


def refused(code: str, message: str, given: dict, field: str | None = None) -> RequestsReply:
    if code not in STATUS:
        code, message, field = "computation_failed", "The requests could not be read from this preparation.", None
    body = UnansweredRequestsRefusal(schema_version=SCHEMA_VERSION, message_type="unanswered_requests_refusal", **import_echo(given),
        operation="unanswered_requests", code=code, message=message, field=field, retryable=code in RETRYABLE).model_dump(mode="json")
    return RequestsReply(STATUS[code], body)


def parse(body: bytes) -> dict | RequestsReply:
    given = read_object(body)
    if isinstance(given, str):
        return refused("invalid_request", given, {})
    version = given.get("schema_version")
    if type(version) is int and version != SCHEMA_VERSION:
        return refused("unsupported_schema", "This application reads schema version one.", given, "schema_version")
    checked = read_strictly(given, UnansweredRequestsRequest, alternatives_of(generated))
    if isinstance(checked, list):
        failure = checked[0]
        return refused("invalid_request", "The request is not valid at " + (failure.field or "the request") + ": " + failure.reason + ".", given, failure.field)
    failures = version_failures(given, (("identity", "implementation_version"),))
    if failures:
        return refused("invalid_request", failures[0].reason + ".", given, failures[0].field)
    return given


class UnansweredRequests:
    def __init__(self, imports: Imports) -> None:
        self._imports = imports

    def unanswered_requests(self, body: bytes) -> RequestsReply:
        given = parse(body)
        if isinstance(given, RequestsReply):
            return given
        try:
            resolved = resolve_population(self._imports, given)
            if isinstance(resolved, Problem):
                return refused(resolved.code, resolved.message, given, resolved.field)
            prepared, population = resolved
            definition = given["definition"]
            both = sorted(set(definition["request_activities"]) & set(definition["answer_activities"]))
            if both:
                return refused("definition_invalid", f"“{both[0]}” is both a request and an answer; an activity can be one of them only.", given, "definition.answer_activities")
            known = {record.activity for history in prepared.histories.values() for record in history if record.activity is not None}
            for field in ("request_activities", "answer_activities"):
                missing = [activity for activity in definition[field] if activity not in known]
                if missing:
                    return refused("activity_unknown", f"“{missing[0]}” is no activity of this reading.", given, "definition." + field)
            turn = definition["turn"]
            if turn is not None and turn["column_index"] not in prepared.mapping["context_columns"]:
                return refused("column_not_context", "The turn column was not mapped as a context column when the source was interpreted.", given, "definition.turn.column_index")
            result = unanswered(prepared, population.case_ids, definition["request_activities"], definition["answer_activities"],
                                None if turn is None else (turn["column_index"], turn["value"]), definition["gap_hours"], given["case_limit"])
            answer = {"schema_version": SCHEMA_VERSION, "message_type": "unanswered_requests_answer", "request_id": given["request_id"],
                      "query_revision": given["query_revision"], "workspace_id": given["workspace_id"], "identity": population.identity,
                      "definition": definition, **result}
            checked = read_strictly(answer, UnansweredRequestsAnswer, alternatives_of(generated))
            if isinstance(checked, list):
                raise ValueError("The requests read are outside their contract at " + str(checked[0].field))
            return RequestsReply(200, answer)
        except Exception:
            logger.exception("The requests without an answer failed unexpectedly")
            return refused("computation_failed", "The requests could not be read. Retry; if it fails again, the application needs repair.", given)
