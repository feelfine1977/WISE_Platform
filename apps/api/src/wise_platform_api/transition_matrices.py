"""The transition matrix of a checked population: direct successions in the activity sequence, with typed measures."""
from __future__ import annotations

from dataclasses import dataclass
import logging

from wise_platform_analytics.transition_matrix import transition_matrix

from .boundary import SCHEMA_VERSION, read_object
from .generated import transition_matrix as generated
from .generated.transition_matrix import TransitionMatrixAnswer, TransitionMatrixRefusal, TransitionMatrixRequest
from .import_boundary import import_echo
from .imports import Imports
from .population_views import resolve_population
from .strict_reading import alternatives_of, read_strictly, version_failures
from .workspace import Problem

logger = logging.getLogger(__name__)

STATUS = {"invalid_request": 400, "unsupported_schema": 400, "invalid_parameter": 400,
          "workspace_unavailable": 404, "workspace_not_writable": 403, "workspace_incompatible": 409,
          "source_unavailable": 404, "memory_unavailable": 503, "preparation_unavailable": 404, "identity_mismatch": 409,
          "population_unavailable": 404, "computation_failed": 500}
RETRYABLE = frozenset({"workspace_unavailable", "workspace_not_writable", "source_unavailable", "memory_unavailable",
                       "preparation_unavailable", "population_unavailable", "computation_failed"})


@dataclass(frozen=True)
class MatrixReply:
    status: int
    body: dict


def refused(code: str, message: str, given: dict, field: str | None = None) -> MatrixReply:
    if code not in STATUS:
        code, message, field = "computation_failed", "The transition matrix could not be computed from this preparation.", None
    body = TransitionMatrixRefusal(schema_version=SCHEMA_VERSION, message_type="transition_matrix_refusal", **import_echo(given),
        operation="transition_matrix", code=code, message=message, field=field, retryable=code in RETRYABLE).model_dump(mode="json")
    return MatrixReply(STATUS[code], body)


def parse(body: bytes) -> dict | MatrixReply:
    given = read_object(body)
    if isinstance(given, str):
        return refused("invalid_request", given, {})
    version = given.get("schema_version")
    if type(version) is int and version != SCHEMA_VERSION:
        return refused("unsupported_schema", "This application reads schema version one.", given, "schema_version")
    checked = read_strictly(given, TransitionMatrixRequest, alternatives_of(generated))
    if isinstance(checked, list):
        failure = checked[0]
        return refused("invalid_request", "The request is not valid at " + (failure.field or "the request") + ": " + failure.reason + ".", given, failure.field)
    failures = version_failures(given, (("identity", "implementation_version"),))
    if failures:
        return refused("invalid_request", failures[0].reason + ".", given, failures[0].field)
    return given


class TransitionMatrices:
    def __init__(self, imports: Imports) -> None:
        self._imports = imports

    def transition_matrix(self, body: bytes) -> MatrixReply:
        given = parse(body)
        if isinstance(given, MatrixReply):
            return given
        try:
            resolved = resolve_population(self._imports, given)
            if isinstance(resolved, Problem):
                return refused(resolved.code, resolved.message, given, resolved.field)
            prepared, population = resolved
            result = transition_matrix(prepared, population.case_ids, given["witness_limit"])
            answer = {"schema_version": SCHEMA_VERSION, "message_type": "transition_matrix_answer", "request_id": given["request_id"],
                      "query_revision": given["query_revision"], "workspace_id": given["workspace_id"], "identity": population.identity, **result}
            checked = read_strictly(answer, TransitionMatrixAnswer, alternatives_of(generated))
            if isinstance(checked, list):
                raise ValueError("The computed matrix is outside its contract at " + str(checked[0].field))
            return MatrixReply(200, answer)
        except Exception:
            logger.exception("The transition matrix failed unexpectedly")
            return refused("computation_failed", "The transition matrix could not be computed. Retry; if it fails again, the application needs repair.", given)
