"""Suggestions of incidents with a similar sequence of activities, by a method fixed on the frozen parent."""
from __future__ import annotations

from dataclasses import dataclass
import logging

from wise_platform_analytics.similar_sequences import similar

from .boundary import SCHEMA_VERSION, read_object
from .generated import similar_sequences as generated
from .generated.similar_sequences import SimilarSequencesAnswer, SimilarSequencesRefusal, SimilarSequencesRequest
from .import_boundary import import_echo
from .imports import Imports
from .population_views import resolve_population
from .strict_reading import alternatives_of, read_strictly, version_failures
from .workspace import Problem

logger = logging.getLogger(__name__)

STATUS = {"invalid_request": 400, "unsupported_schema": 400, "invalid_parameter": 400,
          "workspace_unavailable": 404, "workspace_not_writable": 403, "workspace_incompatible": 409,
          "source_unavailable": 404, "memory_unavailable": 503, "preparation_unavailable": 404, "identity_mismatch": 409,
          "population_unavailable": 404, "invalid_parameter": 400, "computation_failed": 500}
RETRYABLE = frozenset({"workspace_unavailable", "workspace_not_writable", "source_unavailable", "memory_unavailable",
                       "preparation_unavailable", "population_unavailable", "computation_failed"})


@dataclass(frozen=True)
class SimilarReply:
    status: int
    body: dict


def refused(code: str, message: str, given: dict, field: str | None = None) -> SimilarReply:
    if code not in STATUS:
        code, message, field = "computation_failed", "The similar sequences could not be computed from this preparation.", None
    body = SimilarSequencesRefusal(schema_version=SCHEMA_VERSION, message_type="similar_sequences_refusal", **import_echo(given),
        operation="similar_sequences", code=code, message=message, field=field, retryable=code in RETRYABLE).model_dump(mode="json")
    return SimilarReply(STATUS[code], body)


def parse(body: bytes) -> dict | SimilarReply:
    given = read_object(body)
    if isinstance(given, str):
        return refused("invalid_request", given, {})
    version = given.get("schema_version")
    if type(version) is int and version != SCHEMA_VERSION:
        return refused("unsupported_schema", "This application reads schema version one.", given, "schema_version")
    checked = read_strictly(given, SimilarSequencesRequest, alternatives_of(generated))
    if isinstance(checked, list):
        failure = checked[0]
        return refused("invalid_request", "The request is not valid at " + (failure.field or "the request") + ": " + failure.reason + ".", given, failure.field)
    failures = version_failures(given, (("identity", "implementation_version"),))
    if failures:
        return refused("invalid_request", failures[0].reason + ".", given, failures[0].field)
    return given


class SimilarSequences:
    def __init__(self, imports: Imports) -> None:
        self._imports = imports

    def similar_sequences(self, body: bytes) -> SimilarReply:
        given = parse(body)
        if isinstance(given, SimilarReply):
            return given
        try:
            resolved = resolve_population(self._imports, given)
            if isinstance(resolved, Problem):
                return refused(resolved.code, resolved.message, given, resolved.field)
            prepared, population = resolved
            # The method is applied to the frozen parent: the suggestions of a distance do not follow the kept incidents.
            result = similar(prepared, population.parent_ids, population.case_ids, given["anchor"], given["maximum_edits"])
            answer = {"schema_version": SCHEMA_VERSION, "message_type": "similar_sequences_answer", "request_id": given["request_id"],
                      "query_revision": given["query_revision"], "workspace_id": given["workspace_id"], "identity": population.identity,
                      "parent_identity": population.parent_identity, **result}
            checked = read_strictly(answer, SimilarSequencesAnswer, alternatives_of(generated))
            if isinstance(checked, list):
                raise ValueError("The similar sequences are outside their contract at " + str(checked[0].field))
            return SimilarReply(200, answer)
        except Exception:
            logger.exception("The similar sequences failed unexpectedly")
            return refused("computation_failed", "The similar sequences could not be computed. Retry; if it fails again, the application needs repair.", given)
