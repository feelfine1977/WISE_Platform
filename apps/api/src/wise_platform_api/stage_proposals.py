"""The values a mapped context column holds on every record of each labelled activity, from which stages may be proposed."""
from __future__ import annotations

from dataclasses import dataclass
import logging

from wise_platform_analytics.stage_proposal import value_counts

from .boundary import SCHEMA_VERSION, read_object
from .generated import stage_proposal as generated
from .generated.stage_proposal import StageProposalAnswer, StageProposalRefusal, StageProposalRequest
from .import_boundary import import_echo
from .imports import Imports
from .population_views import resolve_population
from .strict_reading import alternatives_of, read_strictly, version_failures
from .workspace import Problem

logger = logging.getLogger(__name__)

STATUS = {"invalid_request": 400, "unsupported_schema": 400, "invalid_parameter": 400,
          "workspace_unavailable": 404, "workspace_not_writable": 403, "workspace_incompatible": 409,
          "source_unavailable": 404, "memory_unavailable": 503, "preparation_unavailable": 404, "identity_mismatch": 409,
          "population_unavailable": 404, "column_not_context": 422, "computation_failed": 500}
RETRYABLE = frozenset({"workspace_unavailable", "workspace_not_writable", "source_unavailable", "memory_unavailable",
                       "preparation_unavailable", "population_unavailable", "computation_failed"})


@dataclass(frozen=True)
class ProposalReply:
    status: int
    body: dict


def refused(code: str, message: str, given: dict, field: str | None = None) -> ProposalReply:
    if code not in STATUS:
        code, message, field = "computation_failed", "The values of this column could not be counted from this preparation.", None
    body = StageProposalRefusal(schema_version=SCHEMA_VERSION, message_type="stage_proposal_refusal", **import_echo(given),
        operation="stage_proposal", code=code, message=message, field=field, retryable=code in RETRYABLE).model_dump(mode="json")
    return ProposalReply(STATUS[code], body)


def parse(body: bytes) -> dict | ProposalReply:
    given = read_object(body)
    if isinstance(given, str):
        return refused("invalid_request", given, {})
    version = given.get("schema_version")
    if type(version) is int and version != SCHEMA_VERSION:
        return refused("unsupported_schema", "This application reads schema version one.", given, "schema_version")
    checked = read_strictly(given, StageProposalRequest, alternatives_of(generated))
    if isinstance(checked, list):
        failure = checked[0]
        return refused("invalid_request", "The request is not valid at " + (failure.field or "the request") + ": " + failure.reason + ".", given, failure.field)
    failures = version_failures(given, (("identity", "implementation_version"),))
    if failures:
        return refused("invalid_request", failures[0].reason + ".", given, failures[0].field)
    return given


class StageProposals:
    def __init__(self, imports: Imports) -> None:
        self._imports = imports

    def stage_proposal(self, body: bytes) -> ProposalReply:
        given = parse(body)
        if isinstance(given, ProposalReply):
            return given
        try:
            resolved = resolve_population(self._imports, given)
            if isinstance(resolved, Problem):
                return refused(resolved.code, resolved.message, given, resolved.field)
            prepared, population = resolved
            column = given["column_index"]
            if column not in prepared.mapping["context_columns"]:
                return refused("column_not_context", "This column was not mapped as a context column when the source was interpreted. Map it in Data to read its values.",
                               given, "column_index")
            result = value_counts(prepared, population.case_ids, column, given["value_limit"])
            answer = {"schema_version": SCHEMA_VERSION, "message_type": "stage_proposal_answer", "request_id": given["request_id"],
                      "query_revision": given["query_revision"], "workspace_id": given["workspace_id"], "identity": population.identity,
                      "column_name": prepared.columns[column], **result}
            checked = read_strictly(answer, StageProposalAnswer, alternatives_of(generated))
            if isinstance(checked, list):
                raise ValueError("The counted values are outside their contract at " + str(checked[0].field))
            return ProposalReply(200, answer)
        except Exception:
            logger.exception("The values of a context column by activity failed unexpectedly")
            return refused("computation_failed", "The values of this column could not be counted. Retry; if it fails again, the application needs repair.", given)
