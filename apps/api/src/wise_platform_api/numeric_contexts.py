"""The numbers of a context column declared numeric: its range in the parent and its distribution on parent-fixed bins."""
from __future__ import annotations

from dataclasses import dataclass
import logging

from wise_platform_analytics.numeric_context import distribution, numeric_columns

from .boundary import SCHEMA_VERSION, read_object
from .generated import numeric_context as generated
from .generated.numeric_context import NumericContextAnswer, NumericContextRefusal, NumericContextRequest
from .import_boundary import import_echo
from .imports import Imports
from .population_views import resolve_population
from .strict_reading import alternatives_of, read_strictly, version_failures
from .workspace import Problem

logger = logging.getLogger(__name__)

STATUS = {"invalid_request": 400, "unsupported_schema": 400, "invalid_parameter": 400,
          "workspace_unavailable": 404, "workspace_not_writable": 403, "workspace_incompatible": 409,
          "source_unavailable": 404, "memory_unavailable": 503, "preparation_unavailable": 404, "identity_mismatch": 409,
          "population_unavailable": 404, "column_not_numeric": 422, "computation_failed": 500}
RETRYABLE = frozenset({"workspace_unavailable", "workspace_not_writable", "source_unavailable", "memory_unavailable",
                       "preparation_unavailable", "population_unavailable", "computation_failed"})


@dataclass(frozen=True)
class NumericReply:
    status: int
    body: dict


def refused(code: str, message: str, given: dict, field: str | None = None) -> NumericReply:
    if code not in STATUS:
        code, message, field = "computation_failed", "The numbers of this column could not be computed from this preparation.", None
    body = NumericContextRefusal(schema_version=SCHEMA_VERSION, message_type="numeric_context_refusal", **import_echo(given),
        operation="numeric_context", code=code, message=message, field=field, retryable=code in RETRYABLE).model_dump(mode="json")
    return NumericReply(STATUS[code], body)


def parse(body: bytes) -> dict | NumericReply:
    given = read_object(body)
    if isinstance(given, str):
        return refused("invalid_request", given, {})
    version = given.get("schema_version")
    if type(version) is int and version != SCHEMA_VERSION:
        return refused("unsupported_schema", "This application reads schema version one.", given, "schema_version")
    checked = read_strictly(given, NumericContextRequest, alternatives_of(generated))
    if isinstance(checked, list):
        failure = checked[0]
        return refused("invalid_request", "The request is not valid at " + (failure.field or "the request") + ": " + failure.reason + ".", given, failure.field)
    failures = version_failures(given, (("identity", "implementation_version"),))
    if failures:
        return refused("invalid_request", failures[0].reason + ".", given, failures[0].field)
    return given


class NumericContexts:
    def __init__(self, imports: Imports) -> None:
        self._imports = imports

    def numeric_context(self, body: bytes) -> NumericReply:
        given = parse(body)
        if isinstance(given, NumericReply):
            return given
        try:
            resolved = resolve_population(self._imports, given)
            if isinstance(resolved, Problem):
                return refused(resolved.code, resolved.message, given, resolved.field)
            prepared, population = resolved
            column = given["column_index"]
            if column not in numeric_columns(prepared):
                return refused("column_not_numeric", "This column was not declared a number when the source was interpreted. Declare it in Data to read its numbers.",
                               given, "column_index")
            result = distribution(prepared, population.case_ids, population.parent_ids, column, given["projection"], given["bin_count"])
            answer = {"schema_version": SCHEMA_VERSION, "message_type": "numeric_context_answer", "request_id": given["request_id"],
                      "query_revision": given["query_revision"], "workspace_id": given["workspace_id"], "identity": population.identity,
                      "parent_identity": population.parent_identity, "column_name": prepared.columns[column], **result}
            checked = read_strictly(answer, NumericContextAnswer, alternatives_of(generated))
            if isinstance(checked, list):
                raise ValueError("The computed numbers are outside their contract at " + str(checked[0].field))
            return NumericReply(200, answer)
        except Exception:
            logger.exception("The numbers of a context column failed unexpectedly")
            return refused("computation_failed", "The numbers of this column could not be computed. Retry; if it fails again, the application needs repair.", given)
